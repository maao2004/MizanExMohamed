/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive acceptance tests for the central `ReportedEPS` period contract,
 * temporal alignment engine, legacy dry-run audit, validation, business hashing,
 * and Excel export/import round-trip.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import {
  MISSING_REPORTED_EPS_PERIOD_ERROR_AR,
  QuarterlyValidationError,
  REPORTED_EPS_PERIOD_OPTIONS,
  applyBulkQuarterlyWrites,
  applyStockAndQuarterAtomicWrite,
  auditLegacyReportedEpsRecord,
  classifyLegacyReportedEpsPeriod,
  computeRecordBusinessHash,
  evaluateReportedEpsPeriodAlignment,
  financialProjection,
  formatReportedEpsPeriodDisplay,
  hasExplicitReportedEpsValue,
  parseReportedEpsPeriodTypeInput,
  resolveCanonicalReportedEpsPeriod,
  resolveImportedReportedEpsPeriod,
  resolveQuarterlyRecordWrite,
  suggestReportedEpsPeriodDates,
  validateAndNormalizeReportedEpsPeriod,
  validateRecords,
  type AtomicWriteTarget,
  type BulkQuarterlyWriteTarget,
} from '../src/core/contracts';
import {
  parseReportedEpsPeriodMeta,
  resolveMetricAuditBundle,
} from '../src/core/domain/metricContracts';
import {
  calculateTTMMetrics,
  runValuationModels,
} from '../src/utils/financialCalculations';
import {
  analyzeLegacyMigration,
  formatLegacyMigrationDryRunReport,
} from '../src/core/domain/legacyMigrationTool';
import { buildQuarterlyRecordsWorkbook } from '../src/utils/excelExport';
import { parseQuarterlyFinancialsExcelDetailed } from '../src/core/imports/parsers';
import type { Company, QuarterlyFinancial, QuarterlyFinancialRecord } from '../src/types';

function workbookToMockFile(wb: XLSX.WorkBook, name = 'QuarterlyFinancialsData.xlsx'): File {
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return {
    name,
    arrayBuffer: async () => arr,
  } as unknown as File;
}

function makeCompany(ticker: string, price = 40): Company {
  return {
    id: ticker.toLowerCase(),
    ticker,
    nameAr: `شركة ${ticker}`,
    nameEn: `${ticker} Corp`,
    sector: 'البنوك',
    currentPrice: price,
    currency: 'EGP',
    sharesOutstanding: 100_000_000,
    marketCap: price * 100_000_000,
  };
}

function makeQuarterlyRecord(
  overrides: Partial<QuarterlyFinancialRecord> & {
    ticker: string;
    year: number;
    quarter: 'Q1' | 'Q2' | 'Q3' | 'FY';
  }
): QuarterlyFinancialRecord {
  const { ticker, year, quarter, ...rest } = overrides;
  return {
    ticker,
    stockName: `${ticker} Corp`,
    year,
    quarter,
    shares: 100_000_000,
    intangibleAssets: 0,
    totalAssets: 5_000_000_000,
    equity: 2_000_000_000,
    totalDebtWithoutTX: 500_000_000,
    totalLiabilities: 3_000_000_000,
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 400_000_000,
    ebitYTD: 300_000_000,
    pbtYTD: 260_000_000,
    netIncomeYTD: 200_000_000,
    ocfYTD: 250_000_000,
    netInvestingCfYTD: -60_000_000,
    dividendsPaidYTD: -40_000_000,
    cash: 300_000_000,
    interestExpenseYTD: 40_000_000,
    financeCostsYTD: 40_000_000,
    interestIncomeYTD: 10_000_000,
    taxExpenseYTD: 60_000_000,
    interestPaidYTD: 35_000_000,
    capexYTD: 50_000_000,
    dateInsertData: `${year}-12-31`,
    currency: 'EGP',
    netIncomeCommonYTD: 200_000_000,
    netIncomeCommonBasis: 'explicit_common',
    equityCommon: 2_000_000_000,
    equityCommonBasis: 'explicit_common',
    weightedAvgSharesYTD: 100_000_000,
    weightedAvgSharesBasis: 'ytd_weighted_avg',
    periodStartDate: `${year}-01-01`,
    periodEndDate: `${year}-12-31`,
    periodDays: 365,
    isPeriodStandard: true,
    ...rest,
  };
}

function toQuarterlyFinancial(rec: QuarterlyFinancialRecord): QuarterlyFinancial {
  return financialProjection(rec) as unknown as QuarterlyFinancial;
}

const BASE_MACROS: Record<string, number> = {
  Rf_Egypt_10Y: 0.2,
  ERP_Developed: 0.05,
  CRP_Egypt: 0.04,
  Terminal_Growth_g: 0.06,
  Tax_Rate: 0.225,
  RIM_Retention: 0.6,
  RIM_Terminal_Method: 1,
};

describe('ReportedEPS Period Central Contract & Classification', () => {
  it('fixes the proven bug: Q3 2026 standalone is NEVER YTD and Q4 2026 standalone is NEVER FY', () => {
    const q3Standalone = parseReportedEpsPeriodMeta('Q3 2026 standalone');
    assert.equal(q3Standalone.kind, 'standalone_quarter');
    assert.notEqual(q3Standalone.kind, 'ytd');
    assert.equal(q3Standalone.year, 2026);
    assert.equal(q3Standalone.quarterToken, 'Q3');

    const q4Standalone = parseReportedEpsPeriodMeta('Q4 2026 standalone');
    assert.equal(q4Standalone.kind, 'standalone_quarter');
    assert.notEqual(q4Standalone.kind, 'fy');
    assert.equal(q4Standalone.year, 2026);
    assert.equal(q4Standalone.quarterToken, 'Q4');

    const q3StandaloneLegacy = classifyLegacyReportedEpsPeriod('Q3 2026 standalone', {
      year: 2026,
      quarter: 'Q3',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-09-30',
    });
    assert.equal(q3StandaloneLegacy.detectedIntent, 'standalone_quarter');
    assert.equal(q3StandaloneLegacy.status, 'needs_review');
    assert.equal(q3StandaloneLegacy.resolved, null);

    const q4StandaloneLegacy = classifyLegacyReportedEpsPeriod('Q4 2026 standalone', {
      year: 2026,
      quarter: 'FY',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-12-31',
    });
    assert.equal(q4StandaloneLegacy.detectedIntent, 'standalone_quarter');
    assert.equal(q4StandaloneLegacy.status, 'needs_review');
    assert.equal(q4StandaloneLegacy.resolved, null);
  });

  it('classifies ambiguous legacy strings as needs_review without inventing dates or assuming Jan 1', () => {
    for (const ambiguous of ['Q3 2026', 'Q4 2026', 'Q2 2026', '2026', 'Q3 2026 standalone YTD']) {
      const res = classifyLegacyReportedEpsPeriod(ambiguous, {
        year: 2026,
        quarter: 'Q3',
        periodStartDate: '2026-01-01',
        periodEndDate: '2026-09-30',
      });
      assert.equal(res.resolved, null, `"${ambiguous}" must not auto-convert silently`);
      assert.equal(res.status, 'needs_review');
    }

    // Even explicit "9M 2026" WITHOUT documented dates must stay needs_review (never fabricates Jan 1!)
    const nineMonthsNoDates = classifyLegacyReportedEpsPeriod('9M 2026', {
      year: 2026,
      quarter: 'Q3',
      periodStartDate: null,
      periodEndDate: null,
    });
    assert.equal(nineMonthsNoDates.resolved, null);
    assert.equal(nineMonthsNoDates.status, 'needs_review');

    // Legacy "FY 2025" WITHOUT documented record dates must NOT fabricate 2025-01-01..2025-12-31!
    const fyNoDates = classifyLegacyReportedEpsPeriod('FY 2025', {
      year: 2025,
      quarter: 'FY',
      periodStartDate: null,
      periodEndDate: null,
    });
    assert.equal(fyNoDates.resolved, null);
    assert.equal(fyNoDates.status, 'needs_review');

    // Legacy "FY 2025" WITH documented non-calendar July–June dates resolves to those exact dates!
    const fyJulyJune = classifyLegacyReportedEpsPeriod('FY 2025', {
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2024-07-01',
      periodEndDate: '2025-06-30',
    });
    assert.equal(fyJulyJune.status, 'unambiguous_convertible');
    assert.equal(fyJulyJune.resolved?.periodType, 'fy');
    assert.equal(fyJulyJune.resolved?.periodStart, '2024-07-01');
    assert.equal(fyJulyJune.resolved?.periodEnd, '2025-06-30');
  });

  it('exposes exact Arabic dropdown labels and parses Arabic labels & canonical codes cleanly', () => {
    assert.deepEqual(
      REPORTED_EPS_PERIOD_OPTIONS.map((o) => ({ code: o.code, labelAr: o.labelAr })),
      [
        { code: 'standalone_quarter', labelAr: 'ربع مالي منفرد' },
        { code: 'ytd', labelAr: 'تراكمي منذ بداية السنة المالية YTD' },
        { code: 'fy', labelAr: 'سنة مالية كاملة FY' },
        { code: 'ttm', labelAr: 'آخر 12 شهراً TTM' },
        { code: 'needs_review', labelAr: 'غير محدد / يحتاج مراجعة' },
      ]
    );

    for (const opt of REPORTED_EPS_PERIOD_OPTIONS) {
      assert.equal(parseReportedEpsPeriodTypeInput(opt.labelAr), opt.code);
      assert.equal(parseReportedEpsPeriodTypeInput(opt.code), opt.code);
    }
    assert.throws(() => parseReportedEpsPeriodTypeInput('Q3 2026 random text'));
  });

  it('rejects invalid dates, start > end, missing dates, Q4 on YTD, quarter on FY/TTM, and span contradictions', () => {
    // Missing dates on operational type
    assert.throws(() =>
      validateAndNormalizeReportedEpsPeriod({
        reportedEps: 2.5,
        reportedEpsPeriodType: 'standalone_quarter',
        reportedEpsFiscalYear: 2026,
        reportedEpsFiscalQuarter: 'Q3',
        reportedEpsPeriodStart: null,
        reportedEpsPeriodEnd: null,
      })
    );

    // start > end
    assert.throws(() =>
      validateAndNormalizeReportedEpsPeriod({
        reportedEps: 2.5,
        reportedEpsPeriodType: 'standalone_quarter',
        reportedEpsFiscalYear: 2026,
        reportedEpsFiscalQuarter: 'Q3',
        reportedEpsPeriodStart: '2026-09-30',
        reportedEpsPeriodEnd: '2026-07-01',
      })
    );

    // Invalid leap-year calendar date (2025 is not a leap year)
    assert.throws(() =>
      validateAndNormalizeReportedEpsPeriod({
        reportedEps: 1.1,
        reportedEpsPeriodType: 'standalone_quarter',
        reportedEpsFiscalYear: 2025,
        reportedEpsFiscalQuarter: 'Q1',
        reportedEpsPeriodStart: '2025-01-01',
        reportedEpsPeriodEnd: '2025-02-29',
      })
    );

    // Q4 rejected on YTD (must use FY instead)
    assert.throws(() =>
      validateAndNormalizeReportedEpsPeriod({
        reportedEps: 4.0,
        reportedEpsPeriodType: 'ytd',
        reportedEpsFiscalYear: 2026,
        reportedEpsFiscalQuarter: 'Q4',
        reportedEpsPeriodStart: '2026-01-01',
        reportedEpsPeriodEnd: '2026-12-31',
      })
    );

    // Quarter rejected on FY
    assert.throws(() =>
      validateAndNormalizeReportedEpsPeriod({
        reportedEps: 4.0,
        reportedEpsPeriodType: 'fy',
        reportedEpsFiscalYear: 2026,
        reportedEpsFiscalQuarter: 'Q4',
        reportedEpsPeriodStart: '2026-01-01',
        reportedEpsPeriodEnd: '2026-12-31',
      })
    );

    // Span contradicting declared type: 92 days declared as FY
    assert.throws(() =>
      validateAndNormalizeReportedEpsPeriod({
        reportedEps: 1.0,
        reportedEpsPeriodType: 'fy',
        reportedEpsFiscalYear: 2026,
        reportedEpsPeriodStart: '2026-10-01',
        reportedEpsPeriodEnd: '2026-12-31',
      })
    );

    // Span contradicting declared type: 273 days declared as standalone_quarter
    assert.throws(() =>
      validateAndNormalizeReportedEpsPeriod({
        reportedEps: 3.0,
        reportedEpsPeriodType: 'standalone_quarter',
        reportedEpsFiscalYear: 2026,
        reportedEpsFiscalQuarter: 'Q3',
        reportedEpsPeriodStart: '2026-01-01',
        reportedEpsPeriodEnd: '2026-09-30',
      })
    );

    // Server contract validateRecords rejects invalid structured ReportedEPS period too
    assert.throws(
      () =>
        validateRecords(
          [
            makeQuarterlyRecord({
              ticker: 'COMI',
              year: 2026,
              quarter: 'Q3',
              periodStartDate: '2026-01-01',
              periodEndDate: '2026-09-30',
              periodDays: 273,
              reportedEps: 3.2,
              reportedEpsPeriodType: 'standalone_quarter',
              reportedEpsFiscalYear: 2026,
              reportedEpsFiscalQuarter: 'Q3',
              reportedEpsPeriodStart: '2026-01-01',
              reportedEpsPeriodEnd: '2026-09-30',
            }),
          ],
          true
        ),
      /ربع مالي منفرد|273/
    );
  });

  it('never suggests dates from a hardcoded Jan 1 assumption when record dates are absent', () => {
    const noDatesSuggestion = suggestReportedEpsPeriodDates({
      periodType: 'fy',
      fiscalYear: 2026,
      fiscalQuarter: null,
      recordYear: 2026,
      recordQuarter: 'FY',
      recordPeriodStartDate: null,
      recordPeriodEndDate: null,
    });
    assert.equal(noDatesSuggestion, null);

    const documentedSuggestion = suggestReportedEpsPeriodDates({
      periodType: 'fy',
      fiscalYear: 2026,
      fiscalQuarter: null,
      recordYear: 2026,
      recordQuarter: 'FY',
      recordPeriodStartDate: '2025-07-01',
      recordPeriodEndDate: '2026-06-30',
    });
    assert.deepEqual(
      documentedSuggestion && {
        periodStart: documentedSuggestion.periodStart,
        periodEnd: documentedSuggestion.periodEnd,
      },
      { periodStart: '2025-07-01', periodEnd: '2026-06-30' }
    );
  });
});

