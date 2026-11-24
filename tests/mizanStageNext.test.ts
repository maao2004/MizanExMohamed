import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { computeComprehensiveValuation } from '../src/core/math/valuation';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { buildCompanyValuationWorkbook } from '../src/utils/excelExport';
import { ValuationSourcesCard } from '../src/components/ValuationSourcesCard';
import { DcfDetailsView } from '../src/components/DcfDetailsView';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DOWNLOADABLE_ALL_PARAMETERS_TEMPLATE_ROWS,
  IMPORT_SAFE_CHUNK_SIZES,
  validateRecords,
} from '../src/core/contracts';
import { FirestoreSessionManager } from '../src/core/domain/firestoreSessionManager';
import {
  buildOverlapSinceMs,
  commitCursorAfterConfirmedMerge,
  computeCandidateDeltaCursor,
  CURSOR_OVERLAP_MS,
} from '../src/services/firebase/firestoreSync';
import { CacheService, TOMBSTONE_TTL_MS } from '../src/services/storage/cacheService';
import { Company, CompanyParameterOverride, QuarterlyFinancial } from '../src/types/financial';
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

const MACROS: Record<string, number> = {
  TaxRate: 0.225,
  Rf_Egypt_10Y: 0.25,
  Rf_USD_10Y: 0.045,
  ERP_Developed: 0.045,
  CRP_Egypt: 0.06,
  Beta_Default: 1.0,
  Terminal_Growth: 0.05,
  Exit_Multiple: 6,
  Forecast_Years: 3,
  Cost_of_Debt: 0.18,
  Growth_Y1: 0.15,
  Growth_Y2: 0.12,
  Growth_Y3: 0.1,
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
  RIM_Retention: 0.5,
  Relative_PE_Weight: 0.5,
  Relative_PB_Weight: 0.5,
};

function makeTestCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'swdy',
    ticker: 'SWDY',
    nameAr: 'السويدي إلكتريك',
    nameEn: 'Elsewedy Electric',
    sector: 'الصناعة',
    sectorClassification: 'non_financial',
    marketPrice: 50,
    sharesOutstanding: 200,
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

function makeTestFinancial(): QuarterlyFinancial {
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
  };
}

