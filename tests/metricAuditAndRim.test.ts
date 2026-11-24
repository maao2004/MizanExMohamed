import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';

import {
  resolveMetricAuditBundle,
  resolvePeriodCommonEquity,
  resolvePeriodCommonNetIncome,
} from '../src/core/domain/metricContracts';
import { ValuationSaveConcurrencyController } from '../src/core/domain/valuationSaveController';
import { computeComprehensiveValuation } from '../src/core/math/valuation';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import {
  buildCompanyValuationWorkbook,
  buildQuarterlyRecordsWorkbook,
} from '../src/utils/excelExport';
import { parseQuarterlyFinancialsExcelDetailed } from '../src/core/imports';
import { validateRecords } from '../src/core/contracts';
import { MetricAuditCard } from '../src/components/MetricAuditCard';
import { ValuationSourcesCard } from '../src/components/ValuationSourcesCard';
import { ValuationView } from '../src/components/ValuationView';
import type {
  Company,
  DailyTradingRecord,
  QuarterlyFinancialRecord,
} from '../src/types';
import type { QuarterlyFinancial } from '../src/types/financial';

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

function makeWorkbookFile(rows: unknown[][], sheetName = 'Sheet1', fileName = 'test.xlsx'): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([arr], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

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
  const year = overrides.year ?? 2025;
  const quarter = overrides.quarter ?? 'FY';
  const bounds = defaultPeriodBoundaries(year, quarter);
  return {
    id: 'COMI_2025_FY',
    companyId: 'comi',
    year,
    quarter,
    periodDate: bounds.end,
    periodStartDate: bounds.start,
    periodEndDate: bounds.end,
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 500_000_000,
    operatingProfitYTD: 400_000_000,
    netProfitYTD: 300_000_000,
    netIncomeCommonYTD: 250_000_000,
    netIncomeCommonBasis: 'explicit_common',
    operatingCashFlowYTD: 320_000_000,
    capexYTD: 50_000_000,
    dividendsPaidYTD: 80_000_000,
    totalAssets: 2_000_000_000,
    totalDebt: 200_000_000,
    cashAndEquivalents: 300_000_000,
    totalEquity: 1_200_000_000,
    commonEquity: 1_000_000_000,
    commonEquityBasis: 'explicit_common',
    sharesCount: 100_000_000,
    weightedAvgSharesYTD: 100_000_000,
    weightedAvgSharesBasis: 'ytd_weighted_avg',
    reportedEps: 2.5,
    reportedEpsSource: 'القوائم المدققة 2025',
    reportedEpsPeriod: 'FY 2025',
    isCapitalActionAdjusted: true,
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
    equity: 1_200_000_000,
    equityCommon: 1_000_000_000,
    equityCommonBasis: 'explicit_common',
    equityCommonNote: 'خصم حقوق الأقلية 200 مليون',
    totalDebtWithoutTX: 200_000_000,
    totalLiabilities: 800_000_000,
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 500_000_000,
    ebitYTD: 400_000_000,
    pbtYTD: 350_000_000,
    netIncomeYTD: 300_000_000,
    netIncomeCommonYTD: 250_000_000,
    netIncomeCommonBasis: 'explicit_common',
    weightedAvgSharesYTD: 100_000_000,
    reportedEps: 2.5,
    reportedEpsSource: 'EGX Disclosure',
    reportedEpsPeriodType: 'fy',
    reportedEpsFiscalYear: 2025,
    reportedEpsPeriodStart: '2025-01-01',
    reportedEpsPeriodEnd: '2025-12-31',
    reportedEpsPeriod: 'FY 2025',
    isCapitalActionAdjusted: true,
    ocfYTD: 320_000_000,
    netInvestingCfYTD: -50_000_000,
    dividendsPaidYTD: 80_000_000,
    cash: 300_000_000,
    interestExpenseYTD: 20_000_000,
    financeCostsYTD: 20_000_000,
    interestIncomeYTD: 5_000_000,
    taxExpenseYTD: 50_000_000,
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
    marketPrice: 60,
    marketPriceSource: 'lastPrice',
    latestTradeDate: '2026-04-01',
    sharesOutstanding: 100_000_000,
    sharesSource: 'quarterly_record',
    sharesPeriod: 'FY 2025',
    beta: 1.0,
    riskFreeRate: 0.18,
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
    lastPrice: 60,
    changePct: 0,
    tradesCount: 100,
    openPrice: 59,
    closePrice: 60,
    turnoverValue: 1_000_000,
    netLiquidity: null,
    volume: 15_000,
    avgVolume5D: null,
    avgVolume30D: null,
    avgVolume90D: null,
    lowPrice: 58,
    highPrice: 61,
    sector: 'بنوك',
    totalBids: null,
    bidsCount: null,
    offersCount: null,
    totalOffers: null,
    avgVolume: null,
    high52W: null,
    low52W: null,
    prevClose: 59,
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

describe('Metric Accounting Basis Audit, RIM Clean Surplus & Save Concurrency', () => {
  it('1) Separates consolidated NetIncome from NetIncomeCommon (explicit vs attested vs unattested)', () => {
    const explicit = resolvePeriodCommonNetIncome(
      makeQuarterFin({ netProfitYTD: 300_000_000, netIncomeCommonYTD: 250_000_000, netIncomeCommonBasis: 'explicit_common' })
    );
    assert.equal(explicit.value, 250_000_000);
    assert.equal(explicit.basis, 'explicit_common');

    const attested = resolvePeriodCommonNetIncome(
      makeQuarterFin({ netProfitYTD: 300_000_000, netIncomeCommonYTD: null, netIncomeCommonBasis: 'attested_net_income_equals_common' })
    );
    assert.equal(attested.value, 300_000_000);
    assert.equal(attested.basis, 'attested_net_income_equals_common');

    const unattested = resolvePeriodCommonNetIncome(
      makeQuarterFin({ netProfitYTD: 300_000_000, netIncomeCommonYTD: null, netIncomeCommonBasis: null })
    );
    assert.equal(unattested.value, null);
    assert.equal(unattested.basis, 'unavailable');
    assert.match(unattested.unavailableReasonAr ?? '', /NetIncomeCommon_YTD/);
  });

  it('2) Keeps Current EOP shares distinct from WeightedAvgShares and flags quarterly-vs-daily mismatch', () => {
    const company = makeCompany({ sharesOutstanding: 100_000_000, sharesSource: 'quarterly_record' });
    const q = makeQuarterFin({
      sharesCount: 100_000_000,
      weightedAvgSharesYTD: 90_000_000,
      netProfitYTD: 270_000_000,
      netIncomeCommonYTD: 270_000_000,
    });
    const dailyMismatch = makeDailyRecord({ listedShares: 112_000_000, tradeDate: '2026-04-01' });

    const bundle = resolveMetricAuditBundle({
      company,
      financials: [q],
      latestDaily: dailyMismatch,
      netIncomeTTM: 270_000_000,
      finCurrencyAllowed: true,
    });

    assert.equal(bundle.accountingEpsLatest.value, 270_000_000 / 90_000_000); // 3.00
    assert.equal(bundle.analyticalEpsTTM.value, 270_000_000 / 100_000_000); // 2.70
    assert.equal(bundle.sharesAlignmentStatus, 'cross_source_mismatch');
    assert.match(bundle.sharesAlignmentNoteAr ?? '', /100,000,000|112,000,000/);

    // Missing WeightedAvgShares_Basis must withhold AccountingEPS while keeping Analytical EPS_TTM
    const unattestedWas = resolveMetricAuditBundle({
      company,
      financials: [{ ...q, weightedAvgSharesBasis: null }],
      latestDaily: dailyMismatch,
      netIncomeTTM: 270_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(unattestedWas.accountingEpsLatest.value, null);
    assert.match(unattestedWas.accountingEpsLatest.unavailableReasonAr ?? '', /WeightedAvgShares_Basis/);
    assert.equal(unattestedWas.analyticalEpsTTM.value, 2.7);
  });

  it('3) Enforces ReportedEPS vs AccountingEPS alignment, discrepancy detection, and period/capital-action withholding', () => {
    const company = makeCompany();

    const aligned = resolveMetricAuditBundle({
      company,
      financials: [
        makeQuarterFin({
          netIncomeCommonYTD: 250_000_000,
          weightedAvgSharesYTD: 100_000_000,
          reportedEps: 2.505,
          reportedEpsPeriod: 'FY 2025',
          isCapitalActionAdjusted: true,
        }),
      ],
      netIncomeTTM: 300_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(aligned.reportedVsAccountingComparison.status, 'aligned');

    const discrepancy = resolveMetricAuditBundle({
      company,
      financials: [
        makeQuarterFin({
          netIncomeCommonYTD: 250_000_000,
          weightedAvgSharesYTD: 100_000_000,
          reportedEps: 2.75,
          reportedEpsPeriod: 'FY 2025',
          isCapitalActionAdjusted: true,
        }),
      ],
      netIncomeTTM: 300_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(discrepancy.reportedVsAccountingComparison.status, 'discrepancy');
    assert.ok(Math.abs((discrepancy.reportedVsAccountingComparison.absoluteDifference ?? 0) - 0.25) < 1e-9);

    const periodMismatch = resolveMetricAuditBundle({
      company,
      financials: [
        makeQuarterFin({
          year: 2025,
          quarter: 'Q3',
          netIncomeCommonYTD: 180_000_000,
          weightedAvgSharesYTD: 100_000_000,
          reportedEps: 1.8,
          reportedEpsPeriod: 'Q2 2025',
        }),
      ],
      netIncomeTTM: null,
      finCurrencyAllowed: true,
    });
    assert.equal(periodMismatch.reportedVsAccountingComparison.status, 'withheld_period_or_basis_mismatch');

    const capActionMismatch = resolveMetricAuditBundle({
      company,
      financials: [
        makeQuarterFin({
          year: 2024,
          quarter: 'Q3',
          netIncomeCommonYTD: 150_000_000,
          weightedAvgSharesYTD: 100_000_000,
          isCapitalActionAdjusted: true,
        }),
        makeQuarterFin({
          year: 2024,
          quarter: 'FY',
          netIncomeCommonYTD: 220_000_000,
          weightedAvgSharesYTD: 100_000_000,
          isCapitalActionAdjusted: false,
        }),
        makeQuarterFin({
          year: 2025,
          quarter: 'Q3',
          netIncomeCommonYTD: 180_000_000,
          weightedAvgSharesYTD: 100_000_000,
          reportedEps: 2.5,
          reportedEpsPeriod: 'TTM 2025',
          isCapitalActionAdjusted: true,
        }),
      ],
      netIncomeTTM: 250_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(capActionMismatch.accountingEpsTTM.value, null);
    assert.match(capActionMismatch.accountingEpsTTM.unavailableReasonAr ?? '', /IsCapitalActionAdjusted/);
  });

  it('4) Derives YTD/FY/TTM AccountingEPS safely without naively summing WeightedAvgShares', () => {
    const company = makeCompany();
    // Different weightedAvgShares across periods WITHOUT IsCapitalActionAdjusted=true must block AccountingEPS TTM
    const unadjustedChange = resolveMetricAuditBundle({
      company,
      financials: [
        makeQuarterFin({ year: 2024, quarter: 'Q3', netIncomeCommonYTD: 150_000_000, weightedAvgSharesYTD: 90_000_000, isCapitalActionAdjusted: false }),
        makeQuarterFin({ year: 2024, quarter: 'FY', netIncomeCommonYTD: 210_000_000, weightedAvgSharesYTD: 95_000_000, isCapitalActionAdjusted: false }),
        makeQuarterFin({ year: 2025, quarter: 'Q3', netIncomeCommonYTD: 180_000_000, weightedAvgSharesYTD: 100_000_000, isCapitalActionAdjusted: false }),
      ],
      netIncomeTTM: 240_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(unadjustedChange.accountingEpsTTM.value, null);
    assert.match(unadjustedChange.accountingEpsTTM.unavailableReasonAr ?? '', /IsCapitalActionAdjusted/);

    // Missing period dates/days must block AccountingEPS TTM (no silent 3/6/9/12 fixed weights)
    const missingDays = resolveMetricAuditBundle({
      company,
      financials: [
        makeQuarterFin({ year: 2024, quarter: 'Q3', periodStartDate: null, periodEndDate: null, periodDays: null, netIncomeCommonYTD: 150_000_000, weightedAvgSharesYTD: 90_000_000, isCapitalActionAdjusted: true }),
        makeQuarterFin({ year: 2024, quarter: 'FY', periodStartDate: null, periodEndDate: null, periodDays: null, netIncomeCommonYTD: 210_000_000, weightedAvgSharesYTD: 95_000_000, isCapitalActionAdjusted: true }),
        makeQuarterFin({ year: 2025, quarter: 'Q3', periodStartDate: null, periodEndDate: null, periodDays: null, netIncomeCommonYTD: 180_000_000, weightedAvgSharesYTD: 100_000_000, isCapitalActionAdjusted: true }),
      ],
      netIncomeTTM: 240_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(missingDays.accountingEpsTTM.value, null);
    assert.match(missingDays.accountingEpsTTM.unavailableReasonAr ?? '', /PeriodStartDate|PeriodDays/);

    // Same periods WITH IsCapitalActionAdjusted=true & contiguous calendar dates derive exact calendar-weighted 12M shares:
    // 2024 Q3 = 274d (leap year), 2024 FY = 366d, 2025 Q3 = 273d => dRem = 92d, ttmDays = 365d
    const adjustedTimeWeighted = resolveMetricAuditBundle({
      company,
      financials: [
        makeQuarterFin({ year: 2024, quarter: 'Q3', netIncomeCommonYTD: 150_000_000, weightedAvgSharesYTD: 90_000_000, isCapitalActionAdjusted: true }),
        makeQuarterFin({ year: 2024, quarter: 'FY', netIncomeCommonYTD: 210_000_000, weightedAvgSharesYTD: 95_000_000, isCapitalActionAdjusted: true }),
        makeQuarterFin({ year: 2025, quarter: 'Q3', netIncomeCommonYTD: 180_000_000, weightedAvgSharesYTD: 100_000_000, isCapitalActionAdjusted: true }),
      ],
      netIncomeTTM: 240_000_000,
      finCurrencyAllowed: true,
    });
    const expectedCalendarShares12M = (273 * 100_000_000 + (366 * 95_000_000 - 274 * 90_000_000)) / 365;
    assert.ok(Math.abs((adjustedTimeWeighted.accountingEpsTTM.denominatorValue ?? 0) - expectedCalendarShares12M) < 1e-6);
    assert.ok(Math.abs((adjustedTimeWeighted.accountingEpsTTM.value ?? 0) - 240_000_000 / expectedCalendarShares12M) < 1e-9);
  });

  it('5) Separates CommonEquity vs TotalEquity across import/validator and prevents consolidated NI over CommonEquity in ROE/RIM', async () => {
    const badEqFile = makeWorkbookFile([
      ['Ticker', 'StockName', 'YearQuarter', 'Year', 'Quarter', 'Shares', 'Equity', 'EquityCommon_Basis', 'DateInsertData'],
      ['COMI', 'CIB', '2025FY', 2025, 'FY', 100, 500, 'invalid_eq_basis', '2026-03-01'],
    ]);
    const badEqRes = await parseQuarterlyFinancialsExcelDetailed(badEqFile);
    assert.equal(badEqRes.records.length, 0);
    assert.equal(badEqRes.rejected[0].column, 'EquityCommon_Basis');

    const goodEqFile = makeWorkbookFile([
      ['Ticker', 'StockName', 'YearQuarter', 'Year', 'Quarter', 'Shares', 'Equity', 'EquityCommon', 'EquityCommon_Basis', 'EquityCommon_Note', 'DateInsertData'],
      ['COMI', 'CIB', '2025FY', 2025, 'FY', 100_000_000, 1_200_000_000, 1_000_000_000, 'explicit_common', 'خصم الأقلية', '2026-03-01'],
    ]);
    const goodEqRes = await parseQuarterlyFinancialsExcelDetailed(goodEqFile);
    assert.equal(goodEqRes.records.length, 1);
    assert.equal(goodEqRes.records[0].equityCommon, 1_000_000_000);
    assert.equal(goodEqRes.records[0].equityCommonBasis, 'explicit_common');
    assert.equal(goodEqRes.records[0].equityCommonNote, 'خصم الأقلية');

    assert.throws(
      () => validateRecords([makeQuarterRecord({ equityCommonBasis: 'bogus' as any })], true),
      /EquityCommon_Basis/
    );

    const commonEqCheck = resolvePeriodCommonEquity(
      makeQuarterFin({ totalEquity: 1_200_000_000, commonEquity: null, commonEquityBasis: null })
    );
    assert.equal(commonEqCheck.value, null);
    assert.equal(commonEqCheck.basis, 'unavailable');

    // If EquityCommon IS attested/explicit, but NetIncomeCommon_YTD is unattested, Valuation ROE MUST withhold (never divide consolidated NI by CommonEquity)
    const scopeGuard = resolveMetricAuditBundle({
      company: makeCompany(),
      financials: [
        makeQuarterFin({
          netProfitYTD: 300_000_000,
          netIncomeCommonYTD: null,
          netIncomeCommonBasis: null,
          totalEquity: 1_200_000_000,
          commonEquity: 1_000_000_000,
          commonEquityBasis: 'explicit_common',
        }),
      ],
      netIncomeTTM: 300_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(scopeGuard.valuationBvps.value, 10);
    assert.equal(scopeGuard.valuationRoe.value, null);
    assert.equal(scopeGuard.valuationRoe.completenessStatus, 'mismatch');

    const comp = computeComprehensiveValuation(
      {
        ticker: 'COMI',
        marketPrice: 60,
        sharesOutstanding: 100_000_000,
        betaRaw: 1.0,
        betaStatus: 'actual',
        netIncomeTTM: 300_000_000,
        ocfTTM: 320_000_000,
        capexTTM: 50_000_000,
        fcfTTM: 270_000_000,
        totalEquity: 1_200_000_000,
        totalDebt: 200_000_000,
        cash: 300_000_000,
        sector: 'بنوك',
        sectorClassification: 'financial',
        epsUsed: scopeGuard.analyticalEpsTTM.value,
        bvpsUsed: scopeGuard.valuationBvps.value,
        bvpsBasis: scopeGuard.equityBasisForValuation,
        bvpsBasisLabelAr: scopeGuard.valuationBvps.basisLabelAr,
        roeUsed: scopeGuard.valuationRoe.value,
        roeBasis: scopeGuard.valuationRoe.basisCode,
        roeBasisLabelAr: scopeGuard.valuationRoe.basisLabelAr,
        metricAudit: scopeGuard,
      },
      BASE_MACROS
    );
    assert.equal(comp.rimValue, null);
    assert.equal(comp.rimAudit.eligible, false);
  });

  it('6) Separates chronological ROE Average Equity from ROE EOP without mixing scopes', () => {
    const company = makeCompany();
    const startFy = makeQuarterFin({
      year: 2024,
      quarter: 'FY',
      totalEquity: 900_000_000,
      commonEquity: 800_000_000,
      commonEquityBasis: 'explicit_common',
      netProfitYTD: 220_000_000,
      netIncomeCommonYTD: 200_000_000,
      netIncomeCommonBasis: 'explicit_common',
    });
    const endFy = makeQuarterFin({
      year: 2025,
      quarter: 'FY',
      totalEquity: 1_100_000_000,
      commonEquity: 1_000_000_000,
      commonEquityBasis: 'explicit_common',
      netProfitYTD: 280_000_000,
      netIncomeCommonYTD: 270_000_000,
      netIncomeCommonBasis: 'explicit_common',
    });

    const bothCommon = resolveMetricAuditBundle({
      company,
      financials: [startFy, endFy],
      netIncomeTTM: 280_000_000,
      finCurrencyAllowed: true,
    });
    // EOP Common ROE = 270 / 1000 = 0.27; Avg Common ROE = 270 / ((800 + 1000)/2) = 270 / 900 = 0.30
    assert.ok(Math.abs((bothCommon.roeCommonEop.value ?? 0) - 0.27) < 1e-9);
    assert.ok(Math.abs((bothCommon.roeAverageEquity.value ?? 0) - 0.3) < 1e-9);
    assert.equal(bothCommon.valuationRoe.value, bothCommon.roeCommonEop.value);
    assert.equal(bothCommon.roeAverageEquity.basisCode, 'common_average_equity');

    // Mixed start (no CommonEquity) + end (explicit CommonEquity) must fall back to consistent TotalEquity pair (900 & 1100), never mixing scopes!
    const mixedStart = makeQuarterFin({
      year: 2024,
      quarter: 'FY',
      totalEquity: 900_000_000,
      commonEquity: null,
      commonEquityBasis: null,
    });
    const noMix = resolveMetricAuditBundle({
      company,
      financials: [mixedStart, endFy],
      netIncomeTTM: 280_000_000,
      finCurrencyAllowed: true,
    });
    assert.equal(noMix.roeAverageEquity.basisCode, 'total_average_equity');
    assert.ok(Math.abs((noMix.roeAverageEquity.denominatorValue ?? 0) - 1_000_000_000) < 1e-6);
    assert.ok(Math.abs((noMix.roeAverageEquity.value ?? 0) - 0.28) < 1e-9);
  });

  it('7) End-to-end SSOT parity across metrics, valuation, UI audit cards, and Excel exports', async () => {
    const company = makeCompany({ sectorClassification: 'non_financial', sector: 'تصنيع', sectorId: 'industrial' });
    const qStart = makeQuarterFin({
      year: 2024,
      quarter: 'FY',
      totalEquity: 900_000_000,
      commonEquity: 800_000_000,
      commonEquityBasis: 'explicit_common',
      netIncomeCommonYTD: 200_000_000,
    });
    const qEnd = makeQuarterFin({
      year: 2025,
      quarter: 'FY',
      totalEquity: 1_200_000_000,
      commonEquity: 1_000_000_000,
      commonEquityBasis: 'explicit_common',
      netProfitYTD: 300_000_000,
      netIncomeCommonYTD: 250_000_000,
      weightedAvgSharesYTD: 95_000_000,
      sharesCount: 100_000_000,
      reportedEps: 2.63,
      reportedEpsPeriod: 'FY 2025',
    });

    const metrics = calculateTTMMetrics(company, [qStart, qEnd], {
      latestDaily: makeDailyRecord(),
      dividendRecords: [],
      cutoffDate: '2026-04-01',
    });
    const val = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      quarterlyRecords: [],
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-03-01', source: 'EGX' },
      betaConfirmed: true,
    });

    assert.equal(metrics.bvps, 10); // Common BVPS = 1000M / 100M
    assert.equal(val.rimAudit?.openingBvps, 10);
    assert.equal(val.rimAudit?.roeUsed, metrics.roe);
    assert.equal(val.sourcesSummary?.metricAudit?.valuationBvps.value, 10);

    const cardHtml = renderToStaticMarkup(
      React.createElement(MetricAuditCard, {
        metricAudit: metrics.metricAudit,
        finCurrencyLabel: 'ج.م',
        defaultExpanded: true,
      })
    );
    assert.match(cardHtml, /Analytical EPS_TTM/);
    assert.match(cardHtml, /AccountingEPS/);
    assert.match(cardHtml, /Common BVPS/);

    const sourcesHtml = renderToStaticMarkup(
      React.createElement(ValuationSourcesCard, { summary: val.sourcesSummary })
    );
    assert.match(sourcesHtml, /AccountingEPS \(TTM\)/);
    assert.match(sourcesHtml, /EquityCommon/);

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
        initialModelTab: 'rim',
      })
    );
    assert.match(viewHtml, /metric-audit-card/);
    assert.match(viewHtml, /rim-audit-schedule/);
    assert.match(viewHtml, /Clean[- ]Surplus/);

    const wb = await buildCompanyValuationWorkbook(company, [qStart, qEnd], metrics, val, []);
    assert.ok(wb.SheetNames.includes('Metric_Audit'));
    assert.ok(wb.SheetNames.includes('RIM_Audit'));
    assert.ok(wb.SheetNames.includes('ملخص التقييم'));

    const metricRows = XLSX.utils.sheet_to_json(wb.Sheets['Metric_Audit'], { header: 1 }) as unknown[][];
    assert.ok(metricRows.some((r) => r[0] === 'valuationRoe'));
    const rimRows = XLSX.utils.sheet_to_json(wb.Sheets['RIM_Audit'], { header: 1 }) as unknown[][];
    assert.ok(rimRows.some((r) => r[0] === 'Year' && r[1] === 'Opening BVPS'));

    const qWb = await buildQuarterlyRecordsWorkbook([makeQuarterRecord()]);
    const qHeaders = (XLSX.utils.sheet_to_json(qWb.Sheets['Quarterly_Financials'], { header: 1 }) as unknown[][])[0];
    assert.ok(qHeaders.includes('EquityCommon'));
    assert.ok(qHeaders.includes('EquityCommon_Basis'));
    assert.ok(qHeaders.includes('EquityCommon_Note'));
  });

  it('8) Verifies RIM 5-year Clean Surplus identity (B_t = B_{t-1} + E_t - D_t) and ROE===Ke => FairValue===B0 invariant', () => {
    // Missing RIM_Terminal_Method must exclude RIM rather than silently assuming Method 1
    const { RIM_Terminal_Method: _omitMethod, ...macrosWithoutMethod } = BASE_MACROS;
    const missingMethodComp = computeComprehensiveValuation(
      {
        ticker: 'COMI',
        marketPrice: 60,
        sharesOutstanding: 100_000_000,
        betaRaw: 1.0,
        betaStatus: 'actual',
        netIncomeTTM: 200_000_000,
        ocfTTM: 200_000_000,
        capexTTM: 0,
        fcfTTM: 200_000_000,
        totalEquity: 1_000_000_000,
        totalDebt: 0,
        cash: 0,
        sector: 'بنوك',
        sectorClassification: 'financial',
        bvpsUsed: 10,
        roeUsed: 0.2,
      },
      macrosWithoutMethod
    );
    assert.equal(missingMethodComp.rimValue, null);
    assert.equal(missingMethodComp.rimAudit.eligible, false);
    assert.match(missingMethodComp.rimAudit.exclusionReasonAr ?? '', /RIM_Terminal_Method/);

    const macrosList = [0, 0.4, 0.8].map((b) => ({
      ...BASE_MACROS,
      Rf_Egypt_10Y: 0.15,
      CRP_Egypt: 0,
      ERP_Developed: 0.05, // Ke = 0.15 + 1.0*0.05 = 0.20
      RIM_Retention: b,
    }));

    for (const macros of macrosList) {
      const comp = computeComprehensiveValuation(
        {
          ticker: 'COMI',
          marketPrice: 60,
          sharesOutstanding: 100_000_000,
          betaRaw: 1.0,
          betaStatus: 'actual',
          netIncomeTTM: 200_000_000,
          ocfTTM: 200_000_000,
          capexTTM: 0,
          fcfTTM: 200_000_000,
          totalEquity: 1_000_000_000,
          totalDebt: 0,
          cash: 0,
          sector: 'بنوك',
          sectorClassification: 'financial',
          bvpsUsed: 10,
          roeUsed: 0.2, // Exactly equal to Ke = 0.20
        },
        macros
      );
      assert.equal(comp.rimAudit.eligible, true);
      assert.equal(comp.rimAudit.cleanSurplusVerified, true);
      assert.equal(comp.rimAudit.years.length, 5);
      for (const row of comp.rimAudit.years) {
        const cleanDiff = Math.abs(row.closingBvps - (row.openingBvps + row.expectedEps - row.impliedDps));
        assert.ok(cleanDiff < 1e-10);
      }
      assert.ok(Math.abs((comp.rimValue ?? 0) - 10) < 1e-9);
    }
  });

  it('9) Isolates negative/non-positive EPS or BVPS cleanly across Relative, Graham, and RIM without cascading failure', () => {
    // Negative EPS + Positive BVPS: Graham excluded, Target_PE disabled, Relative still runs on Target_PB, RIM still runs!
    const negEps = computeComprehensiveValuation(
      {
        ticker: 'COMI',
        marketPrice: 40,
        sharesOutstanding: 100_000_000,
        betaRaw: 1.0,
        betaStatus: 'actual',
        netIncomeTTM: -50_000_000,
        ocfTTM: 20_000_000,
        capexTTM: 10_000_000,
        fcfTTM: 10_000_000,
        totalEquity: 1_000_000_000,
        totalDebt: 0,
        cash: 100_000_000,
        companyTargetPE: 10,
        companyTargetPB: 2.0,
        sector: 'بنوك',
        sectorClassification: 'financial',
      },
      BASE_MACROS
    );
    assert.equal(negEps.grahamValue, null);
    assert.ok(Math.abs((negEps.relativeValue ?? 0) - 20) < 1e-9); // BVPS=10 * Target_PB=2.0
    const relStatus = negEps.modelStatuses.find((m) => m.model === 'relative');
    assert.match(relStatus?.inputBasisSummaryAr ?? '', /Target_PB فقط/);

    // Negative BVPS: Target_PB disabled, Graham & RIM excluded cleanly without throwing
    const negBvps = computeComprehensiveValuation(
      {
        ticker: 'COMI',
        marketPrice: 40,
        sharesOutstanding: 100_000_000,
        betaRaw: 1.0,
        betaStatus: 'actual',
        netIncomeTTM: 100_000_000,
        ocfTTM: 120_000_000,
        capexTTM: 10_000_000,
        fcfTTM: 110_000_000,
        totalEquity: -200_000_000,
        totalDebt: 0,
        cash: 100_000_000,
        companyTargetPE: 10,
        companyTargetPB: 2.0,
        sector: 'بنوك',
        sectorClassification: 'financial',
      },
      BASE_MACROS
    );
    assert.equal(negBvps.grahamValue, null);
    assert.equal(negBvps.rimValue, null);
    assert.equal(negBvps.rimAudit.eligible, false);
    assert.ok(Math.abs((negBvps.relativeValue ?? 0) - 10) < 1e-9); // EPS=1.0 * Target_PE=10
  });

  it('10) ValuationSaveConcurrencyController blocks duplicate (ticker, key) saves, isolates company switches, and allows retry after failure', () => {
    const ctrl = new ValuationSaveConcurrencyController('COMI');
    const h1 = ctrl.beginRequest('COMI', 'Beta');
    assert.ok(h1);
    assert.equal(ctrl.isKeyInFlight('COMI', 'Beta'), true);

    // Duplicate concurrent save for same (ticker, key) MUST be rejected
    const dup = ctrl.beginRequest('COMI', 'Beta');
    assert.equal(dup, null);

    // Different key can still proceed concurrently
    const hOther = ctrl.beginRequest('COMI', 'TaxRate');
    assert.ok(hOther);
    const otherDone = ctrl.completeRequest(hOther!);
    assert.equal(otherDone.shouldApplyUiState, true);

    // User switches active ticker mid-flight -> stale completion must NOT touch new ticker UI state
    ctrl.setActiveTicker('ETEL');
    const staleDone = ctrl.completeRequest(h1!);
    assert.equal(staleDone.shouldApplyUiState, false);
    assert.equal(staleDone.staleReason, 'ticker_changed');
    assert.equal(ctrl.isKeyInFlight('COMI', 'Beta'), false);

    // Switch back to COMI and verify retry succeeds after completion/failure cleanup
    ctrl.setActiveTicker('COMI');
    const retry = ctrl.beginRequest('COMI', 'Beta');
    assert.ok(retry);
    const retryDone = ctrl.completeRequest(retry!);
    assert.equal(retryDone.shouldApplyUiState, true);
    assert.equal(retryDone.staleReason, null);
  });
});
