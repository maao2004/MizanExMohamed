import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';

import {
  computeRecordBusinessHash,
  normalizeRfMethodology,
  normalizeStrictCurrency,
  validateParameterRecords,
} from '../src/core/contracts';
import {
  buildValuationSourcesSummary,
  deriveFinancialCurrencyAndUnit,
  normalizeCurrencyCode,
  resolveValuationAssumptions,
} from '../src/core/domain/valuationAssumptions';
import { deriveStocksFromQuarterlyRecords } from '../src/core/domain/stockDerived';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { buildImportPreview, parseAllParametersExcelFile } from '../src/core/imports';
import { ValuationSourcesCard } from '../src/components/ValuationSourcesCard';
import { CacheService } from '../src/services/storage/cacheService';
import {
  createMemoryAtomicPersistenceDriver,
  persistAtomicBatchCommit,
  persistAtomicDeltaCommit,
} from '../src/services/storage/indexedDbStore';
import {
  Company,
  CompanyParameterOverride,
  QuarterlyFinancial,
} from '../src/types/financial';
import { DailyTradingRecord, QuarterlyFinancialRecord } from '../src/types';

function makeLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  (globalThis as any).localStorage = mock;
  return store;
}

const BASE_MACROS: Record<string, number> = {
  TaxRate: 0.225,
  Rf_Egypt_10Y: 0.24,
  Rf_USD_10Y: 0.045,
  ERP_Developed: 0.045,
  CRP_Egypt: 0.06,
  Beta_Default: 1.0,
  Terminal_Growth: 0.05,
  Exit_Multiple: 6,
  Forecast_Years: 5,
  Cost_of_Debt: 0.18,
  Growth_Y1: 0.12,
  Growth_Y2: 0.10,
  Growth_Y3: 0.08,
  Growth_Y4: 0.07,
  Growth_Y5: 0.06,
  WACC_Mode: 1,
  DDM_Growth: 0.05,
  r_Mode: 1,
  Weight_DCF: 40,
  Weight_DDM: 20,
  Weight_RIM: 20,
  Weight_Relative: 10,
  Weight_Graham: 10,
  Beta_Raw_Weight: 1,
  Beta_Anchor: 1,
  Country_Risk_Lambda: 1,
  RIM_Retention: 0.5,
  Relative_PE_Weight: 0.5,
  Relative_PB_Weight: 0.5,
};

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'swdy',
    ticker: 'SWDY',
    nameAr: 'السويدي إلكتريك',
    nameEn: 'Elsewedy Electric',
    sector: 'الصناعة',
    sectorClassification: 'non_financial',
    marketPrice: 50,
    marketPriceSource: 'lastPrice',
    latestTradeDate: '2026-02-01',
    sharesOutstanding: 200,
    sharesSource: 'quarterly_record',
    sharesPeriod: 'FY 2025',
    beta: 1.0,
    riskFreeRate: null,
    equityRiskPremium: null,
    costOfDebt: null,
    taxRate: null,
    targetDebtRatio: null,
    sustainableGrowthRate: null,
    shortTermGrowthRate: null,
    targetPE: 9,
    targetPB: 1.8,
    currency: 'EGP',
    description: '',
    ...overrides,
  };
}

function makeQuarterRec(overrides: Partial<QuarterlyFinancialRecord> = {}): QuarterlyFinancialRecord {
  return {
    ticker: 'SWDY',
    stockName: 'السويدي إلكتريك',
    yearQuarter: '2025FY',
    year: 2025,
    quarter: 'FY',
    shares: 200,
    intangibleAssets: null,
    totalAssets: 15000,
    equity: 6000,
    totalDebtWithoutTX: 2500,
    totalLiabilities: 9000,
    revenueYTD: 12000,
    grossProfitYTD: 3200,
    ebitYTD: 1800,
    pbtYTD: 1550,
    netIncomeYTD: 1200,
    ocfYTD: 1500,
    netInvestingCfYTD: -300,
    dividendsPaidYTD: 200,
    cash: 800,
    interestExpenseYTD: 250,
    financeCostsYTD: 250,
    interestIncomeYTD: 0,
    taxExpenseYTD: 350,
    interestPaidYTD: 250,
    capexYTD: 300,
    dateInsertData: '2025-12-31',
    depreciationAmortizationYTD: 300,
    changeOperatingNwcYTD: 120,
    valuationTaxRate: 0.225,
    valuationSource: 'قوائم مالية مدققة',
    financialUnit: 'EGP_millions',
    ...overrides,
  };
}