describe('ReportedEPS Temporal Alignment Rules & Audit Engine', () => {
  it('withholds Q3 standalone vs Q3 YTD and Q4 standalone vs FY, keeping ReportedEPS untouched and valuation models unblocked', () => {
    const q3Rec = makeQuarterlyRecord({
      ticker: 'TESTQ3',
      year: 2026,
      quarter: 'Q3',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-09-30',
      periodDays: 273,
      netIncomeYTD: 300_000_000,
      netIncomeCommonYTD: 300_000_000,
      weightedAvgSharesYTD: 100_000_000,
      reportedEps: 1.05,
      reportedEpsPeriodType: 'standalone_quarter',
      reportedEpsFiscalYear: 2026,
      reportedEpsFiscalQuarter: 'Q3',
      reportedEpsPeriodStart: '2026-07-01',
      reportedEpsPeriodEnd: '2026-09-30',
      reportedEpsPeriod: formatReportedEpsPeriodDisplay({
        periodType: 'standalone_quarter',
        fiscalYear: 2026,
        fiscalQuarter: 'Q3',
        periodStart: '2026-07-01',
        periodEnd: '2026-09-30',
      }),
    });

    const q3Audit = resolveMetricAuditBundle({
      company: makeCompany('TESTQ3', 30),
      financials: [toQuarterlyFinancial(q3Rec)],
      netIncomeTTM: 300_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(q3Audit.reportedVsAccountingComparison.status, 'withheld_period_or_basis_mismatch');
    assert.equal(q3Audit.reportedVsAccountingComparison.reportedEps, 1.05);
    assert.equal(q3Audit.reportedVsAccountingComparison.reportedEpsPeriodType, 'standalone_quarter');
    assert.equal(q3Audit.reportedVsAccountingComparison.reportedEpsPeriodStart, '2026-07-01');
    assert.equal(q3Audit.reportedVsAccountingComparison.reportedEpsPeriodEnd, '2026-09-30');
    assert.ok(q3Audit.reportedVsAccountingComparison.remediationAr);

    // Q4 standalone vs FY
    const q4StandaloneOnFy = makeQuarterlyRecord({
      ticker: 'TESTQ4',
      year: 2026,
      quarter: 'FY',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-12-31',
      periodDays: 365,
      netIncomeYTD: 400_000_000,
      netIncomeCommonYTD: 400_000_000,
      weightedAvgSharesYTD: 100_000_000,
      reportedEps: 1.12,
      reportedEpsPeriodType: 'standalone_quarter',
      reportedEpsFiscalYear: 2026,
      reportedEpsFiscalQuarter: 'Q4',
      reportedEpsPeriodStart: '2026-10-01',
      reportedEpsPeriodEnd: '2026-12-31',
    });

    const companyQ4 = makeCompany('TESTQ4', 40);
    const projectedQ4 = toQuarterlyFinancial(q4StandaloneOnFy);
    const q4Audit = resolveMetricAuditBundle({
      company: companyQ4,
      financials: [projectedQ4],
      netIncomeTTM: 400_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(q4Audit.reportedVsAccountingComparison.status, 'withheld_period_or_basis_mismatch');
    assert.equal(q4Audit.reportedVsAccountingComparison.reportedEps, 1.12); // Never annualized to 4.48!
    assert.equal(q4Audit.reportedVsAccountingComparison.accountingEps, 4.0);

    // Valuation models remain completely unblocked!
    const metrics = calculateTTMMetrics(companyQ4, [projectedQ4], {
      dividendRecords: [],
      cutoffDate: '2027-02-01',
    });
    assert.equal(metrics.reportedEps, 1.12);
    assert.equal(metrics.epsTTM, 4.0);
    assert.equal(metrics.metricAudit?.valuationEps.value, 4.0);
    assert.equal(
      metrics.metricAudit?.reportedVsAccountingComparison.status,
      'withheld_period_or_basis_mismatch'
    );

    const valuation = runValuationModels(companyQ4, metrics, undefined, BASE_MACROS, {
      sectorPEMap: { 'البنوك': 10 },
      sectorPeConfirmed: true,
      quarterlyRecords: [q4StandaloneOnFy],
      betaRecord: { ticker: 'TESTQ4', beta: 1.0, asOfDate: '2026-12-31', source: 'EGX' },
      betaConfirmed: true,
    });
    assert.ok(valuation.relativeFairValue && valuation.relativeFairValue > 0);
    assert.ok(valuation.grahamFairValue && valuation.grahamFairValue > 0);
  });

  it('allows Q1 standalone vs Q1 YTD ONLY when documented boundaries match, WITHOUT reclassifying standalone_quarter to ytd', () => {
    const q1Rec = makeQuarterlyRecord({
      ticker: 'Q1OK',
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      periodDays: 90,
      netIncomeYTD: 150_000_000,
      netIncomeCommonYTD: 150_000_000,
      weightedAvgSharesYTD: 100_000_000,
      reportedEps: 1.5,
      reportedEpsPeriodType: 'standalone_quarter',
      reportedEpsFiscalYear: 2026,
      reportedEpsFiscalQuarter: 'Q1',
      reportedEpsPeriodStart: '2026-01-01',
      reportedEpsPeriodEnd: '2026-03-31',
    });

    const audit = resolveMetricAuditBundle({
      company: makeCompany('Q1OK', 15),
      financials: [toQuarterlyFinancial(q1Rec)],
      netIncomeTTM: 150_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(audit.reportedVsAccountingComparison.status, 'aligned');
    assert.equal(audit.reportedVsAccountingComparison.q1BoundaryOverlap, true);
    // CRITICAL: NEVER silently reclassify standalone_quarter into ytd!
    assert.equal(audit.reportedVsAccountingComparison.reportedEpsPeriodType, 'standalone_quarter');
    assert.equal(audit.reportedEps.periodKind, 'standalone_quarter');

    // When Q1 boundaries differ, comparison MUST be withheld!
    const q1Mismatch = evaluateReportedEpsPeriodAlignment({
      resolution: {
        status: 'valid',
        source: 'structured',
        period: {
          periodType: 'standalone_quarter',
          fiscalYear: 2026,
          fiscalQuarter: 'Q1',
          periodStart: '2025-07-01',
          periodEnd: '2025-09-30',
          displayLabel: 'ربع مالي منفرد · Q1 2026 (2025-07-01 ← 2025-09-30)',
        },
        periodType: 'standalone_quarter',
        legacyText: null,
        detectedIntent: 'standalone_quarter',
        displayLabel: 'ربع مالي منفرد · Q1 2026 (2025-07-01 ← 2025-09-30)',
        reasonAr: null,
        remediationAr: null,
      },
      latestAccountingTarget: {
        kind: 'ytd',
        label: 'Q1 2026',
        fiscalYear: 2026,
        fiscalQuarter: 'Q1',
        periodStart: '2026-01-01',
        periodEnd: '2026-03-31',
        isCompleteBoundaries: true,
      },
      ttmAccountingTarget: null,
    });
    assert.equal(q1Mismatch.matched, false);
  });

  it('supports non-calendar July–June fiscal year AND leap year (366 days & Feb 29) accurately', () => {
    const julyJuneLeapFy = makeQuarterlyRecord({
      ticker: 'EGX_JUL',
      year: 2024,
      quarter: 'FY',
      periodStartDate: '2023-07-01',
      periodEndDate: '2024-06-30',
      periodDays: 366,
      netIncomeYTD: 500_000_000,
      netIncomeCommonYTD: 500_000_000,
      weightedAvgSharesYTD: 100_000_000,
      reportedEps: 5.0,
      reportedEpsPeriodType: 'fy',
      reportedEpsFiscalYear: 2024,
      reportedEpsPeriodStart: '2023-07-01',
      reportedEpsPeriodEnd: '2024-06-30',
    });

    const normalized = validateAndNormalizeReportedEpsPeriod(julyJuneLeapFy);
    assert.equal(normalized.reportedEpsPeriodType, 'fy');
    assert.equal(normalized.reportedEpsPeriodStart, '2023-07-01');
    assert.equal(normalized.reportedEpsPeriodEnd, '2024-06-30');

    const audit = resolveMetricAuditBundle({
      company: makeCompany('EGX_JUL', 50),
      financials: [toQuarterlyFinancial(julyJuneLeapFy)],
      netIncomeTTM: 500_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(audit.reportedVsAccountingComparison.status, 'aligned');
    assert.equal(audit.reportedVsAccountingComparison.reportedEpsPeriodStart, '2023-07-01');
    assert.equal(audit.reportedVsAccountingComparison.reportedEpsPeriodEnd, '2024-06-30');
    assert.equal(audit.reportedVsAccountingComparison.accountingEpsPeriodStart, '2023-07-01');
    assert.equal(audit.reportedVsAccountingComparison.accountingEpsPeriodEnd, '2024-06-30');

    // Leap year quarter ending on Feb 29
    const leapQuarter = validateAndNormalizeReportedEpsPeriod({
      reportedEps: 0.9,
      reportedEpsPeriodType: 'standalone_quarter',
      reportedEpsFiscalYear: 2024,
      reportedEpsFiscalQuarter: 'Q1',
      reportedEpsPeriodStart: '2023-12-01',
      reportedEpsPeriodEnd: '2024-02-29',
    });
    assert.equal(leapQuarter.reportedEpsPeriodType, 'standalone_quarter');
    assert.equal(leapQuarter.reportedEpsPeriodEnd, '2024-02-29');
  });

  it('compares FY vs TTM strictly by documented start/end dates (aligned when equal, withheld when different)', () => {
    // Case A: FY record (2025-01-01..2025-12-31) with ReportedEPS declared as TTM over the EXACT same window -> allowed
    const fyMatchingTtm = makeQuarterlyRecord({
      ticker: 'FYTTM_OK',
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-12-31',
      periodDays: 365,
      netIncomeYTD: 300_000_000,
      netIncomeCommonYTD: 300_000_000,
      weightedAvgSharesYTD: 100_000_000,
      reportedEps: 3.0,
      reportedEpsPeriodType: 'ttm',
      reportedEpsPeriodStart: '2025-01-01',
      reportedEpsPeriodEnd: '2025-12-31',
    });
    const auditOk = resolveMetricAuditBundle({
      company: makeCompany('FYTTM_OK', 30),
      financials: [toQuarterlyFinancial(fyMatchingTtm)],
      netIncomeTTM: 300_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(auditOk.reportedVsAccountingComparison.status, 'aligned');

    // Case B: July–June FY vs calendar TTM (differing boundaries) -> withheld!
    const fyDifferentTtm = makeQuarterlyRecord({
      ticker: 'FYTTM_NO',
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2024-07-01',
      periodEndDate: '2025-06-30',
      periodDays: 365,
      netIncomeYTD: 300_000_000,
      netIncomeCommonYTD: 300_000_000,
      weightedAvgSharesYTD: 100_000_000,
      reportedEps: 3.0,
      reportedEpsPeriodType: 'ttm',
      reportedEpsPeriodStart: '2025-01-01',
      reportedEpsPeriodEnd: '2025-12-31',
    });
    const auditDiff = resolveMetricAuditBundle({
      company: makeCompany('FYTTM_NO', 30),
      financials: [toQuarterlyFinancial(fyDifferentTtm)],
      netIncomeTTM: 300_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(auditDiff.reportedVsAccountingComparison.status, 'withheld_period_or_basis_mismatch');

    // Case C: Multi-record TTM window (Q3 2025 + FY 2024 - Q3 2024 => 2024-10-01..2025-09-30)
    const q3Prev = makeQuarterlyRecord({
      ticker: 'TTM3',
      year: 2024,
      quarter: 'Q3',
      periodStartDate: '2024-01-01',
      periodEndDate: '2024-09-30',
      periodDays: 274,
      netIncomeYTD: 210_000_000,
      netIncomeCommonYTD: 210_000_000,
      weightedAvgSharesYTD: 100_000_000,
    });
    const fyPrev = makeQuarterlyRecord({
      ticker: 'TTM3',
      year: 2024,
      quarter: 'FY',
      periodStartDate: '2024-01-01',
      periodEndDate: '2024-12-31',
      periodDays: 366,
      netIncomeYTD: 300_000_000,
      netIncomeCommonYTD: 300_000_000,
      weightedAvgSharesYTD: 100_000_000,
    });
    const q3CurrMatchingTtm = makeQuarterlyRecord({
      ticker: 'TTM3',
      year: 2025,
      quarter: 'Q3',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-09-30',
      periodDays: 273,
      netIncomeYTD: 260_000_000,
      netIncomeCommonYTD: 260_000_000,
      weightedAvgSharesYTD: 100_000_000,
      // TTM NetIncome = 260 + 300 - 210 = 350M => Accounting TTM EPS = 3.50 over 2024-10-01..2025-09-30
      reportedEps: 3.5,
      reportedEpsPeriodType: 'ttm',
      reportedEpsPeriodStart: '2024-10-01',
      reportedEpsPeriodEnd: '2025-09-30',
    });
    const companyTtm = makeCompany('TTM3', 35);
    const ttmAuditMatch = resolveMetricAuditBundle({
      company: companyTtm,
      financials: [q3Prev, fyPrev, q3CurrMatchingTtm].map(toQuarterlyFinancial),
      netIncomeTTM: 350_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(ttmAuditMatch.reportedVsAccountingComparison.status, 'aligned');
    assert.equal(ttmAuditMatch.reportedVsAccountingComparison.accountingEpsPeriodStart, '2024-10-01');
    assert.equal(ttmAuditMatch.reportedVsAccountingComparison.accountingEpsPeriodEnd, '2025-09-30');

    // Same 3-record TTM window vs FY 2024 (different boundaries 2024-01-01..2024-12-31) -> withheld!
    const q3CurrDiffFy = {
      ...q3CurrMatchingTtm,
      reportedEpsPeriodType: 'fy' as const,
      reportedEpsFiscalYear: 2024,
      reportedEpsPeriodStart: '2024-01-01',
      reportedEpsPeriodEnd: '2024-12-31',
    };
    const ttmAuditDiff = resolveMetricAuditBundle({
      company: companyTtm,
      financials: [q3Prev, fyPrev, q3CurrDiffFy].map(toQuarterlyFinancial),
      netIncomeTTM: 350_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(ttmAuditDiff.reportedVsAccountingComparison.status, 'withheld_period_or_basis_mismatch');
  });

  it('business hash stays stable for legacy records and reflects structured ReportedEPS period changes', () => {
    const legacy = makeQuarterlyRecord({
      ticker: 'HASH1',
      year: 2025,
      quarter: 'FY',
      reportedEps: 2.0,
      reportedEpsPeriod: 'FY 2025',
    });
    const hashBefore = computeRecordBusinessHash('quarterly', legacy);
    const hashWithStructured = computeRecordBusinessHash('quarterly', {
      ...legacy,
      reportedEpsPeriodType: 'fy',
      reportedEpsFiscalYear: 2025,
      reportedEpsPeriodStart: '2025-01-01',
      reportedEpsPeriodEnd: '2025-12-31',
    });
    assert.notEqual(hashBefore, hashWithStructured);
  });
});

describe('Legacy Dry-Run Review Preview & Excel Round-Trip', () => {
  it('lists legacy ambiguous, unambiguous convertible, and valid structured ReportedEPS rows in dry-run report without mutating data', () => {
    const structuredValid = makeQuarterlyRecord({
      ticker: 'GOOD',
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-12-31',
      periodDays: 365,
      reportedEps: 3.1,
      reportedEpsPeriodType: 'fy',
      reportedEpsFiscalYear: 2025,
      reportedEpsPeriodStart: '2025-01-01',
      reportedEpsPeriodEnd: '2025-12-31',
    });

    const unambiguousLegacy = makeQuarterlyRecord({
      ticker: 'CONV',
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2024-07-01',
      periodEndDate: '2025-06-30',
      periodDays: 365,
      reportedEps: 2.4,
      reportedEpsPeriod: 'FY 2025',
    });

    const ambiguousLegacy = makeQuarterlyRecord({
      ticker: 'AMBIG',
      year: 2026,
      quarter: 'Q3',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-09-30',
      periodDays: 273,
      reportedEps: 1.8,
      reportedEpsPeriod: 'Q3 2026 standalone',
    });

    const auditItem = auditLegacyReportedEpsRecord(ambiguousLegacy);
    assert.equal(auditItem?.status, 'needs_review');

    const report = analyzeLegacyMigration({
      companies: [],
      dailyRecords: [],
      quarterlyRecords: [structuredValid, unambiguousLegacy, ambiguousLegacy],
      sectorPEMap: {},
    });

    assert.equal(report.dryRunOnly, true);
    assert.equal(report.summaryCounts.reportedEpsStructuredValidCount, 1);
    assert.equal(report.summaryCounts.reportedEpsUnambiguousConvertibleCount, 1);
    assert.equal(report.summaryCounts.reportedEpsNeedsReviewCount, 1);
    assert.equal(report.reportedEpsPeriodAudit.length, 3);

    const formatted = formatLegacyMigrationDryRunReport(report);
    assert.ok(formatted.includes('6. مراجعة فترات ReportedEPS القديمة'));
    assert.ok(formatted.includes('AMBIG'));
    assert.ok(formatted.includes('CONV'));
  });

  it('round-trips structured ReportedEPS period through Excel export and import without loss, and flags ambiguous legacy rows', async () => {
    const standaloneRec = makeQuarterlyRecord({
      ticker: 'EXPT',
      year: 2026,
      quarter: 'Q3',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-09-30',
      periodDays: 273,
      reportedEps: 1.45,
      reportedEpsPeriodType: 'standalone_quarter',
      reportedEpsFiscalYear: 2026,
      reportedEpsFiscalQuarter: 'Q3',
      reportedEpsPeriodStart: '2026-07-01',
      reportedEpsPeriodEnd: '2026-09-30',
      reportedEpsPeriod: formatReportedEpsPeriodDisplay({
        periodType: 'standalone_quarter',
        fiscalYear: 2026,
        fiscalQuarter: 'Q3',
        periodStart: '2026-07-01',
        periodEnd: '2026-09-30',
      }),
    });

    const julyJuneFyRec = makeQuarterlyRecord({
      ticker: 'EXPJ',
      year: 2026,
      quarter: 'FY',
      periodStartDate: '2025-07-01',
      periodEndDate: '2026-06-30',
      periodDays: 365,
      reportedEps: 4.2,
      reportedEpsPeriodType: 'fy',
      reportedEpsFiscalYear: 2026,
      reportedEpsPeriodStart: '2025-07-01',
      reportedEpsPeriodEnd: '2026-06-30',
      reportedEpsPeriod: formatReportedEpsPeriodDisplay({
        periodType: 'fy',
        fiscalYear: 2026,
        periodStart: '2025-07-01',
        periodEnd: '2026-06-30',
      }),
    });

    const legacyAmbiguousRec = makeQuarterlyRecord({
      ticker: 'EXLA',
      year: 2026,
      quarter: 'Q3',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-09-30',
      periodDays: 273,
      reportedEps: 2.1,
      reportedEpsPeriod: 'Q3 2026',
    });

    const wb = await buildQuarterlyRecordsWorkbook([standaloneRec, julyJuneFyRec, legacyAmbiguousRec]);
    const parsed = await parseQuarterlyFinancialsExcelDetailed(workbookToMockFile(wb));

    assert.equal(parsed.rejected.length, 0);
    assert.equal(parsed.records.length, 3);

    const parsedStandalone = parsed.records.find((r) => r.ticker === 'EXPT');
    assert.ok(parsedStandalone);
    assert.equal(parsedStandalone.reportedEps, 1.45);
    assert.equal(parsedStandalone.reportedEpsPeriodType, 'standalone_quarter');
    assert.equal(parsedStandalone.reportedEpsFiscalYear, 2026);
    assert.equal(parsedStandalone.reportedEpsFiscalQuarter, 'Q3');
    assert.equal(parsedStandalone.reportedEpsPeriodStart, '2026-07-01');
    assert.equal(parsedStandalone.reportedEpsPeriodEnd, '2026-09-30');

    const parsedJulyJune = parsed.records.find((r) => r.ticker === 'EXPJ');
    assert.ok(parsedJulyJune);
    assert.equal(parsedJulyJune.reportedEps, 4.2);
    assert.equal(parsedJulyJune.reportedEpsPeriodType, 'fy');
    assert.equal(parsedJulyJune.reportedEpsFiscalYear, 2026);
    assert.equal(parsedJulyJune.reportedEpsFiscalQuarter ?? null, null);
    assert.equal(parsedJulyJune.reportedEpsPeriodStart, '2025-07-01');
    assert.equal(parsedJulyJune.reportedEpsPeriodEnd, '2026-06-30');

    const parsedLegacyAmbig = parsed.records.find((r) => r.ticker === 'EXLA');
    assert.ok(parsedLegacyAmbig);
    assert.equal(parsedLegacyAmbig.reportedEps, 2.1);
    assert.equal(parsedLegacyAmbig.reportedEpsPeriodType, 'needs_review');
    assert.equal(parsedLegacyAmbig.reportedEpsPeriodStart ?? null, null);
    assert.equal(parsedLegacyAmbig.reportedEpsPeriodEnd ?? null, null);
    assert.ok(parsed.warnings.some((w) => w.includes('EXLA') && w.includes('needs_review')));

    const canonical = resolveCanonicalReportedEpsPeriod(parsedStandalone);
    assert.equal(canonical.status, 'valid');
    assert.equal(canonical.period?.periodType, 'standalone_quarter');
  });
});

describe('Batch 29: Conservative Legacy Classification & Unified Write Validation', () => {
  it('never converts FY 2026 (2025-07-01 → 2026-06-30) into calendar 2026-01-01 → 2026-12-31 across resolver, importer, and dry-run audit', async () => {
    const legacyText = 'FY 2026 (2025-07-01 → 2026-06-30)';
    const calendarFyRecord = makeQuarterlyRecord({
      ticker: 'CONF_FY',
      year: 2026,
      quarter: 'FY',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-12-31',
      periodDays: 365,
      netIncomeYTD: 400_000_000,
      netIncomeCommonYTD: 400_000_000,
      weightedAvgSharesYTD: 100_000_000,
      reportedEps: 4.0,
      reportedEpsPeriod: legacyText,
    });

    // 1. Direct legacy classifier must return needs_review with explicit conflict detail
    const classified = classifyLegacyReportedEpsPeriod(legacyText, {
      year: 2026,
      quarter: 'FY',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-12-31',
    });
    assert.equal(classified.status, 'needs_review');
    assert.equal(classified.resolved, null);
    assert.ok(classified.reasonAr.includes('2025-07-01') || classified.reasonAr.includes('2026-06-30'));
    assert.ok(classified.remediationAr);

    // 2. Canonical resolver must NOT substitute record dates or mark aligned
    const resolved = resolveCanonicalReportedEpsPeriod(calendarFyRecord);
    assert.equal(resolved.status, 'needs_review');
    assert.equal(resolved.period, null);
    assert.equal(resolved.legacyText, legacyText);
    assert.ok(resolved.reasonAr?.includes('2025-07-01') || resolved.reasonAr?.includes('2026-06-30'));

    // 3. Audit engine must withhold ReportedEPS vs AccountingEPS comparison
    const audit = resolveMetricAuditBundle({
      company: makeCompany('CONF_FY', 40),
      financials: [toQuarterlyFinancial(calendarFyRecord)],
      netIncomeTTM: 400_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(audit.reportedVsAccountingComparison.status, 'withheld_period_or_basis_mismatch');
    assert.equal(audit.reportedVsAccountingComparison.reportedEps, 4.0);

    // 4. Dry-run migration audit must surface conflict + remediation and NEVER mark convertible
    const dryRunItem = auditLegacyReportedEpsRecord(calendarFyRecord);
    assert.equal(dryRunItem.status, 'needs_review');
    assert.equal(dryRunItem.proposedPeriod, null);
    assert.equal(dryRunItem.reportedEps, 4.0);
    assert.equal(dryRunItem.legacyReportedEpsPeriod, legacyText);
    assert.ok(dryRunItem.remediationAr);

    const migrationReport = analyzeLegacyMigration({
      companies: [],
      dailyRecords: [],
      quarterlyRecords: [calendarFyRecord],
      sectorPEMap: {},
    });
    assert.equal(migrationReport.summaryCounts.reportedEpsUnambiguousConvertibleCount, 0);
    assert.equal(migrationReport.summaryCounts.reportedEpsNeedsReviewCount, 1);
    const reportText = formatLegacyMigrationDryRunReport(migrationReport);
    assert.ok(reportText.includes('CONF_FY'));
    assert.ok(reportText.includes(legacyText));

    // 5. Excel importer must classify as needs_review, preserve original text + ReportedEPS, and warn in preview
    const wb = await buildQuarterlyRecordsWorkbook([calendarFyRecord]);
    const imported = await parseQuarterlyFinancialsExcelDetailed(workbookToMockFile(wb));
    assert.equal(imported.rejected.length, 0);
    assert.equal(imported.records.length, 1);
    assert.equal(imported.records[0].reportedEps, 4.0);
    assert.equal(imported.records[0].reportedEpsPeriodType, 'needs_review');
    assert.equal(imported.records[0].reportedEpsPeriodStart ?? null, null);
    assert.equal(imported.records[0].reportedEpsPeriodEnd ?? null, null);
    assert.equal(imported.records[0].reportedEpsPeriod, legacyText);
    assert.ok(imported.warnings.some((w) => w.includes('CONF_FY') && w.includes('needs_review')));
  });

  it('never re-parses derived display text with dates as a parallel structured source even when dates happen to match, while structured fields stay authoritative', () => {
    const derivedDisplay = 'FY 2026 (2025-07-01 → 2026-06-30)';
    // Without structured fields: conservative -> needs_review
    const withoutStructured = classifyLegacyReportedEpsPeriod(derivedDisplay, {
      year: 2026,
      quarter: 'FY',
      periodStartDate: '2025-07-01',
      periodEndDate: '2026-06-30',
    });
    assert.equal(withoutStructured.status, 'needs_review');
    assert.equal(withoutStructured.resolved, null);

    // With valid structured fields: structured fields are the sole authoritative source
    const withStructured = resolveCanonicalReportedEpsPeriod({
      year: 2026,
      quarter: 'FY',
      periodStartDate: '2025-07-01',
      periodEndDate: '2026-06-30',
      reportedEps: 4.5,
      reportedEpsPeriodType: 'fy',
      reportedEpsFiscalYear: 2026,
      reportedEpsPeriodStart: '2025-07-01',
      reportedEpsPeriodEnd: '2026-06-30',
      reportedEpsPeriod: 'stale arbitrary display label',
    });
    assert.equal(withStructured.status, 'valid');
    assert.equal(withStructured.source, 'structured');
    assert.equal(withStructured.period?.periodType, 'fy');
    assert.equal(withStructured.period?.periodStart, '2025-07-01');
    assert.equal(withStructured.period?.periodEnd, '2026-06-30');
  });

  it('never ignores a differing end date or month inside legacy YTD text and flags conflicting markers/ranges as needs_review', async () => {
    const ytdConflictSamples = [
      'Q3 2026 YTD (ended 2026-06-30)',
      'Q3 2026 YTD (2026-01-01 → 2026-06-30)',
      '9M 2026 ending June 2026',
      'Q3 2026 YTD حتى يونيو 2026',
      'Q3 2026 YTD (30/06/2026)',
      'Q3 2026 YTD 2026-06',
    ];

    for (const sample of ytdConflictSamples) {
      const classified = classifyLegacyReportedEpsPeriod(sample, {
        year: 2026,
        quarter: 'Q3',
        periodStartDate: '2026-01-01',
        periodEndDate: '2026-09-30',
      });
      assert.equal(
        classified.status,
        'needs_review',
        `YTD conflict sample "${sample}" must NEVER convert to 2026-09-30`
      );
      assert.equal(classified.resolved, null);
      assert.ok(classified.remediationAr);
    }

    // Dual fiscal year & conflicting qualifiers must also stay needs_review
    const otherConflictSamples = [
      'FY 2025/2026',
      'FY 2025-2026',
      'FY 2026 standalone',
      'Q3 2026 YTD FY',
      'FY 2026 (ended 30 June 2026)',
    ];
    for (const sample of otherConflictSamples) {
      const classified = classifyLegacyReportedEpsPeriod(sample, {
        year: 2026,
        quarter: 'FY',
        periodStartDate: '2026-01-01',
        periodEndDate: '2026-12-31',
      });
      assert.equal(classified.status, 'needs_review', `Sample "${sample}" must be needs_review`);
      assert.equal(classified.resolved, null);
    }

    // Importer test for legacy YTD with differing June end date on Sep Q3 record
    const ytdConflictRec = makeQuarterlyRecord({
      ticker: 'YTD_JUN',
      year: 2026,
      quarter: 'Q3',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-09-30',
      periodDays: 273,
      reportedEps: 2.35,
      reportedEpsPeriod: 'Q3 2026 YTD (ended 2026-06-30)',
    });
    const wb = await buildQuarterlyRecordsWorkbook([ytdConflictRec]);
    const imported = await parseQuarterlyFinancialsExcelDetailed(workbookToMockFile(wb));
    assert.equal(imported.rejected.length, 0);
    assert.equal(imported.records.length, 1);
    assert.equal(imported.records[0].reportedEps, 2.35);
    assert.equal(imported.records[0].reportedEpsPeriodType, 'needs_review');
    assert.equal(imported.records[0].reportedEpsPeriod, 'Q3 2026 YTD (ended 2026-06-30)');
    assert.equal(imported.records[0].reportedEpsPeriodEnd ?? null, null);
    assert.ok(imported.warnings.some((w) => w.includes('YTD_JUN') && w.includes('2026-06-30')));
  });

  it('continues to allow safe bare legacy tokens with zero conflicts when record boundaries match strictly', () => {
    const bareFy = classifyLegacyReportedEpsPeriod('FY 2025', {
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2024-07-01',
      periodEndDate: '2025-06-30',
    });
    assert.equal(bareFy.status, 'unambiguous_convertible');
    assert.equal(bareFy.resolved?.periodType, 'fy');
    assert.equal(bareFy.resolved?.periodStart, '2024-07-01');
    assert.equal(bareFy.resolved?.periodEnd, '2025-06-30');

    const bareYtd = classifyLegacyReportedEpsPeriod('Q3 2026 YTD', {
      year: 2026,
      quarter: 'Q3',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-09-30',
    });
    assert.equal(bareYtd.status, 'unambiguous_convertible');
    assert.equal(bareYtd.resolved?.periodType, 'ytd');
    assert.equal(bareYtd.resolved?.fiscalQuarter, 'Q3');
    assert.equal(bareYtd.resolved?.periodEnd, '2026-09-30');
  });

  it('unifies write validation for ReportedEPS (including 0 and negative values) across contract, validateRecords, and Excel importer while preserving legacy read compatibility', async () => {
    assert.equal(hasExplicitReportedEpsValue(0), true);
    assert.equal(hasExplicitReportedEpsValue(-1.75), true);
    assert.equal(hasExplicitReportedEpsValue(2.5), true);
    assert.equal(hasExplicitReportedEpsValue(null), false);
    assert.equal(hasExplicitReportedEpsValue(undefined), false);

    // 1. Central contract rejects positive, zero, and negative ReportedEPS with empty period
    for (const epsVal of [2.5, 0, -1.75]) {
      assert.throws(
        () =>
          validateAndNormalizeReportedEpsPeriod({
            reportedEps: epsVal,
            reportedEpsPeriodType: null,
            reportedEpsPeriod: null,
          }),
        (err: unknown) => err instanceof Error && err.message === MISSING_REPORTED_EPS_PERIOD_ERROR_AR
      );

      // 2. Server validateRecords enforces the exact same rule on new writes
      assert.throws(
        () =>
          validateRecords(
            [
              makeQuarterlyRecord({
                ticker: 'EMPTY_EPS',
                year: 2026,
                quarter: 'Q3',
                reportedEps: epsVal,
                reportedEpsPeriodType: null,
                reportedEpsPeriod: null,
              }),
            ],
            true
          ),
        /ReportedEPS/
      );

      // 3. Explicit `needs_review` IS allowed for 0, negative, and positive values (preserving exact numeric value!)
      const accepted = validateRecords(
        [
          makeQuarterlyRecord({
            ticker: 'REV_OK',
            year: 2026,
            quarter: 'Q3',
            reportedEps: epsVal,
            reportedEpsPeriodType: 'needs_review',
            reportedEpsPeriod: null,
          }),
        ],
        true
      );
      assert.equal(accepted.length, 1);
      assert.equal((accepted[0] as QuarterlyFinancialRecord).reportedEps, epsVal);
      assert.equal((accepted[0] as QuarterlyFinancialRecord).reportedEpsPeriodType, 'needs_review');

      // 4. Legacy compatibility mode on validateRecords preserves read/cleanup compatibility for untouched old DB docs
      const legacyCompat = validateRecords(
        [
          makeQuarterlyRecord({
            ticker: 'LEG_OK',
            year: 2025,
            quarter: 'Q3',
            reportedEps: epsVal,
            reportedEpsPeriodType: null,
            reportedEpsPeriod: null,
          }),
        ],
        true,
        undefined,
        { legacyCompatibilityMode: true }
      );
      assert.equal(legacyCompat.length, 1);
      assert.equal((legacyCompat[0] as QuarterlyFinancialRecord).reportedEps, epsVal);
    }

    // 5. Excel importer NEVER accepts blank ReportedEPS period silently — classifies as needs_review with preview warning for 0, negative, and positive values
    const blankPeriodRows = [
      makeQuarterlyRecord({
        ticker: 'ZERO_EPS',
        year: 2026,
        quarter: 'Q3',
        reportedEps: 0,
        reportedEpsPeriodType: null,
        reportedEpsPeriod: null,
      }),
      makeQuarterlyRecord({
        ticker: 'NEG_EPS',
        year: 2026,
        quarter: 'Q3',
        reportedEps: -1.75,
        reportedEpsPeriodType: null,
        reportedEpsPeriod: null,
      }),
      makeQuarterlyRecord({
        ticker: 'POS_EPS',
        year: 2026,
        quarter: 'Q3',
        reportedEps: 2.5,
        reportedEpsPeriodType: null,
        reportedEpsPeriod: null,
      }),
    ];
    const wb = await buildQuarterlyRecordsWorkbook(blankPeriodRows);
    const parsed = await parseQuarterlyFinancialsExcelDetailed(workbookToMockFile(wb));
    assert.equal(parsed.rejected.length, 0);
    assert.equal(parsed.records.length, 3);

    const zRec = parsed.records.find((r) => r.ticker === 'ZERO_EPS');
    const nRec = parsed.records.find((r) => r.ticker === 'NEG_EPS');
    const pRec = parsed.records.find((r) => r.ticker === 'POS_EPS');
    assert.equal(zRec?.reportedEps, 0);
    assert.equal(zRec?.reportedEpsPeriodType, 'needs_review');
    assert.equal(nRec?.reportedEps, -1.75);
    assert.equal(nRec?.reportedEpsPeriodType, 'needs_review');
    assert.equal(pRec?.reportedEps, 2.5);
    assert.equal(pRec?.reportedEpsPeriodType, 'needs_review');

    assert.ok(parsed.warnings.some((w) => w.includes('ZERO_EPS') && w.includes('needs_review')));
    assert.ok(parsed.warnings.some((w) => w.includes('NEG_EPS') && w.includes('needs_review')));
    assert.ok(parsed.warnings.some((w) => w.includes('POS_EPS') && w.includes('needs_review')));

    // 6. Central import resolver produces consistent result directly too
    const directZero = resolveImportedReportedEpsPeriod(
      { reportedEps: 0, reportedEpsPeriodType: null, reportedEpsPeriod: null },
      { year: 2026, quarter: 'Q3', periodStartDate: '2026-01-01', periodEndDate: '2026-09-30' }
    );
    assert.equal(directZero.classification, 'needs_review');
    assert.equal(directZero.normalized.reportedEpsPeriodType, 'needs_review');
    assert.ok(directZero.warningAr?.includes('needs_review'));
  });

  it('withholds ONLY ReportedEPS comparison when period is needs_review or undocumented and NEVER alters independent valuation models (Relative, Graham, RIM, DCF)', () => {
    const baseRecordFields = {
      ticker: 'VAL_ISO',
      year: 2026,
      quarter: 'FY' as const,
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-12-31',
      periodDays: 365,
      shares: 100_000_000,
      equity: 2_000_000_000,
      equityCommon: 2_000_000_000,
      netIncomeYTD: 400_000_000,
      netIncomeCommonYTD: 400_000_000,
      weightedAvgSharesYTD: 100_000_000,
      ocfYTD: 460_000_000,
      capexYTD: 60_000_000,
      ebitYTD: 520_000_000,
      pbtYTD: 500_000_000,
      taxExpenseYTD: 100_000_000,
      depreciationAmortizationYTD: 40_000_000,
      cash: 300_000_000,
      totalDebtWithoutTX: 200_000_000,
    };

    const company = makeCompany('VAL_ISO', 32);

    const alignedRec = makeQuarterlyRecord({
      ...baseRecordFields,
      reportedEps: 4.0,
      reportedEpsPeriodType: 'fy',
      reportedEpsFiscalYear: 2026,
      reportedEpsPeriodStart: '2026-01-01',
      reportedEpsPeriodEnd: '2026-12-31',
    });

    const ambiguousRec = makeQuarterlyRecord({
      ...baseRecordFields,
      reportedEps: -0.5,
      reportedEpsPeriodType: 'needs_review',
      reportedEpsPeriod: 'FY 2026 (2025-07-01 → 2026-06-30)',
    });

    const legacyEmptyPeriodRec = makeQuarterlyRecord({
      ...baseRecordFields,
      reportedEps: 0,
      reportedEpsPeriodType: null,
      reportedEpsPeriod: null,
    });

    const runBundle = (rec: QuarterlyFinancialRecord) => {
      const proj = toQuarterlyFinancial(rec);
      const metrics = calculateTTMMetrics(company, [proj], {
        dividendRecords: [],
        cutoffDate: '2027-02-01',
      });
      const valuation = runValuationModels(company, metrics, undefined, BASE_MACROS, {
        sectorPEMap: { 'البنوك': 10 },
        sectorPeConfirmed: true,
        quarterlyRecords: [rec],
        betaRecord: { ticker: 'VAL_ISO', beta: 1.0, asOfDate: '2026-12-31', source: 'EGX' },
        betaConfirmed: true,
      });
      return { metrics, valuation };
    };

    const resAligned = runBundle(alignedRec);
    const resAmbig = runBundle(ambiguousRec);
    const resLegacyEmpty = runBundle(legacyEmptyPeriodRec);

    assert.equal(resAligned.metrics.metricAudit?.reportedVsAccountingComparison.status, 'aligned');
    assert.equal(
      resAmbig.metrics.metricAudit?.reportedVsAccountingComparison.status,
      'withheld_period_or_basis_mismatch'
    );
    assert.equal(
      resLegacyEmpty.metrics.metricAudit?.reportedVsAccountingComparison.status,
      'withheld_period_or_basis_mismatch'
    );
    assert.equal(resLegacyEmpty.metrics.reportedEps, 0);
    assert.equal(resAmbig.metrics.reportedEps, -0.5);

    // Valuation outputs across Relative, Graham, RIM, DCF must be IDENTICAL regardless of ReportedEPS ambiguity
    for (const other of [resAmbig, resLegacyEmpty]) {
      assert.equal(other.valuation.relativeFairValue, resAligned.valuation.relativeFairValue);
      assert.equal(other.valuation.grahamFairValue, resAligned.valuation.grahamFairValue);
      assert.equal(other.valuation.rimFairValue, resAligned.valuation.rimFairValue);
      assert.equal(other.valuation.dcfFairValue, resAligned.valuation.dcfFairValue);
      assert.equal(other.valuation.fcffFairValue, resAligned.valuation.fcffFairValue);
      assert.equal(other.valuation.averageFairValue, resAligned.valuation.averageFairValue);
    }

    // Dry-run audit of legacy empty-period zero ReportedEPS record must mark needs_review with clear reason & preserve 0
    const zeroAudit = auditLegacyReportedEpsRecord(legacyEmptyPeriodRec);
    assert.equal(zeroAudit.status, 'needs_review');
    assert.equal(zeroAudit.reportedEps, 0);
    assert.ok(zeroAudit.remediationAr);
  });
});

function createInMemoryQuarterlyStore() {
  const collections = new Map<string, Map<string, Record<string, any>>>([
    ['quarterly_financial_records', new Map()],
    ['financials', new Map()],
    ['companies', new Map()],
    ['sectorPE', new Map()],
  ]);

  const getCol = (name: string) => {
    let map = collections.get(name);
    if (!map) {
      map = new Map();
      collections.set(name, map);
    }
    return map;
  };

  let writeOpsCount = 0;

  const setDoc = (collectionName: string, docId: string, data: Record<string, any>, merge: boolean) => {
    writeOpsCount += 1;
    const col = getCol(collectionName);
    if (merge && col.has(docId)) {
      col.set(docId, { ...col.get(docId)!, ...data });
    } else {
      col.set(docId, { ...data });
    }
  };

  const txTarget: AtomicWriteTarget = {
    async getDoc(collectionName: string, docId: string) {
      const existing = getCol(collectionName).get(docId);
      return existing ? { ...existing } : undefined;
    },
    setDoc,
  };

  const bulkTarget: BulkQuarterlyWriteTarget = {
    async getDocs(refs) {
      const out = new Map<string, Record<string, any>>();
      for (const ref of refs) {
        const existing = getCol(ref.collection).get(ref.docId);
        if (existing) {
          out.set(`${ref.collection}/${ref.docId}`, { ...existing });
        }
      }
      return out;
    },
    setDoc,
  };

  const resetWriteOpsCount = () => {
    writeOpsCount = 0;
  };

  return {
    collections,
    txTarget,
    bulkTarget,
    getDoc: (col: string, id: string) => getCol(col).get(id),
    getWriteOpsCount: () => writeOpsCount,
    resetWriteOpsCount,
  };
}

describe('Batch 30: ReportedEPS Write Consistency across Source, Projection, and ContentHash', () => {
  const STAMP = {
    updatedAt: '2026-10-01T12:00:00.000Z',
    updatedBy: 'admin_batch30',
    isDeleted: false,
  };

  it('rejects normal writes with ReportedEPS (positive, zero, negative) and free-text period without reportedEpsPeriodType across validateRecords, single write, and bulk write', async () => {
    for (const epsValue of [3.25, 0, -1.4]) {
      const freeTextRecord = makeQuarterlyRecord({
        ticker: 'FREE_TXT',
        year: 2026,
        quarter: 'Q3',
        periodStartDate: '2026-01-01',
        periodEndDate: '2026-09-30',
        periodDays: 273,
        reportedEps: epsValue,
        reportedEpsPeriodType: null,
        reportedEpsPeriod: '9M 2026',
      });

      // 1. validateRecords default (normal write) MUST reject free-text period
      assert.throws(
        () => validateRecords([freeTextRecord], true),
        (err: unknown) =>
          err instanceof Error && err.message.includes('ReportedEPS_PeriodType')
      );

      // 2. resolveQuarterlyRecordWrite MUST reject with QuarterlyValidationError
      assert.throws(
        () => resolveQuarterlyRecordWrite(undefined, freeTextRecord),
        (err: unknown) => err instanceof QuarterlyValidationError
      );

      // 3. Single atomic write executor MUST reject and write NOTHING
      const store = createInMemoryQuarterlyStore();
      await assert.rejects(
        () =>
          applyStockAndQuarterAtomicWrite(store.txTarget, {
            record: freeTextRecord,
            stamp: STAMP,
          }),
        (err: unknown) => err instanceof QuarterlyValidationError
      );
      assert.equal(store.getWriteOpsCount(), 0);
      assert.equal(store.getDoc('quarterly_financial_records', 'FREE_TXT_2026_Q3'), undefined);
      assert.equal(store.getDoc('financials', 'free_txt_2026_q3'), undefined);

      // 4. Bulk write executor MUST reject and stage NOTHING
      await assert.rejects(
        () =>
          applyBulkQuarterlyWrites(store.bulkTarget, {
            rawRecords: [freeTextRecord],
            stamp: STAMP,
          }),
        (err: unknown) => err instanceof QuarterlyValidationError
      );
      assert.equal(store.getWriteOpsCount(), 0);
    }

    // Internal legacy inspection mode (`legacyCompatibilityMode: true`) still accepts legacy read/audit records
    const legacyAuditRec = makeQuarterlyRecord({
      ticker: 'LEG_READ',
      year: 2025,
      quarter: 'FY',
      reportedEps: 2.1,
      reportedEpsPeriodType: null,
      reportedEpsPeriod: 'FY 2025',
    });
    const inspected = validateRecords([legacyAuditRec], true, 1, {
      legacyCompatibilityMode: true,
    });
    assert.equal(inspected.length, 1);
    assert.equal(inspected[0].reportedEpsPeriod, 'FY 2025');
    assert.equal(inspected[0].reportedEpsPeriodType, null);
    // And read-only canonical resolver still reads legacy records safely without mutating them
    const canonical = resolveCanonicalReportedEpsPeriod(legacyAuditRec, {
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-12-31',
    });
    assert.equal(canonical.status, 'valid');
    assert.equal(canonical.source, 'legacy_unambiguous');
  });

  it('prevents stale YTD period fields, projection drift, and partial contentHash on partial update to needs_review (single & bulk)', async () => {
    const initialYtd = makeQuarterlyRecord({
      ticker: 'COMI',
      year: 2026,
      quarter: 'Q3',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-09-30',
      periodDays: 273,
      revenueYTD: 1_250_000_000,
      netIncomeYTD: 340_000_000,
      equity: 2_400_000_000,
      shares: 100_000_000,
      reportedEps: 3.1,
      reportedEpsSource: 'إفصاح البورصة',
      reportedEpsPeriodType: 'ytd',
      reportedEpsFiscalYear: 2026,
      reportedEpsFiscalQuarter: 'Q3',
      reportedEpsPeriodStart: '2026-01-01',
      reportedEpsPeriodEnd: '2026-09-30',
    });

    for (const mode of ['single', 'bulk'] as const) {
      const store = createInMemoryQuarterlyStore();

      // Seed structured YTD record
      if (mode === 'single') {
        const seedRes = await applyStockAndQuarterAtomicWrite(store.txTarget, {
          record: initialYtd,
          stamp: STAMP,
        });
        assert.equal(seedRes.insertedCount, 1);
      } else {
        const seedRes = await applyBulkQuarterlyWrites(store.bulkTarget, {
          rawRecords: [initialYtd],
          stamp: STAMP,
        });
        assert.equal(seedRes.insertedCount, 1);
      }

      const seededSource = store.getDoc('quarterly_financial_records', 'COMI_2026_Q3')!;
      const seededProj = store.getDoc('financials', 'comi_2026_q3')!;
      assert.equal(seededSource.contentHash, seededProj.contentHash);
      assert.equal(seededSource.contentHash, computeRecordBusinessHash('quarterly', seededSource));
      assert.equal(seededSource.reportedEpsPeriodType, 'ytd');
      assert.equal(seededSource.reportedEpsFiscalQuarter, 'Q3');

      // Attempt 1 (MUST FAIL): Partial update with new EPS + free-text period without reportedEpsPeriodType
      const badPartial = {
        ticker: 'COMI',
        year: 2026,
        quarter: 'Q3',
        reportedEps: 3.45,
        reportedEpsPeriod: 'Q3 2026 free text',
      };
      store.resetWriteOpsCount();
      if (mode === 'single') {
        await assert.rejects(
          () => applyStockAndQuarterAtomicWrite(store.txTarget, { record: badPartial, stamp: STAMP }),
          (err: unknown) => err instanceof QuarterlyValidationError
        );
      } else {
        await assert.rejects(
          () =>
            applyBulkQuarterlyWrites(store.bulkTarget, {
              rawRecords: [badPartial],
              stamp: STAMP,
            }),
          (err: unknown) => err instanceof QuarterlyValidationError
        );
      }
      assert.equal(store.getWriteOpsCount(), 0);
      assert.equal(store.getDoc('quarterly_financial_records', 'COMI_2026_Q3')!.reportedEps, 3.1);
      assert.equal(store.getDoc('quarterly_financial_records', 'COMI_2026_Q3')!.contentHash, seededSource.contentHash);

      // Attempt 2 (MUST SUCCEED): Partial update switching explicitly to `needs_review` WITHOUT sending year/quarter/start/end/display
      const toNeedsReviewPartial = {
        ticker: 'COMI',
        year: 2026,
        quarter: 'Q3',
        reportedEps: 3.45,
        reportedEpsPeriodType: 'needs_review',
      };
      if (mode === 'single') {
        const res = await applyStockAndQuarterAtomicWrite(store.txTarget, {
          record: toNeedsReviewPartial,
          stamp: { ...STAMP, updatedAt: '2026-10-02T12:00:00.000Z' },
        });
        assert.equal(res.updatedCount, 1);
      } else {
        const res = await applyBulkQuarterlyWrites(store.bulkTarget, {
          rawRecords: [toNeedsReviewPartial],
          stamp: { ...STAMP, updatedAt: '2026-10-02T12:00:00.000Z' },
        });
        assert.equal(res.updatedCount, 1);
      }

      const srcAfter = store.getDoc('quarterly_financial_records', 'COMI_2026_Q3')!;
      const projAfter = store.getDoc('financials', 'comi_2026_q3')!;

      // Source MUST have zero stale YTD subfields
      assert.equal(srcAfter.reportedEps, 3.45);
      assert.equal(srcAfter.reportedEpsSource, 'إفصاح البورصة');
      assert.equal(srcAfter.reportedEpsPeriodType, 'needs_review');
      assert.equal(srcAfter.reportedEpsFiscalYear, null);
      assert.equal(srcAfter.reportedEpsFiscalQuarter, null);
      assert.equal(srcAfter.reportedEpsPeriodStart, null);
      assert.equal(srcAfter.reportedEpsPeriodEnd, null);
      assert.equal(srcAfter.reportedEpsPeriod, null);

      // Untouched financial fields MUST be preserved in BOTH source and projection
      assert.equal(srcAfter.revenueYTD, 1_250_000_000);
      assert.equal(srcAfter.netIncomeYTD, 340_000_000);
      assert.equal(srcAfter.equity, 2_400_000_000);
      assert.equal(srcAfter.shares, 100_000_000);

      assert.equal(projAfter.revenueYTD, 1_250_000_000);
      assert.equal(projAfter.netProfitYTD, 340_000_000);
      assert.equal(projAfter.totalEquity, 2_400_000_000);
      assert.equal(projAfter.sharesCount, 100_000_000);
      assert.equal(projAfter.reportedEps, 3.45);
      assert.equal(projAfter.reportedEpsSource, 'إفصاح البورصة');
      assert.equal(projAfter.reportedEpsPeriodType, 'needs_review');
      assert.equal(projAfter.reportedEpsFiscalYear, null);
      assert.equal(projAfter.reportedEpsFiscalQuarter, null);
      assert.equal(projAfter.reportedEpsPeriodStart, null);
      assert.equal(projAfter.reportedEpsPeriodEnd, null);
      assert.equal(projAfter.reportedEpsPeriod, null);

      // contentHash MUST match the FINAL merged document (not the partial payload!)
      const expectedFinalHash = computeRecordBusinessHash('quarterly', srcAfter);
      assert.equal(srcAfter.contentHash, expectedFinalHash);
      assert.equal(projAfter.contentHash, expectedFinalHash);
      assert.notEqual(
        expectedFinalHash,
        computeRecordBusinessHash('quarterly', toNeedsReviewPartial)
      );

      // Attempt 3: Re-submitting identical full final record MUST skip as unchanged with zero writes
      store.resetWriteOpsCount();
      if (mode === 'single') {
        const replay = await applyStockAndQuarterAtomicWrite(store.txTarget, {
          record: { ...srcAfter },
          stamp: { ...STAMP, updatedAt: '2026-10-03T12:00:00.000Z' },
        });
        assert.equal(replay.skippedUnchangedCount, 1);
        assert.equal(replay.updatedCount, 0);
        assert.equal(replay.insertedCount, 0);
      } else {
        const replay = await applyBulkQuarterlyWrites(store.bulkTarget, {
          rawRecords: [{ ...srcAfter }],
          stamp: { ...STAMP, updatedAt: '2026-10-03T12:00:00.000Z' },
        });
        assert.equal(replay.skippedUnchangedCount, 1);
        assert.equal(replay.updatedCount, 0);
        assert.equal(replay.insertedCount, 0);
      }
      assert.equal(store.getWriteOpsCount(), 0);
    }
  });

  it('clears incompatible subfields when changing period type (ytd -> fy, standalone_quarter -> ttm), clearing reportedEps to null, and preserves untouched fields on unrelated partial updates', async () => {
    const store = createInMemoryQuarterlyStore();

    // Seed YTD Q3 record
    await applyStockAndQuarterAtomicWrite(store.txTarget, {
      record: makeQuarterlyRecord({
        ticker: 'SWCH',
        year: 2026,
        quarter: 'Q3',
        periodStartDate: '2026-01-01',
        periodEndDate: '2026-09-30',
        periodDays: 273,
        revenueYTD: 900_000_000,
        reportedEps: 2.2,
        reportedEpsSource: 'قوائم ربعية',
        reportedEpsPeriodType: 'ytd',
        reportedEpsFiscalYear: 2026,
        reportedEpsFiscalQuarter: 'Q3',
        reportedEpsPeriodStart: '2026-01-01',
        reportedEpsPeriodEnd: '2026-09-30',
      }),
      stamp: STAMP,
    });

    // 1. Switch YTD Q3 -> FY 2025 (omitting reportedEpsFiscalQuarter must clear it to null, NOT keep 'Q3'!)
    await applyStockAndQuarterAtomicWrite(store.txTarget, {
      record: {
        ticker: 'SWCH',
        year: 2026,
        quarter: 'Q3',
        reportedEpsPeriodType: 'fy',
        reportedEpsFiscalYear: 2025,
        reportedEpsPeriodStart: '2025-01-01',
        reportedEpsPeriodEnd: '2025-12-31',
      },
      stamp: STAMP,
    });
    let src = store.getDoc('quarterly_financial_records', 'SWCH_2026_Q3')!;
    let proj = store.getDoc('financials', 'swch_2026_q3')!;
    assert.equal(src.reportedEps, 2.2);
    assert.equal(src.reportedEpsPeriodType, 'fy');
    assert.equal(src.reportedEpsFiscalYear, 2025);
    assert.equal(src.reportedEpsFiscalQuarter, null);
    assert.equal(src.reportedEpsPeriodStart, '2025-01-01');
    assert.equal(src.reportedEpsPeriodEnd, '2025-12-31');
    assert.equal(proj.reportedEpsFiscalQuarter, null);
    assert.equal(proj.reportedEpsPeriodType, 'fy');
    assert.equal(src.contentHash, proj.contentHash);
    assert.equal(src.contentHash, computeRecordBusinessHash('quarterly', src));

    // 2. Switch FY 2025 -> TTM (omitting fiscalYear and quarter must clear both to null!)
    await applyStockAndQuarterAtomicWrite(store.txTarget, {
      record: {
        ticker: 'SWCH',
        year: 2026,
        quarter: 'Q3',
        reportedEpsPeriodType: 'ttm',
        reportedEpsPeriodStart: '2025-10-01',
        reportedEpsPeriodEnd: '2026-09-30',
      },
      stamp: STAMP,
    });
    src = store.getDoc('quarterly_financial_records', 'SWCH_2026_Q3')!;
    proj = store.getDoc('financials', 'swch_2026_q3')!;
    assert.equal(src.reportedEpsPeriodType, 'ttm');
    assert.equal(src.reportedEpsFiscalYear, null);
    assert.equal(src.reportedEpsFiscalQuarter, null);
    assert.equal(src.reportedEpsPeriodStart, '2025-10-01');
    assert.equal(src.reportedEpsPeriodEnd, '2026-09-30');
    assert.equal(proj.reportedEpsFiscalYear, null);
    assert.equal(proj.reportedEpsFiscalQuarter, null);
    assert.equal(src.contentHash, proj.contentHash);

    // 3. Partial update of an unrelated financial field (`revenueYTD`) preserves ReportedEPS & all other fields identically
    await applyStockAndQuarterAtomicWrite(store.txTarget, {
      record: {
        ticker: 'SWCH',
        year: 2026,
        quarter: 'Q3',
        revenueYTD: 950_000_000,
      },
      stamp: STAMP,
    });
    src = store.getDoc('quarterly_financial_records', 'SWCH_2026_Q3')!;
    proj = store.getDoc('financials', 'swch_2026_q3')!;
    assert.equal(src.revenueYTD, 950_000_000);
    assert.equal(proj.revenueYTD, 950_000_000);
    assert.equal(src.reportedEps, 2.2);
    assert.equal(src.reportedEpsPeriodType, 'ttm');
    assert.equal(proj.reportedEpsPeriodType, 'ttm');
    assert.equal(proj.reportedEpsPeriodStart, '2025-10-01');
    assert.equal(src.contentHash, proj.contentHash);
    assert.equal(src.contentHash, computeRecordBusinessHash('quarterly', src));

    // 4. Explicitly clearing `reportedEps: null` clears stale period metadata and source cleanly
    await applyStockAndQuarterAtomicWrite(store.txTarget, {
      record: {
        ticker: 'SWCH',
        year: 2026,
        quarter: 'Q3',
        reportedEps: null,
      },
      stamp: STAMP,
    });
    src = store.getDoc('quarterly_financial_records', 'SWCH_2026_Q3')!;
    proj = store.getDoc('financials', 'swch_2026_q3')!;
    assert.equal(src.reportedEps, null);
    assert.equal(src.reportedEpsSource, null);
    assert.equal(src.reportedEpsPeriodType, null);
    assert.equal(src.reportedEpsFiscalYear, null);
    assert.equal(src.reportedEpsFiscalQuarter, null);
    assert.equal(src.reportedEpsPeriodStart, null);
    assert.equal(src.reportedEpsPeriodEnd, null);
    assert.equal(src.reportedEpsPeriod, null);
    assert.equal(proj.reportedEps, null);
    assert.equal(proj.reportedEpsPeriodType, null);
    assert.equal(proj.reportedEpsPeriodStart, null);
    assert.equal(src.revenueYTD, 950_000_000);
    assert.equal(proj.revenueYTD, 950_000_000);
    assert.equal(src.contentHash, proj.contentHash);
    assert.equal(src.contentHash, computeRecordBusinessHash('quarterly', src));
  });

  it('allows unrelated partial updates on untouched legacy records without mutating their legacy ReportedEPS text, while rejecting any ReportedEPS edit unless period is structured or needs_review', async () => {
    const store = createInMemoryQuarterlyStore();
    const legacyDoc = makeQuarterlyRecord({
      ticker: 'OLDLEG',
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-12-31',
      periodDays: 365,
      revenueYTD: 500_000_000,
      reportedEps: 1.8,
      reportedEpsPeriodType: null,
      reportedEpsPeriod: 'FY 2025',
    });
    store.collections.get('quarterly_financial_records')!.set('OLDLEG_2025_FY', {
      ...legacyDoc,
      contentHash: computeRecordBusinessHash('quarterly', legacyDoc),
    });

    // Unrelated update (only revenueYTD): allowed and syncs projection + hash
    const unrelatedRes = await applyStockAndQuarterAtomicWrite(store.txTarget, {
      record: {
        ticker: 'OLDLEG',
        year: 2025,
        quarter: 'FY',
        revenueYTD: 520_000_000,
      },
      stamp: STAMP,
    });
    assert.equal(unrelatedRes.updatedCount, 1);
    const srcAfterUnrelated = store.getDoc('quarterly_financial_records', 'OLDLEG_2025_FY')!;
    const projAfterUnrelated = store.getDoc('financials', 'oldleg_2025_fy')!;
    assert.equal(srcAfterUnrelated.revenueYTD, 520_000_000);
    assert.equal(projAfterUnrelated.revenueYTD, 520_000_000);
    assert.equal(srcAfterUnrelated.reportedEps, 1.8);
    assert.equal(srcAfterUnrelated.reportedEpsPeriod, 'FY 2025');
    assert.equal(srcAfterUnrelated.contentHash, projAfterUnrelated.contentHash);

    // Touching reportedEps WITHOUT giving a structured period or needs_review MUST be rejected
    await assert.rejects(
      () =>
        applyStockAndQuarterAtomicWrite(store.txTarget, {
          record: {
            ticker: 'OLDLEG',
            year: 2025,
            quarter: 'FY',
            reportedEps: 1.95,
          },
          stamp: STAMP,
        }),
      (err: unknown) => err instanceof QuarterlyValidationError
    );
  });

  it('produces identical final source, projection, and contentHash between single and bulk paths', async () => {
    const storeSingle = createInMemoryQuarterlyStore();
    const storeBulk = createInMemoryQuarterlyStore();

    const base = makeQuarterlyRecord({
      ticker: 'PARITY',
      year: 2026,
      quarter: 'Q3',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-09-30',
      periodDays: 273,
      revenueYTD: 700_000_000,
      netIncomeYTD: 180_000_000,
      reportedEps: 1.8,
      reportedEpsPeriodType: 'standalone_quarter',
      reportedEpsFiscalYear: 2026,
      reportedEpsFiscalQuarter: 'Q3',
      reportedEpsPeriodStart: '2026-07-01',
      reportedEpsPeriodEnd: '2026-09-30',
    });

    const partialUpdate = {
      ticker: 'PARITY',
      year: 2026,
      quarter: 'Q3',
      reportedEps: 1.85,
      reportedEpsPeriodType: 'needs_review',
      reportedEpsPeriod: 'مرجع قديم للمراجعة',
    };

    await applyStockAndQuarterAtomicWrite(storeSingle.txTarget, { record: base, stamp: STAMP });
    await applyStockAndQuarterAtomicWrite(storeSingle.txTarget, { record: partialUpdate, stamp: STAMP });

    await applyBulkQuarterlyWrites(storeBulk.bulkTarget, {
      rawRecords: [base],
      stamp: STAMP,
    });
    await applyBulkQuarterlyWrites(storeBulk.bulkTarget, {
      rawRecords: [partialUpdate],
      stamp: STAMP,
    });

    const stripBulkMeta = (doc: Record<string, any> | undefined) => {
      if (!doc) return doc;
      const { sourceRow: _ignored, ...rest } = doc;
      return rest;
    };

    assert.deepEqual(
      stripBulkMeta(storeSingle.getDoc('quarterly_financial_records', 'PARITY_2026_Q3')),
      stripBulkMeta(storeBulk.getDoc('quarterly_financial_records', 'PARITY_2026_Q3'))
    );
    assert.deepEqual(
      stripBulkMeta(storeSingle.getDoc('financials', 'parity_2026_q3')),
      stripBulkMeta(storeBulk.getDoc('financials', 'parity_2026_q3'))
    );
  });
});


