import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';

import {
  buildDividendYearStatusDocId,
  classifyInstrumentType,
  resolveSectorPeFromMap,
  sanitizeCompanyMetadataPatch,
  validateDividendYearStatusPayload,
  validateRecords,
} from '../src/core/contracts';
import {
  resolveDividendAnalyticsForStock,
  resolveRimRetentionValue,
} from '../src/core/domain/dividendAnalytics';
import {
  deriveStockUniverseDiagnostics,
  deriveStocksFromQuarterlyRecords,
} from '../src/core/domain/stockDerived';
import {
  buildImportPreview,
  parseQuarterlyFinancialsExcelDetailed,
} from '../src/core/imports';
import { computeComprehensiveValuation } from '../src/core/math/valuation';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import {
  buildCompanyValuationWorkbook,
  buildDailyTradingWorkbook,
  buildQuarterlyRecordsWorkbook,
} from '../src/utils/excelExport';
import { DividendRecordsTable } from '../src/modules/data-hub/DividendRecordsTable';
import { ValuationSourcesCard } from '../src/components/ValuationSourcesCard';
import { ValuationView } from '../src/components/ValuationView';
import type {
  Company,
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  DividendRecord,
  DividendYearStatusRecord,
  QuarterlyFinancialRecord,
} from '../src/types';
import type { QuarterlyFinancial, SectorDefinition } from '../src/types/financial';

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

