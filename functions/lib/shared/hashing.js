"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VOLATILE_PROVENANCE_KEYS = void 0;
exports.stableStringify = stableStringify;
exports.computeCanonicalHash = computeCanonicalHash;
exports.stripVolatileMetadata = stripVolatileMetadata;
exports.canonicalizeQuarterlyExtendedFields = canonicalizeQuarterlyExtendedFields;
exports.canonicalizeFinancialProjection = canonicalizeFinancialProjection;
exports.computeFinancialProjectionHash = computeFinancialProjectionHash;
exports.computeRecordBusinessHash = computeRecordBusinessHash;
const normalization_1 = require("./normalization");
const parameterRegistry_1 = require("./parameterRegistry");
const parameterTypeContract_1 = require("./parameterTypeContract");
exports.VOLATILE_PROVENANCE_KEYS = new Set([
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
    'originalValues',
    'manualCorrections',
]);
function normalizeCanonicalValue(value) {
    if (value === undefined)
        return undefined;
    if (value === null)
        return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            return null;
        return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => {
            const normalized = normalizeCanonicalValue(item);
            return normalized === undefined ? null : normalized;
        });
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        const sorted = {};
        for (const [k, v] of entries) {
            const normalized = normalizeCanonicalValue(v);
            if (normalized !== undefined) {
                sorted[k] = normalized;
            }
        }
        return sorted;
    }
    return String(value);
}
function stableStringify(value) {
    return JSON.stringify(normalizeCanonicalValue(value));
}
function fnv1a64Pass(str, seedHigh, seedLow) {
    let h1 = seedHigh >>> 0;
    let h2 = seedLow >>> 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 ^= c & 0xff;
        h1 = Math.imul(h1, 0x01000193) >>> 0;
        h2 ^= (c >>> 8) ^ (c & 0xff);
        h2 = Math.imul(h2, 0x01000193) >>> 0;
        // Cross-mix both halves for stronger avalanche across short financial payloads
        h1 = (h1 ^ ((h2 >>> 13) | (h2 << 19))) >>> 0;
        h2 = (h2 ^ ((h1 >>> 11) | (h1 << 21))) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
/**
 * تجزئة حتمية متطابقة بين المتصفح و Node و Cloud Functions بدون الاعتماد على WebCrypto/node:crypto.
 */
function computeCanonicalHash(payload) {
    const serialized = stableStringify(payload);
    const partA = fnv1a64Pass(serialized, 0x811c9dc5, 0x9e3779b9);
    const partB = fnv1a64Pass(`v1:${serialized}`, 0xc2b2ae35, 0x27d4eb2f);
    return `mzh1_${partA}${partB}`;
}
function stripVolatileMetadata(record) {
    const out = {};
    for (const [key, val] of Object.entries(record)) {
        if (exports.VOLATILE_PROVENANCE_KEYS.has(key) || val === undefined)
            continue;
        out[key] = val;
    }
    return out;
}
const LEGACY_DPS_HASH_KEYS = new Set(['dpsCurrent', 'DPS_Current', 'dps_current']);
function canonicalizeQuarterlyExtendedFields(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        if (LEGACY_DPS_HASH_KEYS.has(k) || v === undefined)
            continue;
        out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
}
/**
 * Central canonical business representation of a `financials` projection document.
 * Excludes all server provenance / operational stamps (`updatedAt`, `serverUpdatedAt`,
 * `updatedBy`, `importId`, `sourceFile`, `sourceSheet`, `sourceRow`, `schemaVersion`,
 * `contentHash`, `isDeleted`, `deletedAt`, `deletedBy`) so projection integrity checks
 * compare actual financial business fields rather than trusting stored `contentHash` alone.
 */
function canonicalizeFinancialProjection(doc) {
    const cleaned = stripVolatileMetadata(doc);
    return {
        id: cleaned.id ?? null,
        companyId: cleaned.companyId ?? null,
        year: cleaned.year ?? null,
        quarter: cleaned.quarter ?? null,
        periodDate: cleaned.periodDate ?? null,
        periodStartDate: cleaned.periodStartDate ?? null,
        periodEndDate: cleaned.periodEndDate ?? null,
        periodDays: cleaned.periodDays ?? null,
        revenueYTD: cleaned.revenueYTD ?? null,
        grossProfitYTD: cleaned.grossProfitYTD ?? null,
        operatingProfitYTD: cleaned.operatingProfitYTD ?? null,
        netProfitYTD: cleaned.netProfitYTD ?? null,
        operatingCashFlowYTD: cleaned.operatingCashFlowYTD ?? null,
        capexYTD: cleaned.capexYTD ?? null,
        dividendsPaidYTD: cleaned.dividendsPaidYTD ?? null,
        totalAssets: cleaned.totalAssets ?? null,
        totalDebt: cleaned.totalDebt ?? null,
        cashAndEquivalents: cleaned.cashAndEquivalents ?? null,
        totalEquity: cleaned.totalEquity ?? null,
        sharesCount: cleaned.sharesCount ?? null,
        isAudited: cleaned.isAudited === true,
        depreciationAmortizationYTD: cleaned.depreciationAmortizationYTD ?? null,
        changeOperatingNwcYTD: cleaned.changeOperatingNwcYTD ?? null,
        valuationTaxRate: cleaned.valuationTaxRate ?? null,
        valuationSource: cleaned.valuationSource ?? null,
        financialUnit: cleaned.financialUnit ?? null,
        financialCurrency: cleaned.financialCurrency ?? null,
        netIncomeCommonYTD: cleaned.netIncomeCommonYTD ?? null,
        netIncomeCommonBasis: cleaned.netIncomeCommonBasis ?? null,
        netIncomeCommonNote: cleaned.netIncomeCommonNote ?? null,
        commonEquity: cleaned.commonEquity ?? null,
        commonEquityBasis: cleaned.commonEquityBasis ?? null,
        commonEquityNote: cleaned.commonEquityNote ?? null,
        weightedAvgSharesYTD: cleaned.weightedAvgSharesYTD ?? null,
        weightedAvgSharesBasis: cleaned.weightedAvgSharesBasis ?? null,
        reportedEps: cleaned.reportedEps ?? null,
        reportedEpsSource: cleaned.reportedEpsSource ?? null,
        reportedEpsPeriodType: cleaned.reportedEpsPeriodType ?? null,
        reportedEpsFiscalYear: cleaned.reportedEpsFiscalYear ?? null,
        reportedEpsFiscalQuarter: cleaned.reportedEpsFiscalQuarter ?? null,
        reportedEpsPeriodStart: cleaned.reportedEpsPeriodStart ?? null,
        reportedEpsPeriodEnd: cleaned.reportedEpsPeriodEnd ?? null,
        reportedEpsPeriod: cleaned.reportedEpsPeriod ?? null,
        isCapitalActionAdjusted: cleaned.isCapitalActionAdjusted ?? null,
    };
}
function computeFinancialProjectionHash(doc) {
    return computeCanonicalHash({
        sourceType: 'financial_projection',
        ...canonicalizeFinancialProjection(doc),
    });
}
function computeRecordBusinessHash(sourceType, record) {
    const cleaned = stripVolatileMetadata(record);
    if (sourceType === 'quarterly') {
        const canonical = {
            ticker: cleaned.ticker ?? null,
            stockName: cleaned.stockName ?? null,
            yearQuarter: cleaned.yearQuarter ?? null,
            year: cleaned.year ?? null,
            quarter: cleaned.quarter ?? null,
            shares: cleaned.shares ?? null,
            intangibleAssets: cleaned.intangibleAssets ?? null,
            totalAssets: cleaned.totalAssets ?? null,
            equity: cleaned.equity ?? null,
            totalDebtWithoutTX: cleaned.totalDebtWithoutTX ?? null,
            totalLiabilities: cleaned.totalLiabilities ?? null,
            revenueYTD: cleaned.revenueYTD ?? null,
            grossProfitYTD: cleaned.grossProfitYTD ?? null,
            ebitYTD: cleaned.ebitYTD ?? null,
            pbtYTD: cleaned.pbtYTD ?? null,
            netIncomeYTD: cleaned.netIncomeYTD ?? null,
            ocfYTD: cleaned.ocfYTD ?? null,
            netInvestingCfYTD: cleaned.netInvestingCfYTD ?? null,
            dividendsPaidYTD: cleaned.dividendsPaidYTD ?? null,
            cash: cleaned.cash ?? null,
            interestExpenseYTD: cleaned.interestExpenseYTD ?? null,
            financeCostsYTD: cleaned.financeCostsYTD ?? null,
            interestIncomeYTD: cleaned.interestIncomeYTD ?? null,
            taxExpenseYTD: cleaned.taxExpenseYTD ?? null,
            interestPaidYTD: cleaned.interestPaidYTD ?? null,
            capexYTD: cleaned.capexYTD ?? null,
            dateInsertData: cleaned.dateInsertData ?? null,
            depreciationAmortizationYTD: cleaned.depreciationAmortizationYTD ?? null,
            changeOperatingNwcYTD: cleaned.changeOperatingNwcYTD ?? null,
            valuationTaxRate: cleaned.valuationTaxRate ?? null,
            valuationSource: cleaned.valuationSource ?? null,
            financialUnit: cleaned.financialUnit ?? null,
            financialCurrency: cleaned.financialCurrency ?? null,
            netIncomeCommonYTD: cleaned.netIncomeCommonYTD ?? null,
            ...(cleaned.netIncomeCommonBasis ? { netIncomeCommonBasis: cleaned.netIncomeCommonBasis } : {}),
            ...(cleaned.netIncomeCommonNote ? { netIncomeCommonNote: cleaned.netIncomeCommonNote } : {}),
            ...(cleaned.equityCommon !== undefined && cleaned.equityCommon !== null
                ? { equityCommon: cleaned.equityCommon }
                : {}),
            ...(cleaned.equityCommonBasis ? { equityCommonBasis: cleaned.equityCommonBasis } : {}),
            ...(cleaned.equityCommonNote ? { equityCommonNote: cleaned.equityCommonNote } : {}),
            weightedAvgSharesYTD: cleaned.weightedAvgSharesYTD ?? null,
            ...(cleaned.periodStartDate ? { periodStartDate: cleaned.periodStartDate } : {}),
            ...(cleaned.periodEndDate ? { periodEndDate: cleaned.periodEndDate } : {}),
            ...(cleaned.periodDays !== undefined && cleaned.periodDays !== null
                ? { periodDays: cleaned.periodDays }
                : {}),
            ...(cleaned.weightedAvgSharesBasis
                ? { weightedAvgSharesBasis: cleaned.weightedAvgSharesBasis }
                : {}),
            reportedEps: cleaned.reportedEps ?? null,
            reportedEpsSource: cleaned.reportedEpsSource ?? null,
            ...(cleaned.reportedEpsPeriodType
                ? { reportedEpsPeriodType: cleaned.reportedEpsPeriodType }
                : {}),
            ...(cleaned.reportedEpsFiscalYear !== undefined && cleaned.reportedEpsFiscalYear !== null
                ? { reportedEpsFiscalYear: cleaned.reportedEpsFiscalYear }
                : {}),
            ...(cleaned.reportedEpsFiscalQuarter
                ? { reportedEpsFiscalQuarter: cleaned.reportedEpsFiscalQuarter }
                : {}),
            ...(cleaned.reportedEpsPeriodStart
                ? { reportedEpsPeriodStart: cleaned.reportedEpsPeriodStart }
                : {}),
            ...(cleaned.reportedEpsPeriodEnd
                ? { reportedEpsPeriodEnd: cleaned.reportedEpsPeriodEnd }
                : {}),
            reportedEpsPeriod: cleaned.reportedEpsPeriod ?? null,
            isCapitalActionAdjusted: cleaned.isCapitalActionAdjusted ?? null,
            extendedFields: canonicalizeQuarterlyExtendedFields(cleaned.extendedFields),
        };
        return computeCanonicalHash({ sourceType, ...canonical });
    }
    if (sourceType === 'daily') {
        return computeCanonicalHash({ sourceType, ...cleaned });
    }
    if (sourceType === 'beta') {
        return computeCanonicalHash({
            sourceType,
            ticker: cleaned.ticker ?? null,
            beta: cleaned.beta ?? null,
            asOfDate: cleaned.asOfDate ?? null,
            source: cleaned.source ?? null,
        });
    }
    if (sourceType === 'dividend') {
        return computeCanonicalHash({
            sourceType,
            ticker: cleaned.ticker ?? null,
            fiscalYear: cleaned.fiscalYear ?? null,
            cashDps: cleaned.cashDps ?? null,
            asOfDate: cleaned.asOfDate ?? null,
            distributionId: cleaned.distributionId ?? null,
            recordType: cleaned.recordType ?? 'regular',
            approvalStatus: cleaned.approvalStatus ?? 'approved',
            distributionSemantics: cleaned.distributionSemantics ?? 'standalone_event',
            exDividendDate: cleaned.exDividendDate ?? null,
            paymentDate: cleaned.paymentDate ?? null,
            recordDate: cleaned.recordDate ?? null,
            totalDistributionAmount: cleaned.totalDistributionAmount ?? null,
            eligibleSharesCount: cleaned.eligibleSharesCount ?? null,
            currency: cleaned.currency ?? null,
            source: cleaned.source ?? null,
            parentAnnouncementId: cleaned.parentAnnouncementId ?? null,
            notes: cleaned.notes ?? null,
        });
    }
    if (sourceType === 'dividend_year_status') {
        return computeCanonicalHash({
            sourceType,
            ticker: cleaned.ticker ?? null,
            fiscalYear: cleaned.fiscalYear ?? null,
            status: cleaned.status ?? 'unknown',
            confirmedSource: cleaned.confirmedSource ?? null,
            confirmedAt: cleaned.confirmedAt ?? null,
            notes: cleaned.notes ?? null,
        });
    }
    if (sourceType === 'real_estate_disclosure') {
        return computeCanonicalHash({
            sourceType,
            disclosureId: cleaned.disclosureId ?? null,
            ticker: cleaned.ticker ?? null,
            fiscalYear: cleaned.fiscalYear ?? null,
            fiscalQuarter: cleaned.fiscalQuarter ?? null,
            linkedQuarterlyDocId: cleaned.linkedQuarterlyDocId ?? null,
            balanceSheetDate: cleaned.balanceSheetDate ?? null,
            statementScope: cleaned.statementScope ?? 'unspecified',
            assetCategory: cleaned.assetCategory ?? 'unspecified',
            assetUsageDescription: cleaned.assetUsageDescription ?? null,
            accountingPolicy: cleaned.accountingPolicy ?? 'unspecified',
            aggregationLevel: cleaned.aggregationLevel ?? 'unspecified',
            parentDisclosureId: cleaned.parentDisclosureId ?? null,
            carryingValue: cleaned.carryingValue ?? null,
            disclosedFairValue: cleaned.disclosedFairValue ?? null,
            fairValueDate: cleaned.fairValueDate ?? null,
            fairValueStatementScope: cleaned.fairValueStatementScope ?? null,
            fairValueAssetScopeMatchesCarrying: cleaned.fairValueAssetScopeMatchesCarrying ?? null,
            fairValueSource: cleaned.fairValueSource ?? null,
            fairValueSourceType: cleaned.fairValueSourceType ?? 'unspecified',
            footnoteReference: cleaned.footnoteReference ?? null,
            explanatoryNote: cleaned.explanatoryNote ?? null,
            completenessStatus: cleaned.completenessStatus ?? null,
        });
    }
    const keyStr = typeof cleaned.key === 'string' ? cleaned.key.trim() : null;
    const regDef = keyStr ? (0, parameterRegistry_1.getParameterDefinition)(keyStr) : null;
    const resolvedType = keyStr
        ? (0, parameterTypeContract_1.resolveCanonicalParameterType)(keyStr, {
            valueType: typeof cleaned.valueType === 'string' ? cleaned.valueType : null,
            isPercentage: typeof cleaned.isPercentage === 'boolean' ? cleaned.isPercentage : null,
            unit: typeof cleaned.unit === 'string' ? cleaned.unit : null,
        })
        : null;
    const rawNameAr = typeof cleaned.nameAr === 'string' ? cleaned.nameAr.trim() : '';
    const canonicalNameAr = regDef?.nameAr ?? (rawNameAr !== '' ? rawNameAr : keyStr);
    const rawDescription = typeof cleaned.description === 'string'
        ? cleaned.description.trim()
        : typeof cleaned.descriptionAr === 'string'
            ? cleaned.descriptionAr.trim()
            : '';
    const canonicalDescription = rawDescription !== '' ? rawDescription : (regDef?.descriptionAr ?? '');
    const canonicalAsOfDate = typeof cleaned.asOfDate === 'string' ? cleaned.asOfDate.trim() : '';
    const canonicalSource = typeof cleaned.source === 'string' ? cleaned.source.trim() : '';
    return computeCanonicalHash({
        sourceType,
        key: keyStr,
        nameAr: canonicalNameAr,
        value: cleaned.value ?? null,
        description: canonicalDescription,
        scope: cleaned.scope ?? 'global',
        ticker: cleaned.ticker ?? null,
        unit: cleaned.unit ?? null,
        valueType: resolvedType ? resolvedType.valueType : null,
        isPercentage: resolvedType ? resolvedType.isPercentage : null,
        asOfDate: canonicalAsOfDate,
        source: canonicalSource,
        rfMethodology: (0, normalization_1.normalizeRfMethodology)(cleaned.rfMethodology),
        currency: cleaned.currency ?? null,
        forecastHorizonYears: cleaned.forecastHorizonYears ?? null,
    });
}
//# sourceMappingURL=hashing.js.map