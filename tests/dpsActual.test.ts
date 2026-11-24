import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';

import {
  buildDividendDocId,
  computeRecordBusinessHash,
  IMPORT_SAFE_CHUNK_SIZES,
  validateDividendRecords,
} from '../src/core/contracts';
import {
  resolveDividendAnalyticsForStock,
  resolveRimRetentionValue,
} from '../src/core/domain/dividendAnalytics';
import { FirestoreSessionManager } from '../src/core/domain/firestoreSessionManager';
import { deriveStocksFromQuarterlyRecords } from '../src/core/domain/stockDerived';
import { buildImportPreview, parseDpsActualExcelFile } from '../src/core/imports';
import { computeComprehensiveValuation } from '../src/core/math/valuation';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { ValuationSourcesCard } from '../src/components/ValuationSourcesCard';
import { ValuationView } from '../src/components/ValuationView';
import type {
  Company,
  DividendRecord,
  QuarterlyFinancialRecord,
} from '../src/types';
import type { QuarterlyFinancial } from '../src/types/financial';

const BASE_MACROS: Record<string, number> = {
  TaxRate: 0.225,
  Rf_Egypt_10Y: 0.2,
  ERP_Developed: 0.05,
  CRP_Egypt: 0.05,
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
  Weight_DCF: 40,
  Weight_DDM: 20,
  Weight_RIM: 20,
  Weight_Relative: 10,
  Weight_Graham: 10,
  Beta_Raw_Weight: 1,
  Beta_Anchor: 1,
  Country_Risk_Lambda: 1,
  RIM_Retention: 0.6,
  Relative_PE_Weight: 0.5,
  Relative_PB_Weight: 0.5,
};

function makeWorkbookFile(rows: unknown[][], sheetName = 'DPS_Actual', fileName = 'DPS_Actual.xlsx'): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([arr], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function makeQuarter(overrides: Partial<QuarterlyFinancial> = {}): QuarterlyFinancial {
  return {
    id: 'COMI_2025_FY',
    companyId: 'COMI',
    year: 2025,
    quarter: 'FY',
    periodDate: '2025-12-31',
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 500_000_000,
    operatingProfitYTD: 400_000_000,
    netProfitYTD: 250_000_000,
    operatingCashFlowYTD: 300_000_000,
    capexYTD: 50_000_000,
    dividendsPaidYTD: 150_000_000,
    totalAssets: 2_000_000_000,
    totalDebt: 200_000_000,
    cashAndEquivalents: 300_000_000,
    totalEquity: 1_000_000_000,
    sharesCount: 100_000_000,
    financialCurrency: 'EGP',
    financialUnit: 'base',
    isAudited: true,
    ...overrides,
  };
}

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'COMI',
    ticker: 'COMI',
    nameAr: 'البنك التجاري الدولي',
    nameEn: 'CIB Egypt',
    sector: 'بنوك',
    sectorClassification: 'financial',
    marketPrice: 80,
    sharesOutstanding: 100_000_000,
    beta: 1.0,
    riskFreeRate: 0.2,
    equityRiskPremium: 0.05,
    costOfDebt: 0.16,
    taxRate: 0.225,
    targetDebtRatio: null,
    sustainableGrowthRate: 0.05,
    shortTermGrowthRate: null,
    targetPE: 8,
    targetPB: 1.5,
    currency: 'EGP',
    ...overrides,
  };
}

