"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DividendGovernanceConflictError = exports.QUARTERLY_NESTED_MAP_FIELDS = exports.QuarterlyValidationError = exports.ALLOWED_DIVIDEND_YEAR_STATUSES = exports.QUARTERLY_NUMERIC_FIELDS = exports.DAILY_NUMERIC_FIELDS = exports.DIVIDEND_YEAR_LOCKS_COLLECTION = exports.LEGACY_QUARTERLY_DPS_FIELDS = exports.RECORD_SCHEMA_VERSION = exports.ALLOWED_WEIGHTED_AVG_SHARES_BASIS = void 0;
exports.stripLegacyQuarterlyDpsFromRecord = stripLegacyQuarterlyDpsFromRecord;
exports.sanitizeDailyRawCells = sanitizeDailyRawCells;
exports.validateDailySchemaPayload = validateDailySchemaPayload;
exports.computeCalendarSpanDays = computeCalendarSpanDays;
exports.validateQuarterlyPeriodInputs = validateQuarterlyPeriodInputs;
exports.validateRecords = validateRecords;
exports.validateBetaRecords = validateBetaRecords;
exports.sanitizeDistributionId = sanitizeDistributionId;
exports.buildDividendDocId = buildDividendDocId;
exports.validateDividendRecords = validateDividendRecords;
exports.buildDividendYearStatusDocId = buildDividendYearStatusDocId;
exports.isActiveDividendRecordForConflict = isActiveDividendRecordForConflict;
exports.validateDividendYearStatusPayload = validateDividendYearStatusPayload;
exports.validateParameterRecords = validateParameterRecords;
exports.financialProjection = financialProjection;
exports.sanitizeCompanyMetadataPatch = sanitizeCompanyMetadataPatch;
exports.buildCompanyDocWritePayload = buildCompanyDocWritePayload;
exports.mergeQuarterlyNestedMap = mergeQuarterlyNestedMap;
exports.extractQuarterlyDocIdentity = extractQuarterlyDocIdentity;
exports.resolveQuarterlyRecordWrite = resolveQuarterlyRecordWrite;
exports.applyStockAndQuarterAtomicWrite = applyStockAndQuarterAtomicWrite;
exports.validateBulkQuarterlyRequestEnvelope = validateBulkQuarterlyRequestEnvelope;
exports.applyBulkQuarterlyWrites = applyBulkQuarterlyWrites;
exports.executeBulkQuarterlyTransaction = executeBulkQuarterlyTransaction;
exports.applyDividendRecordsAtomicTx = applyDividendRecordsAtomicTx;
exports.applyDividendYearStatusAtomicTx = applyDividendYearStatusAtomicTx;
exports.validateSectorPEPayload = validateSectorPEPayload;
exports.validateSectorDefinitionPayload = validateSectorDefinitionPayload;
exports.validateSectorStatusTogglePayload = validateSectorStatusTogglePayload;
exports.validateSectorDeletePayload = validateSectorDeletePayload;
exports.validateStoryPayload = validateStoryPayload;
exports.validateDecisionPayload = validateDecisionPayload;
exports.validateTradePayload = validateTradePayload;
const normalization_1 = require("./normalization");
const parameterRegistry_1 = require("./parameterRegistry");
const parameterTypeContract_1 = require("./parameterTypeContract");
const batchLimits_1 = require("./batchLimits");
const hashing_1 = require("./hashing");
const sectorRegistry_1 = require("./sectorRegistry");
const sectorLinkage_1 = require("./sectorLinkage");
const weightedAvgSharesBasis_1 = require("./weightedAvgSharesBasis");
Object.defineProperty(exports, "ALLOWED_WEIGHTED_AVG_SHARES_BASIS", { enumerable: true, get: function () { return weightedAvgSharesBasis_1.ALLOWED_WEIGHTED_AVG_SHARES_BASIS; } });
const reportedEpsPeriod_1 = require("./reportedEpsPeriod");
exports.RECORD_SCHEMA_VERSION = 2;
exports.LEGACY_QUARTERLY_DPS_FIELDS = ['dpsCurrent', 'DPS_Current', 'dps_current'];
exports.DIVIDEND_YEAR_LOCKS_COLLECTION = 'dividend_year_locks';
function stripLegacyQuarterlyDpsFromRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record))
        return record;
    const clone = { ...record };
    for (const key of exports.LEGACY_QUARTERLY_DPS_FIELDS) {
        delete clone[key];
    }
    if (clone.extendedFields && typeof clone.extendedFields === 'object' && !Array.isArray(clone.extendedFields)) {
        const cleanExt = {};
        for (const [k, v] of Object.entries(clone.extendedFields)) {
            if (exports.LEGACY_QUARTERLY_DPS_FIELDS.includes(k))
                continue;
            cleanExt[k] = v;
        }
        if (Object.keys(cleanExt).length > 0) {
            clone.extendedFields = cleanExt;
        }
        else {
            delete clone.extendedFields;
        }
    }
    return clone;
}
exports.DAILY_NUMERIC_FIELDS = [
    'lastPrice',
    'changePct',
    'tradesCount',
    'openPrice',
    'closePrice',
    'turnoverValue',
    'netLiquidity',
    'volume',
    'avgVolume5D',
    'avgVolume30D',
    'avgVolume90D',
    'lowPrice',
    'highPrice',
    'totalBids',
    'bidsCount',
    'offersCount',
    'totalOffers',
    'avgVolume',
    'high52W',
    'low52W',
    'prevClose',
    'marketCapThousands',
    'vwap',
    'peRatio',
    'pbRatio',
    'listedShares',
    'inflowOrders',
    'inflowVolume',
    'inflowLiquidity',
    'askTrades',
    'askTradesVolume',
    'outflowLiquidity',
    'volChange5DPct',
    'volChange30DPct',
    'volChange90DPct',
];
const ALLOWED_DAILY_CELL_TYPES = new Set(['s', 'n', 'b', 'd', 'e', 'z']);
function sanitizeDailyRawCells(rawCells, contextLabel) {
    if (!rawCells || typeof rawCells !== 'object' || Array.isArray(rawCells)) {
        throw new Error(`بيانات الخلايا الديناميكية غير صالحة${contextLabel ? ` (${contextLabel})` : ''}.`);
    }
    const out = {};
    const entries = Object.entries(rawCells);
    if (entries.length > 5000) {
        throw new Error(`عدد الأعمدة الديناميكية يتجاوز الحد المسموح (${entries.length}).`);
    }
    for (const [colId, rawCell] of entries) {
        if (!colId || colId.length > 64 || colId.includes('/') || colId.includes('.')) {
            throw new Error(`معرف العمود الديناميكي (${colId}) غير صالح.`);
        }
        if (rawCell === null || rawCell === undefined)
            continue;
        if (typeof rawCell !== 'object' || Array.isArray(rawCell)) {
            throw new Error(`قيمة الخلية للعمود (${colId}) غير صالحة.`);
        }
        const cell = rawCell;
        const t = typeof cell.t === 'string' && ALLOWED_DAILY_CELL_TYPES.has(cell.t) ? cell.t : null;
        if (!t) {
            throw new Error(`نوع الخلية (${String(cell.t)}) للعمود ${colId} غير مدعوم.`);
        }
        let v = null;
        if (cell.v === undefined || cell.v === null) {
            v = null;
        }
        else if (typeof cell.v === 'number') {
            if (!Number.isFinite(cell.v)) {
                throw new Error(`قيمة رقمية غير منتهية في الخلية ${colId}.`);
            }
            v = Object.is(cell.v, -0) ? 0 : cell.v;
        }
        else if (typeof cell.v === 'string' || typeof cell.v === 'boolean') {
            v = cell.v;
        }
        else {
            throw new Error(`نوع قيمة الخلية ${colId} غير مدعوم.`);
        }
        const cleanCell = { v, t };
        if (cell.w !== undefined && cell.w !== null) {
            cleanCell.w = String(cell.w);
        }
        if (cell.f !== undefined && cell.f !== null) {
            cleanCell.f = String(cell.f);
        }
        if (cell.formulaMissingCachedResult === true) {
            cleanCell.formulaMissingCachedResult = true;
        }
        out[colId] = cleanCell;
    }
    return out;
}
function validateDailySchemaPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('مخطط أعمدة التداول اليومي (dailySchema) غير صالح.');
    }
    const obj = raw;
    const schemaId = typeof obj.schemaId === 'string' ? obj.schemaId.trim() : '';
    if (!schemaId || schemaId.length > 120 || schemaId.includes('/')) {
        throw new Error('معرف مخطط الأعمدة (schemaId) غير صالح.');
    }
    let tradeDate;
    if (obj.tradeDate !== undefined && obj.tradeDate !== null) {
        if (!(0, normalization_1.isValidCalendarDate)(obj.tradeDate)) {
            throw new Error('تاريخ التداول في مخطط الأعمدة غير صالح.');
        }
        tradeDate = obj.tradeDate;
    }
    if (!Array.isArray(obj.columns) || obj.columns.length === 0 || obj.columns.length > 5000) {
        throw new Error('قائمة الأعمدة في مخطط التداول اليومي غير صالحة أو فارغة.');
    }
    const seenColIds = new Set();
    const columns = obj.columns.map((c, idx) => {
        if (!c || typeof c !== 'object' || Array.isArray(c)) {
            throw new Error(`تعريف العمود رقم ${idx + 1} غير صالح.`);
        }
        const col = c;
        const colId = typeof col.colId === 'string' ? col.colId.trim() : '';
        if (!colId || colId.length > 64 || colId.includes('/') || colId.includes('.') || seenColIds.has(colId)) {
            throw new Error(`معرف العمود (${colId}) مكرر أو غير صالح.`);
        }
        seenColIds.add(colId);
        const index = typeof col.index === 'number' && Number.isInteger(col.index) && col.index >= 0 ? col.index : idx;
        const colLetter = typeof col.colLetter === 'string' && col.colLetter.trim() ? col.colLetter.trim() : `C${index + 1}`;
        const headerName = col.headerName === null || col.headerName === undefined ? null : String(col.headerName);
        const normalizedHeader = col.normalizedHeader === null || col.normalizedHeader === undefined ? null : String(col.normalizedHeader);
        const mappedField = col.mappedField === null || col.mappedField === undefined ? null : String(col.mappedField).trim() || null;
        return {
            colId,
            index,
            colLetter,
            headerName,
            normalizedHeader,
            mappedField,
            ...(col.isDuplicateHeader === true ? { isDuplicateHeader: true } : {}),
        };
    });
    const payload = {
        schemaId,
        ...(tradeDate !== undefined ? { tradeDate } : {}),
        ...(typeof obj.sourceFile === 'string' && obj.sourceFile.trim() ? { sourceFile: obj.sourceFile.trim().slice(0, 260) } : {}),
        ...(typeof obj.sourceSheet === 'string' && obj.sourceSheet.trim() ? { sourceSheet: obj.sourceSheet.trim().slice(0, 120) } : {}),
        totalColumns: columns.length,
        columns,
    };
    const docBytes = (0, batchLimits_1.estimateJsonUtf8Bytes)(payload);
    if (docBytes > batchLimits_1.FIRESTORE_MAX_DOCUMENT_BYTES) {
        throw new Error(`حجم مخطط أعمدة التداول اليومي (${docBytes.toLocaleString('en-US')} بايت) يتجاوز حد مستند Firestore المسموح (${batchLimits_1.FIRESTORE_MAX_DOCUMENT_BYTES.toLocaleString('en-US')} بايت).`);
    }
    return payload;
}
exports.QUARTERLY_NUMERIC_FIELDS = [
    'depreciationAmortizationYTD',
    'changeOperatingNwcYTD',
    'valuationTaxRate',
    'netIncomeCommonYTD',
    'equityCommon',
    'weightedAvgSharesYTD',
    'periodDays',
    'reportedEps',
    'shares',
    'intangibleAssets',
    'totalAssets',
    'equity',
    'totalDebtWithoutTX',
    'totalLiabilities',
    'revenueYTD',
    'grossProfitYTD',
    'ebitYTD',
    'pbtYTD',
    'netIncomeYTD',
    'ocfYTD',
    'netInvestingCfYTD',
    'dividendsPaidYTD',
    'cash',
    'interestExpenseYTD',
    'financeCostsYTD',
    'interestIncomeYTD',
    'taxExpenseYTD',
    'interestPaidYTD',
    'capexYTD',
];
function computeCalendarSpanDays(startDate, endDate) {
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const startMs = Date.UTC(sy, sm - 1, sd);
    const endMs = Date.UTC(ey, em - 1, ed);
    return Math.floor((endMs - startMs) / 86_400_000) + 1;
}
/**
 * Single Source of Truth validator for quarterly financial period boundaries and inclusive calendar span.
 * Enforces real calendar dates (including leap years), paired start/end, start <= end, 1..370 days,
 * and rejects any manual periodDays conflicting with the actual calendar span. Never fabricates Jan 1.
 */
