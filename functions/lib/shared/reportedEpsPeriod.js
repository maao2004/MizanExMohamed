"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MISSING_REPORTED_EPS_PERIOD_ERROR_AR = exports.REPORTED_EPS_FIELD_GROUP = exports.REPORTED_EPS_PERIOD_FIELDS = exports.REPORTED_EPS_EXCEL_COLUMNS = exports.ALLOWED_REPORTED_EPS_PERIOD_TYPES = exports.REPORTED_EPS_PERIOD_OPTIONS = void 0;
exports.addIsoCalendarDays = addIsoCalendarDays;
exports.getReportedEpsPeriodOption = getReportedEpsPeriodOption;
exports.parseReportedEpsPeriodTypeInput = parseReportedEpsPeriodTypeInput;
exports.parseReportedEpsFiscalQuarterInput = parseReportedEpsFiscalQuarterInput;
exports.parseReportedEpsFiscalYearInput = parseReportedEpsFiscalYearInput;
exports.formatReportedEpsPeriodDisplay = formatReportedEpsPeriodDisplay;
exports.hasExplicitReportedEpsValue = hasExplicitReportedEpsValue;
exports.validateAndNormalizeReportedEpsPeriod = validateAndNormalizeReportedEpsPeriod;
exports.classifyLegacyReportedEpsPeriod = classifyLegacyReportedEpsPeriod;
exports.resolveImportedReportedEpsPeriod = resolveImportedReportedEpsPeriod;
exports.resolveCanonicalReportedEpsPeriod = resolveCanonicalReportedEpsPeriod;
exports.evaluateReportedEpsPeriodAlignment = evaluateReportedEpsPeriodAlignment;
exports.suggestReportedEpsPeriodDates = suggestReportedEpsPeriodDates;
exports.auditLegacyReportedEpsRecord = auditLegacyReportedEpsRecord;
const normalization_1 = require("./normalization");
exports.REPORTED_EPS_PERIOD_OPTIONS = [
    {
        code: 'standalone_quarter',
        labelAr: 'ربع مالي منفرد',
        shortLabelAr: 'ربع منفرد',
        requiresFiscalYear: true,
        requiresFiscalQuarter: true,
        allowedQuarters: ['Q1', 'Q2', 'Q3', 'Q4'],
        requiresDates: true,
        descriptionAr: 'ربحية السهم لربع مالي واحد منفرد (مثل Q3 منفرد أو Q4 منفرد). لا تُقارن بالأرقام التراكمية YTD أو السنوية FY؛ وفي Q1 فقط تتطابق حدود التواريخ مع Q1 التراكمي دون تغيير تصنيفها.',
    },
    {
        code: 'ytd',
        labelAr: 'تراكمي منذ بداية السنة المالية YTD',
        shortLabelAr: 'تراكمي YTD',
        requiresFiscalYear: true,
        requiresFiscalQuarter: true,
        allowedQuarters: ['Q1', 'Q2', 'Q3'],
        requiresDates: true,
        descriptionAr: 'ربحية السهم التراكمية منذ بداية السنة المالية للشركة حتى نهاية الربع المحدد (Q1 أو Q2 أو Q3). للسنة المالية الكاملة اختر «سنة مالية كاملة FY».',
    },
    {
        code: 'fy',
        labelAr: 'سنة مالية كاملة FY',
        shortLabelAr: 'سنة مالية FY',
        requiresFiscalYear: true,
        requiresFiscalQuarter: false,
        allowedQuarters: [],
        requiresDates: true,
        descriptionAr: 'ربحية السهم لسنة مالية كاملة (12 شهراً موثقة من بداية السنة المالية حتى نهايتها، مثل يناير–ديسمبر أو يوليو–يونيو)، وليست الربع الرابع المنفرد.',
    },
    {
        code: 'ttm',
        labelAr: 'آخر 12 شهراً TTM',
        shortLabelAr: 'آخر 12 شهراً TTM',
        requiresFiscalYear: false,
        requiresFiscalQuarter: false,
        allowedQuarters: [],
        requiresDates: true,
        descriptionAr: 'ربحية السهم لآخر 12 شهراً متصلة (Trailing 12 Months) وفق تاريخي البداية والنهاية الموثقين؛ ولا تطابق FY إلا عند تطابق تاريخي البداية والنهاية فعلياً.',
    },
    {
        code: 'needs_review',
        labelAr: 'غير محدد / يحتاج مراجعة',
        shortLabelAr: 'يحتاج مراجعة',
        requiresFiscalYear: false,
        requiresFiscalQuarter: false,
        allowedQuarters: [],
        requiresDates: false,
        descriptionAr: 'فترة غير محددة أو موروثة من نص غامض تحتاج مراجعة يدوية. تُحجب مقارنة ReportedEPS مقابل AccountingEPS فقط دون تعطيل نماذج التقييم المستقلة.',
    },
];
exports.ALLOWED_REPORTED_EPS_PERIOD_TYPES = new Set(exports.REPORTED_EPS_PERIOD_OPTIONS.map((o) => o.code));
exports.REPORTED_EPS_EXCEL_COLUMNS = {
    periodType: 'ReportedEPS_PeriodType',
    fiscalYear: 'ReportedEPS_FiscalYear',
    fiscalQuarter: 'ReportedEPS_FiscalQuarter',
    periodStart: 'ReportedEPS_PeriodStart',
    periodEnd: 'ReportedEPS_PeriodEnd',
    displayPeriod: 'ReportedEPS_Period',
};
/**
 * Atomic 6-field period definition group for ReportedEPS.
 * Whenever any key in this group is supplied on write, the group is evaluated
 * as a complete definition (omitted subfields become `null` — never inherited from a prior period).
 */
exports.REPORTED_EPS_PERIOD_FIELDS = [
    'reportedEpsPeriodType',
    'reportedEpsFiscalYear',
    'reportedEpsFiscalQuarter',
    'reportedEpsPeriodStart',
    'reportedEpsPeriodEnd',
    'reportedEpsPeriod',
];
/**
 * Complete 8-field ReportedEPS unit treated consistently across source, projection, and contentHash.
 */
exports.REPORTED_EPS_FIELD_GROUP = [
    'reportedEps',
    'reportedEpsSource',
    ...exports.REPORTED_EPS_PERIOD_FIELDS,
];
function spanDaysInclusive(startDate, endDate) {
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const startMs = Date.UTC(sy, sm - 1, sd);
    const endMs = Date.UTC(ey, em - 1, ed);
    return Math.floor((endMs - startMs) / 86_400_000) + 1;
}
function addIsoCalendarDays(isoDate, deltaDays) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}
function getIsoYear(isoDate) {
    return Number(isoDate.slice(0, 4));
}
function normalizeArabicWhitespace(text) {
    return text.trim().replace(/\s+/g, ' ');
}
function getReportedEpsPeriodOption(code) {
    if (!code)
        return null;
    return exports.REPORTED_EPS_PERIOD_OPTIONS.find((o) => o.code === code) ?? null;
}
/**
 * Parses either a canonical internal code or its exact Arabic UI label into ReportedEpsPeriodType.
 * Never guesses from free-text descriptions.
 */
function parseReportedEpsPeriodTypeInput(raw) {
    const clean = (0, normalization_1.parseCleanText)(raw);
    if (!clean)
        return null;
    const lower = clean.toLowerCase();
    if (exports.ALLOWED_REPORTED_EPS_PERIOD_TYPES.has(lower)) {
        return lower;
    }
    const normalizedAr = normalizeArabicWhitespace(clean);
    for (const opt of exports.REPORTED_EPS_PERIOD_OPTIONS) {
        if (normalizeArabicWhitespace(opt.labelAr) === normalizedAr ||
            normalizeArabicWhitespace(opt.shortLabelAr) === normalizedAr) {
            return opt.code;
        }
    }
    throw new Error(`قيمة نوع فترة ReportedEPS_PeriodType غير صالحة (${clean}). القيم المعتمدة: standalone_quarter | ytd | fy | ttm | needs_review (أو المسمى العربي المطابق من القائمة).`);
}
function parseReportedEpsFiscalQuarterInput(raw) {
    const clean = (0, normalization_1.parseCleanText)(raw);
    if (!clean)
        return null;
    const upper = clean.toUpperCase();
    if (upper === 'Q1' || upper === 'Q2' || upper === 'Q3' || upper === 'Q4') {
        return upper;
    }
    throw new Error(`قيمة الربع المالي لفترة ReportedEPS_FiscalQuarter غير صالحة (${clean})؛ المسموح: Q1 | Q2 | Q3 | Q4.`);
}
function parseReportedEpsFiscalYearInput(raw) {
    if (raw === undefined || raw === null || raw === '')
        return null;
    const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1900 || num > 2200) {
        throw new Error('السنة المالية لفترة ReportedEPS_FiscalYear يجب أن تكون عدداً صحيحاً بين 1900 و 2200.');
    }
    return num;
}
/**
 * Derives a deterministic, read-only display label from the structured ReportedEPS period.
 */