function makeQuarterlyFin(overrides: Partial<QuarterlyFinancial> = {}): QuarterlyFinancial {
  return {
    id: 'swdy_2025_fy',
    companyId: 'swdy',
    year: 2025,
    quarter: 'FY',
    periodDate: '2025-12-31',
    revenueYTD: 12000,
    grossProfitYTD: 3200,
    operatingProfitYTD: 1800,
    netProfitYTD: 1200,
    operatingCashFlowYTD: 1500,
    capexYTD: 300,
    dividendsPaidYTD: 200,
    totalAssets: 15000,
    totalDebt: 2500,
    cashAndEquivalents: 800,
    totalEquity: 6000,
    sharesCount: 200,
    isAudited: true,
    depreciationAmortizationYTD: 300,
    changeOperatingNwcYTD: 120,
    valuationTaxRate: 0.225,
    valuationSource: 'قوائم مالية مدققة',
    financialUnit: 'EGP_millions',
    ...overrides,
  };
}

describe('MizanEX v9 Verification Suite', () => {
  it('1) Strict currency normalization never coerces unknown/empty currency to EGP and derives financialCurrency from quarterly records only', () => {
    assert.equal(normalizeCurrencyCode('EUR'), 'UNSUPPORTED');
    assert.equal(normalizeCurrencyCode('GBP'), 'UNSUPPORTED');
    assert.equal(normalizeCurrencyCode(''), 'MISSING');
    assert.equal(normalizeCurrencyCode(null), 'MISSING');
    assert.equal(normalizeCurrencyCode('egp'), 'EGP');
    assert.equal(normalizeCurrencyCode('USD_millions'), 'USD');
    assert.equal(normalizeStrictCurrency('EUR').status, 'unsupported');
    assert.equal(normalizeStrictCurrency('   ').status, 'missing');

    // Quarterly record in USD_millions vs company metadata claiming EGP: quarterly source wins & currency mismatch blocks metrics/valuation
    const usdFin = makeQuarterlyFin({ financialUnit: 'USD_millions', financialCurrency: 'USD' });
    const usdRec = makeQuarterRec({ financialUnit: 'USD_millions', financialCurrency: 'USD' });
    const companyWithWrongMeta = makeCompany({ currency: 'EGP' });

    const derivedList = deriveStocksFromQuarterlyRecords([usdRec], [companyWithWrongMeta]);
    assert.equal(derivedList.length, 1);
    assert.equal(derivedList[0].currency, 'USD');

    const metricsMismatch = calculateTTMMetrics(companyWithWrongMeta, [usdFin]);
    assert.equal(metricsMismatch.financialCurrency, 'USD');
    assert.equal(metricsMismatch.financialUnit, 'USD_millions');
    assert.equal(metricsMismatch.marketPriceCurrency, 'EGP');
    // Market Cap, EV multiples, P/E, P/B are blocked due to financial USD vs market EGP mismatch
    assert.equal(metricsMismatch.marketCap, null);
    assert.equal(metricsMismatch.peTTM, null);
    assert.equal(metricsMismatch.pbTTM, null);
    assert.equal(metricsMismatch.evToEbitda, null);

    const valBlocked = runValuationModels(companyWithWrongMeta, metricsMismatch, undefined, BASE_MACROS, {
      priority: 'company_first',
      quarterlyRecords: [usdRec],
      betaRecord: { ticker: 'SWDY', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
      betaConfirmed: true,
    });
    assert.ok(valBlocked.currencyConsistencyBlockedReasonAr);
    assert.equal(valBlocked.compositeFairValue, null);
    assert.equal(valBlocked.marginOfSafetyPct, null);
    assert.equal(valBlocked.upsidePotentialPct, null);
    assert.equal(valBlocked.dcfFairValue, null);
    assert.equal(valBlocked.ddmFairValue, null);
    assert.equal(valBlocked.rimFairValue, null);

    // Legacy record without financialUnit remains visible in stock list, while unit/currency readiness stays explicit
    const legacyRec = makeQuarterRec({ financialUnit: null, financialCurrency: null });
    const legacyDerived = deriveStocksFromQuarterlyRecords([legacyRec], []);
    assert.equal(legacyDerived.length, 1);
    const derivedCurrency = deriveFinancialCurrencyAndUnit([legacyRec]);
    assert.equal(derivedCurrency.status, 'missing');
    assert.equal(derivedCurrency.amountUnit, 'unspecified');
  });

  it('2) Projected_Terminal_EBITDA is company-only: global scope is rejected/ignored+flagged, and company horizon/currency mismatches exclude exit multiple DCF', () => {
    assert.throws(
      () =>
        validateParameterRecords([
          {
            key: 'Projected_Terminal_EBITDA',
            value: 3000,
            description: 'global invalid',
            scope: 'global',
            ticker: null,
            unit: 'EGP_millions',
            asOfDate: '2026-01-01',
            source: 'test',
          },
        ]),
      /لا يدعم النطاق global/
    );

    const company = makeCompany();
    const qRec = makeQuarterRec();
    const qFin = makeQuarterlyFin();
    const metrics = calculateTTMMetrics(company, [qFin]);

    // Case A: Global Projected_Terminal_EBITDA in macro_params is IGNORED and flagged in invalidGlobalParameters
    const valWithGlobal = runValuationModels(
      company,
      metrics,
      undefined,
      { ...BASE_MACROS, Projected_Terminal_EBITDA: 2800 },
      {
        priority: 'company_first',
        terminalValueMethod: 'exit_multiple',
        quarterlyRecords: [qRec],
        betaRecord: { ticker: 'SWDY', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
        betaConfirmed: true,
      }
    );
    assert.equal(valWithGlobal.dcfFairValue, null);
    assert.equal(valWithGlobal.sourcesSummary?.invalidGlobalParameters?.[0]?.key, 'Projected_Terminal_EBITDA');

    // Case B: Company override with mismatched forecastHorizonYears (3 vs active 5) excludes exit_multiple DCF
    const mismatchedOverride: Record<string, CompanyParameterOverride> = {
      Projected_Terminal_EBITDA: {
        ticker: 'SWDY',
        key: 'Projected_Terminal_EBITDA',
        value: 2800,
        scope: 'company',
        unit: 'EGP_millions',
        currency: 'EGP',
        forecastHorizonYears: 3,
      },
    };
    const valHorizonMismatch = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      priority: 'company_first',
      terminalValueMethod: 'exit_multiple',
      companyOverridesMap: mismatchedOverride,
      quarterlyRecords: [qRec],
      betaRecord: { ticker: 'SWDY', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
      betaConfirmed: true,
    });
    assert.equal(valHorizonMismatch.dcfFairValue, null);
    const dcfStatus = valHorizonMismatch.modelStatuses?.find((m) => m.model === 'dcf');
    assert.equal(dcfStatus?.status, 'excluded');
    assert.match(dcfStatus?.reasonAr || '', /أفق|Forecast_Years/);

    // Case C: Matching currency, unit, and horizon activates exit_multiple DCF while keeping Growth_Y1 independent
    const validOverride: Record<string, CompanyParameterOverride> = {
      Projected_Terminal_EBITDA: {
        ticker: 'SWDY',
        key: 'Projected_Terminal_EBITDA',
        value: 2800,
        scope: 'company',
        unit: 'EGP_millions',
        currency: 'EGP',
        forecastHorizonYears: 5,
      },
    };
    const valValid = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      priority: 'company_first',
      terminalValueMethod: 'exit_multiple',
      companyOverridesMap: validOverride,
      quarterlyRecords: [qRec],
      betaRecord: { ticker: 'SWDY', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
      betaConfirmed: true,
    });
    assert.ok(valValid.dcfFairValue !== null && valValid.dcfFairValue > 0);
    assert.equal(valValid.dcfDetails?.terminalValue, 2800 * 6);
  });

  it('3) rfMethodology complete lifecycle: legacy normalization, strict reject, hashing diff sensitivity, mode binding (USD vs Egypt), and Excel parsing', async () => {
    assert.equal(normalizeRfMethodology('sovereign_raw'), 'sovereign_yield');
    assert.equal(normalizeRfMethodology('default_free'), 'default_free');
    assert.equal(normalizeRfMethodology(''), 'unspecified');
    assert.throws(
      () => normalizeRfMethodology('invalid_method', { strict: true }),
      /غير صالح/
    );

    // Hashing changes when rfMethodology / currency / forecastHorizonYears change even with same value
    const h1 = computeRecordBusinessHash('parameter', {
      key: 'Rf_Egypt_10Y',
      value: 0.24,
      scope: 'global',
      ticker: null,
      unit: 'decimal',
      rfMethodology: 'sovereign_yield',
    });
    const h2 = computeRecordBusinessHash('parameter', {
      key: 'Rf_Egypt_10Y',
      value: 0.24,
      scope: 'global',
      ticker: null,
      unit: 'decimal',
      rfMethodology: 'default_free',
    });
    assert.notEqual(h1, h2);

    const existingMap = new Map<string, Record<string, any>>([
      [
        'Rf_Egypt_10Y',
        {
          key: 'Rf_Egypt_10Y',
          value: 0.24,
          scope: 'global',
          ticker: null,
          unit: 'decimal',
          rfMethodology: 'sovereign_yield',
          contentHash: h1,
        },
      ],
    ]);
    const preview = buildImportPreview({
      sourceType: 'parameters',
      fileName: 'All_Parameters.xlsx',
      sheetName: 'All_Parameters',
      totalRows: 1,
      parsedRecords: [
        {
          key: 'Rf_Egypt_10Y',
          value: 0.24,
          description: '',
          scope: 'global',
          ticker: null,
          unit: 'decimal',
          asOfDate: '',
          source: '',
          rfMethodology: 'default_free',
        },
      ],
      rejected: [],
      warnings: [],
      existingDocsMap: existingMap,
    });
    assert.equal(preview.updates.length, 1);

    // USD r_Mode=2 binds strictly to Rf_USD_10Y's methodology (NOT Rf_Egypt_10Y)
    const usdRec = makeQuarterRec({ financialUnit: 'USD_millions', financialCurrency: 'USD' });
    const usdFin = makeQuarterlyFin({ financialUnit: 'USD_millions', financialCurrency: 'USD' });
    const usdCompany = makeCompany({ currency: 'USD' });
    const usdMetrics = calculateTTMMetrics(usdCompany, [usdFin]);
    const usdVal = runValuationModels(
      usdCompany,
      usdMetrics,
      undefined,
      { ...BASE_MACROS, r_Mode: 2, WACC_Mode: 3 },
      {
        priority: 'company_first',
        quarterlyRecords: [usdRec],
        macroMetaMap: {
          Rf_Egypt_10Y: { rfMethodology: 'sovereign_yield' },
          Rf_USD_10Y: { rfMethodology: 'default_free' },
        },
        betaRecord: { ticker: 'SWDY', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
        betaConfirmed: true,
      }
    );
    assert.equal(usdVal.sourcesSummary?.rfResolvedKey, 'Rf_USD_10Y');
    assert.equal(usdVal.sourcesSummary?.rfMethodology, 'default_free');

    // Excel parser picks up RfMethodology, Currency, ForecastHorizonYears cleanly
    const ws = XLSX.utils.json_to_sheet([
      {
        Key: 'Rf_Egypt_10Y',
        Value: 0.23,
        Scope: 'global',
        Ticker: '',
        Unit: 'decimal',
        RfMethodology: 'sovereign_raw',
        Currency: 'EGP',
        AsOfDate: '2026-02-01',
        Source: 'CBE',
      },
      {
        Key: 'Projected_Terminal_EBITDA',
        Value: 2600,
        Scope: 'company',
        Ticker: 'SWDY',
        Unit: 'EGP_millions',
        Currency: 'EGP',
        ForecastHorizonYears: 5,
        AsOfDate: '2026-02-01',
        Source: 'Model',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'All_Parameters');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const parsed = await parseAllParametersExcelFile({
      name: 'All_Parameters.xlsx',
      arrayBuffer: async () => buf,
    });
    assert.equal(parsed.rejected.length, 0);
    assert.equal(parsed.records[0].rfMethodology, 'sovereign_yield');
    assert.equal(parsed.records[0].currency, 'EGP');
    assert.equal(parsed.records[1].forecastHorizonYears, 5);
  });

  it('4) Sync completeness: per-collection delta cursors isolate collections & atomic persistence rolls back records + cursor on failure', async () => {
    makeLocalStorageMock();
    CacheService.setScope({ projectId: 'mizanex', databaseId: 'default', uid: 'u1' });

    CacheService.setCollectionDeltaCursorMs('daily', 1_760_000_050_000);
    assert.equal(CacheService.getCollectionDeltaCursorMs('daily'), 1_760_000_050_000);
    assert.equal(CacheService.getCollectionDeltaCursorMs('quarterly'), 0);

    const driver = createMemoryAtomicPersistenceDriver();
    const committed = await persistAtomicDeltaCommit({
      scopeKey: 'mizanex:default:u1',
      collection: 'quarterly',
      records: [{ ticker: 'SWDY', year: 2025, quarter: 'FY' }],
      cursorMs: 1_760_000_100_000,
      confirmed: true,
      driver,
    });
    assert.equal(committed.deltaCursors.quarterly, 1_760_000_100_000);
    assert.equal(committed.baselineConfirmed.quarterly, true);

    // Now force transaction abort: records & cursor MUST remain at previous state!
    driver.setFailOnWrite(true);
    await assert.rejects(
      () =>
        persistAtomicBatchCommit({
          scopeKey: 'mizanex:default:u1',
          entries: [
            {
              collection: 'quarterly',
              records: [{ ticker: 'NEW', year: 2026, quarter: 'Q1' }],
              cursorMs: 1_760_000_999_000,
              confirmed: true,
            },
          ],
          driver,
        }),
      /Simulated IndexedDB transaction abort/
    );

    const afterAbort = driver.snapshot('mizanex:default:u1')!;
    assert.equal(afterAbort.deltaCursors.quarterly, 1_760_000_100_000);
    assert.equal((afterAbort.collections.quarterly as any[])[0].ticker, 'SWDY');
  });

  it('5) Analytical EPS_TTM vs GAAP reportedEps & strict chronological ROE average equity calculation', () => {
    const company = makeCompany();
    const q2024 = makeQuarterlyFin({
      id: 'swdy_2024_fy',
      year: 2024,
      quarter: 'FY',
      periodDate: '2024-12-31',
      totalEquity: 4000,
      netProfitYTD: 900,
      netIncomeCommonYTD: 850,
    });
    const q2025 = makeQuarterlyFin({
      id: 'swdy_2025_fy',
      year: 2025,
      quarter: 'FY',
      periodDate: '2025-12-31',
      totalEquity: 6000,
      netProfitYTD: 1200,
      netIncomeCommonYTD: 1100,
      weightedAvgSharesYTD: 195,
      reportedEps: 5.64,
      reportedEpsSource: 'القوائم المجمعة المدققة',
      reportedEpsPeriod: 'FY 2025',
    });

    const metricsWithPair = calculateTTMMetrics(company, [q2024, q2025]);
    assert.equal(metricsWithPair.epsBasis, 'analytical_common_ni_eop_shares');
    assert.match(metricsWithPair.epsBasisLabelAr || '', /المساهمين العاديين|نهاية الفترة/);
    assert.equal(metricsWithPair.reportedEps, 5.64);
    assert.equal(metricsWithPair.reportedEpsPeriod, 'FY 2025');
    // Valuation EPS strictly uses NetIncomeCommon_TTM / EOP shares (1100 / 200 = 5.50), while consolidated reference is 1200 / 200 = 6.00
    assert.equal(metricsWithPair.epsTTM, 5.5);
    assert.equal(metricsWithPair.analyticalConsolidatedEpsTTM, 6.0);
    assert.equal(metricsWithPair.metricAudit.analyticalEpsTTM.basisCode, 'analytical_net_income_eop_shares');
    // Without attested commonEquity, valuation roeBasis is withheld while total-equity reference remains documented
    assert.equal(metricsWithPair.roeBasis, 'unavailable');
    assert.equal(metricsWithPair.metricAudit.roeTotalEop.basisCode, 'end_of_period_equity');
    // Average equity = (4000 + 6000) / 2 = 5000 => reference roeAverageEquity = 1200 / 5000 = 0.24
    assert.ok(Math.abs((metricsWithPair.roeAverageEquity ?? 0) - 0.24) < 1e-9);

    // With explicit commonEquity on both periods, valuation roeBasis & common average ROE compute cleanly
    const metricsCommonEq = calculateTTMMetrics(company, [
      { ...q2024, commonEquity: 3800, commonEquityBasis: 'explicit_common' },
      { ...q2025, commonEquity: 5500, commonEquityBasis: 'explicit_common' },
    ]);
    assert.equal(metricsCommonEq.roeBasis, 'common_eop_equity');
    assert.ok(Math.abs((metricsCommonEq.roe ?? 0) - 1100 / 5500) < 1e-9);
    assert.ok(Math.abs((metricsCommonEq.roeAverageEquity ?? 0) - 1100 / 4650) < 1e-9);

    // Single period only (no matching start/end equity pair) -> roeAverageEquity stays null
    const metricsSingle = calculateTTMMetrics(company, [q2025]);
    assert.equal(metricsSingle.roeAverageEquity, null);
  });

  it('6) ValuationSourcesCard & summary render dual configuredWeights/activeWeights, single-model warning, invalid globals, and clean typography without pills/confidence scores', () => {
    const company = makeCompany({ targetPE: null, targetPB: null });
    const qRec = makeQuarterRec();
    const qFin = makeQuarterlyFin();
    const metrics = calculateTTMMetrics(company, [qFin]);

    // Force only DCF available (DDM excluded due to missing DPS_Actual, RIM excluded via 0 weight/missing, Relative missing targetPE/PB, Graham weight 0)
    const val = runValuationModels(
      company,
      metrics,
      undefined,
      {
        ...BASE_MACROS,
        Weight_DCF: 40,
        Weight_DDM: 20,
        Weight_RIM: 20,
        Weight_Relative: 10,
        Weight_Graham: 10,
        Projected_Terminal_EBITDA: 2500, // invalid global
      },
      {
        priority: 'company_first',
        quarterlyRecords: [qRec],
        betaRecord: { ticker: 'SWDY', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
        betaConfirmed: true,
        macroMetaMap: {
          Rf_Egypt_10Y: { rfMethodology: 'sovereign_yield', asOfDate: '2026-02-01', source: 'CBE' },
        },
      }
    );

    // Exclude RIM/Graham by creating a clean single-model summary check using resolved assumptions
    const resolvedBundle = resolveValuationAssumptions({
      company,
      paramsMap: { ...BASE_MACROS, Projected_Terminal_EBITDA: 2500 },
      macroMetaMap: {
        Rf_Egypt_10Y: { rfMethodology: 'sovereign_yield', asOfDate: '2026-02-01', source: 'CBE' },
      },
    });
    const singleSummary = buildValuationSourcesSummary({
      company,
      quarterlyRecords: [qRec],
      metrics,
      valuation: {
        ...val,
        weights: { dcf: 100, ddm: 0, rim: 0, relative: 0, graham: 0 },
        configuredWeights: { dcf: 40, ddm: 20, rim: 20, relative: 10, graham: 10 },
      },
      sectorClassification: 'non_financial',
      resolvedAssumptions: resolvedBundle,
      modelStatuses: [
        { model: 'dcf', nameAr: 'DCF', status: 'available', fairValue: val.dcfFairValue, weightPct: 100, reasonAr: null },
        { model: 'ddm', nameAr: 'DDM', status: 'excluded', fairValue: null, weightPct: 0, reasonAr: 'لا يوجد توزيع منتظم من DPS_Actual' },
        { model: 'rim', nameAr: 'RIM', status: 'excluded', fairValue: null, weightPct: 0, reasonAr: 'الوزن المكوّن 0%' },
        { model: 'relative', nameAr: 'نسبي', status: 'excluded', fairValue: null, weightPct: 0, reasonAr: 'بلا مضاعف' },
        { model: 'graham', nameAr: 'جراهام', status: 'excluded', fairValue: null, weightPct: 0, reasonAr: 'الوزن 0%' },
      ],
    });

    assert.ok(singleSummary.singleModelWarningAr);
    assert.equal(singleSummary.configuredWeights?.dcf, 40);
    assert.equal(singleSummary.activeWeights?.dcf, 100);
    assert.equal(singleSummary.invalidGlobalParameters?.length, 1);

    const html = renderToStaticMarkup(React.createElement(ValuationSourcesCard, { summary: singleSummary }));
    assert.match(html, /40\.0%/);
    assert.match(html, /100\.0%/);
    assert.match(html, /نموذج تقييم واحد/);
    assert.match(html, /Projected_Terminal_EBITDA/);
    assert.match(html, /sovereign_yield/);
    assert.match(html, /نهاية الفترة المسجلة وليست متوسطاً مرجحاً تاريخياً/);
    assert.equal(html.includes('rounded-full'), false);
    assert.equal(/Confidence Score|درجة الثقة/i.test(html), false);
  });
});