function validateQuarterlyPeriodInputs(input) {
    const pStart = input.periodStartDate !== undefined && input.periodStartDate !== null
        ? (0, normalization_1.parseCleanText)(input.periodStartDate)
        : null;
    const pEnd = input.periodEndDate !== undefined && input.periodEndDate !== null
        ? (0, normalization_1.parseCleanText)(input.periodEndDate)
        : null;
    let parsedDays = null;
    if (input.periodDays !== undefined && input.periodDays !== null && input.periodDays !== '') {
        const rawNum = typeof input.periodDays === 'number' ? input.periodDays : Number(String(input.periodDays).trim());
        if (!Number.isFinite(rawNum) || !Number.isInteger(rawNum) || rawNum < 1 || rawNum > 370) {
            throw new Error('عدد أيام الفترة (PeriodDays) يجب أن يكون عدداً صحيحاً بين 1 و 370.');
        }
        parsedDays = rawNum;
    }
    if ((pStart && !pEnd) || (!pStart && pEnd)) {
        throw new Error('يلزم إدخال تاريخي بداية ونهاية الفترة المالية معاً (PeriodStartDate و PeriodEndDate).');
    }
    if (pStart && pEnd) {
        if (!(0, normalization_1.isValidCalendarDate)(pStart) || !(0, normalization_1.isValidCalendarDate)(pEnd)) {
            throw new Error('صيغة أو تاريخ بداية/نهاية الفترة المالية غير صالح تقويمياً (المطلوب YYYY-MM-DD مع مراعاة السنوات الكبيسة).');
        }
        if (pStart > pEnd) {
            throw new Error(`تاريخ بداية الفترة (${pStart}) يجب أن يسبق أو يساوي تاريخ نهايتها (${pEnd}).`);
        }
        const computedDays = computeCalendarSpanDays(pStart, pEnd);
        if (computedDays < 1 || computedDays > 370) {
            throw new Error(`طول الفترة المالية المحسوب من التواريخ (${computedDays} يوماً) خارج النطاق المسموح (1..370 يوماً).`);
        }
        if (parsedDays !== null && parsedDays !== computedDays) {
            throw new Error(`تعارض في طول الفترة: PeriodDays (${parsedDays}) لا يطابق الفرق التقويمي بين ${pStart} و ${pEnd} (${computedDays} يوماً).`);
        }
        return {
            periodStartDate: pStart,
            periodEndDate: pEnd,
            periodDays: computedDays,
            computedDays,
        };
    }
    return {
        periodStartDate: null,
        periodEndDate: null,
        periodDays: parsedDays,
        computedDays: null,
    };
}
exports.ALLOWED_DIVIDEND_YEAR_STATUSES = new Set([
    'unknown',
    'partial',
    'complete',
    'confirmed_no_dividend',
]);
function validateRecords(value, quarterly, maxBatch = (0, batchLimits_1.getMaxRecordLimitForOperation)(quarterly), options) {
    if (!Array.isArray(value) || value.length < 1 || value.length > maxBatch) {
        throw new Error(`أرسل من 1 إلى ${maxBatch} سجل في الطلب الواحد.`);
    }
    const keys = new Set();
    return value.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error('سجل غير صالح.');
        }
        const rec = item;
        const ticker = (0, normalization_1.normalizedTicker)(rec.ticker);
        if (quarterly) {
            if (!Number.isInteger(rec.year) ||
                rec.year < 1900 ||
                rec.year > 2200 ||
                !['Q1', 'Q2', 'Q3', 'FY'].includes(rec.quarter)) {
                throw new Error('السنة أو الربع غير صالح.');
            }
        }
        else {
            if (!(0, normalization_1.isValidCalendarDate)(rec.tradeDate)) {
                throw new Error('تاريخ التداول غير صالح.');
            }
        }
        const numericFields = quarterly ? exports.QUARTERLY_NUMERIC_FIELDS : exports.DAILY_NUMERIC_FIELDS;
        for (const key of numericFields) {
            const val = rec[key];
            if (val !== undefined && val !== null && (typeof val !== 'number' || !Number.isFinite(val))) {
                throw new Error(`الحقل ${key} يجب أن يكون رقماً أو فارغاً.`);
            }
        }
        if (quarterly) {
            if (rec.valuationTaxRate != null && (rec.valuationTaxRate < 0 || rec.valuationTaxRate > 1)) {
                throw new Error('ضريبة التقييم بين صفر وواحد.');
            }
            if (rec.depreciationAmortizationYTD != null && rec.depreciationAmortizationYTD < 0) {
                throw new Error('الإهلاك والاستنفاد قيمة موجبة أو صفر.');
            }
            if (rec.financialUnit != null) {
                if (typeof rec.financialUnit !== 'string' || rec.financialUnit.trim().length > 100) {
                    throw new Error('الوحدة المالية يجب أن تكون نصاً صالحاً أو فارغة.');
                }
                rec.financialUnit = rec.financialUnit.trim() || null;
            }
            if (rec.financialCurrency != null) {
                const cur = (0, normalization_1.normalizeStrictCurrency)(rec.financialCurrency);
                if (cur.status === 'unsupported') {
                    throw new Error(`العملة المالية (${rec.financialCurrency}) غير مدعومة؛ العملات المدعومة هي EGP و USD فقط.`);
                }
                rec.financialCurrency = cur.code;
            }
            if (rec.financialCurrency && rec.financialUnit) {
                const unitStr = String(rec.financialUnit).trim().toUpperCase();
                const impliedUnitCurrency = unitStr.startsWith('USD') ? 'USD' : unitStr.startsWith('EGP') ? 'EGP' : null;
                if (impliedUnitCurrency && impliedUnitCurrency !== rec.financialCurrency) {
                    throw new Error(`تعارض بين العملة المالية (${rec.financialCurrency}) والوحدة (${rec.financialUnit}).`);
                }
            }
            if (rec.weightedAvgSharesYTD != null && rec.weightedAvgSharesYTD <= 0) {
                throw new Error('المتوسط المرجح للأسهم يجب أن يكون موجباً.');
            }
            if (rec.weightedAvgSharesBasis !== undefined && rec.weightedAvgSharesBasis !== null) {
                rec.weightedAvgSharesBasis = (0, weightedAvgSharesBasis_1.validateAndNormalizeWeightedAvgSharesBasis)(rec.weightedAvgSharesBasis);
            }
            const validatedPeriod = validateQuarterlyPeriodInputs({
                periodStartDate: rec.periodStartDate,
                periodEndDate: rec.periodEndDate,
                periodDays: rec.periodDays,
            });
            if (validatedPeriod.periodStartDate && validatedPeriod.periodEndDate) {
                rec.periodStartDate = validatedPeriod.periodStartDate;
                rec.periodEndDate = validatedPeriod.periodEndDate;
                rec.periodDays = validatedPeriod.periodDays;
            }
            else {
                if (rec.periodStartDate !== undefined)
                    rec.periodStartDate = null;
                if (rec.periodEndDate !== undefined)
                    rec.periodEndDate = null;
                if (validatedPeriod.periodDays !== null) {
                    rec.periodDays = validatedPeriod.periodDays;
                }
            }
            if (rec.isCapitalActionAdjusted !== undefined && rec.isCapitalActionAdjusted !== null) {
                rec.isCapitalActionAdjusted = (0, normalization_1.parseCleanBoolean)(rec.isCapitalActionAdjusted);
            }
            const isLegacyInspection = options?.legacyCompatibilityMode === true;
            if (rec.reportedEpsSource !== undefined && rec.reportedEpsSource !== null) {
                if (typeof rec.reportedEpsSource !== 'string') {
                    throw new Error('مصدر ربحية السهم المعلنة (ReportedEPS_Source) يجب أن يكون نصاً أو فارغاً.');
                }
                const cleanedRepSrc = (0, normalization_1.parseCleanText)(rec.reportedEpsSource);
                if (cleanedRepSrc && cleanedRepSrc.length > 200) {
                    throw new Error('مصدر ربحية السهم المعلنة (ReportedEPS_Source) يجب ألا يتجاوز 200 حرف.');
                }
                rec.reportedEpsSource = cleanedRepSrc;
            }
            const hasAnyReportedEpsPeriodInput = rec.reportedEpsPeriodType !== undefined ||
                rec.reportedEpsFiscalYear !== undefined ||
                rec.reportedEpsFiscalQuarter !== undefined ||
                rec.reportedEpsPeriodStart !== undefined ||
                rec.reportedEpsPeriodEnd !== undefined ||
                rec.reportedEpsPeriod !== undefined;
            if ((0, reportedEpsPeriod_1.hasExplicitReportedEpsValue)(rec.reportedEps) || hasAnyReportedEpsPeriodInput) {
                const normalizedEpsPeriod = (0, reportedEpsPeriod_1.validateAndNormalizeReportedEpsPeriod)({
                    reportedEps: rec.reportedEps ?? null,
                    reportedEpsPeriodType: rec.reportedEpsPeriodType,
                    reportedEpsFiscalYear: rec.reportedEpsFiscalYear,
                    reportedEpsFiscalQuarter: rec.reportedEpsFiscalQuarter,
                    reportedEpsPeriodStart: rec.reportedEpsPeriodStart,
                    reportedEpsPeriodEnd: rec.reportedEpsPeriodEnd,
                    reportedEpsPeriod: rec.reportedEpsPeriod,
                }, {
                    requirePeriodWhenEpsPresent: !isLegacyInspection,
                    allowLegacyPeriodTextOnly: isLegacyInspection,
                });
                // Always materialize all 6 normalized period fields explicitly so cleared/inapplicable
                // subfields become explicit `null` rather than leaving stale prior fields on merge.
                rec.reportedEpsPeriodType = normalizedEpsPeriod.reportedEpsPeriodType;
                rec.reportedEpsFiscalYear = normalizedEpsPeriod.reportedEpsFiscalYear;
                rec.reportedEpsFiscalQuarter = normalizedEpsPeriod.reportedEpsFiscalQuarter;
                rec.reportedEpsPeriodStart = normalizedEpsPeriod.reportedEpsPeriodStart;
                rec.reportedEpsPeriodEnd = normalizedEpsPeriod.reportedEpsPeriodEnd;
                rec.reportedEpsPeriod = normalizedEpsPeriod.reportedEpsPeriod;
            }
            if (rec.netIncomeCommonBasis !== undefined && rec.netIncomeCommonBasis !== null) {
                const cleanedBasis = (0, normalization_1.parseCleanText)(rec.netIncomeCommonBasis);
                if (!cleanedBasis) {
                    rec.netIncomeCommonBasis = null;
                }
                else {
                    const normalizedBasis = cleanedBasis.toLowerCase();
                    if (normalizedBasis !== 'explicit_common' &&
                        normalizedBasis !== 'attested_net_income_equals_common') {
                        throw new Error('قيمة NetIncomeCommon_Basis غير صالحة؛ يُقبل explicit_common أو attested_net_income_equals_common فقط.');
                    }
                    rec.netIncomeCommonBasis = normalizedBasis;
                }
            }
            if (rec.netIncomeCommonNote != null) {
                const cleanedNote = (0, normalization_1.parseCleanText)(rec.netIncomeCommonNote);
                if (cleanedNote && cleanedNote.length > 400) {
                    throw new Error('ملاحظة صافي ربح المساهمين العاديين يجب ألا تتجاوز 400 حرف.');
                }
                rec.netIncomeCommonNote = cleanedNote;
            }
            if (rec.equityCommonBasis !== undefined && rec.equityCommonBasis !== null) {
                const cleanedBasis = (0, normalization_1.parseCleanText)(rec.equityCommonBasis);
                if (!cleanedBasis) {
                    rec.equityCommonBasis = null;
                }
                else {
                    const normalizedBasis = cleanedBasis.toLowerCase();
                    if (normalizedBasis !== 'explicit_common' &&
                        normalizedBasis !== 'attested_total_equals_common') {
                        throw new Error('قيمة EquityCommon_Basis غير صالحة؛ يُقبل explicit_common أو attested_total_equals_common فقط.');
                    }
                    rec.equityCommonBasis = normalizedBasis;
                }
            }
            if (rec.equityCommonNote != null) {
                const cleanedNote = (0, normalization_1.parseCleanText)(rec.equityCommonNote);
                if (cleanedNote && cleanedNote.length > 400) {
                    throw new Error('ملاحظة حقوق ملكية المساهمين العاديين يجب ألا تتجاوز 400 حرف.');
                }
                rec.equityCommonNote = cleanedNote;
            }
            if (rec.valuationSource != null && (typeof rec.valuationSource !== 'string' || rec.valuationSource.length > 1000)) {
                throw new Error('مرجع المصدر غير صالح.');
            }
            if ('shares' in rec && (rec.shares === null || rec.shares <= 0)) {
                throw new Error('عدد الأسهم يجب أن يكون موجباً.');
            }
        }
        let sanitizedRec = { ...rec, ticker };
        if (!quarterly) {
            if (rec.schemaId !== undefined && rec.schemaId !== null) {
                if (typeof rec.schemaId !== 'string' || !rec.schemaId.trim() || rec.schemaId.includes('/') || rec.schemaId.length > 120) {
                    throw new Error(`معرف مخطط الأعمدة (schemaId) للسهم ${ticker} غير صالح.`);
                }
                sanitizedRec.schemaId = rec.schemaId.trim();
            }
            if (rec.rawCells !== undefined && rec.rawCells !== null) {
                sanitizedRec.rawCells = sanitizeDailyRawCells(rec.rawCells, `${ticker}_${rec.tradeDate}`);
            }
            if (rec.rawRowHeadersMissingCount !== undefined && rec.rawRowHeadersMissingCount !== null) {
                if (!Number.isInteger(rec.rawRowHeadersMissingCount) || rec.rawRowHeadersMissingCount < 0) {
                    throw new Error(`عدّاد الأعمدة دون عنوان للسهم ${ticker} غير صالح.`);
                }
            }
            if (rec.formulaMissingCachedCount !== undefined && rec.formulaMissingCachedCount !== null) {
                if (!Number.isInteger(rec.formulaMissingCachedCount) || rec.formulaMissingCachedCount < 0) {
                    throw new Error(`عدّاد الصيغ دون قيمة مخبأة للسهم ${ticker} غير صالح.`);
                }
            }
        }
        if (rec.originalValues !== undefined && rec.originalValues !== null) {
            if (typeof rec.originalValues !== 'object' || Array.isArray(rec.originalValues)) {
                throw new Error(`سجل القيم الأصلية للسهم ${ticker} غير صالح.`);
            }
            const cleanOriginal = {};
            for (const [k, v] of Object.entries(rec.originalValues)) {
                if (!k || k.length > 80)
                    continue;
                if (quarterly && exports.LEGACY_QUARTERLY_DPS_FIELDS.includes(k))
                    continue;
                if (v === null || typeof v === 'string' || typeof v === 'boolean') {
                    cleanOriginal[k] = v;
                }
                else if (typeof v === 'number' && Number.isFinite(v)) {
                    cleanOriginal[k] = Object.is(v, -0) ? 0 : v;
                }
            }
            sanitizedRec.originalValues = cleanOriginal;
        }
        if (rec.manualCorrections !== undefined && rec.manualCorrections !== null) {
            if (typeof rec.manualCorrections !== 'object' || Array.isArray(rec.manualCorrections)) {
                throw new Error(`سجل التعديلات اليدوية للسهم ${ticker} غير صالح.`);
            }
            const cleanCorrections = {};
            for (const [k, entryRaw] of Object.entries(rec.manualCorrections)) {
                if (!k || k.length > 80 || !entryRaw || typeof entryRaw !== 'object' || Array.isArray(entryRaw))
                    continue;
                if (quarterly && exports.LEGACY_QUARTERLY_DPS_FIELDS.includes(k))
                    continue;
                const entry = entryRaw;
                const normalizeScalar = (val) => {
                    if (val === undefined || val === null)
                        return null;
                    if (typeof val === 'string' || typeof val === 'boolean')
                        return val;
                    if (typeof val === 'number' && Number.isFinite(val))
                        return Object.is(val, -0) ? 0 : val;
                    return String(val);
                };
                cleanCorrections[k] = {
                    field: typeof entry.field === 'string' && entry.field.trim() ? entry.field.trim() : k,
                    originalValue: normalizeScalar(entry.originalValue),
                    correctedValue: normalizeScalar(entry.correctedValue),
                    editedAt: typeof entry.editedAt === 'string' && entry.editedAt.trim() ? entry.editedAt.trim() : new Date().toISOString(),
                    ...(typeof entry.reasonAr === 'string' && entry.reasonAr.trim() ? { reasonAr: entry.reasonAr.trim().slice(0, 240) } : {}),
                };
            }
            sanitizedRec.manualCorrections = cleanCorrections;
        }
        if (quarterly) {
            sanitizedRec = stripLegacyQuarterlyDpsFromRecord(sanitizedRec);
        }
        for (const v of Object.values(sanitizedRec)) {
            if (typeof v === 'number' && !Number.isFinite(v)) {
                throw new Error('قيمة رقمية غير صالحة.');
            }
        }
        if (!quarterly) {
            const docBytes = (0, batchLimits_1.estimateJsonUtf8Bytes)(sanitizedRec);
            if (docBytes > batchLimits_1.FIRESTORE_MAX_DOCUMENT_BYTES) {
                throw new Error(`حجم صف التداول اليومي للسهم ${ticker} (${sanitizedRec.tradeDate}) يبلغ ${docBytes.toLocaleString('en-US')} بايت ويتجاوز حد مستند Firestore (${batchLimits_1.FIRESTORE_MAX_DOCUMENT_BYTES.toLocaleString('en-US')} بايت)؛ لا يمكن حذفه جزئياً.`);
            }
        }
        const id = quarterly ? `${ticker}_${rec.year}_${rec.quarter}` : `${ticker}_${rec.tradeDate}`;
        if (keys.has(id))
            throw new Error('سجلات مكررة في الطلب.');
        keys.add(id);
        return sanitizedRec;
    });
}
function validateBetaRecords(value, maxBatch = 400) {
    if (!Array.isArray(value) || value.length < 1 || value.length > maxBatch) {
        throw new Error(`أرسل من 1 إلى ${maxBatch} سجل بيتا في الدفعة الواحدة.`);
    }
    const seen = new Set();
    return value.map((item, idx) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`سجل بيتا غير صالح في الموضع ${idx + 1}.`);
        }
        const raw = item;
        const ticker = (0, normalization_1.normalizedTicker)(raw.ticker);
        if (seen.has(ticker)) {
            throw new Error(`تعارض أو تكرار لرمز السهم ${ticker} داخل نفس الطلب.`);
        }
        seen.add(ticker);
        if (typeof raw.beta !== 'number' || !Number.isFinite(raw.beta)) {
            throw new Error(`قيمة بيتا للسهم ${ticker} يجب أن تكون رقماً منتهياً (يُقبل 0 والسالب).`);
        }
        const asOfDate = (0, normalization_1.parseCleanText)(raw.asOfDate);
        if (!asOfDate || !(0, normalization_1.isValidCalendarDate)(asOfDate)) {
            throw new Error(`تاريخ السريان AsOfDate للسهم ${ticker} غير صالح (المطلوب YYYY-MM-DD).`);
        }
        const source = (0, normalization_1.parseCleanText)(raw.source);
        if (!source || source.length > 500) {
            throw new Error(`المصدر Source للسهم ${ticker} مطلوب.`);
        }
        return {
            ticker,
            beta: Object.is(raw.beta, -0) ? 0 : raw.beta,
            asOfDate,
            source,
        };
    });
}
function sanitizeDistributionId(raw) {
    const cleaned = (0, normalization_1.parseCleanText)(raw);
    if (!cleaned) {
        throw new Error('معرّف التوزيع (DistributionId) مطلوب.');
    }
    if (cleaned.includes('/') || cleaned.includes('..')) {
        throw new Error(`معرّف التوزيع (${cleaned}) لا يجب أن يحتوي على / أو ...`);
    }
    const normalized = cleaned.replace(/\s+/g, '_').slice(0, 80);
    if (!normalized) {
        throw new Error('معرّف التوزيع (DistributionId) غير صالح.');
    }
    return normalized;
}
function buildDividendDocId(rec) {
    const tk = (0, normalization_1.normalizedTicker)(rec.ticker);
    const distId = sanitizeDistributionId(rec.distributionId);
    return `${tk}_${rec.fiscalYear}_${rec.recordType}_${distId}`;
}
function validateDividendRecords(value, maxBatch = 350) {
    if (!Array.isArray(value) || value.length < 1 || value.length > maxBatch) {
        throw new Error(`أرسل من 1 إلى ${maxBatch} سجل توزيعات في الدفعة الواحدة.`);
    }
    const seenIds = new Set();
    return value.map((item, idx) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`سجل توزيعات غير صالح في الموضع ${idx + 1}.`);
        }
        const raw = item;
        const ticker = (0, normalization_1.normalizedTicker)(raw.ticker);
        if (typeof raw.fiscalYear !== 'number' ||
            !Number.isInteger(raw.fiscalYear) ||
            raw.fiscalYear < 1900 ||
            raw.fiscalYear > 2200) {
            throw new Error(`السنة المالية (FiscalYear) للسهم ${ticker} غير صالحة (1900-2200).`);
        }
        if (typeof raw.cashDps !== 'number' || !Number.isFinite(raw.cashDps) || raw.cashDps < 0) {
            throw new Error(`التوزيع النقدي للسهم (CashDPS) للسهم ${ticker} يجب أن يكون رقماً منتهياً >= 0 (يُقبل 0 المؤكد).`);
        }
        const cashDps = Object.is(raw.cashDps, -0) ? 0 : raw.cashDps;
        const asOfDate = (0, normalization_1.parseCleanText)(raw.asOfDate);
        if (!asOfDate || !(0, normalization_1.isValidCalendarDate)(asOfDate)) {
            throw new Error(`تاريخ السريان (AsOfDate) للسهم ${ticker} غير صالح (المطلوب YYYY-MM-DD).`);
        }
        const distributionId = sanitizeDistributionId(raw.distributionId);
        const recordTypeRaw = String(raw.recordType ?? 'regular').trim().toLowerCase();
        if (recordTypeRaw !== 'regular' && recordTypeRaw !== 'special') {
            throw new Error(`نوع التوزيع (RecordType) للسهم ${ticker} يجب أن يكون regular أو special.`);
        }
        const recordType = recordTypeRaw;
        const approvalRaw = String(raw.approvalStatus ?? 'approved').trim().toLowerCase();
        if (approvalRaw !== 'proposed' &&
            approvalRaw !== 'approved' &&
            approvalRaw !== 'paid' &&
            approvalRaw !== 'cancelled') {
            throw new Error(`حالة الاعتماد (ApprovalStatus) للسهم ${ticker} غير صالحة.`);
        }
        const approvalStatus = approvalRaw;
        const semanticsRaw = String(raw.distributionSemantics ?? '').trim().toLowerCase();
        if (semanticsRaw !== 'annual_total' &&
            semanticsRaw !== 'standalone_event' &&
            semanticsRaw !== 'installment') {
            throw new Error(`دلالة التوزيع (Semantics) للسهم ${ticker} يجب أن تكون annual_total أو standalone_event أو installment.`);
        }
        const distributionSemantics = semanticsRaw;
        const checkOptionalDate = (val, label) => {
            const text = (0, normalization_1.parseCleanText)(val);
            if (!text)
                return null;
            if (!(0, normalization_1.isValidCalendarDate)(text)) {
                throw new Error(`تاريخ ${label} للسهم ${ticker} غير صالح (المطلوب YYYY-MM-DD).`);
            }
            return text;
        };
        const exDividendDate = checkOptionalDate(raw.exDividendDate, 'ExDividendDate');
        const paymentDate = checkOptionalDate(raw.paymentDate, 'PaymentDate');
        const recordDate = checkOptionalDate(raw.recordDate, 'RecordDate');
        let totalDistributionAmount = null;
        if (raw.totalDistributionAmount !== undefined && raw.totalDistributionAmount !== null) {
            if (typeof raw.totalDistributionAmount !== 'number' ||
                !Number.isFinite(raw.totalDistributionAmount) ||
                raw.totalDistributionAmount < 0) {
                throw new Error(`إجمالي التوزيع النقدي للسهم ${ticker} يجب أن يكون رقماً >= 0 أو فارغاً.`);
            }
            totalDistributionAmount = Object.is(raw.totalDistributionAmount, -0)
                ? 0
                : raw.totalDistributionAmount;
        }
        let eligibleSharesCount = null;
        if (raw.eligibleSharesCount !== undefined && raw.eligibleSharesCount !== null) {
            if (typeof raw.eligibleSharesCount !== 'number' ||
                !Number.isFinite(raw.eligibleSharesCount) ||
                raw.eligibleSharesCount <= 0) {
                throw new Error(`عدد الأسهم المستحقة للتوزيع للسهم ${ticker} يجب أن يكون موجباً أو فارغاً.`);
            }
            eligibleSharesCount = raw.eligibleSharesCount;
        }
        let currency = null;
        if (raw.currency !== undefined && raw.currency !== null && String(raw.currency).trim() !== '') {
            const cur = (0, normalization_1.normalizeStrictCurrency)(raw.currency);
            if (cur.status !== 'valid' || !cur.code) {
                throw new Error(`عملة التوزيع للسهم ${ticker} غير مدعومة (المسموح EGP أو USD فقط).`);
            }
            currency = cur.code;
        }
        const source = (0, normalization_1.parseCleanText)(raw.source)?.slice(0, 240) ?? null;
        const parentAnnouncementIdRaw = (0, normalization_1.parseCleanText)(raw.parentAnnouncementId);
        if (parentAnnouncementIdRaw && (parentAnnouncementIdRaw.includes('/') || parentAnnouncementIdRaw.includes('..'))) {
            throw new Error(`معرّف التوزيع الأب للسهم ${ticker} غير صالح.`);
        }
        const parentAnnouncementId = parentAnnouncementIdRaw ? parentAnnouncementIdRaw.slice(0, 80) : null;
        const notes = (0, normalization_1.parseCleanText)(raw.notes)?.slice(0, 500) ?? null;
        const docId = buildDividendDocId({
            ticker,
            fiscalYear: raw.fiscalYear,
            recordType,
            distributionId,
        });
        if (seenIds.has(docId)) {
            throw new Error(`تعارض أو تكرار سجل توزيع (${docId}) داخل نفس الدفعة.`);
        }
        seenIds.add(docId);
        return {
            ticker,
            fiscalYear: raw.fiscalYear,
            cashDps,
            asOfDate,
            distributionId,
            recordType,
            approvalStatus,
            distributionSemantics,
            exDividendDate,
            paymentDate,
            recordDate,
            totalDistributionAmount,
            eligibleSharesCount,
            currency,
            source,
            parentAnnouncementId,
            notes,
        };
    });
}
function buildDividendYearStatusDocId(ticker, fiscalYear) {
    const tk = (0, normalization_1.normalizedTicker)(ticker);
    const yr = typeof fiscalYear === 'number' ? fiscalYear : Number(fiscalYear);
    if (!Number.isInteger(yr) || yr < 1900 || yr > 2200) {
        throw new Error(`السنة المالية (FiscalYear) للسهم ${tk} غير صالحة (1900-2200).`);
    }
    return `${tk}_${yr}`;
}
function isActiveDividendRecordForConflict(rec) {
    if (!rec || rec.isDeleted === true)
        return false;
    const st = String(rec.approvalStatus ?? 'approved').trim().toLowerCase();
    return st === 'approved' || st === 'paid';
}
function validateDividendYearStatusPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('بيانات حالة اكتمال توزيعات السنة غير صالحة.');
    }
    const obj = raw;
    const ticker = (0, normalization_1.normalizedTicker)(obj.ticker);
    const fiscalYear = typeof obj.fiscalYear === 'number' ? obj.fiscalYear : Number(obj.fiscalYear);
    if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200) {
        throw new Error(`السنة المالية للسهم ${ticker} غير صالحة (1900-2200).`);
    }
    const statusRaw = String(obj.status ?? '').trim().toLowerCase();
    if (!exports.ALLOWED_DIVIDEND_YEAR_STATUSES.has(statusRaw)) {
        throw new Error(`حالة توزيعات السنة للسهم ${ticker} غير صالحة؛ المسموح: unknown | partial | complete | confirmed_no_dividend.`);
    }
    const confirmedSource = (0, normalization_1.parseCleanText)(obj.confirmedSource)?.slice(0, 240) ?? null;
    const confirmedAtRaw = (0, normalization_1.parseCleanText)(obj.confirmedAt);
    if (confirmedAtRaw && !(0, normalization_1.isValidCalendarDate)(confirmedAtRaw)) {
        throw new Error(`تاريخ تأكيد حالة التوزيعات (confirmedAt) للسهم ${ticker} غير صالح (YYYY-MM-DD).`);
    }
    if ((statusRaw === 'complete' || statusRaw === 'confirmed_no_dividend') &&
        !confirmedSource) {
        throw new Error(`يلزم توثيق مصدر التأكيد (confirmedSource) للسهم ${ticker} لعام ${fiscalYear} عند اعتماد حالة ${statusRaw}.`);
    }
    const notes = (0, normalization_1.parseCleanText)(obj.notes)?.slice(0, 500) ?? null;
    return {
        ticker,
        fiscalYear,
        status: statusRaw,
        confirmedSource,
        confirmedAt: confirmedAtRaw ??
            (statusRaw === 'complete' || statusRaw === 'confirmed_no_dividend'
                ? new Date().toISOString().slice(0, 10)
                : null),
        notes,
    };
}
function validateParameterRecords(value, maxBatch = 400) {
    if (!Array.isArray(value) || value.length < 1 || value.length > maxBatch) {
        throw new Error(`أرسل من 1 إلى ${maxBatch} معاملاً في الدفعة الواحدة.`);
    }
    const seen = new Set();
    return value.map((item, idx) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`سجل معامل غير صالح في الموضع ${idx + 1}.`);
        }
        const raw = item;
        const key = typeof raw.key === 'string' ? raw.key.trim() : '';
        if (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(key)) {
            throw new Error(`اسم المعامل Key غير صالح في الموضع ${idx + 1}.`);
        }
        const scopeRaw = String(raw.scope ?? 'global').trim().toLowerCase();
        if (scopeRaw !== 'global' && scopeRaw !== 'company') {
            throw new Error(`النطاق Scope للمعامل ${key} يجب أن يكون global أو company.`);
        }
        const scope = scopeRaw;
        let ticker = null;
        if (scope === 'company') {
            ticker = (0, normalization_1.normalizedTicker)(raw.ticker);
        }
        else if ((0, normalization_1.parseCleanText)(raw.ticker) !== null) {
            throw new Error(`المعامل العام ${key} (scope=global) يجب أن يكون عمود Ticker فيه فارغاً.`);
        }
        const def = (0, parameterRegistry_1.getParameterDefinition)(key);
        if (def && !def.allowedScopes.includes(scope)) {
            throw new Error(`المعامل ${key} لا يدعم النطاق ${scope}.`);
        }
        if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
            throw new Error(`القيمة للمعامل ${key} يجب أن تكون رقماً منتهياً.`);
        }
        const val = Object.is(raw.value, -0) ? 0 : raw.value;
        if (def) {
            if (def.valueType === 'integer' && !Number.isInteger(val)) {
                throw new Error(`المعامل ${key} يجب أن يكون عدداً صحيحاً.`);
            }
            if (def.valueType === 'mode' && (!Number.isInteger(val) || (def.allowedValues && !def.allowedValues.includes(val)))) {
                throw new Error(`المعامل ${key} يقبل القيم: ${def.allowedValues?.join(', ')}.`);
            }
            if (def.min !== undefined && val < def.min) {
                throw new Error(`المعامل ${key} يجب أن يكون >= ${def.min}.`);
            }
            if (def.max !== undefined && val > def.max) {
                throw new Error(`المعامل ${key} يجب أن يكون <= ${def.max}.`);
            }
        }
        const rawValueType = (0, parameterTypeContract_1.parseOptionalParameterValueType)(raw.valueType, key);
        const rawIsPercentage = (0, parameterTypeContract_1.parseOptionalParameterIsPercentage)(raw.isPercentage, key);
        let resolvedValueType;
        let resolvedIsPercentage;
        let nameAr;
        let category;
        if (def) {
            // Central parameter registry is authoritative for all cataloged parameters.
            resolvedValueType = def.valueType;
            resolvedIsPercentage = def.valueType === 'pct' || def.isPercentage === true;
            nameAr = def.nameAr;
            category = def.category;
        }
        else {
            if (rawValueType !== undefined && rawIsPercentage !== undefined) {
                if ((rawValueType === 'pct') !== rawIsPercentage) {
                    throw new Error(`تعارض في تعريف نوع المعامل ${key}: valueType=${rawValueType} لا يتوافق مع isPercentage=${String(rawIsPercentage)}.`);
                }
            }
            if (rawValueType !== undefined) {
                resolvedValueType = rawValueType;
                resolvedIsPercentage = rawValueType === 'pct';
            }
            else if (rawIsPercentage !== undefined) {
                resolvedValueType = rawIsPercentage ? 'pct' : 'number';
                resolvedIsPercentage = rawIsPercentage;
            }
            else {
                // Preserve legacy / unspecified custom parameters without inventing a type.
                resolvedValueType = null;
                resolvedIsPercentage = null;
            }
            if (resolvedValueType === 'integer' && !Number.isInteger(val)) {
                throw new Error(`المعامل ${key} من النوع integer ويجب أن يكون عدداً صحيحاً.`);
            }
            nameAr = (0, normalization_1.parseCleanText)(raw.nameAr)?.slice(0, 160) ?? undefined;
            if ((0, parameterTypeContract_1.isValidParameterCategory)(raw.category)) {
                category = raw.category;
            }
        }
        const asOfDate = (0, normalization_1.parseCleanText)(raw.asOfDate) || '';
        if (asOfDate && !(0, normalization_1.isValidCalendarDate)(asOfDate)) {
            throw new Error(`تاريخ السريان AsOfDate للمعامل ${key} غير صالح (المطلوب YYYY-MM-DD).`);
        }
        const description = (0, normalization_1.parseCleanText)(raw.description ?? raw.descriptionAr) || def?.descriptionAr || '';
        const unit = (0, normalization_1.parseCleanText)(raw.unit) ||
            def?.unit ||
            (resolvedIsPercentage === true ? 'decimal' : 'number');
        const source = (0, normalization_1.parseCleanText)(raw.source) || 'إدخال معتمد';
        const rfMethRaw = raw.rfMethodology ?? raw.RfMethodology;
        let rfMethodology;
        if (rfMethRaw !== undefined && rfMethRaw !== null && String(rfMethRaw).trim() !== '') {
            rfMethodology = (0, normalization_1.normalizeRfMethodology)(rfMethRaw, {
                strict: true,
                contextLabel: key,
            });
        }
        else if (key === 'Rf_Egypt_10Y' || key === 'Rf_USD_10Y') {
            rfMethodology = 'unspecified';
        }
        let currency;
        const rawCurrency = raw.currency ?? raw.Currency;
        if (rawCurrency !== undefined && rawCurrency !== null && String(rawCurrency).trim() !== '') {
            const parsedCur = (0, normalization_1.normalizeStrictCurrency)(rawCurrency);
            if (parsedCur.status !== 'valid' || !parsedCur.code) {
                throw new Error(`العملة للمعامل ${key} غير مدعومة (${String(rawCurrency)}); يُقبل EGP أو USD فقط.`);
            }
            currency = parsedCur.code;
        }
        let forecastHorizonYears;
        const rawHorizon = raw.forecastHorizonYears ?? raw.ForecastHorizonYears;
        if (rawHorizon !== undefined && rawHorizon !== null && String(rawHorizon).trim() !== '') {
            const hNum = Number(rawHorizon);
            if (!Number.isInteger(hNum) || hNum < 1 || hNum > 20) {
                throw new Error(`عدد سنوات الأفق ForecastHorizonYears للمعامل ${key} يجب أن يكون عدداً صحيحاً من 1 إلى 20.`);
            }
            forecastHorizonYears = hNum;
        }
        if (key === 'Projected_Terminal_EBITDA') {
            const unitUpper = unit.toUpperCase();
            const impliedUnitCurrency = unitUpper.startsWith('USD')
                ? 'USD'
                : unitUpper.startsWith('EGP')
                    ? 'EGP'
                    : null;
            if (currency && impliedUnitCurrency && currency !== impliedUnitCurrency) {
                throw new Error('تعارض بين عملة Projected_Terminal_EBITDA ووحدتها المالية.');
            }
            if (!currency && impliedUnitCurrency) {
                currency = impliedUnitCurrency;
            }
        }
        let precondition;
        if (raw.precondition !== undefined && raw.precondition !== null) {
            if (typeof raw.precondition !== 'object' || Array.isArray(raw.precondition)) {
                throw new Error(`شرط التزامن (precondition) للمعامل ${key} غير صالح.`);
            }
            const pre = raw.precondition;
            const modeRaw = typeof pre.mode === 'string' ? pre.mode.trim().toLowerCase() : '';
            if (modeRaw !== 'create' && modeRaw !== 'update') {
                throw new Error(`وضع شرط التزامن (precondition.mode) للمعامل ${key} يجب أن يكون create أو update.`);
            }
            let expectedRevision;
            if (pre.expectedRevision !== undefined && pre.expectedRevision !== null) {
                if (typeof pre.expectedRevision !== 'number' ||
                    !Number.isInteger(pre.expectedRevision) ||
                    pre.expectedRevision < 0) {
                    throw new Error(`رقم الإصدار المتوقع (expectedRevision) للمعامل ${key} يجب أن يكون عدداً صحيحاً غير سالب.`);
                }
                expectedRevision = pre.expectedRevision;
            }
            else if (pre.expectedRevision === null) {
                expectedRevision = null;
            }
            let expectedContentHash;
            if (pre.expectedContentHash !== undefined && pre.expectedContentHash !== null) {
                if (typeof pre.expectedContentHash !== 'string' || pre.expectedContentHash.trim() === '') {
                    throw new Error(`بصمة المحتوى المتوقعة (expectedContentHash) للمعامل ${key} غير صالحة.`);
                }
                expectedContentHash = pre.expectedContentHash.trim().slice(0, 128);
            }
            else if (pre.expectedContentHash === null) {
                expectedContentHash = null;
            }
            if (modeRaw === 'update' && expectedRevision == null && !expectedContentHash) {
                throw new Error(`شرط التحديث المتزامن للمعامل ${key} يتطلب expectedRevision أو expectedContentHash على الأقل.`);
            }
            precondition = {
                mode: modeRaw,
                ...(expectedRevision !== undefined ? { expectedRevision } : {}),
                ...(expectedContentHash !== undefined ? { expectedContentHash } : {}),
            };
        }
        if (scope === 'global' && !precondition) {
            throw new Error(`شرط التزامن (precondition) إلزامي عند كتابة المعامل العام (${key}) في macro_params؛ حدّد mode="create" للإنشاء أو mode="update" مع نسخة أساس صالحة (expectedRevision أو expectedContentHash) للتحديث.`);
        }
        const dedupId = scope === 'global' ? `global:${key}` : `company:${ticker}:${key}`;
        if (seen.has(dedupId)) {
            throw new Error(`تكرار أو تعارض للمعامل ${key} (${ticker ?? 'global'}) داخل نفس الطلب.`);
        }
        seen.add(dedupId);
        return {
            key,
            ...(nameAr ? { nameAr } : {}),
            value: val,
            description,
            scope,
            ticker,
            unit,
            ...(category ? { category } : {}),
            valueType: resolvedValueType,
            isPercentage: resolvedIsPercentage,
            asOfDate,
            source,
            ...(rfMethodology !== undefined ? { rfMethodology } : {}),
            ...(currency !== undefined ? { currency } : {}),
            ...(forecastHorizonYears !== undefined ? { forecastHorizonYears } : {}),
            ...(precondition !== undefined ? { precondition } : {}),
        };
    });
}
function financialProjection(rec) {
    const companyId = (0, normalization_1.normalizedTicker)(rec.ticker).toLowerCase();
    const ending = { Q1: '03-31', Q2: '06-30', Q3: '09-30', FY: '12-31' };
    const quarter = String(rec.quarter);
    return {
        id: `${companyId}_${rec.year}_${quarter.toLowerCase()}`,
        companyId,
        year: rec.year,
        quarter: rec.quarter,
        periodDate: rec.periodEndDate || `${rec.year}-${ending[quarter] || '12-31'}`,
        periodStartDate: rec.periodStartDate ?? null,
        periodEndDate: rec.periodEndDate ?? null,
        periodDays: rec.periodDays ?? null,
        revenueYTD: rec.revenueYTD ?? null,
        grossProfitYTD: rec.grossProfitYTD ?? null,
        operatingProfitYTD: rec.ebitYTD ?? null,
        netProfitYTD: rec.netIncomeYTD ?? null,
        operatingCashFlowYTD: rec.ocfYTD ?? null,
        capexYTD: rec.capexYTD ?? null,
        dividendsPaidYTD: rec.dividendsPaidYTD ?? null,
        totalAssets: rec.totalAssets ?? null,
        totalDebt: rec.totalDebtWithoutTX ?? null,
        cashAndEquivalents: rec.cash ?? null,
        totalEquity: rec.equity ?? null,
        sharesCount: rec.shares ?? null,
        isAudited: false,
        depreciationAmortizationYTD: rec.depreciationAmortizationYTD ?? null,
        changeOperatingNwcYTD: rec.changeOperatingNwcYTD ?? null,
        valuationTaxRate: rec.valuationTaxRate ?? null,
        valuationSource: rec.valuationSource ?? null,
        financialUnit: rec.financialUnit ?? null,
        financialCurrency: rec.financialCurrency ?? null,
        netIncomeCommonYTD: rec.netIncomeCommonYTD ?? null,
        netIncomeCommonBasis: rec.netIncomeCommonBasis ?? null,
        netIncomeCommonNote: rec.netIncomeCommonNote ?? null,
        commonEquity: rec.equityCommon ?? null,
        commonEquityBasis: rec.equityCommonBasis ?? null,
        commonEquityNote: rec.equityCommonNote ?? null,
        weightedAvgSharesYTD: rec.weightedAvgSharesYTD ?? null,
        weightedAvgSharesBasis: rec.weightedAvgSharesBasis ?? null,
        reportedEps: rec.reportedEps ?? null,
        reportedEpsSource: rec.reportedEpsSource ?? null,
        reportedEpsPeriodType: rec.reportedEpsPeriodType ?? null,
        reportedEpsFiscalYear: rec.reportedEpsFiscalYear ?? null,
        reportedEpsFiscalQuarter: rec.reportedEpsFiscalQuarter ?? null,
        reportedEpsPeriodStart: rec.reportedEpsPeriodStart ?? null,
        reportedEpsPeriodEnd: rec.reportedEpsPeriodEnd ?? null,
        reportedEpsPeriod: rec.reportedEpsPeriod ?? null,
        isCapitalActionAdjusted: rec.isCapitalActionAdjusted ?? null,
    };
}
const ALLOWED_COMPANY_PATCH_TEXT_KEYS = [
    'nameAr',
    'nameEn',
    'shortName',
    'fullName',
    'sector',
    'rawSector',
    'sectorId',
    'sectorSource',
    'sectorDate',
    'isinCode',
    'market',
    'currency',
    'description',
    'website',
    'rimRetentionPolicySource',
];
const LEGACY_COMPANY_VALUATION_NUMERIC_KEYS = new Set([
    'beta',
    'riskFreeRate',
    'equityRiskPremium',
    'costOfDebt',
    'taxRate',
    'sustainableGrowthRate',
    'targetPE',
    'targetPB',
]);
const ALLOWED_COMPANY_PATCH_NUMERIC_KEYS = [
    'sharesOutstanding',
    'beta',
    'riskFreeRate',
    'equityRiskPremium',
    'costOfDebt',
    'taxRate',
    'targetDebtRatio',
    'sustainableGrowthRate',
    'shortTermGrowthRate',
    'targetPE',
    'targetPB',
];
function sanitizeCompanyMetadataPatch(rawPatch, fallbackTicker) {
    if (rawPatch === undefined || rawPatch === null)
        return null;
    if (typeof rawPatch !== 'object' || Array.isArray(rawPatch)) {
        throw new Error('بيانات الشركة الوصفية غير صالحة.');
    }
    const raw = rawPatch;
    const tk = (0, normalization_1.normalizedTicker)(raw.ticker ?? fallbackTicker ?? raw.id);
    const companyId = tk.toLowerCase();
    const patch = {};
    for (const key of ALLOWED_COMPANY_PATCH_TEXT_KEYS) {
        if (!(key in raw) || raw[key] === undefined)
            continue;
        const val = raw[key];
        if (val === null) {
            patch[key] = null;
        }
        else if (typeof val === 'string') {
            const trimmed = val.trim();
            patch[key] = trimmed === '' ? null : trimmed;
        }
        else {
            throw new Error(`الحقل ${key} يجب أن يكون نصاً.`);
        }
    }
    if ('sectorClassification' in raw && raw.sectorClassification !== undefined) {
        const sc = raw.sectorClassification;
        if (sc !== null && sc !== 'non_financial' && sc !== 'financial' && sc !== 'unknown') {
            throw new Error('تصنيف نشاط الشركة غير صالح.');
        }
        patch.sectorClassification = sc;
    }
    if ('instrumentType' in raw && raw.instrumentType !== undefined) {
        const it = raw.instrumentType;
        if (it !== null && it !== 'equity' && it !== 'bond' && it !== 'other' && it !== 'unknown') {
            throw new Error('نوع الورقة المالية للشركة غير صالح.');
        }
        patch.instrumentType = it;
    }
    if ('rimRetentionPolicy' in raw && raw.rimRetentionPolicy !== undefined) {
        const rrp = raw.rimRetentionPolicy;
        if (rrp !== null &&
            rrp !== 'rim_parameter' &&
            rrp !== 'historical_retention' &&
            rrp !== 'minimum') {
            throw new Error('سياسة احتجاز نموذج RIM للشركة غير صالحة.');
        }
        patch.rimRetentionPolicy = rrp;
    }
    for (const key of ALLOWED_COMPANY_PATCH_NUMERIC_KEYS) {
        if (!(key in raw) || raw[key] === undefined)
            continue;
        const val = raw[key];
        if (val === null) {
            patch[key] = null;
            continue;
        }
        if (LEGACY_COMPANY_VALUATION_NUMERIC_KEYS.has(key)) {
            const destHint = key === 'beta'
                ? 'beta_assumptions/{Ticker}'
                : 'company_assumptions/{Ticker}/parameters/{Key}';
            throw new Error(`لا يُسمح بكتابة معامل التقييم (${key}) داخل مستند companies القديم؛ استخدم المسار المعتمد ${destHint}.`);
        }
        if (typeof val !== 'number' || !Number.isFinite(val)) {
            throw new Error(`الحقل ${key} يجب أن يكون رقماً أو فارغاً.`);
        }
        if (key === 'sharesOutstanding' && val <= 0) {
            throw new Error('عدد الأسهم القائمة يجب أن يكون أكبر من صفر.');
        }
        patch[key] = val;
    }
    return { companyId, ticker: tk, patch };
}
function buildCompanyDocWritePayload(existingDoc, companyId, ticker, patch, stamp) {
    if (existingDoc) {
        return {
            ...existingDoc,
            ...patch,
            id: companyId,
            ticker,
            ...stamp,
        };
    }
    return {
        id: companyId,
        ticker,
        nameAr: patch.nameAr || ticker,
        nameEn: patch.nameEn || patch.nameAr || ticker,
        sector: patch.sector ?? null,
        ...(patch.sectorClassification !== undefined ? { sectorClassification: patch.sectorClassification } : {}),
        marketPrice: null,
        sharesOutstanding: patch.sharesOutstanding ?? null,
        beta: patch.beta ?? null,
        riskFreeRate: patch.riskFreeRate ?? null,
        equityRiskPremium: patch.equityRiskPremium ?? null,
        costOfDebt: patch.costOfDebt ?? null,
        taxRate: patch.taxRate ?? null,
        targetDebtRatio: patch.targetDebtRatio ?? null,
        sustainableGrowthRate: patch.sustainableGrowthRate ?? null,
        shortTermGrowthRate: patch.shortTermGrowthRate ?? null,
        targetPE: patch.targetPE ?? null,
        targetPB: patch.targetPB ?? null,
        currency: patch.currency || 'EGP',
        description: patch.description ?? '',
        ...(patch.website !== undefined ? { website: patch.website } : {}),
        ...patch,
        ...stamp,
    };
}
class QuarterlyValidationError extends Error {
    code = 'invalid-argument';
    constructor(message) {
        super(message);
        this.name = 'QuarterlyValidationError';
    }
}
exports.QuarterlyValidationError = QuarterlyValidationError;
const QUARTERLY_SERVER_PROVENANCE_KEYS = new Set([
    'importId',
    'sourceFile',
    'sourceSheet',
    'sourceRow',
    'schemaVersion',
    'updatedBy',
    'serverUpdatedAt',
    'updatedAt',
    'contentHash',
    'isDeleted',
    'deletedAt',
    'deletedBy',
]);
function hasDefinedOwnKey(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}
function stripUndefinedKeys(record) {
    const out = {};
    for (const [k, v] of Object.entries(record)) {
        if (v === undefined)
            continue;
        out[k] = v;
    }
    return out;
}
exports.QUARTERLY_NESTED_MAP_FIELDS = [
    'extendedFields',
    'originalValues',
    'manualCorrections',
];
const QUARTERLY_NESTED_MAP_KEY_SET = new Set(exports.QUARTERLY_NESTED_MAP_FIELDS);
function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
function sanitizeExtendedFieldValue(value, depth = 0) {
    if (depth > 16) {
        throw new QuarterlyValidationError('عمق التداخل في extendedFields يتجاوز الحد المسموح.');
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new QuarterlyValidationError('قيمة رقمية غير صالحة في extendedFields.');
        }
        return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => (item === undefined ? null : sanitizeExtendedFieldValue(item, depth + 1)));
    }
    if (isPlainRecord(value)) {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === undefined)
                continue;
            out[k] = sanitizeExtendedFieldValue(v, depth + 1);
        }
        return out;
    }
    return String(value);
}
function mergeExtendedFieldsRecursive(existingObj, incomingObj, depth = 0) {
    if (depth > 16) {
        throw new QuarterlyValidationError('عمق التداخل في extendedFields يتجاوز الحد المسموح.');
    }
    const merged = {};
    if (existingObj) {
        for (const [k, v] of Object.entries(existingObj)) {
            if (v === undefined)
                continue;
            if (depth === 0 && exports.LEGACY_QUARTERLY_DPS_FIELDS.includes(k))
                continue;
            merged[k] = v;
        }
    }
    for (const [k, v] of Object.entries(incomingObj)) {
        if (v === undefined)
            continue;
        if (depth === 0 && exports.LEGACY_QUARTERLY_DPS_FIELDS.includes(k))
            continue;
        if (v === null) {
            // Explicit null on a nested key deletes that key from extendedFields
            delete merged[k];
            continue;
        }
        if (isPlainRecord(v)) {
            const existingChild = isPlainRecord(merged[k]) ? merged[k] : null;
            const mergedChild = mergeExtendedFieldsRecursive(existingChild, v, depth + 1);
            if (mergedChild === null) {
                delete merged[k];
            }
            else {
                merged[k] = mergedChild;
            }
            continue;
        }
        merged[k] = sanitizeExtendedFieldValue(v, depth + 1);
    }
    return Object.keys(merged).length > 0 ? merged : null;
}
/**
 * Central policy for quarterly nested map fields (`extendedFields`, `originalValues`, `manualCorrections`).
 *
 * Contract:
 * 1. Omitted (`incomingValue === undefined`): preserves `existingValue` untouched.
 * 2. Explicit `null` (`incomingValue === null`): clears/removes the entire map (`null`).
 * 3. Plain object (`{ ... }`): non-destructive key-level merge onto `existingValue`:
 *    - Omitted keys (including an empty map `{}`) are NEVER treated as deletions; existing keys are preserved.
 *    - `extendedFields`: recursive plain-object key merge; explicit `null` on a key deletes that key;
 *      legacy DPS keys are stripped; empty result canonicalizes to `null`.
 *    - `manualCorrections`: shallow key-level merge; explicit `null` on a key deletes that correction entry;
 *      non-null entry replaces that key's correction object; empty result canonicalizes to `null`.
 *    - `originalValues`: shallow key-level merge; scalar `null` is a valid preserved original value
 *      (clearing the whole map uses top-level `originalValues: null`); empty result canonicalizes to `null`.
 * 4. Non-plain-object (array/primitive): throws `QuarterlyValidationError`.
 */