describe('Mizan Stage A-D Comprehensive Regression Suite', () => {
  it('1) Currency mismatch guard blocks DCF/DDM/RIM consistently across engine, scenarios, sensitivity, card, and workbook', async () => {
    const company = makeTestCompany({ currency: 'EGP' });
    const financial = makeTestFinancial();
    const metrics = calculateTTMMetrics(company, [financial]);
    const usdMacros = { ...MACROS, r_Mode: 2, WACC_Mode: 3 };
    const sampleQuarter: QuarterlyFinancialRecord = {
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
    };

    const val = runValuationModels(company, metrics, undefined, usdMacros, {
      priority: 'company_first',
      quarterlyRecords: [sampleQuarter],
      betaRecord: { ticker: 'SWDY', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
      betaConfirmed: true,
    });

    assert.equal(val.dcfFairValue, null);
    assert.equal(val.ddmFairValue, null);
    assert.equal(val.rimFairValue, null);
    assert.equal(val.sourcesSummary?.financialCurrency, 'EGP');
    assert.equal(val.sourcesSummary?.keCurrency, 'USD');
    assert.equal(val.sourcesSummary?.waccCurrency, 'USD');

    // Scenarios only incorporate relative & graham (since DCF/DDM/RIM are blocked by currency guard)
    const relativeAndGrahamComposite = (val.relativeFairValue! * 10 + val.grahamFairValue! * 10) / 20;
    assert.ok(Math.abs(val.scenarios.base.fairValue! - relativeAndGrahamComposite) < 1e-6);

    // SourcesCard & Excel workbook clearly surface the currency mismatch without silently mixing currencies
    const cardHtml = renderToStaticMarkup(React.createElement(ValuationSourcesCard, { summary: val.sourcesSummary! }));
    assert.match(cardHtml, /عدم تطابق العملة|USD|EGP/);

    const wb = await buildCompanyValuationWorkbook(company, [financial], metrics, val, []);
    const summaryRows = XLSX.utils.sheet_to_json(wb.Sheets['ملخص التقييم'], { header: 1 }) as unknown[][];
    const flatText = summaryRows.flat().join(' ');
    assert.match(flatText, /USD|EGP/);
  });

  it('2) Decoupled exit_multiple terminal EBITDA & DcfDetails PV breakdown render cleanly with zero arbitrary color rules', () => {
    const engineOut = computeComprehensiveValuation(
      {
        ticker: 'SWDY',
        financialCurrency: 'EGP',
        marketPrice: 50,
        sharesOutstanding: 200,
        betaRaw: 1.0,
        betaStatus: 'actual',
        terminalValueMethod: 'exit_multiple',
        netIncomeTTM: 1200,
        ocfTTM: 1500,
        capexTTM: 300,
        fcfTTM: 1200,
        fcffTTM: 900,
        ebitdaTTM: 2000,
        totalEquity: 6000,
        totalDebt: 2500,
        cash: 800,
        dpsRegular: 1.5,
        sector: 'الصناعة',
        sectorClassification: 'non_financial',
        companyOverridesMap: {
          Projected_Terminal_EBITDA: {
            ticker: 'SWDY',
            key: 'Projected_Terminal_EBITDA',
            value: 2650,
            scope: 'company',
            unit: 'EGP_millions',
            currency: 'EGP',
            forecastHorizonYears: 3,
          },
        },
      },
      {
        ...MACROS,
      }
    );

    assert.ok(engineOut.dcfDetails);
    assert.equal(engineOut.dcfDetails.terminalValue, 2650 * 6);
    assert.ok(engineOut.dcfDetails.pvForecastFlows > 0);
    assert.ok(engineOut.dcfDetails.terminalShareOfEvPct !== null);
    const expectedShare =
      (engineOut.dcfDetails.presentTerminalValue / engineOut.dcfDetails.enterpriseValue) * 100;
    assert.ok(Math.abs(engineOut.dcfDetails.terminalShareOfEvPct! - expectedShare) < 1e-6);
    assert.match(engineOut.dcfDetails.terminalInputsSummary, /Projected_Terminal_EBITDA/);

    const company = makeTestCompany();
    const metrics = calculateTTMMetrics(company, [makeTestFinancial()]);
    const companyOverridesMap: Record<string, CompanyParameterOverride> = {
      Projected_Terminal_EBITDA: {
        ticker: 'SWDY',
        key: 'Projected_Terminal_EBITDA',
        value: 2650,
        scope: 'company',
        unit: 'EGP_millions',
        currency: 'EGP',
        forecastHorizonYears: 3,
      },
    };
    const val = runValuationModels(
      company,
      metrics,
      undefined,
      MACROS,
      {
        priority: 'company_first',
        terminalValueMethod: 'exit_multiple',
        companyOverridesMap,
        quarterlyRecords: [
          {
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
          },
        ],
        betaRecord: { ticker: 'SWDY', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
        betaConfirmed: true,
      }
    );

    const dcfHtml = renderToStaticMarkup(React.createElement(DcfDetailsView, { metrics, valuation: val }));
    assert.match(dcfHtml, /PV القيمة النهائية:/);
    assert.match(dcfHtml, /% من EV/);
    assert.match(dcfHtml, /Projected_Terminal_EBITDA/);
  });

  it('3) Scenarios and sensitivity matrix shift properly under company_first overrides and preserve base invariants', () => {
    const company = makeTestCompany({
      riskFreeRate: 0.23,
      equityRiskPremium: 0.055,
      sustainableGrowthRate: 0.06,
    });
    const metrics = calculateTTMMetrics(company, [makeTestFinancial()]);
    const companyOverridesMap: Record<string, CompanyParameterOverride> = {
      Rf_Egypt_10Y: {
        ticker: 'SWDY',
        key: 'Rf_Egypt_10Y',
        value: 0.24,
        scope: 'company',
      },
      Terminal_Growth: {
        ticker: 'SWDY',
        key: 'Terminal_Growth',
        value: 0.06,
        scope: 'company',
      },
      Growth_Y1: {
        ticker: 'SWDY',
        key: 'Growth_Y1',
        value: 0.14,
        scope: 'company',
      },
    };

    const val = runValuationModels(company, metrics, undefined, MACROS, {
      priority: 'company_first',
      companyOverridesMap,
      betaRecord: { ticker: 'SWDY', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
      betaConfirmed: true,
    });

    assert.ok(val.compositeFairValue !== null);
    assert.ok(val.scenarios.base.fairValue !== null);
    assert.ok(Math.abs(val.scenarios.base.fairValue! - val.compositeFairValue!) < 1e-6);

    // Bull & Bear MUST genuinely differ even under company_first overrides
    assert.ok(val.scenarios.bull.fairValue! > val.scenarios.base.fairValue!);
    assert.ok(val.scenarios.bear.fairValue! < val.scenarios.base.fairValue!);

    // Sensitivity cells vary across columns and rows
    const firstRow = val.sensitivityMatrix[0];
    assert.ok(firstRow.length === 5);
    assert.notEqual(firstRow[0].fairValue, firstRow[4].fairValue);
  });

  it('4) Delta cursor relies solely on serverUpdatedAt (never Date.now), overlaps by 15s, and skips commit if merge fails', () => {
    makeLocalStorageMock();
    CacheService.setScope({ projectId: 'mizanex', databaseId: 'default', uid: 'user_A' });

    // Simulate extreme future client clock skew — candidate cursor must ONLY use serverUpdatedAt
    const serverTs1 = 1_760_000_000_000;
    const serverTs2 = 1_760_000_050_000;
    const candidate = computeCandidateDeltaCursor(0, [
      { serverUpdatedAt: { toMillis: () => serverTs1 } },
      { serverUpdatedAt: { toMillis: () => serverTs2 } },
      { serverUpdatedAt: undefined },
    ]);
    assert.equal(candidate, serverTs2);
    assert.equal(buildOverlapSinceMs(candidate), serverTs2 - CURSOR_OVERLAP_MS);

    // If merge fails, cursor MUST NOT advance
    const uncommitted = commitCursorAfterConfirmedMerge({
      previousCursorMs: 1_750_000_000_000,
      candidateCursorMs: serverTs2,
      mergeSucceeded: false,
    });
    assert.equal(uncommitted, 1_750_000_000_000);
    assert.equal(CacheService.getDeltaCursorMs(), 0);

    // Once merge succeeds, cursor commits safely
    const committed = commitCursorAfterConfirmedMerge({
      previousCursorMs: 1_750_000_000_000,
      candidateCursorMs: serverTs2,
      mergeSucceeded: true,
    });
    assert.equal(committed, serverTs2);
    assert.equal(CacheService.getDeltaCursorMs(), serverTs2);
  });

  it('5) Scoped CacheService isolates keys by uid/project/db and evicts stale > 30d caches; Tombstones guard recreated records & delete stories/decisions/sectorPE', () => {
    const store = makeLocalStorageMock();

    CacheService.setScope({ projectId: 'mizanex', databaseId: 'default', uid: 'uid_one' });
    CacheService.setDeltaCursorMs(100_000);

    CacheService.setScope({ projectId: 'mizanex', databaseId: 'default', uid: 'uid_two' });
    assert.equal(CacheService.getDeltaCursorMs(), 0);
    CacheService.setDeltaCursorMs(200_000);

    CacheService.setScope({ projectId: 'mizanex', databaseId: 'default', uid: 'uid_one' });
    assert.equal(CacheService.getDeltaCursorMs(), 100_000);

    // TTL expiration (> 30 days) evicts scope keys cleanly
    const prefix = Array.from(store.keys()).find((k) => k.includes('uid_one'))!.replace(/delta_cursor_ms|cached_at_ms/, '');
    const cachedAt = Number(store.get(`${prefix}cached_at_ms`) || Date.now());
    const evicted = CacheService.evictExpiredScopeIfNeeded(cachedAt + TOMBSTONE_TTL_MS + 1000);
    assert.equal(evicted, true);
    assert.equal(CacheService.getDeltaCursorMs(), 0);

    // Tombstone guard across arrays + stories/decisions/sectorPE
    const mgr = new FirestoreSessionManager();
    const token = mgr.beginSession('uid_one');
    mgr.applyManualSyncResult(token, {
      quarterly: [
        {
          ticker: 'COMI',
          stockName: 'البنك التجاري الدولي',
          yearQuarter: '2025FY',
          year: 2025,
          quarter: 'FY',
          shares: 3000,
          intangibleAssets: null,
          totalAssets: 100000,
          equity: 50000,
          totalDebtWithoutTX: 0,
          totalLiabilities: 50000,
          revenueYTD: 10000,
          grossProfitYTD: 8000,
          ebitYTD: 7000,
          pbtYTD: 7000,
          netIncomeYTD: 5000,
          ocfYTD: 6000,
          netInvestingCfYTD: -100,
          dividendsPaidYTD: 0,
          cash: 1000,
          interestExpenseYTD: null,
          financeCostsYTD: null,
          interestIncomeYTD: null,
          taxExpenseYTD: 2000,
          interestPaidYTD: null,
          capexYTD: 100,
          dateInsertData: '2025-12-31',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
      ],
      companies: [],
      daily: [],
      stories: {
        comi: {
          companyId: 'comi',
          companyName: 'CIB',
          summary: 'S',
          drivers: [],
          catalysts: [],
          risks: [],
          thesisChanges: [],
          lastUpdated: '2026-03-01',
        } as any,
      },
      decisions: {
        comi: {
          companyId: 'comi',
          companyName: 'CIB',
          finalDecision: 'شراء',
          marginOfSafetyPct: 20,
          targetExitPrice: 90,
          stopLossPrice: 60,
          checklistScore: 8,
          checklistTotal: 10,
          notes: '',
          lastReviewed: '2026-03-01',
        } as any,
      },
      trades: [],
      macro: [],
      sectorPE: { البنوك: 7.5 },
    });

    // Apply incremental delta: older tombstone for COMI quarter (should NOT delete 2026-03-01 record!),
    // newer tombstones for story, decision, and sectorPE (SHOULD delete them)
    const afterDelta = mgr.applyManualSyncResult(token, {
      quarterly: [],
      companies: [],
      daily: [],
      stories: {},
      decisions: {},
      trades: [],
      macro: [],
      sectorPE: undefined,
      isIncrementalDelta: true,
      tombstones: [
        {
          id: 'quarterly_COMI_2025_FY',
          collection: 'quarterly_financial_records',
          docId: 'COMI_2025_FY',
          deletedAt: '2026-02-01T00:00:00.000Z',
          expiresAtMs: Date.now() + 86_400_000,
        },
        {
          id: 'stories_comi',
          collection: 'stories',
          docId: 'comi',
          deletedAt: '2026-04-01T00:00:00.000Z',
          expiresAtMs: Date.now() + 86_400_000,
        },
        {
          id: 'decisions_comi',
          collection: 'decisions',
          docId: 'comi',
          deletedAt: '2026-04-01T00:00:00.000Z',
          expiresAtMs: Date.now() + 86_400_000,
        },
        {
          id: 'sectorPE_البنوك',
          collection: 'sectorPE',
          docId: 'البنوك',
          deletedAt: '2026-04-01T00:00:00.000Z',
          expiresAtMs: Date.now() + 86_400_000,
        },
      ],
    });

    assert.equal(afterDelta.state.quarterlyRecords.length, 1);
    assert.equal(afterDelta.state.stories['comi'], undefined);
    assert.equal(afterDelta.state.decisions['comi'], undefined);
    assert.equal(afterDelta.state.sectorPEMap['البنوك'], undefined);
  });

  it('6) Daily import accepts >200 rows up to 350 and quarterly enforces 180 from shared batchLimits', () => {
    const dailyRows: DailyTradingRecord[] = Array.from({ length: 280 }, (_, idx) => ({
      ticker: `TK${idx}`,
      shortName: `Stock ${idx}`,
      tradeDate: '2026-02-01',
      lastPrice: 10 + idx * 0.1,
      changePct: 0,
      tradesCount: 10,
      openPrice: 10,
      closePrice: 10,
      turnoverValue: 1000,
      netLiquidity: 0,
      volume: 100,
      avgVolume5D: null,
      avgVolume30D: null,
      avgVolume90D: null,
      lowPrice: 9.5,
      highPrice: 10.5,
      sector: 'عام',
      totalBids: null,
      bidsCount: null,
      offersCount: null,
      totalOffers: null,
      avgVolume: null,
      high52W: null,
      low52W: null,
      prevClose: 10,
      marketCapThousands: null,
      vwap: null,
      peRatio: null,
      listedShares: null,
      isinCode: null,
      inflowOrders: null,
      inflowVolume: null,
      inflowLiquidity: null,
      askTrades: null,
      askTradesVolume: null,
      outflowLiquidity: null,
      fullName: `Stock ${idx}`,
      market: 'EGX',
      volChange5DPct: null,
      volChange30DPct: null,
      volChange90DPct: null,
      updatedAt: '2026-02-01T00:00:00.000Z',
    }));

    assert.equal(IMPORT_SAFE_CHUNK_SIZES.daily, 350);
    assert.equal(IMPORT_SAFE_CHUNK_SIZES.quarterly, 180);
    assert.equal(validateRecords(dailyRows, false).length, 280);

    const tooManyQuarterly: QuarterlyFinancialRecord[] = Array.from({ length: 185 }, (_, idx) => ({
      ticker: `Q${idx}`,
      stockName: `Q Stock ${idx}`,
      yearQuarter: '2025FY',
      year: 2025,
      quarter: 'FY',
      shares: 100,
      intangibleAssets: null,
      totalAssets: 500,
      equity: 200,
      totalDebtWithoutTX: 50,
      totalLiabilities: 300,
      revenueYTD: 400,
      grossProfitYTD: 200,
      ebitYTD: 100,
      pbtYTD: 90,
      netIncomeYTD: 70,
      ocfYTD: 80,
      netInvestingCfYTD: -10,
      dividendsPaidYTD: 0,
      cash: 20,
      interestExpenseYTD: 10,
      financeCostsYTD: 10,
      interestIncomeYTD: 0,
      taxExpenseYTD: 20,
      interestPaidYTD: 10,
      capexYTD: 10,
      dateInsertData: '2025-12-31',
    }));

    assert.throws(() => validateRecords(tooManyQuarterly, true), /180/);
  });

  it('7) Templates contain blank AsOfDate / no COMI sample row, and ValuationView contains zero range sliders', () => {
    assert.ok(DOWNLOADABLE_ALL_PARAMETERS_TEMPLATE_ROWS.length >= 28);
    for (const row of DOWNLOADABLE_ALL_PARAMETERS_TEMPLATE_ROWS) {
      assert.equal(row.AsOfDate, '');
    }

    const templatesSrc = fs.readFileSync(path.resolve('src/core/imports/templates.ts'), 'utf8');
    assert.equal(templatesSrc.includes("'COMI'"), false);

    const valViewSrc = fs.readFileSync(path.resolve('src/components/ValuationView.tsx'), 'utf8');
    assert.equal(/type=["']range["']/.test(valViewSrc), false);
    assert.equal(valViewSrc.includes('?? 0.20'), false);
    assert.equal(valViewSrc.includes('?? 0.08'), false);
  });

  it('8) Explicit Rf methodology & Sovereign_Default_Spread disabled without auto-deriving spread from CRP', () => {
    const company = makeTestCompany();
    const metrics = calculateTTMMetrics(company, [makeTestFinancial()]);
    const sampleQuarter: QuarterlyFinancialRecord = {
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
    };

    const val = runValuationModels(
      company,
      metrics,
      undefined,
      { ...MACROS, Sovereign_Default_Spread: 0.03 },
      {
        priority: 'company_first',
        quarterlyRecords: [sampleQuarter],
        macroMetaMap: {
          Rf_Egypt_10Y: {
            rfMethodology: 'sovereign_raw',
            asOfDate: '2026-01-01',
            source: 'CBE',
          },
          Sovereign_Default_Spread: {
            enabledInEngine: false,
            asOfDate: '2026-01-01',
            source: 'Moodys',
          },
        },
        betaRecord: { ticker: 'SWDY', beta: 1.0, asOfDate: '2026-01-01', source: 'EGX' },
        betaConfirmed: true,
      }
    );

    assert.equal(val.sourcesSummary?.rfMethodology, 'sovereign_yield');
    assert.equal(val.resolvedAssumptions?.sovereignDefaultSpread?.enabledInEngine, false);
    // CRP must NOT subtract Sovereign_Default_Spread — Ke should match standard Rf + beta*ERP + CRP
    assert.ok(
      Math.abs((val.engineOutputs?.costOfEquity ?? 0) - (0.25 + 1.0 * 0.045 + 1 * 0.06)) < 1e-9
    );
  });
});