function formatReportedEpsPeriodDisplay(params) {
    const range = params.periodStart && params.periodEnd ? ` (${params.periodStart} → ${params.periodEnd})` : '';
    switch (params.periodType) {
        case 'standalone_quarter': {
            const q = params.fiscalQuarter ?? 'Q?';
            const y = params.fiscalYear != null ? ` ${params.fiscalYear}` : '';
            return `${q}${y} — ربع مالي منفرد${range}`;
        }
        case 'ytd': {
            const q = params.fiscalQuarter ?? 'Q?';
            const y = params.fiscalYear != null ? ` ${params.fiscalYear}` : '';
            return `${q}${y} — تراكمي YTD${range}`;
        }
        case 'fy': {
            const y = params.fiscalYear != null ? ` ${params.fiscalYear}` : '';
            return `FY${y} — سنة مالية كاملة${range}`;
        }
        case 'ttm': {
            return `TTM — آخر 12 شهراً${range}`;
        }
        case 'needs_review': {
            const cleanLegacy = (0, normalization_1.parseCleanText)(params.legacyText);
            return cleanLegacy
                ? `غير محدد / يحتاج مراجعة (النص السابق: ${cleanLegacy})`
                : 'غير محدد / يحتاج مراجعة';
        }
    }
}
function validateSpanForPeriodType(periodType, fiscalQuarter, startDate, endDate) {
    const span = spanDaysInclusive(startDate, endDate);
    if (span < 1 || span > 370) {
        throw new Error(`طول فترة ReportedEPS المحسوب من التواريخ (${span} يوماً) خارج النطاق المسموح (1..370 يوماً).`);
    }
    if (periodType === 'fy') {
        if (span < 360 || span > 370) {
            throw new Error(`فترة السنة المالية الكاملة FY تتطلب نطاق تواريخ يغطي 12 شهراً (360–370 يوماً)، بينما النطاق المدخل (${startDate} → ${endDate}) يساوي ${span} يوماً.`);
        }
        return;
    }
    if (periodType === 'ttm') {
        if (span < 360 || span > 370) {
            throw new Error(`فترة آخر 12 شهراً TTM تتطلب نطاق تواريخ يغطي 12 شهراً (360–370 يوماً)، بينما النطاق المدخل (${startDate} → ${endDate}) يساوي ${span} يوماً.`);
        }
        return;
    }
    if (periodType === 'standalone_quarter') {
        if (span < 60 || span > 125) {
            throw new Error(`فترة الربع المالي المنفرد (${fiscalQuarter ?? '-'}) لا تتسق مع النطاق (${startDate} → ${endDate} = ${span} يوماً)؛ تحقق من عدم إدخال تواريخ فترة تراكمية YTD أو سنة كاملة FY.`);
        }
        return;
    }
    if (periodType === 'ytd') {
        if (fiscalQuarter === 'Q1' && (span < 60 || span > 125)) {
            throw new Error(`الفترة التراكمية Q1 YTD لا تتسق مع النطاق (${startDate} → ${endDate} = ${span} يوماً؛ المتوقع قرابة ربع واحد 60–125 يوماً).`);
        }
        if (fiscalQuarter === 'Q2' && (span < 150 || span > 215)) {
            throw new Error(`الفترة التراكمية Q2 YTD لا تتسق مع النطاق (${startDate} → ${endDate} = ${span} يوماً؛ المتوقع قرابة نصف سنة 150–215 يوماً).`);
        }
        if (fiscalQuarter === 'Q3' && (span < 240 || span > 305)) {
            throw new Error(`الفترة التراكمية Q3 YTD لا تتسق مع النطاق (${startDate} → ${endDate} = ${span} يوماً؛ المتوقع قرابة 9 أشهر 240–305 يوماً).`);
        }
    }
}
function validateFiscalYearAgainstDates(fiscalYear, startDate, endDate) {
    const startY = getIsoYear(startDate);
    const endY = getIsoYear(endDate);
    // Supports calendar years (Jan-Dec) AND non-calendar fiscal years (e.g. Jul 2025 - Jun 2026 = FY 2026 or FY 2025 depending on company convention)
    if (fiscalYear < startY - 1 || fiscalYear > endY + 1) {
        throw new Error(`السنة المالية المحددة (${fiscalYear}) تتعارض مع نطاق التواريخ (${startDate} → ${endDate}).`);
    }
}
/**
 * Single Source of Truth predicate: distinguishes an explicit numeric ReportedEPS value
 * (INCLUDING `0` and negative values) from absence (`null` / `undefined` / `NaN`).
 */