function mergeQuarterlyNestedMap(field, existingValue, incomingValue) {
    if (incomingValue === undefined) {
        return existingValue;
    }
    if (incomingValue === null) {
        return null;
    }
    if (!isPlainRecord(incomingValue)) {
        throw new QuarterlyValidationError(`الحقل ${field} يجب أن يكون كائناً (خريطة) أو فارغاً (null).`);
    }
    const existingMap = isPlainRecord(existingValue) ? existingValue : null;
    if (field === 'extendedFields') {
        return mergeExtendedFieldsRecursive(existingMap, incomingValue, 0);
    }
    const merged = {};
    if (existingMap) {
        for (const [k, v] of Object.entries(existingMap)) {
            if (v === undefined)
                continue;
            if (exports.LEGACY_QUARTERLY_DPS_FIELDS.includes(k))
                continue;
            merged[k] = v;
        }
    }
    for (const [k, v] of Object.entries(incomingValue)) {
        if (v === undefined)
            continue;
        if (exports.LEGACY_QUARTERLY_DPS_FIELDS.includes(k))
            continue;
        if (field === 'manualCorrections' && v === null) {
            delete merged[k];
            continue;
        }
        merged[k] = v;
    }
    return Object.keys(merged).length > 0 ? merged : null;
}
function extractQuarterlyDocIdentity(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new QuarterlyValidationError('سجل غير صالح.');
    }
    const rec = raw;
    let ticker;
    try {
        ticker = (0, normalization_1.normalizedTicker)(rec.ticker);
    }
    catch (err) {
        throw new QuarterlyValidationError(err instanceof Error ? err.message : 'رمز السهم غير صالح.');
    }
    if (!Number.isInteger(rec.year) ||
        rec.year < 1900 ||
        rec.year > 2200 ||
        !['Q1', 'Q2', 'Q3', 'FY'].includes(rec.quarter)) {
        throw new QuarterlyValidationError('السنة أو الربع غير صالح.');
    }
    const quarter = rec.quarter;
    return {
        ticker,
        year: rec.year,
        quarter,
        docId: `${ticker}_${rec.year}_${quarter}`,
        financialDocId: `${ticker.toLowerCase()}_${rec.year}_${quarter.toLowerCase()}`,
    };
}
/**
 * Single Source of Truth for merging, validating, projecting, and hashing a quarterly financial write
 * (used identically by single `quarterly_record` transactions and transactional `bulk_quarterly` writes).
 *
 * Omitted-key vs explicit-`null` & nested-map update contract:
 * 1. Scalar non-ReportedEPS business fields:
 *    - Omitted (`undefined` or absent from request): preserves the existing Firestore document's value.
 *    - Explicit `null`: clears the field to `null`.
 *    - If `periodStartDate` or `periodEndDate` is updated while `periodDays` is omitted, inherited
 *      `periodDays` is reset to `null` so `validateQuarterlyPeriodInputs` derives the exact day span.
 * 2. Nested map fields (`extendedFields`, `originalValues`, `manualCorrections`):
 *    - Merged via `mergeQuarterlyNestedMap` (omitted preserves, `{}` preserves non-destructively,
 *      object merges keys, top-level `null` clears whole map, nested `null` deletes key in
 *      `extendedFields` / `manualCorrections` while `originalValues` preserves scalar `null`).
 *    - Source writes use full replacement (`merge: false`) of the transactionally-merged final document
 *      so Firestore storage, `contentHash`, and `projection` are bit-for-bit identical.
 * 3. ReportedEPS 8-field group (`REPORTED_EPS_FIELD_GROUP`):
 *    - Untouched group preserves existing fields; touching any of the 6 period fields replaces all 6
 *      atomically; setting `reportedEps: null` clears stale period fields; touching only value/source
 *      validates strictly without accepting free-text-only legacy periods.
 * 4. Projection integrity verification:
 *    - Never trusts stored `existingFinancialDoc.contentHash` alone; verifies actual canonical business
 *      content via `computeFinancialProjectionHash(existingFinancialDoc) === projectionHash` so a
 *      diverged projection is repaired WITHOUT modifying an already-valid source document.
 */