describe('Part 3: DPS_Actual Importer, Governance & Valuation Integration', () => {
  it('1) Contracts & Batch Limits: buildDividendDocId, validation, and deterministic hashing', () => {
    const docId = buildDividendDocId({
      ticker: 'comi.ca',
      fiscalYear: 2025,
      recordType: 'regular',
      distributionId: 'FY2025 FINAL',
    });
    assert.equal(docId, 'COMI_2025_regular_FY2025_FINAL');

    assert.equal(IMPORT_SAFE_CHUNK_SIZES.dividend, 350);

    const validated = validateDividendRecords([
      {
        ticker: 'COMI.CA',
        fiscalYear: 2025,
        cashDps: 0,
        asOfDate: '2026-03-20',
        recordType: 'regular',
        approvalStatus: 'approved',
        distributionSemantics: 'annual_total',
        distributionId: 'FY2025_FINAL',
        currency: 'EGP',
      },
    ]);
    assert.equal(validated.length, 1);
    assert.equal(validated[0].ticker, 'COMI');
    assert.equal(validated[0].cashDps, 0);

    assert.throws(
      () =>
        validateDividendRecords([
          {
            ticker: 'COMI',
            fiscalYear: 2025,
            cashDps: -1,
            asOfDate: '2026-03-20',
          },
        ]),
      /CashDPS/i
    );

    const h1 = computeRecordBusinessHash('dividend', validated[0]);
    const h2 = computeRecordBusinessHash('dividend', { ...validated[0], updatedAt: '2099-01-01' });
    assert.equal(h1, h2);
  });

  it('2) Excel Parser: preserves confirmed 0, rejects blank CashDPS & invalid dates & duplicates, flags semantics confirmation', async () => {
    const file = makeWorkbookFile([
      [
        'Ticker',
        'FiscalYear',
        'CashDPS',
        'AsOfDate',
        'RecordType',
        'ApprovalStatus',
        'Semantics',
        'DistributionId',
        'Currency',
      ],
      ['COMI.CA', 2025, 0, '2026-03-20', 'regular', 'approved', '', 'DIST_ZERO', 'EGP'],
      ['ABUK', 2025, 2.5, '2026-04-01', 'special', 'paid', 'standalone_event', 'SPEC_1', 'EGP'],
      ['EFID', 2025, '', '2026-04-01', 'regular', 'approved', 'annual_total', 'BLANK_DPS', 'EGP'],
      ['HRHO', 2025, 1.2, '2026-02-30', 'regular', 'approved', 'annual_total', 'BAD_DATE', 'EGP'],
      ['COMI', 2025, 0.5, '2026-03-20', 'regular', 'approved', 'annual_total', 'DIST_ZERO', 'EGP'],
    ]);

    const parsed = await parseDpsActualExcelFile(file, { defaultSemantics: 'annual_total' });
    assert.equal(parsed.totalRows, 5);
    assert.equal(parsed.records.length, 2);
    assert.equal(parsed.rejected.length, 3);
    assert.equal(parsed.requiresSemanticsConfirmation, true);
    assert.equal(parsed.defaultSemanticsUsed, 'annual_total');

    // Preserved 0 on CashDPS + applied fallback semantics
    assert.equal(parsed.records[0].ticker, 'COMI');
    assert.equal(parsed.records[0].cashDps, 0);
    assert.equal(parsed.records[0].distributionSemantics, 'annual_total');

    assert.equal(parsed.records[1].ticker, 'ABUK');
    assert.equal(parsed.records[1].recordType, 'special');
    assert.equal(parsed.records[1].cashDps, 2.5);

    // Rejected reasons
    assert.equal(parsed.rejected[0].column, 'CashDPS');
    assert.equal(parsed.rejected[1].column, 'AsOfDate');
    assert.equal(parsed.rejected[2].column, 'DistributionId');

    // Arabic column aliases
    const arFile = makeWorkbookFile([
      ['الرمز', 'السنة المالية', 'التوزيع النقدي للسهم', 'تاريخ السريان', 'نوع التوزيع', 'حالة الاعتماد', 'دلالة التوزيع'],
      ['TMGH', 2025, 0.75, '2026-03-15', 'عادي', 'معتمد', 'إجمالي سنوي'],
    ]);
    const arParsed = await parseDpsActualExcelFile(arFile);
    assert.equal(arParsed.records.length, 1);
    assert.equal(arParsed.records[0].ticker, 'TMGH');
    assert.equal(arParsed.records[0].recordType, 'regular');
    assert.equal(arParsed.records[0].approvalStatus, 'approved');
    assert.equal(arParsed.records[0].distributionSemantics, 'annual_total');
  });

  it('3) Anti-Double-Counting, Cutoff Discipline, Status, Currency & Regular/Special Split', () => {
    const records: DividendRecord[] = [
      // Annual total wins over installments in same (2025, regular) bucket
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 2.0,
        asOfDate: '2026-03-20',
        distributionId: 'FY2025_ANN',
        recordType: 'regular',
        approvalStatus: 'approved',
        distributionSemantics: 'annual_total',
        currency: 'EGP',
      },
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 0.8,
        asOfDate: '2025-10-01',
        distributionId: 'FY2025_Q3_TRANCHE',
        recordType: 'regular',
        approvalStatus: 'paid',
        distributionSemantics: 'installment',
        currency: 'EGP',
      },
      // Special dividend in same year kept separate
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 1.0,
        asOfDate: '2026-03-25',
        distributionId: 'FY2025_SPEC',
        recordType: 'special',
        approvalStatus: 'paid',
        distributionSemantics: 'standalone_event',
        currency: 'EGP',
      },
      // Cancelled dividend excluded
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 5.0,
        asOfDate: '2026-03-10',
        distributionId: 'FY2025_CANCELLED',
        recordType: 'regular',
        approvalStatus: 'cancelled',
        distributionSemantics: 'standalone_event',
        currency: 'EGP',
      },
      // Future record past cutoffDate excluded
      {
        ticker: 'COMI',
        fiscalYear: 2026,
        cashDps: 4.0,
        asOfDate: '2026-12-01',
        recordDate: '2026-12-10',
        distributionId: 'FY2026_FUTURE',
        recordType: 'regular',
        approvalStatus: 'approved',
        distributionSemantics: 'annual_total',
        currency: 'EGP',
      },
      // Wrong currency excluded
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 0.5,
        asOfDate: '2026-03-01',
        distributionId: 'FY2025_USD',
        recordType: 'special',
        approvalStatus: 'approved',
        distributionSemantics: 'standalone_event',
        currency: 'USD',
      },
    ];

    const summaryWithoutAttr = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: records,
      quarterlyRecords: [makeQuarter({ netProfitYTD: 500_000_000 })],
      sharesOutstanding: 100_000_000,
      netIncomeTTM: 999_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });

    assert.equal(summaryWithoutAttr.source, 'dividend_records');
    assert.equal(summaryWithoutAttr.targetFiscalYear, 2025);
    assert.equal(summaryWithoutAttr.regularDps, 2.0);
    assert.equal(summaryWithoutAttr.specialDps, 1.0);
    assert.equal(summaryWithoutAttr.totalDps, 3.0);
    // Strict governance: never multiply cashDps * sharesOutstanding when totalDistributionAmount & eligibleSharesCount are absent
    assert.equal(summaryWithoutAttr.totalAttributableDividends, null);
    assert.equal(summaryWithoutAttr.attributableBasis, 'unavailable');
    assert.equal(summaryWithoutAttr.historicalPayoutRatio, null);
    assert.equal(summaryWithoutAttr.historicalRetentionRatio, null);

    const recordsWithAttr = records.map((r) => ({ ...r, eligibleSharesCount: 100_000_000 }));
    // Without dividendYearStatus='complete' and without netIncomeCommonYTD/attestation -> official payout/retention are blocked (null)
    const unconfirmedSummary = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: recordsWithAttr,
      quarterlyRecords: [makeQuarter({ netProfitYTD: 500_000_000 })],
      sharesOutstanding: 120_000_000,
      netIncomeTTM: 999_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });
    assert.equal(unconfirmedSummary.dividendYearStatus, 'unknown');
    assert.equal(unconfirmedSummary.fiscalYearIncomeUsed, null);
    assert.equal(unconfirmedSummary.historicalPayoutRatio, null);
    assert.equal(unconfirmedSummary.historicalRetentionRatio, null);

    // With explicit NetIncomeCommon_YTD and confirmed complete dividendYearStatus -> computes official payout/retention against FY common NI
    const summary = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: recordsWithAttr,
      dividendYearStatuses: [
        {
          ticker: 'COMI',
          fiscalYear: 2025,
          status: 'complete',
          confirmedSource: 'EGX AGM',
          confirmedAt: '2026-03-30',
          notes: null,
        },
      ],
      quarterlyRecords: [
        makeQuarter({
          netProfitYTD: 500_000_000,
          netIncomeCommonYTD: 500_000_000,
          netIncomeCommonBasis: 'explicit_common',
        }),
      ],
      sharesOutstanding: 120_000_000,
      netIncomeTTM: 999_000_000, // ignored for payout; FY 2025 netIncomeCommonYTD (500M) must be used
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });

    assert.equal(summary.dividendYearStatus, 'complete');
    assert.equal(summary.totalAttributableDividends, 300_000_000);
    assert.equal(summary.attributableBasis, 'cash_dps_x_eligible_shares');
    assert.equal(summary.fiscalYearIncomeUsed, 500_000_000);
    assert.equal(summary.fiscalYearIncomeSource, 'netIncomeCommonYTD');
    assert.ok(Math.abs((summary.historicalPayoutRatio ?? 0) - 0.6) < 1e-9);
    assert.ok(Math.abs((summary.historicalRetentionRatio ?? 0) - 0.4) < 1e-9);
    assert.equal(summary.excludedCancelledCount, 1);
    assert.equal(summary.excludedFutureCount, 1);
    assert.equal(summary.excludedCurrencyMismatchCount, 1);
    assert.equal(summary.excludedDeduplicatedCount, 1);
    assert.equal(summary.legacyFallbackUsed, false);
  });

  it('4) Installment Deduplication via parentAnnouncementId & Distinct Tranche Sum', () => {
    const records: DividendRecord[] = [
      {
        ticker: 'ETEL',
        fiscalYear: 2025,
        cashDps: 1.5,
        asOfDate: '2026-03-01',
        distributionId: 'ANN_PARENT',
        recordType: 'regular',
        approvalStatus: 'approved',
        distributionSemantics: 'standalone_event',
      },
      {
        ticker: 'ETEL',
        fiscalYear: 2025,
        cashDps: 0.75,
        asOfDate: '2026-03-15',
        distributionId: 'TRANCHE_1',
        parentAnnouncementId: 'ANN_PARENT',
        recordType: 'regular',
        approvalStatus: 'paid',
        distributionSemantics: 'installment',
      },
      {
        ticker: 'ETEL',
        fiscalYear: 2025,
        cashDps: 0.5,
        asOfDate: '2026-04-10',
        distributionId: 'EXTRA_REGULAR',
        recordType: 'regular',
        approvalStatus: 'paid',
        distributionSemantics: 'standalone_event',
      },
    ];

    const summary = resolveDividendAnalyticsForStock({
      ticker: 'ETEL',
      dividendRecords: records,
      sharesOutstanding: 1_000_000,
      netIncomeTTM: 10_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-05-01',
    });

    // ANN_PARENT (1.5) + EXTRA_REGULAR (0.5) = 2.0; TRANCHE_1 suppressed because parentAnnouncementId present
    assert.equal(summary.regularDps, 2.0);
    assert.equal(summary.excludedDeduplicatedCount, 1);
  });

  it('5) Legacy quarterly.dpsCurrent Termination & Strict Stock List Single Source of Truth', () => {
    // 5a) Empty dividend_records -> NEVER falls back to uncleaned legacy quarterly.dpsCurrent
    const rawLegacyQuarter = { ...makeQuarter(), dpsCurrent: 1.5 } as any;
    const noFallbackSummary = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [],
      quarterlyRecords: [rawLegacyQuarter],
      sharesOutstanding: 100_000_000,
      netIncomeTTM: 250_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-05-01',
    });
    assert.equal(noFallbackSummary.source, 'missing');
    assert.equal(noFallbackSummary.legacyFallbackUsed, false);
    assert.equal(noFallbackSummary.regularDps, null);

    // 5b) dividend_records has rows for ticker, all excluded -> NO fallback and counts exclusions
    const allExcludedSummary = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [
        {
          ticker: 'COMI',
          fiscalYear: 2026,
          cashDps: 5.0,
          asOfDate: '2027-01-01',
          distributionId: 'FUTURE_1',
          recordType: 'regular',
          approvalStatus: 'approved',
          distributionSemantics: 'annual_total',
        },
      ],
      quarterlyRecords: [rawLegacyQuarter],
      sharesOutstanding: 100_000_000,
      netIncomeTTM: 250_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-05-01',
    });
    assert.equal(allExcludedSummary.source, 'missing');
    assert.equal(allExcludedSummary.legacyFallbackUsed, false);
    assert.equal(allExcludedSummary.regularDps, null);
    assert.equal(allExcludedSummary.excludedFutureCount, 1);

    // 5c) Stock list comes ONLY from quarterly_financial_records, never from dividend-only tickers
    const qRecs: QuarterlyFinancialRecord[] = [
      {
        ticker: 'COMI',
        stockName: 'CIB',
        sector: 'بنوك',
        year: 2025,
        quarter: 'FY',
        revenueYTD: 1000,
        grossProfitYTD: 500,
        operatingProfitYTD: 400,
        netProfitYTD: 250,
        operatingCashFlowYTD: 300,
        capexYTD: 50,
        dividendsPaidYTD: null,
        totalAssets: 2000,
        totalDebt: 200,
        cashAndEquivalents: 300,
        totalEquity: 1000,
        shares: 100,
        financialCurrency: 'EGP',
        financialUnit: 'base',
        dateInsertData: '2026-02-01',
      },
    ];
    const derivedStocks = deriveStocksFromQuarterlyRecords(qRecs, [], {});
    assert.deepEqual(
      derivedStocks.map((s) => s.ticker),
      ['COMI']
    );
  });

  it('6) DDM Regular-Only + Confirmed Zero vs Unavailable + RIM Retention Policies', () => {
    const company = makeCompany();
    const quarters = [makeQuarter()];

    // Confirmed 0 regular DPS + positive special DPS -> DDM must remain excluded with explicit zero reason
    const zeroRegDividends: DividendRecord[] = [
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 0,
        asOfDate: '2026-03-20',
        distributionId: 'REG_ZERO',
        recordType: 'regular',
        approvalStatus: 'approved',
        distributionSemantics: 'annual_total',
        currency: 'EGP',
      },
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 2.0,
        asOfDate: '2026-03-20',
        distributionId: 'SPEC_TWO',
        recordType: 'special',
        approvalStatus: 'paid',
        distributionSemantics: 'standalone_event',
        currency: 'EGP',
      },
    ];

    const metricsZeroReg = calculateTTMMetrics(company, quarters, {
      dividendRecords: zeroRegDividends,
      cutoffDate: '2026-04-01',
    });
    assert.equal(metricsZeroReg.dpsRegular, 0);
    assert.equal(metricsZeroReg.dpsSpecial, 2.0);
    assert.equal(metricsZeroReg.dividendYieldRegular, 0);
    assert.ok(Math.abs((metricsZeroReg.dividendYieldTotal ?? 0) - 2.5) < 1e-6);

    const valZeroReg = runValuationModels(company, metricsZeroReg, undefined, BASE_MACROS, {
      quarterlyRecords: [],
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
      betaConfirmed: true,
    });
    assert.equal(valZeroReg.ddmFairValue, null);
    const ddmStatus = valZeroReg.sourcesSummary?.modelStatuses.find((m) => m.model === 'ddm');
    assert.equal(ddmStatus?.status, 'excluded');
    assert.match(ddmStatus?.reasonAr ?? '', /صفراً|0/);

    // RIM Retention Policy modes: rim_parameter (0.6) vs historical_retention vs minimum
    // totalAttributableDividends = 2.0 * 100M = 200M; netIncome = 250M -> payout = 0.80 -> historicalRetention = 0.20
    const rimParamResolved = resolveRimRetentionValue({
      policy: 'rim_parameter',
      rimRetentionParam: 0.6,
      historicalRetentionRatio: 0.2,
    });
    assert.equal(rimParamResolved.retention, 0.6);

    const histResolved = resolveRimRetentionValue({
      policy: 'historical_retention',
      rimRetentionParam: 0.6,
      historicalRetentionRatio: 0.2,
    });
    assert.ok(Math.abs((histResolved.retention ?? 0) - 0.2) < 1e-9);

    const minResolved = resolveRimRetentionValue({
      policy: 'minimum',
      rimRetentionParam: 0.6,
      historicalRetentionRatio: 0.2,
    });
    assert.ok(Math.abs((minResolved.retention ?? 0) - 0.2) < 1e-9);

    const engineRimParam = computeComprehensiveValuation(
      {
        ticker: 'COMI',
        marketPrice: 80,
        sharesOutstanding: 100_000_000,
        betaRaw: 1.0,
        betaStatus: 'actual',
        netIncomeTTM: 250_000_000,
        ocfTTM: 300_000_000,
        capexTTM: 50_000_000,
        fcfTTM: 250_000_000,
        totalEquity: 1_000_000_000,
        totalDebt: 200_000_000,
        cash: 300_000_000,
        dpsRegular: 1.5,
        dpsSpecial: 0.5,
        sector: 'بنوك',
        sectorClassification: 'financial',
        rimRetentionPolicy: 'rim_parameter',
        historicalRetentionRatio: 0.2,
        financialCurrency: 'EGP',
        marketPriceCurrency: 'EGP',
      },
      BASE_MACROS
    );

    const engineRimHist = computeComprehensiveValuation(
      {
        ticker: 'COMI',
        marketPrice: 80,
        sharesOutstanding: 100_000_000,
        betaRaw: 1.0,
        betaStatus: 'actual',
        netIncomeTTM: 250_000_000,
        ocfTTM: 300_000_000,
        capexTTM: 50_000_000,
        fcfTTM: 250_000_000,
        totalEquity: 1_000_000_000,
        totalDebt: 200_000_000,
        cash: 300_000_000,
        dpsRegular: 1.5,
        dpsSpecial: 0.5,
        sector: 'بنوك',
        sectorClassification: 'financial',
        rimRetentionPolicy: 'historical_retention',
        historicalRetentionRatio: 0.2,
        financialCurrency: 'EGP',
        marketPriceCurrency: 'EGP',
      },
      BASE_MACROS
    );

    assert.equal(engineRimParam.activeRimRetentionUsed, 0.6);
    assert.ok(Math.abs((engineRimHist.activeRimRetentionUsed ?? 0) - 0.2) < 1e-9);
    // Saved RIM_Retention parameter remains 0.6 untouched in resolvedAssumptions!
    assert.equal(engineRimHist.resolvedAssumptions.rimRetention?.value, 0.6);
  });

  it('7) Session Sync & Preview Engine: delta merge, tombstone deletion & DPS preview diffs', () => {
    const rec1: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      cashDps: 1.5,
      asOfDate: '2026-03-20',
      distributionId: 'D1',
      recordType: 'regular',
      approvalStatus: 'approved',
      distributionSemantics: 'annual_total',
    };
    const docId = buildDividendDocId(rec1);
    const existingMap = new Map<string, Record<string, any>>([
      [docId, { ...rec1, contentHash: computeRecordBusinessHash('dividend', rec1) }],
    ]);

    const preview = buildImportPreview({
      sourceType: 'dividend',
      fileName: 'DPS_Actual.xlsx',
      sheetName: 'DPS_Actual',
      totalRows: 2,
      parsedRecords: [
        rec1,
        {
          ...rec1,
          distributionId: 'D2',
          cashDps: 2.25,
        },
      ],
      rejected: [],
      warnings: [],
      existingDocsMap: existingMap,
      requiresSemanticsConfirmation: true,
      defaultSemanticsUsed: 'annual_total',
    });

    assert.equal(preview.unchanged.length, 1);
    assert.equal(preview.inserts.length, 1);
    assert.equal(preview.requiresSemanticsConfirmation, true);

    const mgr = new FirestoreSessionManager();
    const token = mgr.beginSession('user-test');
    const baseEmpty = {
      quarterly: [],
      companies: [],
      daily: [],
      stories: {},
      decisions: {},
      trades: [],
      macro: [],
      sectorPE: {},
    };
    mgr.applyManualSyncResult(token, {
      ...baseEmpty,
      dividendRecords: [rec1],
      isIncrementalDelta: false,
    });
    assert.equal(mgr.getState().dividendRecords.length, 1);
    assert.equal(mgr.getState().dividendConfirmed, true);

    mgr.applyManualSyncResult(token, {
      ...baseEmpty,
      dividendRecords: [],
      tombstones: [
        {
          id: `dividend_records__${docId}`,
          collection: 'dividend_records',
          docId,
          deletedAt: '2026-04-01T00:00:00.000Z',
          expiresAtMs: Date.now() + 60_000,
        },
      ],
      isIncrementalDelta: true,
    });
    assert.equal(mgr.getState().dividendRecords.length, 0);
  });

  it('8) UI SSR Verification: ValuationSourcesCard & ValuationView display Regular/Special DPS & RIM Policy', () => {
    const company = makeCompany();
    const quarters = [makeQuarter()];
    const divRecords: DividendRecord[] = [
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 1.5,
        asOfDate: '2026-03-20',
        distributionId: 'REG_2025',
        recordType: 'regular',
        approvalStatus: 'approved',
        distributionSemantics: 'annual_total',
        currency: 'EGP',
      },
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 0.75,
        asOfDate: '2026-03-22',
        distributionId: 'SPEC_2025',
        recordType: 'special',
        approvalStatus: 'paid',
        distributionSemantics: 'standalone_event',
        currency: 'EGP',
      },
    ];
    const metrics = calculateTTMMetrics(company, quarters, {
      dividendRecords: divRecords,
      cutoffDate: '2026-04-01',
    });
    const valuation = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      quarterlyRecords: [],
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
      betaConfirmed: true,
      rimRetentionPolicy: 'minimum',
    });

    const sourcesHtml = renderToStaticMarkup(
      React.createElement(ValuationSourcesCard, { summary: valuation.sourcesSummary })
    );
    assert.match(sourcesHtml, /DPS_Actual/);
    assert.match(sourcesHtml, /التوزيع العادي/);
    assert.match(sourcesHtml, /التوزيع الاستثنائي/);

    const viewHtml = renderToStaticMarkup(
      React.createElement(ValuationView, {
        company,
        metrics: {
          ...metrics,
          wacc: valuation.engineOutputs?.wacc ?? null,
          costOfEquity: valuation.engineOutputs?.costOfEquity ?? null,
        },
        valuation,
        assumptionPriority: 'company_first',
        onChangePriority: () => undefined,
        rimRetentionPolicy: 'minimum',
        onChangeRimRetentionPolicy: () => undefined,
        onUpdateCompanyParams: () => undefined,
      })
    );
    assert.match(viewHtml, /نموذج خصم التوزيعات|Regular DPS|DPS_Actual/);
  });
});