function hasExplicitReportedEpsValue(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
exports.MISSING_REPORTED_EPS_PERIOD_ERROR_AR = 'عند إدخال قيمة ReportedEPS (بما فيها الصفر أو القيم السالبة) يلزم تحديد نوع فترة ReportedEPS_PeriodType من القائمة المعتمدة، أو اختيار «غير محدد / يحتاج مراجعة» (needs_review) إذا كانت الفترة غير موثقة.';
/**
 * Validates and normalizes structured ReportedEPS period fields using the central contract.
 * - Single Source of Truth for AddModal, EditModal, Excel Importer, and Server `validateRecords`.
 * - Enforces that any explicit `reportedEps` (including `0` and negative values) cannot be written
 *   with an empty period unless explicitly handled (`needs_review` or operational type).
 * - Preserves structured fields as the sole authoritative source and derives `reportedEpsPeriod` for display only.
 */
function validateAndNormalizeReportedEpsPeriod(input, options) {
    const requirePeriodWhenEpsPresent = options?.requirePeriodWhenEpsPresent ?? true;
    const allowLegacyPeriodTextOnly = options?.allowLegacyPeriodTextOnly ?? false;
    const rawType = parseReportedEpsPeriodTypeInput(input.reportedEpsPeriodType);
    const rawYear = parseReportedEpsFiscalYearInput(input.reportedEpsFiscalYear);
    const rawQuarter = parseReportedEpsFiscalQuarterInput(input.reportedEpsFiscalQuarter);
    const rawStart = (0, normalization_1.parseCleanText)(input.reportedEpsPeriodStart);
    const rawEnd = (0, normalization_1.parseCleanText)(input.reportedEpsPeriodEnd);
    const rawLegacyDisplay = (0, normalization_1.parseCleanText)(input.reportedEpsPeriod);
    const hasEps = hasExplicitReportedEpsValue(input.reportedEps);
    const hasAnyStructuredOtherThanType = rawYear !== null || rawQuarter !== null || rawStart !== null || rawEnd !== null;
    if (rawType === null) {
        if (hasAnyStructuredOtherThanType) {
            throw new Error('تم إدخال حقول فرعية لفترة ReportedEPS (سنة/ربع/تواريخ) دون تحديد نوع الفترة (ReportedEPS_PeriodType).');
        }
        if (rawLegacyDisplay && rawLegacyDisplay.length > 160) {
            throw new Error('وصف فترة ReportedEPS_Period يجب ألا يتجاوز 160 حرفاً.');
        }
        if (rawLegacyDisplay && !allowLegacyPeriodTextOnly) {
            throw new Error(exports.MISSING_REPORTED_EPS_PERIOD_ERROR_AR);
        }
        if (hasEps && requirePeriodWhenEpsPresent) {
            if (!rawLegacyDisplay || !allowLegacyPeriodTextOnly) {
                throw new Error(exports.MISSING_REPORTED_EPS_PERIOD_ERROR_AR);
            }
        }
        return {
            reportedEpsPeriodType: null,
            reportedEpsFiscalYear: null,
            reportedEpsFiscalQuarter: null,
            reportedEpsPeriodStart: null,
            reportedEpsPeriodEnd: null,
            reportedEpsPeriod: rawLegacyDisplay,
        };
    }
    // Validate date pair syntax/order if any date is provided
    if ((rawStart && !rawEnd) || (!rawStart && rawEnd)) {
        throw new Error('يلزم إدخال تاريخي بداية ونهاية فترة ReportedEPS معاً (ReportedEPS_PeriodStart و ReportedEPS_PeriodEnd).');
    }
    if (rawStart && rawEnd) {
        if (!(0, normalization_1.isValidCalendarDate)(rawStart) || !(0, normalization_1.isValidCalendarDate)(rawEnd)) {
            throw new Error('تاريخ بداية أو نهاية فترة ReportedEPS غير صالح تقويمياً (المطلوب YYYY-MM-DD مع مراعاة السنوات الكبيسة).');
        }
        if (rawStart > rawEnd) {
            throw new Error(`تاريخ بداية فترة ReportedEPS (${rawStart}) يجب أن يسبق أو يساوي تاريخ نهايتها (${rawEnd}).`);
        }
    }
    if (rawType === 'needs_review') {
        if (rawStart && rawEnd) {
            const span = spanDaysInclusive(rawStart, rawEnd);
            if (span < 1 || span > 370) {
                throw new Error(`طول فترة ReportedEPS المحسوب من التواريخ (${span} يوماً) خارج النطاق المسموح (1..370 يوماً).`);
            }
        }
        if (rawLegacyDisplay && rawLegacyDisplay.length > 160) {
            throw new Error('وصف فترة ReportedEPS_Period يجب ألا يتجاوز 160 حرفاً.');
        }
        return {
            reportedEpsPeriodType: 'needs_review',
            reportedEpsFiscalYear: rawYear,
            reportedEpsFiscalQuarter: rawQuarter,
            reportedEpsPeriodStart: rawStart,
            reportedEpsPeriodEnd: rawEnd,
            reportedEpsPeriod: rawLegacyDisplay,
        };
    }
    // The 4 operational types all require explicit documented start and end dates
    if (!rawStart || !rawEnd) {
        throw new Error(`يلزم توثيق تاريخي بداية ونهاية فترة ReportedEPS (${exports.REPORTED_EPS_EXCEL_COLUMNS.periodStart} و ${exports.REPORTED_EPS_EXCEL_COLUMNS.periodEnd}) عند اختيار نوع الفترة (${rawType}).`);
    }
    if (rawType === 'standalone_quarter') {
        if (rawYear === null) {
            throw new Error('السنة المالية (ReportedEPS_FiscalYear) مطلوبة لفترة الربع المالي المنفرد.');
        }
        if (rawQuarter === null) {
            throw new Error('الربع المالي (ReportedEPS_FiscalQuarter: Q1..Q4) مطلوب لفترة الربع المالي المنفرد.');
        }
        validateSpanForPeriodType('standalone_quarter', rawQuarter, rawStart, rawEnd);
        validateFiscalYearAgainstDates(rawYear, rawStart, rawEnd);
    }
    else if (rawType === 'ytd') {
        if (rawYear === null) {
            throw new Error('السنة المالية (ReportedEPS_FiscalYear) مطلوبة للفترة التراكمية YTD.');
        }
        if (rawQuarter === null) {
            throw new Error('الربع المالي (ReportedEPS_FiscalQuarter: Q1..Q3) مطلوب للفترة التراكمية YTD.');
        }
        if (rawQuarter === 'Q4') {
            throw new Error('الفترة التراكمية لأربعة أرباع تمثل سنة مالية كاملة؛ اختر نوع الفترة «سنة مالية كاملة FY» بدلاً من Q4 تراكمي.');
        }
        validateSpanForPeriodType('ytd', rawQuarter, rawStart, rawEnd);
        validateFiscalYearAgainstDates(rawYear, rawStart, rawEnd);
    }
    else if (rawType === 'fy') {
        if (rawYear === null) {
            throw new Error('السنة المالية (ReportedEPS_FiscalYear) مطلوبة لفترة السنة المالية الكاملة FY.');
        }
        if (rawQuarter !== null) {
            throw new Error('السنة المالية الكاملة FY لا تقبل رمز ربع (Q1–Q4)؛ إذا كانت القيمة للربع الرابع منفرداً فاختر «ربع مالي منفرد» مع Q4.');
        }
        validateSpanForPeriodType('fy', null, rawStart, rawEnd);
        validateFiscalYearAgainstDates(rawYear, rawStart, rawEnd);
    }
    else if (rawType === 'ttm') {
        if (rawQuarter !== null) {
            throw new Error('فترة آخر 12 شهراً TTM تُعرَّف بتاريخي البداية والنهاية ولا تقبل رمز ربع (Q1–Q4).');
        }
        validateSpanForPeriodType('ttm', null, rawStart, rawEnd);
        if (rawYear !== null) {
            validateFiscalYearAgainstDates(rawYear, rawStart, rawEnd);
        }
    }
    const derivedDisplay = formatReportedEpsPeriodDisplay({
        periodType: rawType,
        fiscalYear: rawYear,
        fiscalQuarter: rawQuarter,
        periodStart: rawStart,
        periodEnd: rawEnd,
    });
    return {
        reportedEpsPeriodType: rawType,
        reportedEpsFiscalYear: rawYear,
        reportedEpsFiscalQuarter: rawQuarter,
        reportedEpsPeriodStart: rawStart,
        reportedEpsPeriodEnd: rawEnd,
        reportedEpsPeriod: derivedDisplay,
    };
}
function getDocumentedRecordBounds(ctx) {
    if (!ctx)
        return null;
    const s = (0, normalization_1.parseCleanText)(ctx.periodStartDate);
    const e = (0, normalization_1.parseCleanText)(ctx.periodEndDate);
    if (!s || !e)
        return null;
    if (!(0, normalization_1.isValidCalendarDate)(s) || !(0, normalization_1.isValidCalendarDate)(e) || s > e)
        return null;
    const spanDays = spanDaysInclusive(s, e);
    if (spanDays < 1 || spanDays > 370)
        return null;
    return { start: s, end: e, spanDays };
}
const ENGLISH_MONTH_PATTERNS = [
    { regex: /\b(?:JANUARY|JAN)\b/gi, monthNumber: 1 },
    { regex: /\b(?:FEBRUARY|FEB)\b/gi, monthNumber: 2 },
    { regex: /\b(?:MARCH|MAR)\b/gi, monthNumber: 3 },
    { regex: /\b(?:APRIL|APR)\b/gi, monthNumber: 4 },
    { regex: /\bMAY\b/gi, monthNumber: 5 },
    { regex: /\b(?:JUNE|JUN)\b/gi, monthNumber: 6 },
    { regex: /\b(?:JULY|JUL)\b/gi, monthNumber: 7 },
    { regex: /\b(?:AUGUST|AUG)\b/gi, monthNumber: 8 },
    { regex: /\b(?:SEPTEMBER|SEPT|SEP)\b/gi, monthNumber: 9 },
    { regex: /\b(?:OCTOBER|OCT)\b/gi, monthNumber: 10 },
    { regex: /\b(?:NOVEMBER|NOV)\b/gi, monthNumber: 11 },
    { regex: /\b(?:DECEMBER|DEC)\b/gi, monthNumber: 12 },
];
const ARABIC_MONTH_PATTERNS = [
    { regex: /يناير/g, monthNumber: 1 },
    { regex: /فبراير/g, monthNumber: 2 },
    { regex: /مارس/g, monthNumber: 3 },
    { regex: /أبريل|ابريل/g, monthNumber: 4 },
    { regex: /مايو/g, monthNumber: 5 },
    { regex: /يونيو|يونية/g, monthNumber: 6 },
    { regex: /يوليو|يولية/g, monthNumber: 7 },
    { regex: /أغسطس|اغسطس/g, monthNumber: 8 },
    { regex: /سبتمبر/g, monthNumber: 9 },
    { regex: /أكتوبر|اكتوبر/g, monthNumber: 10 },
    { regex: /نوفمبر/g, monthNumber: 11 },
    { regex: /ديسمبر/g, monthNumber: 12 },
];
function inspectLegacyPeriodTextSignals(clean) {
    const isoDates = Array.from(clean.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)).map((m) => m[0]);
    const numericDates = Array.from(clean.matchAll(/\b(?:\d{4}[/.]\d{1,2}[/.]\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\b/g))
        .map((m) => m[0])
        .filter((tok) => !isoDates.includes(tok));
    const strippedIso = clean.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
    const yearMonths = Array.from(strippedIso.matchAll(/\b(?:19|20|21)\d{2}[-/](?:0?[1-9]|1[0-2])\b/g)).map((m) => m[0]);
    const dualYears = Array.from(strippedIso.matchAll(/\b(?:19|20|21)\d{2}\s*[-/]\s*(?:(?:19|20|21)\d{2}|\d{2})\b/g))
        .map((m) => m[0])
        .filter((tok) => !yearMonths.includes(tok));
    const months = [];
    for (const entry of [...ENGLISH_MONTH_PATTERNS, ...ARABIC_MONTH_PATTERNS]) {
        for (const m of clean.matchAll(entry.regex)) {
            months.push({ token: m[0], monthNumber: entry.monthNumber });
        }
    }
    const distinctYears = Array.from(new Set(Array.from(clean.matchAll(/\b(19\d{2}|20\d{2}|21\d{2})\b/g)).map((m) => Number(m[1]))));
    const hasRangeOrQualifierSyntax = /[()[\]→←—–]/.test(clean) ||
        /->|<-/.test(clean) ||
        /\b(?:ENDED|ENDING|END|UNTIL|THRU|THROUGH|FROM|TO|AS\s+OF|RESTATED|UNAUDITED|ESTIMATED)\b/i.test(clean) ||
        /حتى|إلى|الى|المنتهية|منتهي|للفترة|معدل|غير\s+مدقق/.test(clean);
    const hasAnyEmbeddedTemporalDetails = isoDates.length > 0 ||
        numericDates.length > 0 ||
        yearMonths.length > 0 ||
        dualYears.length > 0 ||
        months.length > 0 ||
        distinctYears.length > 1 ||
        hasRangeOrQualifierSyntax;
    return {
        isoDates,
        numericDates,
        yearMonths,
        dualYears,
        months,
        distinctYears,
        hasRangeOrQualifierSyntax,
        hasAnyEmbeddedTemporalDetails,
    };
}
function getIsoMonth(isoDate) {
    return Number(isoDate.slice(5, 7));
}
function describeEmbeddedTemporalConflict(clean, signals, docBounds) {
    const remediationAr = 'افتح السجل واختر نوع فترة ReportedEPS الصريح وحدد تاريخي البداية والنهاية الفعليين لفترة ربحية السهم المعلنة في الحقول البنيوية المعتمدة (دون الخلط مع فترة السجل المالي).';
    if (docBounds) {
        // 1) Explicit ISO date pair or single ISO date conflicting with record boundaries
        if (signals.isoDates.length >= 2) {
            const [firstIso, secondIso] = signals.isoDates;
            if (firstIso !== docBounds.start || secondIso !== docBounds.end) {
                return {
                    hasDirectConflict: true,
                    reasonAr: `تعارض زمني صريح: النص القديم "${clean}" يذكر النطاق (${firstIso} → ${secondIso}) بينما تواريخ السجل المالي هي (${docBounds.start} → ${docBounds.end})؛ لا يُسمح بتجاهل تواريخ النص أو استبدالها بتواريخ السجل تلقائياً.`,
                    remediationAr,
                };
            }
        }
        else if (signals.isoDates.length === 1) {
            const singleIso = signals.isoDates[0];
            if (singleIso !== docBounds.end && singleIso !== docBounds.start) {
                return {
                    hasDirectConflict: true,
                    reasonAr: `تعارض زمني صريح: النص القديم "${clean}" يذكر التاريخ (${singleIso}) وهو لا يطابق حدود السجل المالي (${docBounds.start} → ${docBounds.end})؛ تم وسمه كـ needs_review دون استبدال التاريخ صامتاً.`,
                    remediationAr,
                };
            }
        }
        // 2) Numeric slash/dot dates (e.g. 30/06/2026) — never silently discard
        if (signals.numericDates.length > 0) {
            return {
                hasDirectConflict: true,
                reasonAr: `النص القديم "${clean}" يحتوي تاريخاً/تواريخ رقمية مضمّنة (${signals.numericDates.join(', ')}) لا يجوز تجاهلها أو استبدالها بحدود السجل المالي (${docBounds.start} → ${docBounds.end}) تلقائياً.`,
                remediationAr,
            };
        }
        // 3) Year-Month token (e.g. 2026-06) conflicting with record start/end
        if (signals.yearMonths.length > 0) {
            const recordStartYm = docBounds.start.slice(0, 7);
            const recordEndYm = docBounds.end.slice(0, 7);
            const conflictingYm = signals.yearMonths.find((ym) => {
                const normalizedYm = ym.replace('/', '-');
                const [y, m] = normalizedYm.split('-');
                const padded = `${y}-${m.padStart(2, '0')}`;
                return padded !== recordStartYm && padded !== recordEndYm;
            });
            if (conflictingYm) {
                return {
                    hasDirectConflict: true,
                    reasonAr: `تعارض زمني صريح: النص القديم "${clean}" يذكر الشهر (${conflictingYm}) وهو لا يطابق حدود السجل المالي (${docBounds.start} → ${docBounds.end})؛ تم وسمه كـ needs_review دون تجاهل التاريخ.`,
                    remediationAr,
                };
            }
        }
        // 4) Month name (English or Arabic, e.g. June / يونيو vs September / 2026-09-30)
        if (signals.months.length > 0) {
            const startMonth = getIsoMonth(docBounds.start);
            const endMonth = getIsoMonth(docBounds.end);
            const conflictingMonth = signals.months.find((m) => m.monthNumber !== startMonth && m.monthNumber !== endMonth);
            if (conflictingMonth) {
                return {
                    hasDirectConflict: true,
                    reasonAr: `تعارض زمني صريح: النص القديم "${clean}" يشير إلى شهر "${conflictingMonth.token}" وهو يتعارض مع حدود السجل المالي (${docBounds.start} → ${docBounds.end})؛ لا يُسمح بتجاهل نهاية الفترة المذكورة في النص.`,
                    remediationAr,
                };
            }
        }
        // 5) Dual fiscal year (e.g. 2025/2026) conflicting with single-calendar-year record (2026-01-01..2026-12-31)
        if (signals.dualYears.length > 0 || signals.distinctYears.length > 1) {
            const startYear = getIsoYear(docBounds.start);
            const endYear = getIsoYear(docBounds.end);
            if (startYear === endYear) {
                return {
                    hasDirectConflict: true,
                    reasonAr: `تعارض زمني صريح: النص القديم "${clean}" يشير إلى سنتين تقويميتين بينما السجل المالي يغطي سنة تقويمية واحدة (${docBounds.start} → ${docBounds.end})؛ تم وسمه كـ needs_review دون تحويل تلقائي.`,
                    remediationAr,
                };
            }
        }
    }
    return {
        hasDirectConflict: false,
        reasonAr: `النص القديم "${clean}" يتضمن تواريخ أو تفاصيل أو نطاقاً زمنياً مضمّناً داخل نص حر/وصف مشتق دون حقول بنيوية معتمدة (ReportedEPS_PeriodType وReportedEPS_PeriodStart وReportedEPS_PeriodEnd)؛ لا يُعاد تفسير النص الحر كمصدر موازٍ وتلزم المراجعة اليدوية لتثبيت الحقول البنيوية.`,
        remediationAr,
    };
}
/**
 * Strict full-string allow-list parsers for pure legacy period tokens ONLY.
 * Rejects ANY string with leftover tokens, embedded dates, months, parentheses, or qualifiers.
 */
function matchPureLegacyFyToken(normalizedSpaceText) {
    const m = normalizedSpaceText.match(/^(?:FY\s*(19\d{2}|20\d{2}|21\d{2})|(19\d{2}|20\d{2}|21\d{2})\s*FY|FULL\s+YEAR\s+(19\d{2}|20\d{2}|21\d{2})|ANNUAL\s+(19\d{2}|20\d{2}|21\d{2})|السنة\s+المالية\s+(19\d{2}|20\d{2}|21\d{2})|سنة\s+مالية\s+كاملة\s+(19\d{2}|20\d{2}|21\d{2}))$/i);
    if (!m)
        return null;
    const yearStr = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
    return yearStr ? Number(yearStr) : null;
}
function matchPureLegacyYtdToken(normalizedSpaceText) {
    let m = normalizedSpaceText.match(/^(Q[1-3])\s+(19\d{2}|20\d{2}|21\d{2})\s+(?:YTD|CUMULATIVE|تراكمي)$/i);
    if (m)
        return { quarter: m[1].toUpperCase(), year: Number(m[2]) };
    m = normalizedSpaceText.match(/^(19\d{2}|20\d{2}|21\d{2})\s*(Q[1-3])\s+(?:YTD|CUMULATIVE|تراكمي)$/i);
    if (m)
        return { year: Number(m[1]), quarter: m[2].toUpperCase() };
    m = normalizedSpaceText.match(/^(?:YTD|CUMULATIVE|تراكمي)\s+(Q[1-3])\s+(19\d{2}|20\d{2}|21\d{2})$/i);
    if (m)
        return { quarter: m[1].toUpperCase(), year: Number(m[2]) };
    m = normalizedSpaceText.match(/^(6M|H1|9M)\s+(19\d{2}|20\d{2}|21\d{2})$/i);
    if (m) {
        const tok = m[1].toUpperCase();
        return { quarter: tok === '9M' ? 'Q3' : 'Q2', year: Number(m[2]) };
    }
    m = normalizedSpaceText.match(/^(19\d{2}|20\d{2}|21\d{2})\s+(6M|H1|9M)$/i);
    if (m) {
        const tok = m[2].toUpperCase();
        return { year: Number(m[1]), quarter: tok === '9M' ? 'Q3' : 'Q2' };
    }
    return null;
}
function matchPureLegacyQ1StandaloneToken(normalizedSpaceText) {
    const m = normalizedSpaceText.match(/^(?:Q1\s+(19\d{2}|20\d{2}|21\d{2})\s+(?:STANDALONE|ربع\s*(?:مالي\s*)?منفرد|منفرد)|(19\d{2}|20\d{2}|21\d{2})\s*Q1\s+(?:STANDALONE|ربع\s*(?:مالي\s*)?منفرد|منفرد))$/i);
    if (!m)
        return null;
    const yearStr = m[1] || m[2];
    return yearStr ? Number(yearStr) : null;
}
/**
 * Explicit, conservative, conflict-aware classification of legacy `ReportedEPS_Period` strings.
 * - NEVER ignores embedded dates, months, dual fiscal years, ranges, or conflicting qualifiers.
 * - NEVER silently replaces dates embedded in text with the financial record's dates.
 * - NEVER re-parses derived display labels as a parallel source of truth when structured fields are absent.
 * - NEVER maps `Q3 ... standalone` to YTD or `Q4 ... standalone` (or bare `Q4 ...`) to FY.
 * - NEVER invents Jan 1–Dec 31 dates when record boundaries are missing.
 * - Converts ONLY strictly allow-listed pure legacy tokens paired with matching documented record boundaries.
 * - Marks all ambiguous, conflicting, undated, or date-bearing free-text strings as `needs_review`.
 */
function classifyLegacyReportedEpsPeriod(rawLegacyText, recordContext) {
    const clean = (0, normalization_1.parseCleanText)(rawLegacyText);
    if (!clean) {
        return {
            status: 'empty',
            legacyText: null,
            detectedIntent: null,
            resolved: null,
            reasonAr: 'حقل فترة ReportedEPS غير مدخل.',
            remediationAr: 'اختر نوع فترة ReportedEPS وحدد تاريخي البداية والنهاية الموثقين في السجل.',
        };
    }
    const normalizedSpace = normalizeArabicWhitespace(clean);
    const upper = normalizedSpace.toUpperCase();
    const hasStandaloneMarker = /\bSTANDALONE\b|\bSINGLE\s*QUARTER\b|\bQUARTER\s*ONLY\b|\b3M\s*ONLY\b|ربع\s*(?:مالي\s*)?منفرد|منفرد/.test(upper) || /منفرد/.test(normalizedSpace);
    const hasYtdMarker = /\bYTD\b|\bCUMULATIVE\b|\b6M\b|\b9M\b|\bH1\b|تراكمي/.test(upper) ||
        /تراكمي/.test(normalizedSpace);
    const hasFyMarker = /\bFY\b|\bFULL\s*YEAR\b|\bANNUAL\b|سنة\s*مالية\s*كاملة|السنة\s*المالية/.test(upper) ||
        /سنة\s*مالية/.test(normalizedSpace);
    const hasTtmMarker = /\bTTM\b|\bLTM\b|آخر\s*12\s*شه/.test(upper) || /آخر\s*12\s*شه/.test(normalizedSpace);
    const markerCount = [hasStandaloneMarker, hasYtdMarker, hasFyMarker, hasTtmMarker].filter(Boolean).length;
    if (markerCount > 1) {
        return {
            status: 'needs_review',
            legacyText: clean,
            detectedIntent: null,
            resolved: null,
            reasonAr: `النص السابق "${clean}" يحتوي مؤشرات متعارضة لأكثر من نوع فترة (standalone / YTD / FY / TTM) ويحتاج مراجعة يدوية.`,
            remediationAr: 'حدد نوع فترة ReportedEPS الصريح وتاريخي البداية والنهاية من القائمة المقيدة.',
        };
    }
    const quarterMatches = Array.from(upper.matchAll(/\b(Q[1-4])\b/g)).map((m) => m[1]);
    const compactMatch = upper.match(/\b(19\d{2}|20\d{2}|21\d{2})\s*[-_/]?\s*(Q[1-4]|FY)\b/);
    const parsedQuarter = quarterMatches.length === 1
        ? quarterMatches[0]
        : compactMatch && compactMatch[2] !== 'FY'
            ? compactMatch[2]
            : null;
    // Conflicting multiple quarters or Q4 combined with FY
    if (quarterMatches.length > 1) {
        return {
            status: 'needs_review',
            legacyText: clean,
            detectedIntent: null,
            resolved: null,
            reasonAr: `النص السابق "${clean}" يذكر أكثر من ربع مالي ويحتاج مراجعة يدوية.`,
            remediationAr: 'حدد نوع الفترة وتاريخي البداية والنهاية بوضوح.',
        };
    }
    if (hasFyMarker && parsedQuarter !== null) {
        return {
            status: 'needs_review',
            legacyText: clean,
            detectedIntent: null,
            resolved: null,
            reasonAr: `النص السابق "${clean}" يخلط بين سنة مالية كاملة FY والربع (${parsedQuarter}) ويحتاج مراجعة يدوية.`,
            remediationAr: 'اختر «ربع مالي منفرد» إذا كانت القيمة للربع فقط، أو «سنة مالية كاملة FY» إذا كانت للسنة الكاملة.',
        };
    }
    const docBounds = getDocumentedRecordBounds(recordContext);
    const signals = inspectLegacyPeriodTextSignals(normalizedSpace);
    const preliminaryIntent = hasStandaloneMarker
        ? 'standalone_quarter'
        : hasFyMarker
            ? 'fy'
            : hasYtdMarker
                ? 'ytd'
                : hasTtmMarker
                    ? 'ttm'
                    : null;
    // CRITICAL GUARD: Never ignore embedded dates, months, dual fiscal years, ranges, parentheses,
    // or derived display strings! Always return `needs_review` with explicit conflict diagnostics.
    if (signals.hasAnyEmbeddedTemporalDetails) {
        const conflictInfo = describeEmbeddedTemporalConflict(clean, signals, docBounds);
        return {
            status: 'needs_review',
            legacyText: clean,
            detectedIntent: conflictInfo.hasDirectConflict ? null : preliminaryIntent,
            resolved: null,
            reasonAr: conflictInfo.reasonAr,
            remediationAr: conflictInfo.remediationAr,
        };
    }
    // 1) Pure allow-listed Full Fiscal Year (e.g. "FY 2025", "2025FY", "Full Year 2025")
    const pureFyYear = matchPureLegacyFyToken(normalizedSpace);
    if (pureFyYear !== null) {
        if (recordContext?.quarter === 'FY' &&
            recordContext?.year === pureFyYear &&
            docBounds &&
            docBounds.spanDays >= 360 &&
            docBounds.spanDays <= 370) {
            try {
                validateSpanForPeriodType('fy', null, docBounds.start, docBounds.end);
                validateFiscalYearAgainstDates(pureFyYear, docBounds.start, docBounds.end);
                const displayLabel = formatReportedEpsPeriodDisplay({
                    periodType: 'fy',
                    fiscalYear: pureFyYear,
                    fiscalQuarter: null,
                    periodStart: docBounds.start,
                    periodEnd: docBounds.end,
                });
                return {
                    status: 'unambiguous_convertible',
                    legacyText: clean,
                    detectedIntent: 'fy',
                    resolved: {
                        periodType: 'fy',
                        fiscalYear: pureFyYear,
                        fiscalQuarter: null,
                        periodStart: docBounds.start,
                        periodEnd: docBounds.end,
                        displayLabel,
                    },
                    reasonAr: `نص صريح لسنة مالية كاملة (${clean}) مطابق لحدود سجل FY ${pureFyYear} الموثقة (${docBounds.start} → ${docBounds.end}) دون أي تعارض أو تواريخ إضافية.`,
                    remediationAr: null,
                };
            }
            catch {
                // Fall through to needs_review when dates do not match fiscal year cleanly
            }
        }
        return {
            status: 'needs_review',
            legacyText: clean,
            detectedIntent: 'fy',
            resolved: null,
            reasonAr: `النص السابق "${clean}" يشير إلى سنة مالية كاملة ولكن حدود التواريخ الموثقة للسنة غير مكتملة أو لا تطابق السجل (${recordContext?.quarter ?? '-'} ${recordContext?.year ?? '-'})؛ لا تُفترض تواريخ 1 يناير–31 ديسمبر تلقائياً.`,
            remediationAr: 'اختر «سنة مالية كاملة FY» وأدخل تاريخي بداية ونهاية السنة المالية الموثقين.',
        };
    }
    // 2) Pure allow-listed Cumulative YTD (e.g. "Q3 2025 YTD", "9M 2025", "H1 2025")
    const pureYtd = matchPureLegacyYtdToken(normalizedSpace);
    if (pureYtd !== null) {
        if (recordContext?.quarter === pureYtd.quarter &&
            recordContext?.year === pureYtd.year &&
            docBounds) {
            try {
                validateSpanForPeriodType('ytd', pureYtd.quarter, docBounds.start, docBounds.end);
                validateFiscalYearAgainstDates(pureYtd.year, docBounds.start, docBounds.end);
                const displayLabel = formatReportedEpsPeriodDisplay({
                    periodType: 'ytd',
                    fiscalYear: pureYtd.year,
                    fiscalQuarter: pureYtd.quarter,
                    periodStart: docBounds.start,
                    periodEnd: docBounds.end,
                });
                return {
                    status: 'unambiguous_convertible',
                    legacyText: clean,
                    detectedIntent: 'ytd',
                    resolved: {
                        periodType: 'ytd',
                        fiscalYear: pureYtd.year,
                        fiscalQuarter: pureYtd.quarter,
                        periodStart: docBounds.start,
                        periodEnd: docBounds.end,
                        displayLabel,
                    },
                    reasonAr: `نص صريح لفترة تراكمية (${clean}) مطابق لحدود سجل ${pureYtd.quarter} ${pureYtd.year} الموثقة (${docBounds.start} → ${docBounds.end}) دون أي تعارض أو تواريخ إضافية.`,
                    remediationAr: null,
                };
            }
            catch {
                // Fall through to needs_review when documented record dates don't fit YTD span/year
            }
        }
        return {
            status: 'needs_review',
            legacyText: clean,
            detectedIntent: 'ytd',
            resolved: null,
            reasonAr: `النص السابق "${clean}" يشير إلى فترة تراكمية YTD دون توثيق متطابق لتاريخي البداية والنهاية على السجل.`,
            remediationAr: 'اختر «تراكمي منذ بداية السنة المالية YTD» وأدخل تاريخي البداية والنهاية الموثقين.',
        };
    }
    // 3) Pure allow-listed Q1 standalone ONLY (Q2/Q3/Q4 standalone never borrow cumulative record start dates!)
    const pureQ1StandaloneYear = matchPureLegacyQ1StandaloneToken(normalizedSpace);
    if (pureQ1StandaloneYear !== null) {
        if (recordContext?.quarter === 'Q1' &&
            recordContext?.year === pureQ1StandaloneYear &&
            docBounds &&
            docBounds.spanDays >= 60 &&
            docBounds.spanDays <= 125) {
            try {
                validateSpanForPeriodType('standalone_quarter', 'Q1', docBounds.start, docBounds.end);
                validateFiscalYearAgainstDates(pureQ1StandaloneYear, docBounds.start, docBounds.end);
                const displayLabel = formatReportedEpsPeriodDisplay({
                    periodType: 'standalone_quarter',
                    fiscalYear: pureQ1StandaloneYear,
                    fiscalQuarter: 'Q1',
                    periodStart: docBounds.start,
                    periodEnd: docBounds.end,
                });
                return {
                    status: 'unambiguous_convertible',
                    legacyText: clean,
                    detectedIntent: 'standalone_quarter',
                    resolved: {
                        periodType: 'standalone_quarter',
                        fiscalYear: pureQ1StandaloneYear,
                        fiscalQuarter: 'Q1',
                        periodStart: docBounds.start,
                        periodEnd: docBounds.end,
                        displayLabel,
                    },
                    reasonAr: `نص صريح لربع أول منفرد (${clean}) مع حدود Q1 موثقة (${docBounds.start} → ${docBounds.end}).`,
                    remediationAr: null,
                };
            }
            catch {
                // Fall through to needs_review
            }
        }
    }
    // 4) Non-allow-listed Standalone Quarter (e.g. Q3/Q4 standalone or undated Q1)
    if (hasStandaloneMarker) {
        return {
            status: 'needs_review',
            legacyText: clean,
            detectedIntent: 'standalone_quarter',
            resolved: null,
            reasonAr: `النص السابق "${clean}" يشير إلى ربع مالي منفرد ولا يجوز تفسيره كـ YTD أو FY؛ كما أن تاريخي بداية ونهاية الربع المنفرد غير موثقين في الحقول البنيوية.`,
            remediationAr: 'افتح السجل واختر «ربع مالي منفرد» وأدخل تاريخي بداية ونهاية هذا الربع المنفرد كما وردت في القوائم المالية.',
        };
    }
    // 5) Explicit TTM (without structured start/end dates, TTM boundaries cannot be invented)
    if (hasTtmMarker) {
        return {
            status: 'needs_review',
            legacyText: clean,
            detectedIntent: 'ttm',
            resolved: null,
            reasonAr: `النص السابق "${clean}" يشير إلى آخر 12 شهراً TTM دون توثيق صريح لتاريخي بداية ونهاية نافذة TTM؛ لا تُخمن حدود TTM تلقائياً.`,
            remediationAr: 'اختر «آخر 12 شهراً TTM» وأدخل تاريخي بداية ونهاية نافذة الـ 12 شهراً الموثقة.',
        };
    }
    // 6) Non-allow-listed FY / YTD / ambiguous free text (e.g. "Q3 2026", "Q4 2026", "FY 2026 extra note", "Q4 2026 YTD")
    if (hasFyMarker) {
        return {
            status: 'needs_review',
            legacyText: clean,
            detectedIntent: 'fy',
            resolved: null,
            reasonAr: `النص السابق "${clean}" يحتوي تفاصيل غير قابلة للتحقق التلقائي أو غير مطابقة لصيغة FY الموثقة؛ تم وسمه كـ needs_review دون تخمين.`,
            remediationAr: 'اختر «سنة مالية كاملة FY» وأدخل السنة وتاريخي البداية والنهاية الموثقين في الحقول البنيوية.',
        };
    }
    if (hasYtdMarker) {
        return {
            status: 'needs_review',
            legacyText: clean,
            detectedIntent: 'ytd',
            resolved: null,
            reasonAr: `النص السابق "${clean}" يشير إلى فترة تراكمية YTD غير مكتملة أو تحتوي تفاصيل إضافية لا يجوز التحويل التلقائي فوقها (يلزم Q1/Q2/Q3 موثقة التواريخ، أو استخدام FY للسنة الكاملة).`,
            remediationAr: 'اختر «تراكمي منذ بداية السنة المالية YTD» وأدخل الربع والسنة وتاريخي البداية والنهاية الموثقين.',
        };
    }
    return {
        status: 'needs_review',
        legacyText: clean,
        detectedIntent: null,
        resolved: null,
        reasonAr: `النص السابق "${clean}" غامض ولا يميز بوضوح بين ربع منفرد، تراكمي YTD، سنة مالية كاملة FY، أو TTM؛ تم وسمه للمراجعة دون تخمين النوع أو التواريخ.`,
        remediationAr: 'افتح السجل واختر نوع فترة ReportedEPS الصريح وتاريخي البداية والنهاية الموثقين.',
    };
}
/**
 * Central import-time resolver for ReportedEPS period fields (Single Source of Truth for Excel parsers).
 * - Enforces the exact same central contract as UI and `validateRecords`:
 *   - Valid structured fields -> preserved as authoritative source.
 *   - Invalid structured fields -> throws strict validation error (row rejected).
 *   - Legacy-only unambiguous bare token with matching documented record dates -> upgraded cleanly.
 *   - Legacy-only conflicting/ambiguous/date-bearing text -> marked `needs_review` with preview warning, preserving original text and ReportedEPS value.
 *   - Missing period when `reportedEps` is explicitly present (including `0` and negative values) -> NEVER left empty silently; marked `needs_review` with preview warning without picking an operational default.
 */
function resolveImportedReportedEpsPeriod(input, recordContext) {
    const hasEps = hasExplicitReportedEpsValue(input.reportedEps);
    const rawLegacyDisplay = (0, normalization_1.parseCleanText)(input.reportedEpsPeriod);
    const rawTypeText = (0, normalization_1.parseCleanText)(input.reportedEpsPeriodType);
    const hasAnyStructuredInput = rawTypeText !== null ||
        (0, normalization_1.parseCleanText)(input.reportedEpsFiscalYear) !== null ||
        (0, normalization_1.parseCleanText)(input.reportedEpsFiscalQuarter) !== null ||
        (0, normalization_1.parseCleanText)(input.reportedEpsPeriodStart) !== null ||
        (0, normalization_1.parseCleanText)(input.reportedEpsPeriodEnd) !== null;
    // 1) Structured fields supplied -> validate strictly using the central write contract
    if (hasAnyStructuredInput) {
        const normalized = validateAndNormalizeReportedEpsPeriod(input, {
            requirePeriodWhenEpsPresent: true,
            allowLegacyPeriodTextOnly: false,
        });
        if (normalized.reportedEpsPeriodType === 'needs_review') {
            const warningAr = hasEps
                ? `قيمة ReportedEPS (${input.reportedEps}) موسومة كـ «غير محدد / يحتاج مراجعة» (needs_review)${normalized.reportedEpsPeriod ? ` · النص المرجعي: "${normalized.reportedEpsPeriod}"` : ''}؛ ستُحفظ القيمة مع حجب المقارنة فقط حتى توثيق الفترة.`
                : null;
            return {
                normalized,
                warningAr,
                classification: 'needs_review',
            };
        }
        return {
            normalized,
            warningAr: null,
            classification: 'structured_valid',
        };
    }
    // 2) No structured fields, legacy ReportedEPS_Period text supplied -> conservative classification
    if (rawLegacyDisplay) {
        if (rawLegacyDisplay.length > 160) {
            throw new Error('وصف فترة ReportedEPS_Period يجب ألا يتجاوز 160 حرفاً.');
        }
        const legacyClassified = classifyLegacyReportedEpsPeriod(rawLegacyDisplay, recordContext);
        if (legacyClassified.status === 'unambiguous_convertible' && legacyClassified.resolved) {
            return {
                normalized: {
                    reportedEpsPeriodType: legacyClassified.resolved.periodType,
                    reportedEpsFiscalYear: legacyClassified.resolved.fiscalYear,
                    reportedEpsFiscalQuarter: legacyClassified.resolved.fiscalQuarter,
                    reportedEpsPeriodStart: legacyClassified.resolved.periodStart,
                    reportedEpsPeriodEnd: legacyClassified.resolved.periodEnd,
                    reportedEpsPeriod: legacyClassified.resolved.displayLabel,
                },
                warningAr: null,
                classification: 'legacy_unambiguous_upgraded',
            };
        }
        const remediationSuffix = legacyClassified.remediationAr ? ` ${legacyClassified.remediationAr}` : '';
        return {
            normalized: {
                reportedEpsPeriodType: 'needs_review',
                reportedEpsFiscalYear: null,
                reportedEpsFiscalQuarter: null,
                reportedEpsPeriodStart: null,
                reportedEpsPeriodEnd: null,
                reportedEpsPeriod: rawLegacyDisplay,
            },
            warningAr: `${legacyClassified.reasonAr}${remediationSuffix} (تم وسم السجل كـ needs_review مع الحفاظ على النص الأصلي وقيمة ReportedEPS دون اختيار فترة تشغيلية تلقائياً).`,
            classification: 'needs_review',
        };
    }
    // 3) Neither structured fields nor legacy text — if ReportedEPS is present (including 0 or negative),
    //    NEVER allow silent empty period! Classify explicitly as `needs_review` with preview warning.
    if (hasEps) {
        return {
            normalized: {
                reportedEpsPeriodType: 'needs_review',
                reportedEpsFiscalYear: null,
                reportedEpsFiscalQuarter: null,
                reportedEpsPeriodStart: null,
                reportedEpsPeriodEnd: null,
                reportedEpsPeriod: null,
            },
            warningAr: `تم إدخال ReportedEPS (${input.reportedEps}) دون تحديد نوع الفترة أو نصها؛ تم وسم السجل كـ «غير محدد / يحتاج مراجعة» (needs_review) في المعاينة دون اختيار فترة تشغيلية تلقائياً، وستُحجب المقارنة فقط حتى توثيق الفترة.`,
            classification: 'needs_review',
        };
    }
    // 4) Neither ReportedEPS nor any period input -> clean empty
    return {
        normalized: {
            reportedEpsPeriodType: null,
            reportedEpsFiscalYear: null,
            reportedEpsFiscalQuarter: null,
            reportedEpsPeriodStart: null,
            reportedEpsPeriodEnd: null,
            reportedEpsPeriod: null,
        },
        warningAr: null,
        classification: 'empty',
    };
}
/**
 * Resolves the canonical ReportedEPS period for a record (strictly preferring structured fields over legacy text).
 * - Never re-parses derived display text when valid structured fields are present.
 * - Preserves full read compatibility for pre-existing legacy Firestore records without inventing dates/types.
 */
function resolveCanonicalReportedEpsPeriod(record) {
    const hasStructuredType = record.reportedEpsPeriodType !== undefined &&
        record.reportedEpsPeriodType !== null &&
        String(record.reportedEpsPeriodType).trim() !== '';
    if (hasStructuredType) {
        try {
            const normalized = validateAndNormalizeReportedEpsPeriod(record, {
                requirePeriodWhenEpsPresent: false,
                allowLegacyPeriodTextOnly: true,
            });
            if (normalized.reportedEpsPeriodType === 'needs_review') {
                const legacyText = normalized.reportedEpsPeriod;
                const legacyDiagnostic = legacyText
                    ? classifyLegacyReportedEpsPeriod(legacyText, {
                        year: record.year,
                        quarter: record.quarter,
                        periodStartDate: record.periodStartDate,
                        periodEndDate: record.periodEndDate,
                    })
                    : null;
                const displayLabel = formatReportedEpsPeriodDisplay({
                    periodType: 'needs_review',
                    legacyText,
                });
                return {
                    status: 'needs_review',
                    source: 'structured',
                    period: {
                        periodType: 'needs_review',
                        fiscalYear: normalized.reportedEpsFiscalYear,
                        fiscalQuarter: normalized.reportedEpsFiscalQuarter,
                        periodStart: normalized.reportedEpsPeriodStart,
                        periodEnd: normalized.reportedEpsPeriodEnd,
                        displayLabel,
                    },
                    periodType: 'needs_review',
                    legacyText,
                    detectedIntent: legacyDiagnostic?.detectedIntent ?? null,
                    displayLabel,
                    reasonAr: legacyDiagnostic && legacyDiagnostic.status === 'needs_review'
                        ? legacyDiagnostic.reasonAr
                        : 'فترة ReportedEPS موسومة صراحةً بأنها «غير محدد / يحتاج مراجعة».',
                    remediationAr: legacyDiagnostic?.remediationAr ??
                        'اختر نوع الفترة الصريح وتاريخي البداية والنهاية الموثقين في السجل.',
                };
            }
            if (normalized.reportedEpsPeriodType !== null) {
                const displayLabel = normalized.reportedEpsPeriod ??
                    formatReportedEpsPeriodDisplay({
                        periodType: normalized.reportedEpsPeriodType,
                        fiscalYear: normalized.reportedEpsFiscalYear,
                        fiscalQuarter: normalized.reportedEpsFiscalQuarter,
                        periodStart: normalized.reportedEpsPeriodStart,
                        periodEnd: normalized.reportedEpsPeriodEnd,
                    });
                return {
                    status: 'valid',
                    source: 'structured',
                    period: {
                        periodType: normalized.reportedEpsPeriodType,
                        fiscalYear: normalized.reportedEpsFiscalYear,
                        fiscalQuarter: normalized.reportedEpsFiscalQuarter,
                        periodStart: normalized.reportedEpsPeriodStart,
                        periodEnd: normalized.reportedEpsPeriodEnd,
                        displayLabel,
                    },
                    periodType: normalized.reportedEpsPeriodType,
                    legacyText: null,
                    detectedIntent: normalized.reportedEpsPeriodType,
                    displayLabel,
                    reasonAr: null,
                    remediationAr: null,
                };
            }
        }
        catch (err) {
            const legacyText = (0, normalization_1.parseCleanText)(record.reportedEpsPeriod);
            return {
                status: 'needs_review',
                source: 'structured',
                period: null,
                periodType: 'needs_review',
                legacyText,
                detectedIntent: null,
                displayLabel: formatReportedEpsPeriodDisplay({
                    periodType: 'needs_review',
                    legacyText,
                }),
                reasonAr: err instanceof Error
                    ? `بيانات فترة ReportedEPS البنيوية غير صالحة أو متضاربة: ${err.message}`
                    : 'بيانات فترة ReportedEPS البنيوية غير صالحة أو متضاربة.',
                remediationAr: 'صحّح نوع فترة ReportedEPS وتاريخي البداية والنهاية في السجل.',
            };
        }
    }
    // Fallback for pre-existing unmigrated legacy records (ONLY allow-listed bare tokens with matching documented boundaries)
    const legacyText = (0, normalization_1.parseCleanText)(record.reportedEpsPeriod);
    if (!legacyText) {
        return {
            status: 'empty',
            source: 'empty',
            period: null,
            periodType: null,
            legacyText: null,
            detectedIntent: null,
            displayLabel: null,
            reasonAr: 'لم يتم تحديد فترة ReportedEPS في السجل.',
            remediationAr: 'افتح السجل واختر نوع فترة ReportedEPS وتاريخي البداية والنهاية.',
        };
    }
    const classified = classifyLegacyReportedEpsPeriod(legacyText, {
        year: record.year,
        quarter: record.quarter,
        periodStartDate: record.periodStartDate,
        periodEndDate: record.periodEndDate,
    });
    if (classified.status === 'unambiguous_convertible' && classified.resolved) {
        return {
            status: 'valid',
            source: 'legacy_unambiguous',
            period: classified.resolved,
            periodType: classified.resolved.periodType,
            legacyText,
            detectedIntent: classified.resolved.periodType,
            displayLabel: classified.resolved.displayLabel,
            reasonAr: null,
            remediationAr: null,
        };
    }
    return {
        status: 'needs_review',
        source: 'legacy_ambiguous',
        period: null,
        periodType: 'needs_review',
        legacyText,
        detectedIntent: classified.detectedIntent,
        displayLabel: formatReportedEpsPeriodDisplay({
            periodType: 'needs_review',
            legacyText,
        }),
        reasonAr: classified.reasonAr,
        remediationAr: classified.remediationAr,
    };
}
/**
 * Strict temporal alignment engine for comparing ReportedEPS against AccountingEPS.
 * Rules enforced:
 * - Standalone quarter is NEVER compared against YTD, FY, or TTM unless it is fiscal Q1 with identical documented start/end boundaries (without reclassifying standalone_quarter to ytd).
 * - YTD is matched ONLY against latest cumulative YTD with matching quarter, year, and exact start/end boundaries.
 * - FY is a full fiscal year (never standalone Q4); matches latest FY or TTM ONLY when documented start/end boundaries match identically.
 * - TTM matches AccountingEPS TTM ONLY when documented start/end boundaries match identically.
 * - Missing/ambiguous/conflicting boundaries always withhold comparison with a clear Arabic reason & remediation.
 */
function evaluateReportedEpsPeriodAlignment(params) {
    const { resolution, latestAccountingTarget, ttmAccountingTarget } = params;
    const baseDecision = {
        reportedDisplayLabel: resolution.displayLabel,
        reportedPeriodType: resolution.periodType,
        reportedPeriodStart: resolution.period?.periodStart ?? null,
        reportedPeriodEnd: resolution.period?.periodEnd ?? null,
    };
    if (resolution.status !== 'valid' || !resolution.period) {
        return {
            ...baseDecision,
            matched: false,
            target: null,
            q1BoundaryOverlap: false,
            accountingPeriodLabel: latestAccountingTarget?.label ?? null,
            accountingPeriodStart: latestAccountingTarget?.periodStart ?? null,
            accountingPeriodEnd: latestAccountingTarget?.periodEnd ?? null,
            reasonAr: resolution.reasonAr ||
                'تم حجب المقارنة المباشرة لأن فترة ReportedEPS غير محددة بوضوح أو تحتاج مراجعة.',
            remediationAr: resolution.remediationAr ||
                'افتح السجل وحدد نوع فترة ReportedEPS الصريح وتاريخي بدايتها ونهايتها.',
        };
    }
    const p = resolution.period;
    const rStart = p.periodStart;
    const rEnd = p.periodEnd;
    if (!rStart || !rEnd) {
        return {
            ...baseDecision,
            matched: false,
            target: null,
            q1BoundaryOverlap: false,
            accountingPeriodLabel: latestAccountingTarget?.label ?? null,
            accountingPeriodStart: latestAccountingTarget?.periodStart ?? null,
            accountingPeriodEnd: latestAccountingTarget?.periodEnd ?? null,
            reasonAr: 'تم حجب المقارنة المباشرة لعدم توثيق تاريخي بداية ونهاية فترة ReportedEPS.',
            remediationAr: 'أدخل ReportedEPS_PeriodStart و ReportedEPS_PeriodEnd الموثقين في السجل.',
        };
    }
    // 1. Standalone Quarter
    if (p.periodType === 'standalone_quarter') {
        // Only fiscal Q1 can share identical documented boundaries with latest Q1 YTD (without reclassifying standalone_quarter!)
        if (p.fiscalQuarter === 'Q1' &&
            latestAccountingTarget &&
            latestAccountingTarget.kind === 'ytd' &&
            latestAccountingTarget.fiscalQuarter === 'Q1') {
            if (!latestAccountingTarget.isCompleteBoundaries) {
                return {
                    ...baseDecision,
                    matched: false,
                    target: null,
                    q1BoundaryOverlap: false,
                    accountingPeriodLabel: latestAccountingTarget.label,
                    accountingPeriodStart: latestAccountingTarget.periodStart,
                    accountingPeriodEnd: latestAccountingTarget.periodEnd,
                    reasonAr: 'تم حجب مقارنة Q1 المنفرد مقابل Q1 التراكمي لعدم توثيق تاريخي بداية ونهاية السجل المالي (PeriodStartDate / PeriodEndDate).',
                    remediationAr: 'وثّق PeriodStartDate و PeriodEndDate على سجل Q1 للتحقق من تطابق الحدود الزمنية.',
                };
            }
            if (p.fiscalYear === latestAccountingTarget.fiscalYear &&
                rStart === latestAccountingTarget.periodStart &&
                rEnd === latestAccountingTarget.periodEnd) {
                return {
                    ...baseDecision,
                    matched: true,
                    target: 'latest',
                    q1BoundaryOverlap: true,
                    accountingPeriodLabel: latestAccountingTarget.label,
                    accountingPeriodStart: latestAccountingTarget.periodStart,
                    accountingPeriodEnd: latestAccountingTarget.periodEnd,
                    reasonAr: `تتطابق حدود الربع الأول المنفرد (${rStart} → ${rEnd}) فعلياً مع حدود سجل Q1 التراكمي الموثقة دون تغيير تصنيف الفترة عن «ربع مالي منفرد».`,
                    remediationAr: null,
                };
            }
            return {
                ...baseDecision,
                matched: false,
                target: null,
                q1BoundaryOverlap: false,
                accountingPeriodLabel: latestAccountingTarget.label,
                accountingPeriodStart: latestAccountingTarget.periodStart,
                accountingPeriodEnd: latestAccountingTarget.periodEnd,
                reasonAr: `تم حجب المقارنة لاختلاف الحدود الزمنية الموثقة بين ReportedEPS (${p.displayLabel}) وسجل AccountingEPS (${latestAccountingTarget.label ?? '-'} : ${latestAccountingTarget.periodStart ?? '-'} → ${latestAccountingTarget.periodEnd ?? '-'}).`,
                remediationAr: 'راجع تواريخ فترة ReportedEPS وتواريخ السجل المالي للتأكد من تغطيتهما نفس الفترة.',
            };
        }
        return {
            ...baseDecision,
            matched: false,
            target: null,
            q1BoundaryOverlap: false,
            accountingPeriodLabel: latestAccountingTarget?.label ?? null,
            accountingPeriodStart: latestAccountingTarget?.periodStart ?? null,
            accountingPeriodEnd: latestAccountingTarget?.periodEnd ?? null,
            reasonAr: `تم حجب المقارنة المباشرة لأن ReportedEPS يمثل ربعاً مالياً منفرداً (${p.displayLabel})، بينما AccountingEPS المحسوب يغطي فترة تراكمية YTD أو سنة كاملة FY أو آخر 12 شهراً TTM ولا يجوز خلطهما.`,
            remediationAr: 'لا تُقارن ربحية ربع منفرد مع رقم تراكمي/سنوي؛ إذا كانت القوائم تفصح أيضاً عن EPS التراكمي أو السنوي فوثّقه في حقل ReportedEPS بدلاً من الربع المنفرد أو اتركها للمرجعية المنفصلة.',
        };
    }
    // 2. Cumulative YTD
    if (p.periodType === 'ytd') {
        if (!latestAccountingTarget || latestAccountingTarget.kind !== 'ytd') {
            return {
                ...baseDecision,
                matched: false,
                target: null,
                q1BoundaryOverlap: false,
                accountingPeriodLabel: latestAccountingTarget?.label ?? null,
                accountingPeriodStart: latestAccountingTarget?.periodStart ?? null,
                accountingPeriodEnd: latestAccountingTarget?.periodEnd ?? null,
                reasonAr: `تم حجب المقارنة المباشرة لأن ReportedEPS يغطي فترة تراكمية YTD (${p.displayLabel}) بينما أحدث سجل محاسبي ليس فترة YTD مطابقة (${latestAccountingTarget?.label ?? '-'}).`,
                remediationAr: 'تأكد من أن نوع فترة ReportedEPS يطابق فترة السجل المالي الأحدث.',
            };
        }
        if (!latestAccountingTarget.isCompleteBoundaries) {
            return {
                ...baseDecision,
                matched: false,
                target: null,
                q1BoundaryOverlap: false,
                accountingPeriodLabel: latestAccountingTarget.label,
                accountingPeriodStart: latestAccountingTarget.periodStart,
                accountingPeriodEnd: latestAccountingTarget.periodEnd,
                reasonAr: `تم حجب المقارنة المباشرة لغياب تاريخي البداية والنهاية الموثقين (PeriodStartDate / PeriodEndDate) على السجل المالي (${latestAccountingTarget.label ?? '-'}).`,
                remediationAr: 'وثّق PeriodStartDate و PeriodEndDate على السجل المالي للتحقق من التطابق الزمني.',
            };
        }
        if (p.fiscalYear === latestAccountingTarget.fiscalYear &&
            p.fiscalQuarter === latestAccountingTarget.fiscalQuarter &&
            rStart === latestAccountingTarget.periodStart &&
            rEnd === latestAccountingTarget.periodEnd) {
            return {
                ...baseDecision,
                matched: true,
                target: 'latest',
                q1BoundaryOverlap: false,
                accountingPeriodLabel: latestAccountingTarget.label,
                accountingPeriodStart: latestAccountingTarget.periodStart,
                accountingPeriodEnd: latestAccountingTarget.periodEnd,
                reasonAr: `تطابق زمني موثق لفترة YTD (${rStart} → ${rEnd}).`,
                remediationAr: null,
            };
        }
        return {
            ...baseDecision,
            matched: false,
            target: null,
            q1BoundaryOverlap: false,
            accountingPeriodLabel: latestAccountingTarget.label,
            accountingPeriodStart: latestAccountingTarget.periodStart,
            accountingPeriodEnd: latestAccountingTarget.periodEnd,
            reasonAr: `تم حجب المقارنة المباشرة لاختلاف الربع أو السنة أو حدود التواريخ بين ReportedEPS (${p.displayLabel}) والفترة المحاسبية (${latestAccountingTarget.label ?? '-'} : ${latestAccountingTarget.periodStart ?? '-'} → ${latestAccountingTarget.periodEnd ?? '-'}).`,
            remediationAr: 'تحقق من مطابقة الربع والسنة المالية وتاريخي البداية والنهاية بين ReportedEPS والسجل المالي.',
        };
    }
    // 3. Full Fiscal Year (FY)
    if (p.periodType === 'fy') {
        // 3A. Match against latest FY record if boundaries match identically
        if (latestAccountingTarget && latestAccountingTarget.kind === 'fy') {
            if (!latestAccountingTarget.isCompleteBoundaries) {
                return {
                    ...baseDecision,
                    matched: false,
                    target: null,
                    q1BoundaryOverlap: false,
                    accountingPeriodLabel: latestAccountingTarget.label,
                    accountingPeriodStart: latestAccountingTarget.periodStart,
                    accountingPeriodEnd: latestAccountingTarget.periodEnd,
                    reasonAr: `تم حجب مقارنة السنة المالية الكاملة FY لغياب تاريخي البداية والنهاية الموثقين على السجل المالي (${latestAccountingTarget.label ?? '-'}).`,
                    remediationAr: 'وثّق PeriodStartDate و PeriodEndDate على سجل FY للتحقق من تطابق حدود السنة المالية.',
                };
            }
            if (p.fiscalYear === latestAccountingTarget.fiscalYear &&
                rStart === latestAccountingTarget.periodStart &&
                rEnd === latestAccountingTarget.periodEnd) {
                return {
                    ...baseDecision,
                    matched: true,
                    target: 'latest',
                    q1BoundaryOverlap: false,
                    accountingPeriodLabel: latestAccountingTarget.label,
                    accountingPeriodStart: latestAccountingTarget.periodStart,
                    accountingPeriodEnd: latestAccountingTarget.periodEnd,
                    reasonAr: `تطابق زمني موثق للسنة المالية الكاملة FY (${rStart} → ${rEnd}).`,
                    remediationAr: null,
                };
            }
        }
        // 3B. Match FY against AccountingEPS TTM ONLY when documented start/end boundaries match identically
        if (ttmAccountingTarget &&
            ttmAccountingTarget.isCompleteBoundaries &&
            rStart === ttmAccountingTarget.periodStart &&
            rEnd === ttmAccountingTarget.periodEnd) {
            return {
                ...baseDecision,
                matched: true,
                target: 'ttm',
                q1BoundaryOverlap: false,
                accountingPeriodLabel: ttmAccountingTarget.label,
                accountingPeriodStart: ttmAccountingTarget.periodStart,
                accountingPeriodEnd: ttmAccountingTarget.periodEnd,
                reasonAr: `تتطابق حدود السنة المالية الكاملة FY (${rStart} → ${rEnd}) فعلياً مع حدود نافذة AccountingEPS TTM الموثقة.`,
                remediationAr: null,
            };
        }
        return {
            ...baseDecision,
            matched: false,
            target: null,
            q1BoundaryOverlap: false,
            accountingPeriodLabel: latestAccountingTarget?.label ?? ttmAccountingTarget?.label ?? null,
            accountingPeriodStart: latestAccountingTarget?.periodStart ?? ttmAccountingTarget?.periodStart ?? null,
            accountingPeriodEnd: latestAccountingTarget?.periodEnd ?? ttmAccountingTarget?.periodEnd ?? null,
            reasonAr: `تم حجب المقارنة المباشرة لأن حدود السنة المالية الكاملة FY (${rStart} → ${rEnd}) لا تطابق حدود الفترة المحاسبية المتاحة (${latestAccountingTarget?.label ?? '-'} : ${latestAccountingTarget?.periodStart ?? '-'} → ${latestAccountingTarget?.periodEnd ?? '-'}).`,
            remediationAr: 'تأكد من تطابق تاريخي البداية والنهاية للسنة المالية بين ReportedEPS والسجل المالي.',
        };
    }
    // 4. Trailing 12 Months (TTM) — compares ONLY against AccountingEPS TTM with identical documented start/end boundaries
    if (p.periodType === 'ttm') {
        if (!ttmAccountingTarget || !ttmAccountingTarget.isCompleteBoundaries) {
            return {
                ...baseDecision,
                matched: false,
                target: null,
                q1BoundaryOverlap: false,
                accountingPeriodLabel: ttmAccountingTarget?.label ?? null,
                accountingPeriodStart: ttmAccountingTarget?.periodStart ?? null,
                accountingPeriodEnd: ttmAccountingTarget?.periodEnd ?? null,
                reasonAr: 'تم حجب مقارنة ReportedEPS TTM لعدم اكتمال توثيق تاريخي بداية ونهاية نافذة AccountingEPS TTM عبر السجلات المكونة لها.',
                remediationAr: 'وثّق PeriodStartDate و PeriodEndDate لجميع الفترات المكونة لنافذة TTM.',
            };
        }
        if (rStart === ttmAccountingTarget.periodStart && rEnd === ttmAccountingTarget.periodEnd) {
            return {
                ...baseDecision,
                matched: true,
                target: 'ttm',
                q1BoundaryOverlap: false,
                accountingPeriodLabel: ttmAccountingTarget.label,
                accountingPeriodStart: ttmAccountingTarget.periodStart,
                accountingPeriodEnd: ttmAccountingTarget.periodEnd,
                reasonAr: `تطابق زمني موثق لنافذة آخر 12 شهراً TTM (${rStart} → ${rEnd}).`,
                remediationAr: null,
            };
        }
        return {
            ...baseDecision,
            matched: false,
            target: null,
            q1BoundaryOverlap: false,
            accountingPeriodLabel: ttmAccountingTarget.label,
            accountingPeriodStart: ttmAccountingTarget.periodStart,
            accountingPeriodEnd: ttmAccountingTarget.periodEnd,
            reasonAr: `تم حجب المقارنة المباشرة لاختلاف حدود نافذة ReportedEPS TTM (${rStart} → ${rEnd}) عن حدود نافذة AccountingEPS TTM الموثقة (${ttmAccountingTarget.periodStart} → ${ttmAccountingTarget.periodEnd}).`,
            remediationAr: 'تحقق من مطابقة تاريخي البداية والنهاية لنافذة الـ 12 شهراً بين ReportedEPS وAccountingEPS.',
        };
    }
    return {
        ...baseDecision,
        matched: false,
        target: null,
        q1BoundaryOverlap: false,
        accountingPeriodLabel: latestAccountingTarget?.label ?? null,
        accountingPeriodStart: latestAccountingTarget?.periodStart ?? null,
        accountingPeriodEnd: latestAccountingTarget?.periodEnd ?? null,
        reasonAr: 'تم حجب المقارنة المباشرة لعدم تحقق شروط التطابق الزمني.',
        remediationAr: 'راجع تعريف فترة ReportedEPS في السجل.',
    };
}
/**
 * Optional documented-date suggestion helper for UI forms.
 * NEVER assumes Jan 1 and NEVER forces ReportedEPS period to equal the quarterly record period.
 */
function suggestReportedEpsPeriodDates(params) {
    const { periodType, fiscalYear, fiscalQuarter, recordYear, recordQuarter, recordPeriodStartDate, recordPeriodEndDate, companyQuarterHistory = [], } = params;
    if (!periodType || periodType === 'needs_review')
        return null;
    const currentBounds = getDocumentedRecordBounds({
        year: recordYear,
        quarter: recordQuarter,
        periodStartDate: recordPeriodStartDate,
        periodEndDate: recordPeriodEndDate,
    });
    if (periodType === 'ytd') {
        if (currentBounds &&
            recordQuarter &&
            recordQuarter !== 'FY' &&
            fiscalYear === recordYear &&
            fiscalQuarter === recordQuarter) {
            try {
                validateSpanForPeriodType('ytd', fiscalQuarter, currentBounds.start, currentBounds.end);
                return {
                    periodStart: currentBounds.start,
                    periodEnd: currentBounds.end,
                    sourceNoteAr: `مقترح من تواريخ السجل التراكمي الموثقة (${recordQuarter} ${recordYear}).`,
                };
            }
            catch {
                return null;
            }
        }
        return null;
    }
    if (periodType === 'fy') {
        if (currentBounds &&
            recordQuarter === 'FY' &&
            fiscalYear === recordYear &&
            currentBounds.spanDays >= 360 &&
            currentBounds.spanDays <= 370) {
            return {
                periodStart: currentBounds.start,
                periodEnd: currentBounds.end,
                sourceNoteAr: `مقترح من تواريخ السنة المالية الموثقة على السجل (FY ${recordYear}).`,
            };
        }
        return null;
    }
    if (periodType === 'standalone_quarter') {
        if (!fiscalQuarter || fiscalYear === null)
            return null;
        if (fiscalQuarter === 'Q1' &&
            recordQuarter === 'Q1' &&
            fiscalYear === recordYear &&
            currentBounds &&
            currentBounds.spanDays >= 60 &&
            currentBounds.spanDays <= 125) {
            return {
                periodStart: currentBounds.start,
                periodEnd: currentBounds.end,
                sourceNoteAr: `مقترح من تواريخ سجل Q1 ${recordYear} الموثقة (تتطابق حدود Q1 المنفرد مع Q1 التراكمي).`,
            };
        }
        // For Q2/Q3/Q4 standalone: suggest ONLY if prior documented quarter's end date + target quarter's end date both exist
        const targetRecordQuarter = fiscalQuarter === 'Q4' ? 'FY' : fiscalQuarter;
        const prevRecordQuarter = fiscalQuarter === 'Q2'
            ? 'Q1'
            : fiscalQuarter === 'Q3'
                ? 'Q2'
                : fiscalQuarter === 'Q4'
                    ? 'Q3'
                    : null;
        if (!prevRecordQuarter)
            return null;
        const targetEnd = recordQuarter === targetRecordQuarter && recordYear === fiscalYear && currentBounds
            ? currentBounds.end
            : getDocumentedRecordBounds(companyQuarterHistory.find((h) => h.year === fiscalYear && h.quarter === targetRecordQuarter))?.end ?? null;
        const prevBounds = getDocumentedRecordBounds(companyQuarterHistory.find((h) => h.year === fiscalYear && h.quarter === prevRecordQuarter));
        if (targetEnd && prevBounds) {
            const candidateStart = addIsoCalendarDays(prevBounds.end, 1);
            if (candidateStart <= targetEnd) {
                try {
                    validateSpanForPeriodType('standalone_quarter', fiscalQuarter, candidateStart, targetEnd);
                    return {
                        periodStart: candidateStart,
                        periodEnd: targetEnd,
                        sourceNoteAr: `مقترح من اليوم التالي لنهاية ${prevRecordQuarter} ${fiscalYear} الموثق (${prevBounds.end}) حتى نهاية ${targetRecordQuarter} ${fiscalYear} (${targetEnd}).`,
                    };
                }
                catch {
                    return null;
                }
            }
        }
        return null;
    }
    if (periodType === 'ttm') {
        if (currentBounds &&
            recordQuarter === 'FY' &&
            currentBounds.spanDays >= 360 &&
            currentBounds.spanDays <= 370) {
            return {
                periodStart: currentBounds.start,
                periodEnd: currentBounds.end,
                sourceNoteAr: `مقترح من حدود السنة المالية الكاملة الموثقة (FY ${recordYear}).`,
            };
        }
        if (currentBounds && recordYear !== null && recordQuarter && recordQuarter !== 'FY') {
            const prevComp = getDocumentedRecordBounds(companyQuarterHistory.find((h) => h.year === recordYear - 1 && h.quarter === recordQuarter));
            const prevFy = getDocumentedRecordBounds(companyQuarterHistory.find((h) => h.year === recordYear - 1 && h.quarter === 'FY'));
            if (prevComp &&
                prevFy &&
                prevComp.start === prevFy.start &&
                prevComp.end < prevFy.end &&
                addIsoCalendarDays(prevFy.end, 1) === currentBounds.start) {
                const ttmStart = addIsoCalendarDays(prevComp.end, 1);
                const span = spanDaysInclusive(ttmStart, currentBounds.end);
                if (span >= 360 && span <= 370) {
                    return {
                        periodStart: ttmStart,
                        periodEnd: currentBounds.end,
                        sourceNoteAr: `مقترح من حدود نافذة TTM الموثقة والمتصلة حتى ${recordQuarter} ${recordYear}.`,
                    };
                }
            }
        }
        return null;
    }
    return null;
}
/**
 * Dry-run audit helper for a single quarterly record's ReportedEPS period definition.
 * Never mutates data or writes to storage.
 */
function auditLegacyReportedEpsRecord(record) {
    const yearQuarter = record.yearQuarter || `${record.year}${record.quarter}`;
    const hasEps = typeof record.reportedEps === 'number' && Number.isFinite(record.reportedEps);
    const legacyText = (0, normalization_1.parseCleanText)(record.reportedEpsPeriod);
    const hasStructured = record.reportedEpsPeriodType != null;
    if (!hasEps && !legacyText && !hasStructured) {
        return {
            ticker: record.ticker,
            year: record.year,
            quarter: record.quarter,
            yearQuarter,
            reportedEps: null,
            currentPeriodType: null,
            legacyReportedEpsPeriod: null,
            status: 'no_reported_eps',
            detectedIntent: null,
            proposedPeriod: null,
            reasonAr: 'لا توجد قيمة ReportedEPS مسجلة في هذا السجل.',
            remediationAr: null,
        };
    }
    if (hasStructured) {
        const res = resolveCanonicalReportedEpsPeriod(record);
        if (res.status === 'valid' && res.period) {
            return {
                ticker: record.ticker,
                year: record.year,
                quarter: record.quarter,
                yearQuarter,
                reportedEps: hasEps ? record.reportedEps : null,
                currentPeriodType: res.period.periodType,
                legacyReportedEpsPeriod: legacyText,
                status: 'structured_valid',
                detectedIntent: res.period.periodType,
                proposedPeriod: res.period,
                reasonAr: `معرّف وفق العقد المركزي الصريح (${res.period.displayLabel}).`,
                remediationAr: null,
            };
        }
        return {
            ticker: record.ticker,
            year: record.year,
            quarter: record.quarter,
            yearQuarter,
            reportedEps: hasEps ? record.reportedEps : null,
            currentPeriodType: record.reportedEpsPeriodType ?? null,
            legacyReportedEpsPeriod: legacyText,
            status: 'needs_review',
            detectedIntent: res.detectedIntent,
            proposedPeriod: null,
            reasonAr: res.reasonAr || 'حقول فترة ReportedEPS البنيوية تحتاج مراجعة.',
            remediationAr: res.remediationAr,
        };
    }
    if (!legacyText) {
        return {
            ticker: record.ticker,
            year: record.year,
            quarter: record.quarter,
            yearQuarter,
            reportedEps: hasEps ? record.reportedEps : null,
            currentPeriodType: null,
            legacyReportedEpsPeriod: null,
            status: 'needs_review',
            detectedIntent: null,
            proposedPeriod: null,
            reasonAr: 'توجد قيمة ReportedEPS مسجلة دون تحديد نوع الفترة أو نصها في السجل القديم؛ يلزم مراجعتها وتوثيق الفترة قبل أي مقارنة.',
            remediationAr: 'افتح السجل واختر نوع فترة ReportedEPS الصريح وتاريخي بدايتها ونهايتها (أو احتفظ بوسم «غير محدد / يحتاج مراجعة» مع حجب المقارنة فقط).',
        };
    }
    const classified = classifyLegacyReportedEpsPeriod(legacyText, {
        year: record.year,
        quarter: record.quarter,
        periodStartDate: record.periodStartDate,
        periodEndDate: record.periodEndDate,
    });
    if (classified.status === 'unambiguous_convertible' && classified.resolved) {
        return {
            ticker: record.ticker,
            year: record.year,
            quarter: record.quarter,
            yearQuarter,
            reportedEps: hasEps ? record.reportedEps : null,
            currentPeriodType: null,
            legacyReportedEpsPeriod: legacyText,
            status: 'unambiguous_convertible',
            detectedIntent: classified.resolved.periodType,
            proposedPeriod: classified.resolved,
            reasonAr: classified.reasonAr,
            remediationAr: 'قابل للترقية الآمنة إلى العقد البنيوي الصريح دون تعديل قيمة ReportedEPS.',
        };
    }
    return {
        ticker: record.ticker,
        year: record.year,
        quarter: record.quarter,
        yearQuarter,
        reportedEps: hasEps ? record.reportedEps : null,
        currentPeriodType: null,
        legacyReportedEpsPeriod: legacyText,
        status: 'needs_review',
        detectedIntent: classified.detectedIntent,
        proposedPeriod: null,
        reasonAr: classified.reasonAr,
        remediationAr: classified.remediationAr,
    };
}
//# sourceMappingURL=reportedEpsPeriod.js.map