function resolveQuarterlyRecordWrite(existingDoc, incomingRaw, existingFinancialDoc) {
    const hasFinancialSnapshotArg = arguments.length >= 3;
    const identity = extractQuarterlyDocIdentity(incomingRaw);
    const incoming = incomingRaw;
    const activeExisting = existingDoc && existingDoc.isDeleted !== true
        ? stripLegacyQuarterlyDpsFromRecord({ ...existingDoc })
        : null;
    // Base business document from existing Firestore record (excluding volatile server stamp keys)
    const merged = {};
    if (activeExisting) {
        for (const [k, v] of Object.entries(activeExisting)) {
            if (QUARTERLY_SERVER_PROVENANCE_KEYS.has(k) || v === undefined)
                continue;
            merged[k] = v;
        }
    }
    const reportedEpsKeySet = new Set(reportedEpsPeriod_1.REPORTED_EPS_FIELD_GROUP);
    // Merge non-ReportedEPS scalar fields: omitted keys preserve existing; explicit null clears
    for (const [k, v] of Object.entries(incoming)) {
        if (QUARTERLY_SERVER_PROVENANCE_KEYS.has(k) ||
            reportedEpsKeySet.has(k) ||
            QUARTERLY_NESTED_MAP_KEY_SET.has(k) ||
            v === undefined) {
            continue;
        }
        merged[k] = v;
    }
    // Merge nested map fields (`extendedFields`, `originalValues`, `manualCorrections`) centrally
    for (const mapField of exports.QUARTERLY_NESTED_MAP_FIELDS) {
        if (hasDefinedOwnKey(incoming, mapField)) {
            const mergedMap = mergeQuarterlyNestedMap(mapField, activeExisting ? activeExisting[mapField] : undefined, incoming[mapField]);
            merged[mapField] = mergedMap;
        }
    }
    merged.ticker = identity.ticker;
    merged.year = identity.year;
    merged.quarter = identity.quarter;
    // If period start/end dates changed while periodDays was omitted, clear inherited periodDays so span recomputes cleanly
    if ((hasDefinedOwnKey(incoming, 'periodStartDate') || hasDefinedOwnKey(incoming, 'periodEndDate')) &&
        !hasDefinedOwnKey(incoming, 'periodDays')) {
        merged.periodDays = null;
    }
    const touchedValue = hasDefinedOwnKey(incoming, 'reportedEps');
    const touchedSource = hasDefinedOwnKey(incoming, 'reportedEpsSource');
    const touchedPeriod = reportedEpsPeriod_1.REPORTED_EPS_PERIOD_FIELDS.some((k) => hasDefinedOwnKey(incoming, k));
    const touchedAnyReportedEps = touchedValue || touchedSource || touchedPeriod;
    if (!activeExisting || touchedAnyReportedEps) {
        if (touchedValue &&
            incoming.reportedEps !== null &&
            (typeof incoming.reportedEps !== 'number' || !Number.isFinite(incoming.reportedEps))) {
            throw new QuarterlyValidationError('الحقل reportedEps يجب أن يكون رقماً أو فارغاً.');
        }
        const nextReportedEps = touchedValue
            ? incoming.reportedEps === null
                ? null
                : Object.is(incoming.reportedEps, -0)
                    ? 0
                    : incoming.reportedEps
            : typeof activeExisting?.reportedEps === 'number' && Number.isFinite(activeExisting.reportedEps)
                ? activeExisting.reportedEps
                : null;
        let nextReportedEpsSource;
        if (touchedSource) {
            if (incoming.reportedEpsSource === null) {
                nextReportedEpsSource = null;
            }
            else if (typeof incoming.reportedEpsSource !== 'string') {
                throw new QuarterlyValidationError('مصدر ربحية السهم المعلنة (ReportedEPS_Source) يجب أن يكون نصاً أو فارغاً.');
            }
            else {
                const cleanedSrc = (0, normalization_1.parseCleanText)(incoming.reportedEpsSource);
                if (cleanedSrc && cleanedSrc.length > 200) {
                    throw new QuarterlyValidationError('مصدر ربحية السهم المعلنة (ReportedEPS_Source) يجب ألا يتجاوز 200 حرف.');
                }
                nextReportedEpsSource = cleanedSrc;
            }
        }
        else if (touchedValue && nextReportedEps === null) {
            nextReportedEpsSource = null;
        }
        else {
            nextReportedEpsSource =
                typeof activeExisting?.reportedEpsSource === 'string'
                    ? (0, normalization_1.parseCleanText)(activeExisting.reportedEpsSource)
                    : null;
        }
        let periodInput;
        if (touchedPeriod) {
            // Atomic replacement of the 6 period fields — omitted keys become explicit null, never inherited
            periodInput = {
                reportedEps: nextReportedEps,
                reportedEpsPeriodType: hasDefinedOwnKey(incoming, 'reportedEpsPeriodType')
                    ? incoming.reportedEpsPeriodType
                    : null,
                reportedEpsFiscalYear: hasDefinedOwnKey(incoming, 'reportedEpsFiscalYear')
                    ? incoming.reportedEpsFiscalYear
                    : null,
                reportedEpsFiscalQuarter: hasDefinedOwnKey(incoming, 'reportedEpsFiscalQuarter')
                    ? incoming.reportedEpsFiscalQuarter
                    : null,
                reportedEpsPeriodStart: hasDefinedOwnKey(incoming, 'reportedEpsPeriodStart')
                    ? incoming.reportedEpsPeriodStart
                    : null,
                reportedEpsPeriodEnd: hasDefinedOwnKey(incoming, 'reportedEpsPeriodEnd')
                    ? incoming.reportedEpsPeriodEnd
                    : null,
                reportedEpsPeriod: hasDefinedOwnKey(incoming, 'reportedEpsPeriod')
                    ? incoming.reportedEpsPeriod
                    : null,
            };
        }
        else if (touchedValue && nextReportedEps === null) {
            // Clearing ReportedEPS to null without a new period definition clears stale period metadata
            periodInput = {
                reportedEps: null,
                reportedEpsPeriodType: null,
                reportedEpsFiscalYear: null,
                reportedEpsFiscalQuarter: null,
                reportedEpsPeriodStart: null,
                reportedEpsPeriodEnd: null,
                reportedEpsPeriod: null,
            };
        }
        else {
            // Only value/source touched on existing doc (or create without period keys) — validate strictly
            periodInput = {
                reportedEps: nextReportedEps,
                reportedEpsPeriodType: activeExisting?.reportedEpsPeriodType ?? null,
                reportedEpsFiscalYear: activeExisting?.reportedEpsFiscalYear ?? null,
                reportedEpsFiscalQuarter: activeExisting?.reportedEpsFiscalQuarter ?? null,
                reportedEpsPeriodStart: activeExisting?.reportedEpsPeriodStart ?? null,
                reportedEpsPeriodEnd: activeExisting?.reportedEpsPeriodEnd ?? null,
                reportedEpsPeriod: activeExisting?.reportedEpsPeriod ?? null,
            };
        }
        let normalizedPeriod;
        try {
            normalizedPeriod = (0, reportedEpsPeriod_1.validateAndNormalizeReportedEpsPeriod)(periodInput, {
                requirePeriodWhenEpsPresent: true,
                allowLegacyPeriodTextOnly: false,
            });
        }
        catch (err) {
            throw new QuarterlyValidationError(err instanceof Error ? err.message : 'بيانات فترة ReportedEPS غير صالحة.');
        }
        merged.reportedEps = nextReportedEps;
        merged.reportedEpsSource = nextReportedEpsSource;
        merged.reportedEpsPeriodType = normalizedPeriod.reportedEpsPeriodType;
        merged.reportedEpsFiscalYear = normalizedPeriod.reportedEpsFiscalYear;
        merged.reportedEpsFiscalQuarter = normalizedPeriod.reportedEpsFiscalQuarter;
        merged.reportedEpsPeriodStart = normalizedPeriod.reportedEpsPeriodStart;
        merged.reportedEpsPeriodEnd = normalizedPeriod.reportedEpsPeriodEnd;
        merged.reportedEpsPeriod = normalizedPeriod.reportedEpsPeriod;
    }
    let validated;
    try {
        const preserveUntouchedLegacyEps = Boolean(activeExisting && !touchedAnyReportedEps);
        [validated] = validateRecords([merged], true, 1, {
            legacyCompatibilityMode: preserveUntouchedLegacyEps,
        });
    }
    catch (err) {
        throw new QuarterlyValidationError(err instanceof Error ? err.message : 'سجل غير صالح.');
    }
    const finalRecord = stripUndefinedKeys(stripLegacyQuarterlyDpsFromRecord({
        ...validated,
        ticker: identity.ticker,
    }));
    // Canonicalize empty validated maps to null if explicitly present on finalRecord
    for (const mapField of exports.QUARTERLY_NESTED_MAP_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(finalRecord, mapField) &&
            isPlainRecord(finalRecord[mapField]) &&
            Object.keys(finalRecord[mapField]).length === 0) {
            finalRecord[mapField] = null;
        }
    }
    const projection = financialProjection(finalRecord);
    const contentHash = (0, hashing_1.computeRecordBusinessHash)('quarterly', finalRecord);
    const projectionHash = (0, hashing_1.computeFinancialProjectionHash)(projection);
    let sourceNeedsWrite = true;
    if (activeExisting) {
        const existingComputedHash = (0, hashing_1.computeRecordBusinessHash)('quarterly', activeExisting);
        const existingBusinessAndHashMatch = typeof activeExisting.contentHash === 'string' &&
            activeExisting.contentHash === contentHash &&
            existingComputedHash === contentHash;
        // Also detect explicit changes to audit maps (`originalValues` / `manualCorrections`) which are
        // intentionally excluded from `contentHash` so valid audit edits are not silently dropped.
        const existingOrigNorm = isPlainRecord(activeExisting.originalValues) && Object.keys(activeExisting.originalValues).length > 0
            ? activeExisting.originalValues
            : null;
        const finalOrigNorm = isPlainRecord(finalRecord.originalValues) && Object.keys(finalRecord.originalValues).length > 0
            ? finalRecord.originalValues
            : null;
        const existingCorrNorm = isPlainRecord(activeExisting.manualCorrections) &&
            Object.keys(activeExisting.manualCorrections).length > 0
            ? activeExisting.manualCorrections
            : null;
        const finalCorrNorm = isPlainRecord(finalRecord.manualCorrections) &&
            Object.keys(finalRecord.manualCorrections).length > 0
            ? finalRecord.manualCorrections
            : null;
        const auditMapsMatch = (0, hashing_1.stableStringify)(existingOrigNorm) === (0, hashing_1.stableStringify)(finalOrigNorm) &&
            (0, hashing_1.stableStringify)(existingCorrNorm) === (0, hashing_1.stableStringify)(finalCorrNorm);
        sourceNeedsWrite = !(existingBusinessAndHashMatch && auditMapsMatch);
    }
    let projectionNeedsWrite;
    if (!hasFinancialSnapshotArg) {
        projectionNeedsWrite = sourceNeedsWrite;
    }
    else if (!existingFinancialDoc || existingFinancialDoc.isDeleted === true) {
        projectionNeedsWrite = true;
    }
    else {
        const storedFinancialHashMatches = existingFinancialDoc.contentHash === contentHash;
        const actualProjectionContentMatches = (0, hashing_1.computeFinancialProjectionHash)(existingFinancialDoc) === projectionHash;
        projectionNeedsWrite = !(storedFinancialHashMatches && actualProjectionContentMatches);
    }
    const isUnchanged = !sourceNeedsWrite && !projectionNeedsWrite;
    return {
        identity,
        finalRecord,
        projection,
        contentHash,
        projectionHash,
        isInsert: !activeExisting,
        sourceNeedsWrite,
        projectionNeedsWrite,
        isUnchanged,
    };
}
async function applyStockAndQuarterAtomicWrite(tx, params) {
    const identity = extractQuarterlyDocIdentity(params.record);
    const companyPatch = sanitizeCompanyMetadataPatch(params.companyMetadata, identity.ticker);
    // Phase 1: All Firestore transaction reads MUST precede any writes
    const existingQuarter = await tx.getDoc('quarterly_financial_records', identity.docId);
    const existingFinancial = await tx.getDoc('financials', identity.financialDocId);
    let existingCompany;
    let canonicalCompanyPatch = null;
    if (companyPatch) {
        existingCompany = await tx.getDoc('companies', companyPatch.companyId);
        const validatedSector = await (0, sectorLinkage_1.validateAndCanonicalizeCompanySectorWrite)({
            existingCompanyData: existingCompany,
            incomingPatch: companyPatch.patch,
            getSectorDoc: (sectorId) => tx.getDoc('sectorPE', sectorId),
            isCreate: !existingCompany || existingCompany.isDeleted === true,
        });
        canonicalCompanyPatch = validatedSector.canonicalPatch;
    }
    const resolved = resolveQuarterlyRecordWrite(existingQuarter, params.record, existingFinancial);
    // Phase 2: Atomic writes using the exact same final record, projection, and contentHash.
    // Uses `merge: false` for quarterly source & projection so Firestore persists the exact merged
    // document (including nested-map key deletions / clears) matching `contentHash` & `projectionHash`.
    // When only the projection diverged, heals `financials` WITHOUT touching the valid source doc.
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedUnchangedCount = 0;
    if (resolved.isUnchanged) {
        skippedUnchangedCount = 1;
    }
    else {
        if (resolved.isInsert)
            insertedCount = 1;
        else
            updatedCount = 1;
        const writeStamp = {
            ...params.stamp,
            contentHash: resolved.contentHash,
        };
        if (resolved.sourceNeedsWrite) {
            tx.setDoc('quarterly_financial_records', resolved.identity.docId, { ...resolved.finalRecord, ...writeStamp }, false);
        }
        if (resolved.projectionNeedsWrite) {
            tx.setDoc('financials', resolved.projection.id, { ...resolved.projection, ...writeStamp }, false);
        }
    }
    if (companyPatch && canonicalCompanyPatch) {
        const companyPayload = buildCompanyDocWritePayload(existingCompany, companyPatch.companyId, companyPatch.ticker, canonicalCompanyPatch, params.stamp);
        tx.setDoc('companies', companyPatch.companyId, companyPayload, true);
    }
    return {
        docId: resolved.identity.docId,
        financialDocId: resolved.projection.id,
        finalRecord: resolved.finalRecord,
        projection: resolved.projection,
        contentHash: resolved.contentHash,
        projectionHash: resolved.projectionHash,
        sourceWritten: resolved.sourceNeedsWrite,
        projectionWritten: resolved.projectionNeedsWrite,
        insertedCount,
        updatedCount,
        skippedUnchangedCount,
    };
}
function validateBulkQuarterlyRequestEnvelope(rawRecords, maxBatch = (0, batchLimits_1.getMaxRecordLimitForOperation)(true)) {
    if (!Array.isArray(rawRecords) || rawRecords.length < 1 || rawRecords.length > maxBatch) {
        throw new QuarterlyValidationError(`أرسل من 1 إلى ${maxBatch} سجل في الطلب الواحد.`);
    }
    const identities = [];
    const seenIds = new Set();
    for (const item of rawRecords) {
        const idInfo = extractQuarterlyDocIdentity(item);
        if (seenIds.has(idInfo.docId)) {
            throw new QuarterlyValidationError('سجلات مكررة في الطلب.');
        }
        seenIds.add(idInfo.docId);
        identities.push(idInfo);
    }
    return identities;
}
async function applyBulkQuarterlyWrites(target, params) {
    const maxBatch = params.maxBatch ?? (0, batchLimits_1.getMaxRecordLimitForOperation)(true);
    const identities = validateBulkQuarterlyRequestEnvelope(params.rawRecords, maxBatch);
    const refSpecs = [];
    for (const idInfo of identities) {
        refSpecs.push({ collection: 'quarterly_financial_records', docId: idInfo.docId });
        refSpecs.push({ collection: 'financials', docId: idInfo.financialDocId });
    }
    const existingMap = await target.getDocs(refSpecs);
    // Resolve and validate EVERY item before staging any write so invalid items fail atomically
    const resolvedItems = [];
    for (let idx = 0; idx < params.rawRecords.length; idx++) {
        const idInfo = identities[idx];
        const existingQuarter = existingMap.get(`quarterly_financial_records/${idInfo.docId}`);
        const existingFinancial = existingMap.get(`financials/${idInfo.financialDocId}`);
        resolvedItems.push(resolveQuarterlyRecordWrite(existingQuarter, params.rawRecords[idx], existingFinancial));
    }
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedUnchangedCount = 0;
    let writeOps = 0;
    for (let idx = 0; idx < resolvedItems.length; idx++) {
        const resolved = resolvedItems[idx];
        if (resolved.isUnchanged) {
            skippedUnchangedCount += 1;
            continue;
        }
        if (resolved.isInsert)
            insertedCount += 1;
        else
            updatedCount += 1;
        const rawItem = params.rawRecords[idx];
        const sourceRow = typeof rawItem?.sourceRow === 'number' ? rawItem.sourceRow : idx + 1;
        const stamp = {
            ...params.stamp,
            sourceRow,
            contentHash: resolved.contentHash,
        };
        const neededOps = (resolved.sourceNeedsWrite ? 1 : 0) + (resolved.projectionNeedsWrite ? 1 : 0);
        const reservedLogOps = params.importBatchLog ? 1 : 0;
        if (writeOps + neededOps + reservedLogOps > batchLimits_1.FIRESTORE_BATCH_WRITE_LIMIT) {
            throw new QuarterlyValidationError(`تجاوزت الدفعة حد عمليات Firestore (${batchLimits_1.FIRESTORE_BATCH_WRITE_LIMIT} عملية).`);
        }
        if (resolved.sourceNeedsWrite) {
            target.setDoc('quarterly_financial_records', resolved.identity.docId, { ...resolved.finalRecord, ...stamp }, false);
            writeOps += 1;
        }
        if (resolved.projectionNeedsWrite) {
            target.setDoc('financials', resolved.projection.id, { ...resolved.projection, ...stamp }, false);
            writeOps += 1;
        }
    }
    if (params.importBatchLog) {
        target.setDoc('import_batches', params.importBatchLog.logId, {
            ...params.importBatchLog.data,
            processedCount: resolvedItems.length,
            insertedCount,
            updatedCount,
            skippedUnchangedCount,
        }, true);
        writeOps += 1;
    }
    return {
        count: resolvedItems.length,
        insertedCount,
        updatedCount,
        skippedUnchangedCount,
        writeOps,
        resolvedItems,
    };
}
/**
 * Executes `bulk_quarterly` atomically inside a Firestore transaction (`db.runTransaction`).
 * - Reads all target `quarterly_financial_records` and `financials` docs inside the transaction.
 * - Merges, validates, projects, and hashes against the transaction's fresh snapshot.
 * - On concurrent modification (e.g., simultaneous `quarterly_record` edit), Firestore aborts and
 *   automatically retries the transaction callback from fresh reads so no concurrent update is lost.
 * - Preserves the supported batch size (`IMPORT_SAFE_CHUNK_SIZES.quarterly` = 180 -> <= 361 writes)
 *   within one atomic transaction without silently splitting into partial operations.
 */
