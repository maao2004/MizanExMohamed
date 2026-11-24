/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Batch 33 Acceptance Tests:
 * Unifying `WeightedAvgShares_Basis` contract/validation and Central `AccountingEPS` Eligibility
 * (including documented Q1 standalone ↔ YTD equivalence, TTM reuse & guards, valuation priority,
 * and Metric_Audit Excel export parity).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

import {
  ALLOWED_WEIGHTED_AVG_SHARES_BASIS,
  WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR,
  WEIGHTED_AVG_SHARES_BASIS_OPTIONS,
  WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR,
  formatWeightedAvgSharesBasisAr,
  inspectWeightedAvgSharesBasis,
  validateAndNormalizeWeightedAvgSharesBasis,
  validateRecords,
} from '../src/core/contracts';
import {
  evaluatePeriodSharesBasisEligibility,
  resolveMetricAuditBundle,
} from '../src/core/domain';
import { parseQuarterlyFinancialsExcelDetailed } from '../src/core/imports';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { buildCompanyValuationWorkbook } from '../src/utils/excelExport';
import type { Company, DailyTradingRecord, QuarterlyFinancial } from '../src/types';

function makeWorkbookFile(rows: unknown[][], sheetName = 'QuarterlyFinancials', fileName = 'test.xlsx'): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([arr], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

const TEST_COMPANY: Company = {
  id: 'test',
  ticker: 'TEST',
  name: 'Test Industrial Co.',
  nameAr: 'شركة اختبار',
  sector: 'industrial',
  marketPrice: 15,
  tradingCurrency: 'EGP',
  financialCurrency: 'EGP',
  sharesOutstanding: 100,
};

function defaultPeriodBoundaries(year: number, quarter: 'Q1' | 'Q2' | 'Q3' | 'FY') {
  switch (quarter) {
    case 'Q1':
      return { start: `${year}-01-01`, end: `${year}-03-31` };
    case 'Q2':
      return { start: `${year}-01-01`, end: `${year}-06-30` };
    case 'Q3':
      return { start: `${year}-01-01`, end: `${year}-09-30` };
    default:
      return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
}

function makeQuarterFin(overrides: Partial<QuarterlyFinancial> = {}): QuarterlyFinancial {
  const year = overrides.year ?? 2026;
  const quarter = overrides.quarter ?? 'Q1';
  const bounds = defaultPeriodBoundaries(year, quarter);
  return {
    id: `TEST_${year}_${quarter}`,
    companyId: 'test',
    year,
    quarter,
    periodDate: overrides.periodEndDate ?? bounds.end,
    periodStartDate: 'periodStartDate' in overrides ? overrides.periodStartDate : bounds.start,
    periodEndDate: 'periodEndDate' in overrides ? overrides.periodEndDate : bounds.end,
    periodDays: 'periodDays' in overrides ? overrides.periodDays : null,
    revenueYTD: 100,
    grossProfitYTD: 60,
    operatingProfitYTD: 45,
    netProfitYTD: 30,
    netIncomeCommonYTD: 30,
    netIncomeCommonBasis: 'explicit_common',
    operatingCashFlowYTD: 35,
    capexYTD: 5,
    dividendsPaidYTD: 0,
    totalAssets: 500,
    totalDebt: 50,
    cashAndEquivalents: 60,
    totalEquity: 300,
    commonEquity: 300,
    commonEquityBasis: 'explicit_common',
    sharesCount: 100,
    weightedAvgSharesYTD: 100,
    weightedAvgSharesBasis: 'ytd_weighted_avg',
    reportedEps: null,
    reportedEpsSource: null,
    reportedEpsPeriod: null,
    reportedEpsPeriodType: null,
    isCapitalActionAdjusted: true,
    financialCurrency: 'EGP',
    financialUnit: 'base',
    isAudited: true,
    ...overrides,
  };
}

function resolveAudit(financials: QuarterlyFinancial[], netIncomeTTM: number | null = null) {
  return resolveMetricAuditBundle({
    company: TEST_COMPANY,
    financials,
    netIncomeTTM,
    finCurrencyAllowed: true,
    currencySuffix: ' ج.م',
  });
}

const BASE_MACROS: Record<string, number> = {
  TaxRate: 0.225,
  Rf_Egypt_10Y: 0.18,
  ERP_Developed: 0.05,
  CRP_Egypt: 0.02,
  Beta_Default: 1.0,
  Terminal_Growth: 0.05,
  Exit_Multiple: 6,
  Forecast_Years: 3,
  Cost_of_Debt: 0.16,
  Growth_Y1: 0.12,
  Growth_Y2: 0.1,
  Growth_Y3: 0.08,
  WACC_Mode: 1,
  DDM_Growth: 0.06,
  r_Mode: 1,
  Weight_DCF: 35,
  Weight_DDM: 15,
  Weight_RIM: 25,
  Weight_Relative: 15,
  Weight_Graham: 10,
  Beta_Raw_Weight: 1,
  Beta_Anchor: 1,
  Country_Risk_Lambda: 1,
  RIM_Retention: 0.6,
  RIM_Terminal_Method: 1,
  Relative_PE_Weight: 0.5,
  Relative_PB_Weight: 0.5,
};

describe('Batch 33 — Central WeightedAvgShares_Basis Contract & Unified Validation', () => {
  it('defines all 5 preserved canonical codes with accurate Arabic semantics and zero silent capital-action assumption', () => {
    assert.deepEqual(
      WEIGHTED_AVG_SHARES_BASIS_OPTIONS.map((o) => o.code),
      [
        'ytd_weighted_avg',
        'standalone_quarter',
        'end_of_period_proxy',
        'unadjusted_weighted_avg',
        'unknown',
      ]
    );
    assert.equal(ALLOWED_WEIGHTED_AVG_SHARES_BASIS.size, 5);
    assert.match(WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR, /عدد أسهم/);
    assert.match(WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR, /وليس ربحية سهم/);
    assert.match(WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR, /IsCapitalActionAdjusted/);

    for (const opt of WEIGHTED_AVG_SHARES_BASIS_OPTIONS) {
      assert.equal(opt.provesCapitalActionAdjustment, false);
      assert.ok(opt.labelAr.trim().length > 0);
      assert.ok(opt.meaningAr.trim().length > 0);
      assert.ok(opt.usageLimitsAr.trim().length > 0);
    }

    const ytd = WEIGHTED_AVG_SHARES_BASIS_OPTIONS.find((o) => o.code === 'ytd_weighted_avg')!;
    assert.match(ytd.selectLabelAr, /FY/);
    assert.match(ytd.meaningAr, /السنة المالية الكاملة/);
    assert.equal(ytd.accountingEpsPolicy, 'direct_ytd_or_fy');

    const standalone = WEIGHTED_AVG_SHARES_BASIS_OPTIONS.find((o) => o.code === 'standalone_quarter')!;
    assert.match(standalone.meaningAr, /ربع مالي واحد منفرد/);
    assert.match(standalone.meaningAr, /6 أشهر/);
    assert.equal(standalone.accountingEpsPolicy, 'conditional_q1_documented_equivalence');

    const proxy = WEIGHTED_AVG_SHARES_BASIS_OPTIONS.find((o) => o.code === 'end_of_period_proxy')!;
    assert.match(proxy.meaningAr, /نهاية الفترة التقريبي/);
    assert.match(proxy.meaningAr, /ولا يعني «سنة مالية كاملة»/);
    assert.equal(proxy.accountingEpsPolicy, 'blocked');
  });

  it('enforces unified validation across central validator, server validateRecords, and Excel importer without mutating unrecognized values on read', async () => {
    // Central write validator
    assert.equal(validateAndNormalizeWeightedAvgSharesBasis(null), null);
    assert.equal(validateAndNormalizeWeightedAvgSharesBasis(''), null);
    assert.equal(validateAndNormalizeWeightedAvgSharesBasis('BLANK'), null);
    assert.equal(validateAndNormalizeWeightedAvgSharesBasis('  YTD_WEIGHTED_AVG  '), 'ytd_weighted_avg');
    assert.equal(validateAndNormalizeWeightedAvgSharesBasis('standalone_quarter'), 'standalone_quarter');
    assert.throws(() => validateAndNormalizeWeightedAvgSharesBasis('full_year_proxy'), /WeightedAvgShares_Basis/);
    assert.throws(() => validateAndNormalizeWeightedAvgSharesBasis(123), /WeightedAvgShares_Basis/);

    // Non-mutating read inspection
    const inspectedUnknown = inspectWeightedAvgSharesBasis('legacy_custom_code');
    assert.equal(inspectedUnknown.status, 'unrecognized');
    assert.equal(inspectedUnknown.rawValue, 'legacy_custom_code');
    assert.equal(inspectedUnknown.code, null);
    assert.match(formatWeightedAvgSharesBasisAr('legacy_custom_code'), /legacy_custom_code/);

    // Server validateRecords rejects invalid basis identically
    const invalidServerRecord = {
      ticker: 'TEST',
      stockName: 'شركة اختبار',
      year: 2026,
      quarter: 'Q1',
      shares: 100,
      revenueYTD: 100,
      netIncomeYTD: 30,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'invalid_basis_code',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      dateInsertData: '2026-04-15',
    };
    assert.throws(
      () => validateRecords([invalidServerRecord], true),
      /WeightedAvgShares_Basis/
    );

    // Server validateRecords accepts all 5 canonical codes untouched
    for (const opt of WEIGHTED_AVG_SHARES_BASIS_OPTIONS) {
      const ok = validateRecords(
        [{ ...invalidServerRecord, weightedAvgSharesBasis: opt.code }],
        true
      );
      assert.equal(ok.length, 1);
      assert.equal(ok[0].weightedAvgSharesBasis, opt.code);
    }

    // Excel importer rejects invalid basis into `rejected[]` and preserves valid canonical codes
    const badFile = makeWorkbookFile([
      ['Ticker', 'StockName', 'YearQuarter', 'Shares', 'RevenueYTD', 'NetIncomeYTD', 'WeightedAvgShares_YTD', 'WeightedAvgShares_Basis', 'PeriodStartDate', 'PeriodEndDate'],
      ['TEST', 'شركة اختبار', '2026Q1', 100, 100, 30, 100, 'bad_basis_value', '2026-01-01', '2026-03-31'],
    ]);
    const badParsed = await parseQuarterlyFinancialsExcelDetailed(badFile);
    assert.equal(badParsed.records.length, 0);
    assert.equal(badParsed.rejected.length, 1);
    assert.equal(badParsed.rejected[0].column, 'WeightedAvgShares_Basis');
    assert.match(badParsed.rejected[0].reasonAr, /WeightedAvgShares_Basis/);
    assert.match(badParsed.rejected[0].reasonAr, /bad_basis_value/);

    const goodFile = makeWorkbookFile([
      ['Ticker', 'StockName', 'YearQuarter', 'Shares', 'RevenueYTD', 'NetIncomeYTD', 'WeightedAvgShares_YTD', 'WeightedAvgShares_Basis', 'PeriodStartDate', 'PeriodEndDate'],
      ['TEST', 'شركة اختبار', '2026Q1', 100, 100, 30, 100, 'standalone_quarter', '2026-01-01', '2026-03-31'],
    ]);
    const parsed = await parseQuarterlyFinancialsExcelDetailed(goodFile);
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.records[0].weightedAvgSharesBasis, 'standalone_quarter');
  });
});

describe('Batch 33 — Central AccountingEPS Eligibility & Documented Q1 Equivalence', () => {
  it('computes identical AccountingEPS (30 / 100 = 0.30) for documented Q1 calendar year under both ytd_weighted_avg and standalone_quarter without mutating stored code', () => {
    const q1Ytd = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      netIncomeCommonYTD: 30,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'ytd_weighted_avg',
    });
    const q1Standalone = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      netIncomeCommonYTD: 30,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
    });

    const bundleYtd = resolveAudit([q1Ytd]);
    const bundleStandalone = resolveAudit([q1Standalone]);

    assert.equal(bundleYtd.accountingEpsLatestEligibility.eligible, true);
    assert.equal(bundleYtd.accountingEpsLatestEligibility.accountingEpsValue, 0.3);
    assert.equal(bundleYtd.accountingEpsLatestEligibility.originalSharesBasis, 'ytd_weighted_avg');
    assert.equal(bundleYtd.accountingEpsLatestEligibility.effectiveSharesBasis, 'ytd_weighted_avg');
    assert.equal(bundleYtd.accountingEpsLatestEligibility.usedQ1DocumentedEquivalence, false);

    assert.equal(bundleStandalone.accountingEpsLatestEligibility.eligible, true);
    assert.equal(bundleStandalone.accountingEpsLatestEligibility.accountingEpsValue, 0.3);
    assert.equal(bundleStandalone.accountingEpsLatest.value, 0.3);
    assert.equal(bundleStandalone.accountingEpsLatestEligibility.originalSharesBasis, 'standalone_quarter');
    assert.equal(
      bundleStandalone.accountingEpsLatestEligibility.effectiveSharesBasis,
      'q1_standalone_equivalent_to_ytd'
    );
    assert.equal(bundleStandalone.accountingEpsLatestEligibility.usedQ1DocumentedEquivalence, true);
    assert.equal(bundleStandalone.accountingEpsLatest.originalSharesBasis, 'standalone_quarter');
    assert.equal(
      bundleStandalone.accountingEpsLatest.effectiveSharesBasis,
      'q1_standalone_equivalent_to_ytd'
    );
    assert.equal(bundleStandalone.accountingEpsLatest.usedQ1DocumentedEquivalence, true);

    // Stored record is NEVER mutated
    assert.equal(q1Standalone.weightedAvgSharesBasis, 'standalone_quarter');
  });

  it('supports documented Q1 equivalence for non-calendar fiscal years (July–June) and leap years (2024)', () => {
    // Non-calendar FY 2026 Q1: 2025-07-01 -> 2025-09-30 (92 days)
    const fyPrevNonCal = makeQuarterFin({
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2024-07-01',
      periodEndDate: '2025-06-30',
      weightedAvgSharesBasis: 'ytd_weighted_avg',
    });
    const q1NonCal = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2025-07-01',
      periodEndDate: '2025-09-30',
      netIncomeCommonYTD: 30,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    const nonCalBundle = resolveAudit([fyPrevNonCal, q1NonCal]);
    assert.equal(nonCalBundle.accountingEpsLatestEligibility.eligible, true);
    assert.equal(nonCalBundle.accountingEpsLatestEligibility.accountingEpsValue, 0.3);
    assert.equal(nonCalBundle.accountingEpsLatestEligibility.periodDays, 92);
    assert.equal(nonCalBundle.accountingEpsLatestEligibility.usedQ1DocumentedEquivalence, true);
    assert.equal(q1NonCal.weightedAvgSharesBasis, 'standalone_quarter');

    // Leap year Q1 2024: 2024-01-01 -> 2024-03-31 (91 days)
    const q1Leap = makeQuarterFin({
      year: 2024,
      quarter: 'Q1',
      periodStartDate: '2024-01-01',
      periodEndDate: '2024-03-31',
      periodDays: 91,
      netIncomeCommonYTD: 30,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    const leapBundle = resolveAudit([q1Leap]);
    assert.equal(leapBundle.accountingEpsLatestEligibility.eligible, true);
    assert.equal(leapBundle.accountingEpsLatestEligibility.periodDays, 91);
    assert.equal(leapBundle.accountingEpsLatestEligibility.accountingEpsValue, 0.3);

    // Invalid non-leap date 2025-02-29 is blocked
    const invalidLeap = makeQuarterFin({
      year: 2025,
      quarter: 'Q1',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-02-29',
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    const invalidLeapDecision = evaluatePeriodSharesBasisEligibility(invalidLeap);
    assert.equal(invalidLeapDecision.eligible, false);
    assert.equal(invalidLeapDecision.blockedCode, 'standalone_q1_period_conflict');
  });

  it('blocks Q1 standalone_quarter when dates are missing (even if periodDays alone is present) or when dates/context conflict', () => {
    // 1. Q1 label + periodDays=90 alone WITHOUT PeriodStartDate/PeriodEndDate => BLOCKED
    const q1DaysOnly = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: null,
      periodEndDate: null,
      periodDays: 90,
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    const daysOnlyBundle = resolveAudit([q1DaysOnly]);
    assert.equal(daysOnlyBundle.accountingEpsLatestEligibility.eligible, false);
    assert.equal(daysOnlyBundle.accountingEpsLatestEligibility.blockedCode, 'standalone_q1_missing_dates');
    assert.equal(daysOnlyBundle.accountingEpsLatestEligibility.missingField, 'periodStartDate');
    assert.ok(daysOnlyBundle.accountingEpsLatestEligibility.remediationAr);
    assert.ok(
      daysOnlyBundle.missingAccountingEpsFields.some(
        (m) => m.field === 'periodStartDate' && m.quarter === 'Q1' && m.year === 2026
      )
    );

    // 2. Q1 with non-quarter span (181 days) => BLOCKED
    const q1TooLong = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-06-30',
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    assert.equal(
      evaluatePeriodSharesBasisEligibility(q1TooLong).blockedCode,
      'standalone_q1_period_conflict'
    );

    // 3. Q1 with PeriodDays mismatching actual calendar span => BLOCKED
    const q1DaysMismatch = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      periodDays: 95,
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    assert.equal(
      evaluatePeriodSharesBasisEligibility(q1DaysMismatch).blockedCode,
      'standalone_q1_period_conflict'
    );

    // 4. Q1 fiscal year conflicts with dates => BLOCKED
    const q1YearConflict = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2023-01-01',
      periodEndDate: '2023-03-31',
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    assert.equal(
      evaluatePeriodSharesBasisEligibility(q1YearConflict).blockedCode,
      'standalone_q1_period_conflict'
    );

    // 5. Q1 start conflicts with previous FY end + 1 day => BLOCKED
    const fyPrev = makeQuarterFin({
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2024-07-01',
      periodEndDate: '2025-06-30',
    });
    const q1BoundaryConflict = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    assert.equal(
      evaluatePeriodSharesBasisEligibility(q1BoundaryConflict, { previousFY: fyPrev }).blockedCode,
      'standalone_q1_period_conflict'
    );

    // 6. Q1 start conflicts with same-year Q2 start => BLOCKED
    const q2SameYear = makeQuarterFin({
      year: 2026,
      quarter: 'Q2',
      periodStartDate: '2025-07-01',
      periodEndDate: '2025-12-31',
    });
    assert.equal(
      evaluatePeriodSharesBasisEligibility(q1BoundaryConflict, { sameYearRecords: [q2SameYear] })
        .blockedCode,
      'standalone_q1_period_conflict'
    );
  });

  it('always blocks standalone_quarter on Q2, Q3, and FY even with complete valid dates', () => {
    for (const quarter of ['Q2', 'Q3', 'FY'] as const) {
      const rec = makeQuarterFin({
        year: 2026,
        quarter,
        weightedAvgSharesBasis: 'standalone_quarter',
      });
      const bundle = resolveAudit([rec]);
      assert.equal(bundle.accountingEpsLatestEligibility.eligible, false, `${quarter} must be blocked`);
      assert.equal(
        bundle.accountingEpsLatestEligibility.blockedCode,
        'standalone_quarter_non_q1_blocked'
      );
      assert.equal(bundle.accountingEpsLatest.value, null);
      assert.equal(bundle.accountingEpsLatestEligibility.missingField, 'weightedAvgSharesBasis');
    }
  });

  it('blocks end_of_period_proxy, unadjusted_weighted_avg, unknown, empty, and unrecognized stored codes with distinct explanations', () => {
    const cases: Array<{ basis: any; expectedCode: string; mustMatch: RegExp }> = [
      {
        basis: 'end_of_period_proxy',
        expectedCode: 'end_of_period_proxy_blocked',
        mustMatch: /تقريبي/,
      },
      {
        basis: 'unadjusted_weighted_avg',
        expectedCode: 'unadjusted_weighted_avg_blocked',
        mustMatch: /غير معدل/,
      },
      {
        basis: 'unknown',
        expectedCode: 'unknown_shares_basis_blocked',
        mustMatch: /unknown/,
      },
      {
        basis: null,
        expectedCode: 'missing_shares_basis',
        mustMatch: /غير موثق/,
      },
      {
        basis: 'legacy_weird_code',
        expectedCode: 'unrecognized_shares_basis',
        mustMatch: /legacy_weird_code/,
      },
    ];

    for (const c of cases) {
      const rec = makeQuarterFin({
        year: 2025,
        quarter: 'FY',
        weightedAvgSharesBasis: c.basis,
      });
      const decision = evaluatePeriodSharesBasisEligibility(rec);
      assert.equal(decision.eligible, false);
      assert.equal(decision.blockedCode, c.expectedCode);
      assert.match(decision.reasonAr, c.mustMatch);
      assert.equal(decision.missingField, 'weightedAvgSharesBasis');
      assert.ok(decision.remediationAr);
    }
  });

  it('preserves zero (0) and negative (-30) NetIncomeCommon, blocks <= 0 or missing shares, and never bypasses NetIncomeCommon guard', () => {
    // Zero numerator -> 0 (never -0)
    const zeroNi = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      netIncomeCommonYTD: 0,
      netIncomeCommonBasis: 'explicit_common',
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    const zeroBundle = resolveAudit([zeroNi]);
    assert.equal(zeroBundle.accountingEpsLatestEligibility.eligible, true);
    assert.equal(Object.is(zeroBundle.accountingEpsLatestEligibility.accountingEpsValue, 0), true);
    assert.equal(zeroBundle.accountingEpsLatest.value, 0);

    // Negative numerator -> -0.30 preserved
    const negNi = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      netIncomeCommonYTD: -30,
      netIncomeCommonBasis: 'explicit_common',
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    const negBundle = resolveAudit([negNi]);
    assert.equal(negBundle.accountingEpsLatestEligibility.eligible, true);
    assert.equal(negBundle.accountingEpsLatestEligibility.accountingEpsValue, -0.3);

    // Shares == 0 or < 0 or null => blocked
    for (const badShares of [0, -100, null]) {
      const rec = makeQuarterFin({
        year: 2026,
        quarter: 'Q1',
        weightedAvgSharesYTD: badShares,
        weightedAvgSharesBasis: 'ytd_weighted_avg',
      });
      const decision = evaluatePeriodSharesBasisEligibility(rec);
      assert.equal(decision.eligible, false);
      assert.equal(
        decision.blockedCode,
        badShares === null ? 'missing_weighted_avg_shares' : 'invalid_weighted_avg_shares'
      );
    }

    // NetIncomeCommon guard NEVER bypassed even on documented Q1
    const unattestedNi = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      netProfitYTD: 30,
      netIncomeCommonYTD: null,
      netIncomeCommonBasis: null,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    const unattestedBundle = resolveAudit([unattestedNi]);
    assert.equal(unattestedBundle.accountingEpsLatestEligibility.eligible, false);
    assert.equal(
      unattestedBundle.accountingEpsLatestEligibility.blockedCode,
      'missing_net_income_common'
    );
    assert.equal(unattestedBundle.accountingEpsLatest.value, null);
  });
});

describe('Batch 33 — Central AccountingEPS TTM Reuse, Guards, Valuation Priority & Excel Export', () => {
  it('computes AccountingEPS TTM with documented Q1 standalone_quarter on Q1 2026 & Q1 2025 + FY 2025 ytd_weighted_avg without summing shares or mutating basis', () => {
    // Constant shares = 100 across Q1 2025 (90d), FY 2025 (365d), Q1 2026 (90d)
    const q1_2025 = makeQuarterFin({
      year: 2025,
      quarter: 'Q1',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-03-31',
      netIncomeCommonYTD: 25,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
      isCapitalActionAdjusted: true,
    });
    const fy_2025 = makeQuarterFin({
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-12-31',
      netIncomeCommonYTD: 120,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'ytd_weighted_avg',
      isCapitalActionAdjusted: true,
    });
    const q1_2026 = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      netIncomeCommonYTD: 35,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
      isCapitalActionAdjusted: true,
    });

    const bundle = resolveAudit([q1_2025, fy_2025, q1_2026], 130);
    // NetIncomeCommon TTM = 35 + 120 - 25 = 130; shares = 100 => EPS TTM = 1.30
    assert.equal(bundle.accountingEpsTtmEligibility.eligible, true);
    assert.ok(Math.abs((bundle.accountingEpsTtmEligibility.accountingEpsValue ?? 0) - 1.3) < 1e-9);
    assert.equal(bundle.accountingEpsTtmEligibility.denominatorValue, 100);
    assert.equal(bundle.accountingEpsTtmEligibility.usedQ1DocumentedEquivalence, true);
    assert.equal(bundle.accountingEpsTtmEligibility.originalSharesBasis, 'standalone_quarter');
    assert.equal(
      bundle.accountingEpsTtmEligibility.effectiveSharesBasis,
      'q1_standalone_equivalent_to_ytd'
    );
    assert.equal(bundle.accountingEpsTtmEligibility.periodDays, 365);
    assert.equal(q1_2025.weightedAvgSharesBasis, 'standalone_quarter');
    assert.equal(q1_2026.weightedAvgSharesBasis, 'standalone_quarter');

    // Changing shares with IsCapitalActionAdjusted === true uses calendar-day weighting (NOT summing shares)
    const q1_2026_chg = makeQuarterFin({
      ...q1_2026,
      weightedAvgSharesYTD: 110,
      isCapitalActionAdjusted: true,
    });
    const weightedBundle = resolveAudit([q1_2025, fy_2025, q1_2026_chg], 130);
    const expectedWeightedShares = (110 * 90 + 100 * 365 - 100 * 90) / 365;
    assert.equal(weightedBundle.accountingEpsTtmEligibility.eligible, true);
    assert.ok(
      Math.abs((weightedBundle.accountingEpsTtmEligibility.denominatorValue ?? 0) - expectedWeightedShares) < 1e-6
    );
    assert.ok(
      Math.abs(
        (weightedBundle.accountingEpsTtmEligibility.accountingEpsValue ?? 0) -
          130 / expectedWeightedShares
      ) < 1e-6
    );
  });

  it('preserves all TTM guards: blocks unadjusted share changes, IsCapitalActionAdjusted conflicts, invalid FY basis, and non-contiguous boundaries', () => {
    const q1_2025 = makeQuarterFin({
      year: 2025,
      quarter: 'Q1',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-03-31',
      netIncomeCommonYTD: 25,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
      isCapitalActionAdjusted: false,
    });
    const fy_2025 = makeQuarterFin({
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-12-31',
      netIncomeCommonYTD: 120,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'ytd_weighted_avg',
      isCapitalActionAdjusted: false,
    });
    const q1_2026_chg = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      netIncomeCommonYTD: 35,
      weightedAvgSharesYTD: 115,
      weightedAvgSharesBasis: 'standalone_quarter',
      isCapitalActionAdjusted: false,
    });

    // 1. Shares changed without IsCapitalActionAdjusted === true => BLOCKED
    const unadjChg = resolveAudit([q1_2025, fy_2025, q1_2026_chg], 130);
    assert.equal(unadjChg.accountingEpsTtmEligibility.eligible, false);
    assert.equal(
      unadjChg.accountingEpsTtmEligibility.blockedCode,
      'ttm_unadjusted_shares_change'
    );
    assert.equal(unadjChg.accountingEpsTtmEligibility.missingField, 'isCapitalActionAdjusted');

    // 2. IsCapitalActionAdjusted conflict across periods => BLOCKED
    const conflictFlag = resolveAudit(
      [
        { ...q1_2025, isCapitalActionAdjusted: true },
        { ...fy_2025, isCapitalActionAdjusted: false },
        { ...q1_2026_chg, weightedAvgSharesYTD: 100, isCapitalActionAdjusted: true },
      ],
      130
    );
    assert.equal(conflictFlag.accountingEpsTtmEligibility.eligible, false);
    assert.equal(
      conflictFlag.accountingEpsTtmEligibility.blockedCode,
      'ttm_capital_action_conflict'
    );

    // 3. previousFY having end_of_period_proxy => BLOCKED
    const badFyBasis = resolveAudit(
      [
        { ...q1_2025, isCapitalActionAdjusted: true },
        { ...fy_2025, isCapitalActionAdjusted: true, weightedAvgSharesBasis: 'end_of_period_proxy' },
        { ...q1_2026_chg, weightedAvgSharesYTD: 100, isCapitalActionAdjusted: true },
      ],
      130
    );
    assert.equal(badFyBasis.accountingEpsTtmEligibility.eligible, false);
    assert.equal(badFyBasis.accountingEpsTtmEligibility.blockedCode, 'end_of_period_proxy_blocked');

    // 4. Non-contiguous boundaries (gap between FY 2025 end and Q1 2026 start) => BLOCKED
    // For standalone_quarter Q1, Guard 3 catches standalone_q1_period_conflict immediately;
    // for ytd_weighted_avg Q1, Guard 5 catches ttm_boundary_conflict.
    const gapDatesStandalone = resolveAudit(
      [
        { ...q1_2025, isCapitalActionAdjusted: true },
        { ...fy_2025, isCapitalActionAdjusted: true, periodEndDate: '2025-12-20' },
        { ...q1_2026_chg, weightedAvgSharesYTD: 100, isCapitalActionAdjusted: true },
      ],
      130
    );
    assert.equal(gapDatesStandalone.accountingEpsTtmEligibility.eligible, false);
    assert.equal(
      gapDatesStandalone.accountingEpsTtmEligibility.blockedCode,
      'standalone_q1_period_conflict'
    );

    const gapDatesYtd = resolveAudit(
      [
        { ...q1_2025, isCapitalActionAdjusted: true, weightedAvgSharesBasis: 'ytd_weighted_avg' },
        { ...fy_2025, isCapitalActionAdjusted: true, periodEndDate: '2025-12-20' },
        {
          ...q1_2026_chg,
          weightedAvgSharesYTD: 100,
          isCapitalActionAdjusted: true,
          weightedAvgSharesBasis: 'ytd_weighted_avg',
        },
      ],
      130
    );
    assert.equal(gapDatesYtd.accountingEpsTtmEligibility.eligible, false);
    assert.equal(gapDatesYtd.accountingEpsTtmEligibility.blockedCode, 'ttm_boundary_conflict');
  });

  it('keeps valuation EPS selection priority unchanged and exports Metric_Audit parity in Excel workbook', async () => {
    const q1_2025 = makeQuarterFin({
      year: 2025,
      quarter: 'Q1',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-03-31',
      netIncomeCommonYTD: 25,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
      isCapitalActionAdjusted: true,
    });
    const fy_2025 = makeQuarterFin({
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2025-01-01',
      periodEndDate: '2025-12-31',
      netIncomeCommonYTD: 120,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'ytd_weighted_avg',
      isCapitalActionAdjusted: true,
    });
    const q1_2026 = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      netIncomeCommonYTD: 35,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
      isCapitalActionAdjusted: true,
      reportedEps: 1.4,
      reportedEpsPeriodType: 'ttm',
      reportedEpsPeriodStart: '2025-04-01',
      reportedEpsPeriodEnd: '2026-03-31',
      reportedEpsPeriod: 'TTM (2025-04-01 → 2026-03-31)',
      reportedEpsSource: 'القوائم المالية Q1 2026',
    });

    const daily: DailyTradingRecord = {
      ticker: 'TEST',
      tradeDate: '2026-04-15',
      closePrice: 15,
      volume: 100000,
      valueTraded: 1500000,
      listedShares: 100,
      marketCap: 1500,
      currency: 'EGP',
    };

    const financials = [q1_2025, fy_2025, q1_2026];
    const metrics = calculateTTMMetrics(TEST_COMPANY, financials, daily);
    const val = runValuationModels(TEST_COMPANY, metrics, BASE_MACROS, {}, {
      sectorPE: 12,
      dailyRecords: [daily],
      quarterlyRecords: [],
      betaRecord: { ticker: 'TEST', beta: 1.0, asOfDate: '2026-04-01', source: 'EGX' },
      betaConfirmed: true,
    });

    // Valuation EPS selection priority remains completely untouched (Analytical Common EPS TTM = 130 / 100 = 1.30)
    assert.equal(metrics.metricAudit?.epsSelectionPolicy.perModel.targetPE.source, 'Analytical Common EPS TTM');
    assert.equal(metrics.metricAudit?.valuationEps.value, 1.3);
    assert.equal(metrics.metricAudit?.accountingEpsTtmEligibility.eligible, true);
    assert.equal(metrics.metricAudit?.accountingEpsTtmEligibility.usedQ1DocumentedEquivalence, true);
    assert.equal(metrics.metricAudit?.reportedVsAccountingComparison.status, 'discrepancy');

    const wb = await buildCompanyValuationWorkbook(TEST_COMPANY, financials, metrics, val, []);
    const auditSheet = wb.Sheets['Metric_Audit'];
    assert.ok(auditSheet, 'Metric_Audit sheet must exist');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(auditSheet, { header: 1 });
    const serialized = JSON.stringify(rows);

    assert.match(serialized, /قرار أهلية AccountingEPS المركزي وأساس المتوسط المرجح/);
    assert.match(serialized, /مقبول \(eligible\)/);
    assert.match(serialized, /standalone_quarter/);
    assert.match(serialized, /q1_standalone_equivalent_to_ytd/);
  });

  it('exports blocked AccountingEPS remediation & missing fields table in Metric_Audit sheet when blocked', async () => {
    const q1MissingDates = makeQuarterFin({
      year: 2026,
      quarter: 'Q1',
      periodStartDate: null,
      periodEndDate: null,
      periodDays: 90,
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    const daily: DailyTradingRecord = {
      ticker: 'TEST',
      tradeDate: '2026-04-15',
      closePrice: 15,
      volume: 100000,
      valueTraded: 1500000,
      listedShares: 100,
      marketCap: 1500,
      currency: 'EGP',
    };

    const metrics = calculateTTMMetrics(TEST_COMPANY, [q1MissingDates], daily);
    const val = runValuationModels(TEST_COMPANY, metrics, BASE_MACROS, {}, {
      sectorPE: 12,
      dailyRecords: [daily],
      quarterlyRecords: [],
      betaRecord: { ticker: 'TEST', beta: 1.0, asOfDate: '2026-04-01', source: 'EGX' },
      betaConfirmed: true,
    });

    assert.equal(metrics.metricAudit?.accountingEpsLatestEligibility.eligible, false);
    assert.equal(
      metrics.metricAudit?.accountingEpsLatestEligibility.blockedCode,
      'standalone_q1_missing_dates'
    );

    const wb = await buildCompanyValuationWorkbook(TEST_COMPANY, [q1MissingDates], metrics, val, []);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Metric_Audit'], { header: 1 });
    const serialized = JSON.stringify(rows);
    assert.match(serialized, /محجوب \(blocked\)/);
    assert.match(serialized, /PeriodStartDate/);
    assert.match(serialized, /حقول AccountingEPS الناقصة أو المحجوبة/);
  });
});