function makeWorkbookFile(rows: unknown[][], sheetName = 'Sheet1', fileName = 'test.xlsx'): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([arr], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function makeQuarterFin(overrides: Partial<QuarterlyFinancial> = {}): QuarterlyFinancial {
  return {
    id: 'COMI_2025_FY',
    companyId: 'comi',
    year: 2025,
    quarter: 'FY',
    periodDate: '2025-12-31',
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 500_000_000,
    operatingProfitYTD: 400_000_000,
    netProfitYTD: 250_000_000,
    netIncomeCommonYTD: 250_000_000,
    netIncomeCommonBasis: 'explicit_common',
    operatingCashFlowYTD: 300_000_000,
    capexYTD: 50_000_000,
    dividendsPaidYTD: 100_000_000,
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

function makeQuarterRecord(overrides: Partial<QuarterlyFinancialRecord> = {}): QuarterlyFinancialRecord {
  return {
    ticker: 'COMI',
    stockName: 'CIB Egypt',
    yearQuarter: '2025FY',
    year: 2025,
    quarter: 'FY',
    shares: 100_000_000,
    intangibleAssets: null,
    totalAssets: 2_000_000_000,
    equity: 1_000_000_000,
    totalDebtWithoutTX: 200_000_000,
    totalLiabilities: 1_000_000_000,
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 500_000_000,
    ebitYTD: 400_000_000,
    pbtYTD: 320_000_000,
    netIncomeYTD: 250_000_000,
    netIncomeCommonYTD: 250_000_000,
    netIncomeCommonBasis: 'explicit_common',
    ocfYTD: 300_000_000,
    netInvestingCfYTD: -50_000_000,
    dividendsPaidYTD: 100_000_000,
    cash: 300_000_000,
    interestExpenseYTD: 20_000_000,
    financeCostsYTD: 20_000_000,
    interestIncomeYTD: 5_000_000,
    taxExpenseYTD: 70_000_000,
    interestPaidYTD: 18_000_000,
    capexYTD: 50_000_000,
    dateInsertData: '2026-03-01',
    financialUnit: 'base',
    financialCurrency: 'EGP',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'comi',
    ticker: 'COMI',
    nameAr: 'البنك التجاري الدولي',
    nameEn: 'CIB Egypt',
    sector: 'بنوك',
    sectorId: 'banks',
    sectorClassification: 'financial',
    marketPrice: 80,
    marketPriceSource: 'lastPrice',
    latestTradeDate: '2026-04-01',
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

function makeDailyRecord(overrides: Partial<DailyTradingRecord> = {}): DailyTradingRecord {
  return {
    ticker: 'COMI',
    shortName: 'التجاري الدولي',
    tradeDate: '2026-04-01',
    lastPrice: 80,
    changePct: 0,
    tradesCount: 100,
    openPrice: 79,
    closePrice: 80,
    turnoverValue: 1_000_000,
    netLiquidity: null,
    volume: 12_500,
    avgVolume5D: null,
    avgVolume30D: null,
    avgVolume90D: null,
    lowPrice: 78,
    highPrice: 81,
    sector: 'بنوك',
    totalBids: null,
    bidsCount: null,
    offersCount: null,
    totalOffers: null,
    avgVolume: null,
    high52W: null,
    low52W: null,
    prevClose: 79,
    marketCapThousands: null,
    vwap: null,
    peRatio: null,
    listedShares: 100_000_000,
    isinCode: 'EGS60121C018',
    inflowOrders: null,
    inflowVolume: null,
    inflowLiquidity: null,
    askTrades: null,
    askTradesVolume: null,
    outflowLiquidity: null,
    fullName: 'البنك التجاري الدولي',
    market: 'EGX',
    volChange5DPct: null,
    volChange30DPct: null,
    volChange90DPct: null,
    updatedAt: '2026-04-01T15:00:00.000Z',
    ...overrides,
  };
}

describe('Dividends Reliability, Retention Governance, Date Policy & Exports', () => {
  it('1) Special-only stock keeps ddmFairValue = null and dpsRegular = null (ignores raw uncleaned dpsCurrent)', () => {
    const company = makeCompany();
    const quarters = [makeQuarterFin({ dpsCurrent: 4.5 } as any)];
    const specialOnly: DividendRecord[] = [
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 3.25,
        asOfDate: '2026-03-15',
        distributionId: 'SPEC_ONLY_2025',
        recordType: 'special',
        approvalStatus: 'paid',
        distributionSemantics: 'standalone_event',
        currency: 'EGP',
      },
    ];

    const metrics = calculateTTMMetrics(company, quarters, {
      dividendRecords: specialOnly,
      cutoffDate: '2026-04-01',
    });
    assert.equal(metrics.dpsRegular, null);
    assert.equal(metrics.dpsSpecial, 3.25);
    assert.equal(metrics.dpsCurrent, 3.25);

    const val = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      quarterlyRecords: [],
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-03-01', source: 'EGX' },
      betaConfirmed: true,
    });
    assert.equal(val.ddmFairValue, null);
    const ddmStatus = val.sourcesSummary?.modelStatuses.find((m) => m.model === 'ddm');
    assert.equal(ddmStatus?.status, 'excluded');
    assert.match(ddmStatus?.reasonAr ?? '', /استثنائي|special|منتظم/i);

    const viewHtml = renderToStaticMarkup(
      React.createElement(ValuationView, {
        company,
        metrics: { ...metrics, wacc: val.engineOutputs?.wacc ?? null, costOfEquity: val.engineOutputs?.costOfEquity ?? null },
        valuation: val,
        assumptionPriority: 'company_first',
        onChangePriority: () => undefined,
        rimRetentionPolicy: 'rim_parameter',
        onChangeRimRetentionPolicy: () => undefined,
        onUpdateCompanyParams: () => undefined,
      })
    );
    // Must not display legacy 4.50 as Regular DPS
    assert.doesNotMatch(viewHtml, /4\.50 ج\.م/);
  });

  it('2) Legacy quarterly.dpsCurrent is permanently terminated even on raw uncleaned documents', () => {
    const legacyQuarters = [makeQuarterFin({ dpsCurrent: 1.8 } as any)];

    const terminated = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [],
      quarterlyRecords: legacyQuarters,
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });
    assert.equal(terminated.source, 'missing');
    assert.equal(terminated.legacyFallbackUsed, false);
    assert.equal(terminated.regularDps, null);

    const noDivRes = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [],
      dividendYearStatuses: [
        {
          ticker: 'COMI',
          fiscalYear: 2025,
          status: 'confirmed_no_dividend',
          confirmedSource: 'AGM Resolution',
          confirmedAt: '2026-03-25',
          notes: null,
        },
      ],
      quarterlyRecords: legacyQuarters,
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });
    assert.equal(noDivRes.source, 'confirmed_no_dividend');
    assert.equal(noDivRes.legacyFallbackUsed, false);
    assert.equal(noDivRes.regularDps, 0);
  });

  it('3) Enforces Common NI denominator (netIncomeCommonYTD vs explicit attestation) in parser, validator, and analytics', async () => {
    // 3a) Excel parser validates NetIncomeCommon_Basis strictly
    const badBasisFile = makeWorkbookFile([
      ['Ticker', 'StockName', 'YearQuarter', 'Year', 'Quarter', 'Shares', 'NetIncomeYTD', 'NetIncomeCommon_Basis', 'DateInsertData'],
      ['COMI', 'CIB', '2025FY', 2025, 'FY', 100, 200, 'bogus_basis', '2026-03-01'],
    ]);
    const badParsed = await parseQuarterlyFinancialsExcelDetailed(badBasisFile);
    assert.equal(badParsed.records.length, 0);
    assert.equal(badParsed.rejected.length, 1);
    assert.equal(badParsed.rejected[0].column, 'NetIncomeCommon_Basis');

    const goodFile = makeWorkbookFile([
      ['Ticker', 'StockName', 'YearQuarter', 'Year', 'Quarter', 'Shares', 'NetIncomeYTD', 'NetIncomeCommon_Basis', 'NetIncomeCommon_Note', 'DateInsertData'],
      ['COMI', 'CIB', '2025FY', 2025, 'FY', 100, 200, 'attested_net_income_equals_common', 'لا توجد حقوق أقلية', '2026-03-01'],
    ]);
    const goodParsed = await parseQuarterlyFinancialsExcelDetailed(goodFile);
    assert.equal(goodParsed.records.length, 1);
    assert.equal(goodParsed.records[0].netIncomeCommonBasis, 'attested_net_income_equals_common');
    assert.equal(goodParsed.records[0].netIncomeCommonNote, 'لا توجد حقوق أقلية');

    assert.throws(
      () =>
        validateRecords(
          [
            makeQuarterRecord({
              netIncomeCommonBasis: 'invalid_val' as any,
            }),
          ],
          true
        ),
      /NetIncomeCommon_Basis/
    );

    // 3b) Analytics rejects unattested netProfitYTD fallback, accepts explicit_common or attested_net_income_equals_common
    const completeStatus: DividendYearStatusRecord[] = [
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        status: 'complete',
        confirmedSource: 'EGX',
        confirmedAt: '2026-03-30',
        notes: null,
      },
    ];
    const divRec: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      cashDps: 1.0,
      asOfDate: '2026-03-20',
      distributionId: 'ANN_2025',
      recordType: 'regular',
      approvalStatus: 'approved',
      distributionSemantics: 'annual_total',
      totalDistributionAmount: 100_000_000,
      currency: 'EGP',
    };

    const unattested = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [divRec],
      dividendYearStatuses: completeStatus,
      quarterlyRecords: [
        makeQuarterFin({
          netProfitYTD: 250_000_000,
          netIncomeCommonYTD: null,
          netIncomeCommonBasis: null,
        }),
      ],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });
    assert.equal(unattested.fiscalYearIncomeSource, 'unavailable');
    assert.equal(unattested.historicalPayoutRatio, null);
    assert.equal(unattested.historicalRetentionSuitableForRim, false);

    const attested = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [divRec],
      dividendYearStatuses: completeStatus,
      quarterlyRecords: [
        makeQuarterFin({
          netProfitYTD: 250_000_000,
          netIncomeCommonYTD: null,
          netIncomeCommonBasis: 'attested_net_income_equals_common',
        }),
      ],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });
    assert.equal(attested.fiscalYearIncomeSource, 'netProfitYTD_attested_common');
    assert.ok(Math.abs((attested.historicalPayoutRatio ?? 0) - 0.4) < 1e-9);
    assert.ok(Math.abs((attested.historicalRetentionRatio ?? 0) - 0.6) < 1e-9);
    assert.equal(attested.historicalRetentionSuitableForRim, true);
  });

  it('4) Annual dividend completeness (unknown, partial, complete, confirmed_no_dividend) and conflict guards', () => {
    const divRec: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      cashDps: 1.0,
      asOfDate: '2026-03-20',
      distributionId: 'Q4_2025',
      recordType: 'regular',
      approvalStatus: 'paid',
      distributionSemantics: 'standalone_event',
      totalDistributionAmount: 100_000_000,
      currency: 'EGP',
    };
    const qFin = [makeQuarterFin({ netIncomeCommonYTD: 250_000_000 })];

    // partial -> audit-only partialPayoutRatio/partialRetentionRatio populated, official ratios remain null
    const partialRes = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [divRec],
      dividendYearStatuses: [
        {
          ticker: 'COMI',
          fiscalYear: 2025,
          status: 'partial',
          confirmedSource: null,
          confirmedAt: null,
          notes: 'ربع أول فقط',
        },
      ],
      quarterlyRecords: qFin,
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });
    assert.equal(partialRes.dividendYearStatus, 'partial');
    assert.equal(partialRes.historicalPayoutRatio, null);
    assert.equal(partialRes.historicalRetentionRatio, null);
    assert.ok(Math.abs((partialRes.partialPayoutRatio ?? 0) - 0.4) < 1e-9);
    assert.ok(Math.abs((partialRes.partialRetentionRatio ?? 0) - 0.6) < 1e-9);
    assert.equal(partialRes.historicalRetentionSuitableForRim, false);

    // confirmed_no_dividend -> regularDps=0, specialDps=0, totalDps=0, payout=0, retention=1
    const noDivRes = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [],
      dividendYearStatuses: [
        {
          ticker: 'COMI',
          fiscalYear: 2025,
          status: 'confirmed_no_dividend',
          confirmedSource: 'AGM Board',
          confirmedAt: '2026-03-28',
          notes: 'ترحيل كامل الأرباح',
        },
      ],
      quarterlyRecords: qFin,
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });
    assert.equal(noDivRes.source, 'confirmed_no_dividend');
    assert.equal(noDivRes.regularDps, 0);
    assert.equal(noDivRes.totalAttributableDividends, 0);
    assert.equal(noDivRes.historicalPayoutRatio, 0);
    assert.equal(noDivRes.historicalRetentionRatio, 1);
    assert.equal(noDivRes.historicalRetentionSuitableForRim, true);

    // Validator enforces confirmedSource on complete / confirmed_no_dividend
    assert.throws(
      () =>
        validateDividendYearStatusPayload({
          ticker: 'COMI',
          fiscalYear: 2025,
          status: 'confirmed_no_dividend',
          confirmedSource: '',
        }),
      /confirmedSource/
    );

    // Import preview rejects importing active (approved/paid) dividend into a year marked confirmed_no_dividend
    const statusDocId = buildDividendYearStatusDocId('COMI', 2025);
    const conflictPreview = buildImportPreview({
      sourceType: 'dividend',
      fileName: 'DPS_Actual.xlsx',
      sheetName: 'DPS_Actual',
      totalRows: 1,
      parsedRecords: [divRec],
      rejected: [],
      warnings: [],
      existingDocsMap: new Map([
        [
          `year_status::${statusDocId}`,
          { ticker: 'COMI', fiscalYear: 2025, status: 'confirmed_no_dividend' },
        ],
      ]),
    });
    assert.equal(conflictPreview.rejected.length, 1);
    assert.equal(conflictPreview.inserts.length, 0);
    assert.match(conflictPreview.rejected[0].reasonAr, /confirmed_no_dividend/);

    // UI DividendRecordsTable renders governance panel safely
    const tableHtml = renderToStaticMarkup(
      React.createElement(DividendRecordsTable, {
        records: [divRec],
        dividendYearStatuses: [
          {
            ticker: 'COMI',
            fiscalYear: 2025,
            status: 'complete',
            confirmedSource: 'EGX',
            confirmedAt: '2026-03-30',
            notes: null,
          },
        ],
        availableTickers: ['COMI'],
        selectedBaseTicker: 'COMI',
        userRole: 'admin',
        canEdit: true,
        onSaveDividendYearStatus: async () => undefined,
      })
    );
    assert.match(tableHtml, /dividend_year_statuses/);
    assert.match(tableHtml, /EGX/);
  });

  it('5) Negative historicalRetentionRatio stays unclamped and is blocked from automatic RIM feed', () => {
    const overPayoutRec: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      cashDps: 3.0,
      asOfDate: '2026-03-20',
      distributionId: 'OVER_PAYOUT',
      recordType: 'regular',
      approvalStatus: 'paid',
      distributionSemantics: 'annual_total',
      totalDistributionAmount: 300_000_000,
      currency: 'EGP',
    };
    const res = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [overPayoutRec],
      dividendYearStatuses: [
        {
          ticker: 'COMI',
          fiscalYear: 2025,
          status: 'complete',
          confirmedSource: 'EGX',
          confirmedAt: '2026-03-30',
          notes: null,
        },
      ],
      quarterlyRecords: [makeQuarterFin({ netIncomeCommonYTD: 200_000_000 })],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });
    // payout = 1.5 -> retention = -0.5 (UNCLAMPED!)
    assert.ok(Math.abs((res.historicalPayoutRatio ?? 0) - 1.5) < 1e-9);
    assert.ok(Math.abs((res.historicalRetentionRatio ?? 0) - -0.5) < 1e-9);
    assert.equal(res.historicalRetentionSuitableForRim, false);
    assert.match(res.historicalRetentionRimBlockReasonAr ?? '', /RIM_Retention/);

    const resolvedRim = resolveRimRetentionValue({
      policy: 'historical_retention',
      rimRetentionParam: 0.6,
      historicalRetentionRatio: res.historicalRetentionRatio,
      historicalRetentionSuitableForRim: res.historicalRetentionSuitableForRim,
      historicalRetentionBlockReasonAr: res.historicalRetentionRimBlockReasonAr,
    });
    assert.equal(resolvedRim.retention, null);
    assert.match(resolvedRim.noteAr ?? '', /RIM_Retention/);

    const comp = computeComprehensiveValuation(
      {
        ticker: 'COMI',
        marketPrice: 80,
        sharesOutstanding: 100_000_000,
        betaRaw: 1.0,
        betaStatus: 'actual',
        netIncomeTTM: 200_000_000,
        ocfTTM: 220_000_000,
        capexTTM: 20_000_000,
        fcfTTM: 200_000_000,
        totalEquity: 1_000_000_000,
        totalDebt: 100_000_000,
        cash: 200_000_000,
        dpsRegular: 3.0,
        dpsSpecial: 0,
        sector: 'بنوك',
        sectorClassification: 'financial',
        rimRetentionPolicy: 'minimum',
        historicalRetentionRatio: res.historicalRetentionRatio,
        historicalRetentionSuitableForRim: res.historicalRetentionSuitableForRim,
        historicalRetentionRimBlockReasonAr: res.historicalRetentionRimBlockReasonAr,
        financialCurrency: 'EGP',
        marketPriceCurrency: 'EGP',
      },
      BASE_MACROS
    );
    assert.equal(comp.rimValue, null);
    assert.equal(comp.activeRimRetentionUsed, null);
  });

  it('6) Per-company rimRetentionPolicy persists through metadata sanitization and overrides default policy per company', () => {
    const sanitized = sanitizeCompanyMetadataPatch({ rimRetentionPolicy: 'minimum' }, 'COMI');
    assert.ok(sanitized);
    assert.equal(sanitized.patch.rimRetentionPolicy, 'minimum');
    assert.throws(
      () => sanitizeCompanyMetadataPatch({ rimRetentionPolicy: 'invalid_policy' }, 'COMI'),
      /سياسة احتجاز نموذج RIM/
    );

    const companyWithMin = makeCompany({ ticker: 'COMI', id: 'comi', rimRetentionPolicy: 'minimum' });
    const companyWithParam = makeCompany({ ticker: 'ABUK', id: 'abuk', rimRetentionPolicy: undefined });
    const quartersComi = [makeQuarterFin({ companyId: 'comi', netIncomeCommonYTD: 250_000_000 })];
    const quartersAbuk = [makeQuarterFin({ companyId: 'abuk', netIncomeCommonYTD: 250_000_000 })];
    const divStatuses: DividendYearStatusRecord[] = [
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        status: 'complete',
        confirmedSource: 'EGX',
        confirmedAt: '2026-03-30',
        notes: null,
      },
      {
        ticker: 'ABUK',
        fiscalYear: 2025,
        status: 'complete',
        confirmedSource: 'EGX',
        confirmedAt: '2026-03-30',
        notes: null,
      },
    ];
    const divRecords: DividendRecord[] = [
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 2.0,
        asOfDate: '2026-03-20',
        distributionId: 'C1',
        recordType: 'regular',
        approvalStatus: 'paid',
        distributionSemantics: 'annual_total',
        totalDistributionAmount: 200_000_000, // payout = 0.80 -> hist retention = 0.20 < RIM_Retention 0.60
        currency: 'EGP',
      },
      {
        ticker: 'ABUK',
        fiscalYear: 2025,
        cashDps: 2.0,
        asOfDate: '2026-03-20',
        distributionId: 'A1',
        recordType: 'regular',
        approvalStatus: 'paid',
        distributionSemantics: 'annual_total',
        totalDistributionAmount: 200_000_000,
        currency: 'EGP',
      },
    ];

    const mComi = calculateTTMMetrics(companyWithMin, quartersComi, {
      dividendRecords: divRecords,
      dividendYearStatuses: divStatuses,
      cutoffDate: '2026-04-01',
    });
    const mAbuk = calculateTTMMetrics(companyWithParam, quartersAbuk, {
      dividendRecords: divRecords,
      dividendYearStatuses: divStatuses,
      cutoffDate: '2026-04-01',
    });

    const valComi = runValuationModels(companyWithMin, mComi, undefined, BASE_MACROS, {
      quarterlyRecords: [],
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-03-01', source: 'EGX' },
      betaConfirmed: true,
    });
    const valAbuk = runValuationModels(companyWithParam, mAbuk, undefined, BASE_MACROS, {
      quarterlyRecords: [],
      betaRecord: { ticker: 'ABUK', beta: 1.0, asOfDate: '2026-03-01', source: 'EGX' },
      betaConfirmed: true,
    });

    assert.equal(valComi.rimRetentionPolicy, 'minimum');
    assert.ok(Math.abs((valComi.sourcesSummary?.activeRimRetentionUsed ?? 0) - 0.2) < 1e-9);
    assert.equal(valAbuk.rimRetentionPolicy, 'rim_parameter');
    assert.equal(valAbuk.sourcesSummary?.activeRimRetentionUsed, 0.6);
  });

  it('7) Date policy filters daily sessions by tradeDate <= valuationDate and tracks approved vs paid dividend subsets', () => {
    const qRecs = [makeQuarterRecord({ ticker: 'COMI', year: 2025, quarter: 'FY' })];
    const dailyEarly = makeDailyRecord({ ticker: 'COMI', tradeDate: '2026-03-25', lastPrice: 72 });
    const dailyLate = makeDailyRecord({ ticker: 'COMI', tradeDate: '2026-04-10', lastPrice: 95 });

    const stocksAtCutoff = deriveStocksFromQuarterlyRecords(
      qRecs,
      [],
      [dailyEarly, dailyLate],
      {},
      { valuationDate: '2026-04-01' }
    );
    assert.equal(stocksAtCutoff[0].marketPrice, 72);
    assert.equal(stocksAtCutoff[0].latestTradeDate, '2026-03-25');

    const divApprovedLaterPayment: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      cashDps: 1.5,
      asOfDate: '2026-03-20',
      exDividendDate: '2026-04-05',
      recordDate: '2026-04-06',
      paymentDate: '2026-04-12',
      distributionId: 'APPROVED_NOT_YET_PAID',
      recordType: 'regular',
      approvalStatus: 'approved',
      distributionSemantics: 'standalone_event',
      totalDistributionAmount: 150_000_000,
      currency: 'EGP',
    };
    const divPaidOnTime: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      cashDps: 0.5,
      asOfDate: '2026-03-01',
      paymentDate: '2026-03-18',
      distributionId: 'PAID_TRANCHE',
      recordType: 'special',
      approvalStatus: 'paid',
      distributionSemantics: 'standalone_event',
      totalDistributionAmount: 50_000_000,
      currency: 'EGP',
    };

    const summary = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [divApprovedLaterPayment, divPaidOnTime],
      quarterlyRecords: [makeQuarterFin({ netIncomeCommonYTD: 250_000_000 })],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      valuationDate: '2026-04-01',
    });

    // Approved before valuationDate (even with paymentDate 2026-04-12) counts toward approved/paid regularDps & totalDps
    assert.equal(summary.regularDps, 1.5);
    assert.equal(summary.specialDps, 0.5);
    assert.equal(summary.totalDps, 2.0);
    // Paid-actual subset as of valuationDate excludes paymentDate > 2026-04-01
    assert.equal(summary.paidRecordsCount, 1);
    assert.equal(summary.paidTotalDps, 0.5);
    assert.equal(summary.paidAttributableDividends, 50_000_000);
  });

  it('8) Bare tickers classify as unknown while staying equity-eligible from quarterly records, and sector P/E conflicts disable P/E safely', () => {
    assert.equal(classifyInstrumentType({ ticker: 'ETEL' }).instrumentType, 'unknown');
    assert.equal(classifyInstrumentType({ ticker: 'EGB0001', shortName: 'سندات خزانة' }).instrumentType, 'bond');

    const diag = deriveStockUniverseDiagnostics(
      [makeQuarterRecord({ ticker: 'ETEL', stockName: 'المصرية للاتصالات' })],
      [],
      []
    );
    assert.equal(diag.stocks.length, 1);
    assert.equal(diag.excludedNonEquity.length, 0);

    const sectorDefs: SectorDefinition[] = [
      {
        sectorId: 'building_materials',
        nameAr: 'مواد بناء',
        aliases: ['التشييد ومواد البناء', 'أسمنت'],
        classification: 'non_financial',
        multiple: 9.0,
        status: 'active',
      },
    ];

    const conflictLookup = resolveSectorPeFromMap(
      { 'التشييد ومواد البناء': 9.0, أسمنت: 12.5 },
      'مواد بناء',
      'building_materials',
      sectorDefs
    );
    assert.equal(conflictLookup.conflictDetected, true);
    assert.equal(conflictLookup.multiple, null);
    assert.equal(conflictLookup.conflictingEntries.length, 2);

    // Duplicate active sectorPE definitions for the same alias also trigger conflict detection safely
    const duplicateDocConflict = resolveSectorPeFromMap(
      undefined,
      'أسمنت',
      null,
      [
        ...sectorDefs,
        {
          sectorId: 'cement_dup',
          nameAr: 'أسمنت',
          aliases: [],
          classification: 'non_financial',
          multiple: 12.5,
          status: 'active',
        },
      ]
    );
    assert.equal(duplicateDocConflict.conflictDetected, true);
    assert.equal(duplicateDocConflict.multiple, null);
    assert.equal(duplicateDocConflict.conflictingEntries.length, 2);

    // Valuation with conflicting sector P/E entries records conflict and surfaces alert in ValuationSourcesCard
    const company = makeCompany({ sector: 'أسمنت', sectorId: 'building_materials', sectorClassification: 'non_financial' });
    const metrics = calculateTTMMetrics(company, [makeQuarterFin({ netIncomeCommonYTD: 250_000_000 })], {
      dividendRecords: [],
      cutoffDate: '2026-04-01',
    });
    const val = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      quarterlyRecords: [],
      sectorPEMap: { 'التشييد ومواد البناء': 9.0, أسمنت: 12.5 },
      sectorDefinitions: sectorDefs,
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-03-01', source: 'EGX' },
      betaConfirmed: true,
    });
    assert.equal(val.sourcesSummary?.sectorPeConflictDetected, true);
    const sourcesHtml = renderToStaticMarkup(
      React.createElement(ValuationSourcesCard, { summary: val.sourcesSummary })
    );
    assert.match(sourcesHtml, /تعارض رقمي في مضاعف القطاع|sectorPE/);
  });

  it('9) Excel workbooks export extra.<key>, originalValues, Manual_Corrections sheet, safe formula/error text, and valuation audit rows', async () => {
    const schema: DailyTradingSchemaRecord = {
      schemaId: 's1',
      tradeDate: '2026-04-01',
      totalColumns: 2,
      updatedAt: '2026-04-01T10:00:00.000Z',
      columns: [
        { colId: 'col_1', index: 0, colLetter: 'A', headerName: 'الرمز', normalizedHeader: 'الرمز', mappedField: 'ticker' },
        { colId: 'col_2', index: 1, colLetter: 'B', headerName: 'مؤشر خام', normalizedHeader: 'مؤشر خام', mappedField: null },
      ],
    };
    const dailyRec = makeDailyRecord({
      schemaId: 's1',
      rawCells: {
        col_1: { v: 'COMI', t: 's' },
        col_2: { v: '#DIV/0!', t: 'e', f: 'A1/0' },
      },
      originalValues: { lastPrice: 78 },
      manualCorrections: {
        lastPrice: {
          field: 'lastPrice',
          originalValue: 78,
          correctedValue: 80,
          editedAt: '2026-04-01T12:00:00.000Z',
          reasonAr: 'تصحيح سعر الإغلاق',
        },
      },
    });
    (dailyRec as unknown as Record<string, unknown>).customDailyNote = 'ملاحظة مخصصة';

    const dWb = await buildDailyTradingWorkbook([dailyRec], { s1: schema });
    assert.ok(dWb.SheetNames.includes('Manual_Corrections'));
    const dHeaders = (XLSX.utils.sheet_to_json(dWb.Sheets['Daily_Trading'], { header: 1 }) as unknown[][])[0];
    assert.ok(dHeaders.includes('extra.customDailyNote'));
    assert.ok(dHeaders.includes('originalValues (القيم الأصلية)'));
    const dFirstRow = (XLSX.utils.sheet_to_json(dWb.Sheets['Daily_Trading'], { header: 1 }) as unknown[][])[1];
    assert.equal(typeof dFirstRow[1], 'string');
    assert.ok(String(dFirstRow[1]).startsWith('غير صالح'));

    const qRec = makeQuarterRecord({
      originalValues: { netIncomeCommonYTD: 240_000_000 },
      manualCorrections: {
        netIncomeCommonYTD: {
          field: 'netIncomeCommonYTD',
          originalValue: 240_000_000,
          correctedValue: 250_000_000,
          editedAt: '2026-03-05T09:00:00.000Z',
        },
      },
    });
    (qRec as unknown as Record<string, unknown>).extraBoardTag = 'audit_ok';
    const qWb = await buildQuarterlyRecordsWorkbook([qRec]);
    assert.ok(qWb.SheetNames.includes('Manual_Corrections'));
    const qHeaders = (XLSX.utils.sheet_to_json(qWb.Sheets['Quarterly_Financials'], { header: 1 }) as unknown[][])[0];
    assert.ok(qHeaders.includes('NetIncomeCommon_Basis'));
    assert.ok(qHeaders.includes('extra.extraBoardTag'));
    assert.ok(qHeaders.includes('originalValues (القيم الأصلية)'));
    const mcRows = XLSX.utils.sheet_to_json(qWb.Sheets['Manual_Corrections'], { header: 1 }) as unknown[][];
    assert.equal(mcRows.length, 2);

    const company = makeCompany({ rimRetentionPolicy: 'minimum', sector: 'أسمنت', sectorId: 'building_materials', sectorClassification: 'non_financial' });
    const metrics = calculateTTMMetrics(company, [makeQuarterFin({ netIncomeCommonYTD: 250_000_000 })], {
      dividendRecords: [],
      dividendYearStatuses: [
        {
          ticker: 'COMI',
          fiscalYear: 2025,
          status: 'confirmed_no_dividend',
          confirmedSource: 'AGM Board',
          confirmedAt: '2026-03-28',
          notes: null,
        },
      ],
      cutoffDate: '2026-04-01',
    });
    const val = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      quarterlyRecords: [],
      sectorPEMap: { 'التشييد ومواد البناء': 9.0, أسمنت: 12.5 },
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-03-01', source: 'EGX' },
      betaConfirmed: true,
      valuationDate: '2026-04-01',
    });
    const cWb = await buildCompanyValuationWorkbook(company, [makeQuarterFin()], metrics, val, []);
    const summaryRows = XLSX.utils.sheet_to_json(cWb.Sheets['ملخص التقييم'], { header: 1 }) as unknown[][];
    const joined = summaryRows.map((r) => r.join(' | ')).join('\n');
    assert.match(joined, /confirmed_no_dividend/);
    assert.match(joined, /تاريخ التقييم المعتمد/);
    assert.match(joined, /تعارض مضاعف ربحية القطاع/);
  });
});