async function executeBulkQuarterlyTransaction(port, params) {
    const maxBatch = params.maxBatch ?? (0, batchLimits_1.getMaxRecordLimitForOperation)(true);
    // Upfront structural envelope check before opening transaction
    validateBulkQuarterlyRequestEnvelope(params.rawRecords, maxBatch);
    return port.runTransaction((txTarget) => applyBulkQuarterlyWrites(txTarget, {
        rawRecords: params.rawRecords,
        maxBatch,
        stamp: params.stamp,
        importBatchLog: params.importBatchLog,
    }));
}
class DividendGovernanceConflictError extends Error {
    code = 'failed-precondition';
    constructor(message) {
        super(message);
        this.name = 'DividendGovernanceConflictError';
    }
}
exports.DividendGovernanceConflictError = DividendGovernanceConflictError;
async function applyDividendRecordsAtomicTx(tx, params) {
    const { records, sourceRows, stamp, operationType, importBatchLog } = params;
    const docIds = records.map((r) => buildDividendDocId(r));
    const activeYearPairMap = new Map();
    for (const rec of records) {
        if (isActiveDividendRecordForConflict(rec)) {
            const pairId = buildDividendYearStatusDocId(rec.ticker, rec.fiscalYear);
            activeYearPairMap.set(pairId, { ticker: rec.ticker, fiscalYear: rec.fiscalYear });
        }
    }
    // Phase 1: All Firestore transaction reads MUST precede any writes
    const existingDocs = await Promise.all(docIds.map((docId) => tx.getDoc('dividend_records', docId)));
    const yearPairEntries = Array.from(activeYearPairMap.entries());
    const existingStatusDocs = await Promise.all(yearPairEntries.map(([pairId]) => tx.getDoc('dividend_year_statuses', pairId)));
    // Read lock docs to guarantee serializable lock contention against concurrent save_dividend_year_status
    await Promise.all(yearPairEntries.map(([pairId]) => tx.getDoc(exports.DIVIDEND_YEAR_LOCKS_COLLECTION, pairId)));
    const statusMap = new Map();
    yearPairEntries.forEach(([pairId], idx) => {
        statusMap.set(pairId, existingStatusDocs[idx]);
    });
    for (const rec of records) {
        if (!isActiveDividendRecordForConflict(rec))
            continue;
        const statusDocId = buildDividendYearStatusDocId(rec.ticker, rec.fiscalYear);
        const statusDoc = statusMap.get(statusDocId);
        if (statusDoc && statusDoc.isDeleted !== true && statusDoc.status === 'confirmed_no_dividend') {
            throw new DividendGovernanceConflictError(`تعارض حوكمة: السهم ${rec.ticker} لعام ${rec.fiscalYear} مسجل بحالة "عدم توزيع مؤكد" (confirmed_no_dividend)؛ يجب تعديل حالة اكتمال توزيعات السنة أولاً قبل اعتماد توزيع نقدي.`);
        }
    }
    // Pre-compute changes and enforce Firestore transaction write limit (<= 500 writes)
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedUnchangedCount = 0;
    const pendingWrites = [];
    for (let idx = 0; idx < records.length; idx++) {
        const rec = records[idx];
        const docId = docIds[idx];
        const sourceRow = sourceRows?.[idx] ?? idx + 1;
        const contentHash = (0, hashing_1.computeRecordBusinessHash)('dividend', rec);
        const existing = existingDocs[idx];
        const existingHash = !existing || existing.isDeleted === true
            ? null
            : typeof existing.contentHash === 'string' && existing.contentHash.startsWith('mzh1_')
                ? existing.contentHash
                : (0, hashing_1.computeRecordBusinessHash)('dividend', existing);
        if (existing && existingHash === contentHash) {
            skippedUnchangedCount += 1;
            continue;
        }
        if (!existing || existing.isDeleted === true)
            insertedCount += 1;
        else
            updatedCount += 1;
        pendingWrites.push({
            docId,
            payload: { ...rec, ...stamp, sourceRow, contentHash },
        });
    }
    const totalTxWrites = pendingWrites.length +
        (pendingWrites.length > 0 ? yearPairEntries.length : 0) +
        (importBatchLog ? 1 : 0);
    if (totalTxWrites > batchLimits_1.FIRESTORE_BATCH_WRITE_LIMIT) {
        throw new Error(`تجاوزت المعاملة الذرية حد عمليات Firestore (${totalTxWrites} > ${batchLimits_1.FIRESTORE_BATCH_WRITE_LIMIT})؛ يرجى تقسيم الدفعة.`);
    }
    // Phase 2: All writes after all reads
    for (const item of pendingWrites) {
        tx.setDoc('dividend_records', item.docId, item.payload, true);
    }
    if (pendingWrites.length > 0) {
        for (const [pairId, info] of yearPairEntries) {
            tx.setDoc(exports.DIVIDEND_YEAR_LOCKS_COLLECTION, pairId, {
                ticker: info.ticker,
                fiscalYear: info.fiscalYear,
                lastOperation: operationType,
                updatedBy: stamp.updatedBy ?? null,
                updatedAt: stamp.updatedAt ?? new Date().toISOString(),
                serverUpdatedAt: stamp.serverUpdatedAt ?? null,
            }, true);
        }
    }
    if (importBatchLog) {
        tx.setDoc('import_batches', importBatchLog.logId, importBatchLog.data, true);
    }
    return {
        count: records.length,
        insertedCount,
        updatedCount,
        skippedUnchangedCount,
    };
}
async function applyDividendYearStatusAtomicTx(tx, params) {
    const { validated, stamp, importBatchLog } = params;
    const docId = buildDividendYearStatusDocId(validated.ticker, validated.fiscalYear);
    // Phase 1: All Firestore transaction reads MUST precede any writes
    const existingData = await tx.getDoc('dividend_year_statuses', docId);
    await tx.getDoc(exports.DIVIDEND_YEAR_LOCKS_COLLECTION, docId);
    if (validated.status === 'confirmed_no_dividend') {
        const yearDividends = await tx.getActiveDividendsForYear(validated.ticker, validated.fiscalYear);
        if (yearDividends.some((d) => isActiveDividendRecordForConflict(d))) {
            throw new DividendGovernanceConflictError(`لا يمكن تعيين حالة "confirmed_no_dividend" للسهم ${validated.ticker} لعام ${validated.fiscalYear} لوجود توزيعات معتمدة أو مدفوعة مسجلة لنفس السنة.`);
        }
    }
    const contentHash = (0, hashing_1.computeRecordBusinessHash)('dividend_year_status', validated);
    const existingHash = !existingData || existingData.isDeleted === true
        ? null
        : typeof existingData.contentHash === 'string' && existingData.contentHash.startsWith('mzh1_')
            ? existingData.contentHash
            : (0, hashing_1.computeRecordBusinessHash)('dividend_year_status', existingData);
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedUnchangedCount = 0;
    if (existingData && existingHash === contentHash) {
        skippedUnchangedCount = 1;
    }
    else {
        if (!existingData || existingData.isDeleted === true)
            insertedCount = 1;
        else
            updatedCount = 1;
        // Phase 2: Atomic writes for status + coordination lock
        tx.setDoc('dividend_year_statuses', docId, { ...validated, ...stamp, contentHash }, true);
        tx.setDoc(exports.DIVIDEND_YEAR_LOCKS_COLLECTION, docId, {
            ticker: validated.ticker,
            fiscalYear: validated.fiscalYear,
            status: validated.status,
            lastOperation: 'save_dividend_year_status',
            updatedBy: stamp.updatedBy ?? null,
            updatedAt: stamp.updatedAt ?? new Date().toISOString(),
            serverUpdatedAt: stamp.serverUpdatedAt ?? null,
        }, true);
    }
    if (importBatchLog) {
        tx.setDoc('import_batches', importBatchLog.logId, importBatchLog.data, true);
    }
    return { count: 1, insertedCount, updatedCount, skippedUnchangedCount };
}
function validateSectorPEPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('بيانات مضاعفات القطاعات غير صالحة.');
    }
    const entries = Object.entries(raw);
    if (entries.length === 0 || entries.length > 200) {
        throw new Error('أرسل من 1 إلى 200 قطاعاً لتحديث مضاعفاته.');
    }
    const result = {};
    for (const [sectorKey, val] of entries) {
        const cleanKey = sectorKey.trim();
        if (!cleanKey || cleanKey.includes('/') || cleanKey.length > 120) {
            throw new Error(`اسم القطاع (${sectorKey}) غير صالح.`);
        }
        if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > 500) {
            throw new Error(`مضاعف القطاع (${cleanKey}) يجب أن يكون رقماً موجباً منتهياً.`);
        }
        result[cleanKey] = val;
    }
    return result;
}
function parseOptionalMutationId(raw) {
    if (raw === undefined || raw === null || raw === '')
        return null;
    if (typeof raw !== 'string') {
        throw new Error('معرّف العملية (mutationId) غير صالح.');
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes('/') || trimmed.length > 120) {
        throw new Error('معرّف العملية (mutationId) غير صالح.');
    }
    return trimmed;
}
function parseOptionalResumeCompanyId(raw) {
    if (raw === undefined || raw === null || raw === '')
        return null;
    if (typeof raw !== 'string') {
        throw new Error('مؤشر استئناف الدفعة (resumeAfterCompanyId) غير صالح.');
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes('/') || trimmed.length > 120) {
        throw new Error('مؤشر استئناف الدفعة (resumeAfterCompanyId) غير صالح.');
    }
    return trimmed;
}
function parseOptionalSectorBatchLimit(raw) {
    if (raw === undefined || raw === null || raw === '')
        return undefined;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 450) {
        throw new Error('حد الدفعة لعملية القطاعات (batchLimit) يجب أن يكون عدداً صحيحاً بين 1 و 450.');
    }
    return raw;
}
function validateSectorDefinitionPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('بيانات تعريف القطاع في sectorPE غير صالحة.');
    }
    const obj = raw;
    const nameAr = (0, sectorRegistry_1.cleanMetadataText)(obj.nameAr);
    if (!nameAr || nameAr.includes('/') || nameAr.length > 120) {
        throw new Error('الاسم الرسمي للقطاع (nameAr) مطلوب ويجب أن يكون نصاً صالحاً.');
    }
    const requestedId = (0, sectorRegistry_1.sanitizeSectorId)(obj.sectorId);
    const sectorId = requestedId ?? (0, sectorRegistry_1.sanitizeSectorId)((0, sectorRegistry_1.suggestSectorId)(nameAr));
    if (!sectorId) {
        throw new Error('معرّف القطاع (sectorId) غير صالح.');
    }
    const classRaw = String(obj.classification ?? 'unknown').trim().toLowerCase();
    if (classRaw !== 'financial' && classRaw !== 'non_financial' && classRaw !== 'unknown') {
        throw new Error('تصنيف نشاط القطاع غير صالح (المسموح: financial | non_financial | unknown).');
    }
    const classification = classRaw;
    let multiple = null;
    if (obj.multiple !== undefined && obj.multiple !== null && obj.multiple !== '') {
        if (typeof obj.multiple !== 'number' || !Number.isFinite(obj.multiple) || obj.multiple <= 0 || obj.multiple > 500) {
            throw new Error('مضاعف القطاع (multiple) يجب أن يكون رقماً موجباً منتهياً (0 < x <= 500) أو فارغاً (null).');
        }
        multiple = Object.is(obj.multiple, -0) ? 0 : obj.multiple;
    }
    const multipleSource = (0, normalization_1.parseCleanText)(obj.multipleSource)?.slice(0, 240) ?? null;
    const multipleAsOfDateRaw = (0, normalization_1.parseCleanText)(obj.multipleAsOfDate);
    if (multipleAsOfDateRaw && !(0, normalization_1.isValidCalendarDate)(multipleAsOfDateRaw)) {
        throw new Error('تاريخ سريان مضاعف القطاع (multipleAsOfDate) غير صالح (المطلوب YYYY-MM-DD).');
    }
    const statusRaw = String(obj.status ?? 'active').trim().toLowerCase();
    if (statusRaw !== 'active' && statusRaw !== 'disabled') {
        throw new Error('حالة القطاع يجب أن تكون active أو disabled.');
    }
    const status = statusRaw;
    const rawAliases = Array.isArray(obj.aliases) ? obj.aliases : [];
    if (rawAliases.length > 50) {
        throw new Error('الحد الأقصى للأسماء المرادفة للقطاع الواحد هو 50 اسماً.');
    }
    const seenTokens = new Set([
        (0, sectorRegistry_1.normalizeSectorToken)(nameAr),
        (0, sectorRegistry_1.normalizeSectorToken)(sectorId),
    ]);
    const aliases = [];
    for (const item of rawAliases) {
        if (typeof item !== 'string')
            continue;
        const cleaned = (0, sectorRegistry_1.cleanMetadataText)(item);
        if (!cleaned || cleaned.length > 120)
            continue;
        const norm = (0, sectorRegistry_1.normalizeSectorToken)(cleaned);
        if (!norm || seenTokens.has(norm))
            continue;
        seenTokens.add(norm);
        aliases.push(cleaned);
    }
    const notes = (0, normalization_1.parseCleanText)(obj.notes)?.slice(0, 500) ?? null;
    const propagateToCompanies = obj.propagateToCompanies !== false;
    const mutationId = parseOptionalMutationId(obj.mutationId);
    const resumeAfterCompanyId = parseOptionalResumeCompanyId(obj.resumeAfterCompanyId);
    const batchLimit = parseOptionalSectorBatchLimit(obj.batchLimit);
    return {
        sectorId,
        nameAr,
        aliases,
        classification,
        multiple,
        multipleSource,
        multipleAsOfDate: multipleAsOfDateRaw ?? null,
        status,
        notes,
        propagateToCompanies,
        ...(mutationId ? { mutationId } : {}),
        ...(resumeAfterCompanyId ? { resumeAfterCompanyId } : {}),
        ...(batchLimit !== undefined ? { batchLimit } : {}),
    };
}
function validateSectorStatusTogglePayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('بيانات تغيير حالة القطاع غير صالحة.');
    }
    const obj = raw;
    const sectorId = (0, sectorRegistry_1.sanitizeSectorId)(obj.sectorId);
    if (!sectorId) {
        throw new Error('معرّف القطاع (sectorId) مطلوب.');
    }
    const statusRaw = String(obj.status ?? '').trim().toLowerCase();
    if (statusRaw !== 'active' && statusRaw !== 'disabled') {
        throw new Error('الحالة المطلوبة للقطاع يجب أن تكون active أو disabled.');
    }
    const reassignToSectorId = obj.reassignToSectorId !== undefined && obj.reassignToSectorId !== null && obj.reassignToSectorId !== ''
        ? (0, sectorRegistry_1.sanitizeSectorId)(obj.reassignToSectorId)
        : null;
    if (obj.reassignToSectorId && !reassignToSectorId) {
        throw new Error('معرّف القطاع البديل (reassignToSectorId) غير صالح.');
    }
    if (reassignToSectorId && reassignToSectorId === sectorId) {
        throw new Error('لا يمكن إعادة إسناد الشركات إلى نفس القطاع الجاري تعطيله.');
    }
    const mutationId = parseOptionalMutationId(obj.mutationId);
    const resumeAfterCompanyId = parseOptionalResumeCompanyId(obj.resumeAfterCompanyId);
    const batchLimit = parseOptionalSectorBatchLimit(obj.batchLimit);
    return {
        sectorId,
        status: statusRaw,
        ...(reassignToSectorId ? { reassignToSectorId } : {}),
        ...(mutationId ? { mutationId } : {}),
        ...(resumeAfterCompanyId ? { resumeAfterCompanyId } : {}),
        ...(batchLimit !== undefined ? { batchLimit } : {}),
    };
}
function validateSectorDeletePayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('بيانات حذف القطاع غير صالحة.');
    }
    const obj = raw;
    const sectorId = (0, sectorRegistry_1.sanitizeSectorId)(obj.sectorId);
    if (!sectorId) {
        throw new Error('معرّف القطاع (sectorId) مطلوب للحذف.');
    }
    const reassignToSectorId = obj.reassignToSectorId !== undefined && obj.reassignToSectorId !== null && obj.reassignToSectorId !== ''
        ? (0, sectorRegistry_1.sanitizeSectorId)(obj.reassignToSectorId)
        : null;
    if (obj.reassignToSectorId && !reassignToSectorId) {
        throw new Error('معرّف القطاع البديل (reassignToSectorId) غير صالح.');
    }
    if (reassignToSectorId && reassignToSectorId === sectorId) {
        throw new Error('لا يمكن نقل الشركات إلى نفس القطاع الجاري حذفه.');
    }
    const mutationId = parseOptionalMutationId(obj.mutationId);
    const resumeAfterCompanyId = parseOptionalResumeCompanyId(obj.resumeAfterCompanyId);
    const batchLimit = parseOptionalSectorBatchLimit(obj.batchLimit);
    return {
        sectorId,
        ...(reassignToSectorId ? { reassignToSectorId } : {}),
        ...(mutationId ? { mutationId } : {}),
        ...(resumeAfterCompanyId ? { resumeAfterCompanyId } : {}),
        ...(batchLimit !== undefined ? { batchLimit } : {}),
    };
}
function validateStoryPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('بيانات القصة الاستثمارية غير صالحة.');
    }
    const rec = raw;
    const tk = (0, normalization_1.normalizedTicker)(rec.ticker ?? rec.companyId);
    const companyId = (typeof rec.companyId === 'string' && rec.companyId.trim()) ? rec.companyId.trim().toLowerCase() : tk.toLowerCase();
    if (companyId.includes('/')) {
        throw new Error('معرف الشركة للقصة الاستثمارية غير صالح.');
    }
    const cleanStr = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
    const cleanArr = (v) => Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [];
    const moatRaw = rec.economicMoat && typeof rec.economicMoat === 'object' ? rec.economicMoat : {};
    const allowedRatings = ['واسع (Wide)', 'متوسط (Narrow)', 'منعدم (None)'];
    const rating = allowedRatings.includes(moatRaw.rating) ? moatRaw.rating : 'متوسط (Narrow)';
    return {
        companyId,
        ticker: tk,
        businessOverview: cleanStr(rec.businessOverview),
        economicMoat: {
            rating,
            description: cleanStr(moatRaw.description),
            advantages: cleanArr(moatRaw.advantages),
        },
        investmentThesis: cleanStr(rec.investmentThesis),
        catalysts: cleanArr(rec.catalysts),
        risks: cleanArr(rec.risks),
        ...(typeof rec.managementScore === 'string' ? { managementScore: rec.managementScore.trim() } : {}),
        analystVerdict: cleanStr(rec.analystVerdict),
    };
}
function validateDecisionPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('بيانات قرار الاستثمار غير صالحة.');
    }
    const rec = raw;
    const tk = (0, normalization_1.normalizedTicker)(rec.ticker ?? rec.companyId);
    const companyId = (typeof rec.companyId === 'string' && rec.companyId.trim()) ? rec.companyId.trim().toLowerCase() : tk.toLowerCase();
    if (companyId.includes('/')) {
        throw new Error('معرف الشركة للقرار الاستثماري غير صالح.');
    }
    const ensureFiniteNonNeg = (val, label) => {
        if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
            throw new Error(`الحقل ${label} يجب أن يكون رقماً غير سالب.`);
        }
        return val;
    };
    return {
        companyId,
        ticker: tk,
        fundamentalVerdict: typeof rec.fundamentalVerdict === 'string' ? rec.fundamentalVerdict : 'قريب من القيمة العادلة',
        valuationReasonAr: typeof rec.valuationReasonAr === 'string' ? rec.valuationReasonAr.trim() : '',
        timingVerdict: typeof rec.timingVerdict === 'string' ? rec.timingVerdict : 'حيادي / انتظار محفز',
        timingReasonAr: typeof rec.timingReasonAr === 'string' ? rec.timingReasonAr.trim() : '',
        finalDecision: typeof rec.finalDecision === 'string' ? rec.finalDecision : 'مراقبة لصيقة',
        targetEntryRange: typeof rec.targetEntryRange === 'string' ? rec.targetEntryRange.trim() : '',
        stopLossPrice: ensureFiniteNonNeg(rec.stopLossPrice ?? 0, 'stopLossPrice'),
        targetExitPrice: ensureFiniteNonNeg(rec.targetExitPrice ?? 0, 'targetExitPrice'),
        riskRewardRatio: ensureFiniteNonNeg(rec.riskRewardRatio ?? 0, 'riskRewardRatio'),
        notes: typeof rec.notes === 'string' ? rec.notes.trim() : '',
    };
}
function validateTradePayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('بيانات سجل الصفقة غير صالحة.');
    }
    const rec = raw;
    const tk = (0, normalization_1.normalizedTicker)(rec.ticker ?? rec.companyId);
    const companyId = (typeof rec.companyId === 'string' && rec.companyId.trim()) ? rec.companyId.trim().toLowerCase() : tk.toLowerCase();
    const id = typeof rec.id === 'string' && rec.id.trim() && !rec.id.includes('/') ? rec.id.trim() : `trade_${Date.now()}`;
    const numCheck = (v, label, allowNull = false) => {
        if (v === undefined || v === null) {
            if (allowNull)
                return undefined;
            throw new Error(`الحقل ${label} مطلوب كرقم.`);
        }
        if (typeof v !== 'number' || !Number.isFinite(v)) {
            throw new Error(`الحقل ${label} يجب أن يكون رقماً منتهياً.`);
        }
        return v;
    };
    const plannedEntryPrice = numCheck(rec.plannedEntryPrice, 'plannedEntryPrice');
    const targetFairValue = numCheck(rec.targetFairValue, 'targetFairValue');
    const stopLoss = numCheck(rec.stopLoss, 'stopLoss');
    const portfolioWeightPct = numCheck(rec.portfolioWeightPct, 'portfolioWeightPct');
    const executedPrice = numCheck(rec.executedPrice, 'executedPrice', true);
    const returnPct = numCheck(rec.returnPct, 'returnPct', true);
    return {
        id,
        companyId,
        ticker: tk,
        companyName: typeof rec.companyName === 'string' ? rec.companyName.trim() : tk,
        action: ['شراء', 'بيع', 'تجميع', 'وقف خسارة'].includes(rec.action) ? rec.action : 'شراء',
        plannedEntryPrice,
        ...(executedPrice !== undefined ? { executedPrice } : {}),
        targetFairValue,
        stopLoss,
        portfolioWeightPct,
        status: ['مخطط', 'قيد التنفيذ', 'مفعل', 'مغلق'].includes(rec.status) ? rec.status : 'مخطط',
        entryDate: typeof rec.entryDate === 'string' ? rec.entryDate.trim() : '',
        ...(typeof rec.exitDate === 'string' && rec.exitDate.trim() ? { exitDate: rec.exitDate.trim() } : {}),
        ...(returnPct !== undefined ? { returnPct } : {}),
        notes: typeof rec.notes === 'string' ? rec.notes.trim() : '',
    };
}
//# sourceMappingURL=records.js.map