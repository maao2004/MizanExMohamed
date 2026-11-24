import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';

import { FirestoreSessionManager } from '../src/core/domain/firestoreSessionManager';
import {
  classifyAppDataState,
  deriveStocksFromQuarterlyRecords,
} from '../src/core/domain/stockDerived';
import {
  classifyCompanySector,
  resolveMarketPriceFromDaily,
  resolveValuationAssumptions,
} from '../src/core/domain/valuationAssumptions';
import { createSessionEpochGuard } from '../src/context/AuthContext';
import {
  applyStockAndQuarterAtomicWrite,
  buildCompanyDocWritePayload,
  sanitizeCompanyMetadataPatch,
  validateRecords,
} from '../src/core/contracts';
import { parseDailyTradingExcelFile } from '../src/services/parser/excelParser';
import { runStockHealthChecks } from '../src/core/math/healthChecks';
import { computeComprehensiveValuation } from '../src/core/math/valuation';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { buildCompanyValuationWorkbook } from '../src/utils/excelExport';
import { ValuationSourcesCard } from '../src/components/ValuationSourcesCard';
import { DailyTradingRecord, QuarterlyFinancialRecord } from '../src/types';
import { Company, SectorDefinition } from '../src/types/financial';

function makeQuarterlyRec(overrides: Partial<QuarterlyFinancialRecord> = {}): QuarterlyFinancialRecord {
  return {
    ticker: 'ETEL',
    stockName: 'المصرية للاتصالات',
    yearQuarter: '2025FY',
    year: 2025,
    quarter: 'FY',
    shares: 1707,
    intangibleAssets: null,
    totalAssets: 120000,
    equity: 45000,
    totalDebtWithoutTX: 20000,
    totalLiabilities: 75000,
    revenueYTD: 15000,
    grossProfitYTD: 6000,
    ebitYTD: 4000,
    pbtYTD: 3500,
    netIncomeYTD: 2800,
    ocfYTD: 3200,
    netInvestingCfYTD: -800,
    dividendsPaidYTD: 0,
    cash: 5000,
    interestExpenseYTD: 400,
    financeCostsYTD: 400,
    interestIncomeYTD: 100,
    taxExpenseYTD: 700,
    interestPaidYTD: 350,
    capexYTD: 700,
    dateInsertData: '2025-12-31',
    depreciationAmortizationYTD: 900,
    changeOperatingNwcYTD: 150,
    valuationTaxRate: 0.225,
    valuationSource: 'قوائم مالية مدققة 2025',
    financialUnit: 'EGP_millions',
    updatedAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeDailyRec(overrides: Partial<DailyTradingRecord> = {}): DailyTradingRecord {
  return {
    ticker: 'ETEL',
    shortName: 'المصرية للاتصالات',
    tradeDate: '2026-02-01',
    lastPrice: 40,
    changePct: 1.5,
    tradesCount: 300,
    openPrice: 39.2,
    closePrice: 39.8,
    turnoverValue: 5000000,
    netLiquidity: 100000,
    volume: 125000,
    avgVolume5D: null,
    avgVolume30D: null,
    avgVolume90D: null,
    lowPrice: 39,
    highPrice: 40.5,
    sector: 'اتصالات',
    totalBids: null,
    bidsCount: null,
    offersCount: null,
    totalOffers: null,
    avgVolume: null,
    high52W: null,
    low52W: null,
    prevClose: 39.4,
    marketCapThousands: null,
    vwap: null,
    peRatio: 10,
    listedShares: 1707000000,
    isinCode: 'EGS48031C016',
    inflowOrders: null,
    inflowVolume: null,
    inflowLiquidity: null,
    askTrades: null,
    askTradesVolume: null,
    outflowLiquidity: null,
    fullName: 'المصرية للاتصالات',
    market: 'EGX',
    volChange5DPct: null,
    volChange30DPct: null,
    volChange90DPct: null,
    updatedAt: '2026-02-01T15:00:00.000Z',
    ...overrides,
  };
}

const FULL_MACRO: Record<string, number> = {
  r_Mode: 1,
  WACC_Mode: 1,
  Country_Risk_Lambda: 1,
  Beta_Raw_Weight: 0.67,
  Beta_Anchor: 1,
  Relative_PE_Weight: 0.6,
  Relative_PB_Weight: 0.4,
  Rf_Egypt_10Y: 0.25,
  Rf_USD_10Y: 0.045,
  ERP_Developed: 0.05,
  CRP_Egypt: 0.02,
  Cost_of_Debt: 0.18,
  TaxRate: 0.225,
  Terminal_Growth: 0.05,
  Forecast_Years: 5,
  Growth_Y1: 0.12,
  Growth_Y2: 0.1,
  Growth_Y3: 0.08,
  Growth_Y4: 0.06,
  Growth_Y5: 0.05,
  DDM_Growth: 0.05,
  RIM_Retention: 0.5,
  Weight_DCF: 35,
  Weight_DDM: 15,
  Weight_RIM: 20,
  Weight_Relative: 20,
  Weight_Graham: 10,
};

describe('Data Reliability & Governance Milestone (11 Mandatory Scenarios)', () => {
  it('1) cached empty snapshot never confirms empty, whereas server empty snapshot confirms empty', () => {
    const mgr = new FirestoreSessionManager();
    const token = mgr.beginSession('user_1');

    // Cache-only empty snapshot while online -> awaiting server confirmation
    const cachedEmpty = mgr.applyQuarterlySnapshot(
      token,
      [],
      { fromCache: true, hasPendingWrites: false },
      true
    );
    assert.equal(cachedEmpty.accepted, true);
    assert.equal(cachedEmpty.state.quarterlyConfirmed, false);
    assert.equal(
      classifyAppDataState({
        authLoading: false,
        isAuthenticated: true,
        connectionError: cachedEmpty.state.connectionError,
        quarterlyConfirmed: cachedEmpty.state.quarterlyConfirmed,
        stocksCount: 0,
      }),
      'loading'
    );

    // Server-confirmed empty snapshot (!fromCache) -> confirmed empty
    const serverEmpty = mgr.applyQuarterlySnapshot(
      token,
      [],
      { fromCache: false, hasPendingWrites: false },
      true
    );
    assert.equal(serverEmpty.state.quarterlyConfirmed, true);
    assert.equal(
      classifyAppDataState({
        authLoading: false,
        isAuthenticated: true,
        connectionError: serverEmpty.state.connectionError,
        quarterlyConfirmed: serverEmpty.state.quarterlyConfirmed,
        stocksCount: 0,
      }),
      'empty'
    );
  });

  it('2) offline with cached snapshot enters offline state and does not show stale cache as ready DB', () => {
    const mgr = new FirestoreSessionManager();
    const token = mgr.beginSession('user_1');

    const cachedWhileOffline = mgr.applyQuarterlySnapshot(
      token,
      [makeQuarterlyRec()],
      { fromCache: true, hasPendingWrites: false },
      false
    );

    assert.equal(cachedWhileOffline.reason, 'cached_offline');
    assert.equal(cachedWhileOffline.state.quarterlyConfirmed, false);
    assert.equal(cachedWhileOffline.state.quarterlyRecords.length, 0);
    assert.equal(cachedWhileOffline.state.connectionError?.type, 'offline');
    assert.equal(
      classifyAppDataState({
        authLoading: false,
        isAuthenticated: true,
        connectionError: cachedWhileOffline.state.connectionError,
        quarterlyConfirmed: cachedWhileOffline.state.quarterlyConfirmed,
        stocksCount: 0,
      }),
      'offline'
    );
  });

  it('3) failed manual sync keeps quarterlyConfirmed false; succeeded sync sets data and confirms atomically', () => {
    const mgr = new FirestoreSessionManager();
    const token = mgr.beginSession('user_1');

    const errRes = mgr.applyConnectionError(
      token,
      'quarterly_financial_records',
      { code: 'unavailable', message: 'offline' },
      false,
      false
    );
    assert.equal(errRes.state.quarterlyConfirmed, false);
    assert.equal(errRes.state.connectionError?.type, 'offline');

    const rec = makeQuarterlyRec();
    const syncOk = mgr.applyManualSyncResult(token, {
      quarterly: [rec],
      companies: [],
      daily: [],
      stories: {},
      decisions: {},
      trades: [],
      macro: [],
      sectorPE: {},
    });
    assert.equal(syncOk.accepted, true);
    assert.equal(syncOk.state.quarterlyConfirmed, true);
    assert.equal(syncOk.state.quarterlyRecords.length, 1);
    assert.equal(syncOk.state.connectionError, null);
  });

  it('4) rejects late async responses from previous user session cleanly', () => {
    const mgr = new FirestoreSessionManager();
    const oldToken = mgr.beginSession('user_old');
    const newToken = mgr.beginSession('user_new');

    const staleSnap = mgr.applyQuarterlySnapshot(
      oldToken,
      [makeQuarterlyRec({ ticker: 'OLDCO' })],
      { fromCache: false, hasPendingWrites: false },
      true
    );
    assert.equal(staleSnap.accepted, false);
    assert.equal(staleSnap.reason, 'stale_session');
    assert.equal(mgr.getState().quarterlyRecords.length, 0);

    const guard = createSessionEpochGuard();
    const authTokenA = guard.begin('user_old');
    const authTokenB = guard.begin('user_new');
    assert.equal(guard.isCurrent(authTokenA), false);
    assert.equal(guard.isCurrent(authTokenB), true);
  });

  it('5) atomic quarter + metadata transaction preserves existing company fields, supports explicit null clear, and rolls back on error', async () => {
    const store = new Map<string, Record<string, any>>([
      [
        'companies/etel',
        {
          id: 'etel',
          ticker: 'ETEL',
          nameAr: 'المصرية للاتصالات',
          sector: 'اتصالات',
          sectorClassification: 'non_financial',
          beta: 0.92,
          riskFreeRate: 0.24,
        },
      ],
    ]);

    const runMockTx = async (fn: (tx: any) => Promise<void>, failAtCommit = false) => {
      const staged = new Map(store);
      const tx = {
        async getDoc(col: string, id: string) {
          return staged.get(`${col}/${id}`);
        },
        setDoc(col: string, id: string, data: Record<string, any>, merge: boolean) {
          const k = `${col}/${id}`;
          staged.set(k, merge ? { ...(staged.get(k) ?? {}), ...data } : data);
        },
      };
      await fn(tx);
      if (failAtCommit) throw new Error('Simulated transaction failure');
      store.clear();
      for (const [k, v] of staged.entries()) store.set(k, v);
    };

    // Omitting beta & sector preserves them while adding a new quarter and explicitly clearing riskFreeRate to null
    await runMockTx((tx) =>
      applyStockAndQuarterAtomicWrite(tx, {
        record: makeQuarterlyRec({ quarter: 'FY', year: 2025 }),
        companyMetadata: { id: 'etel', ticker: 'ETEL', riskFreeRate: null, description: 'وصف محدث' },
        stamp: { updatedAt: '2026-02-01T00:00:00.000Z' },
      })
    );

    const savedCompany = store.get('companies/etel')!;
    assert.equal(savedCompany.beta, 0.92);
    assert.equal(savedCompany.sector, 'اتصالات');
    assert.equal(savedCompany.sectorClassification, 'non_financial');
    assert.equal(savedCompany.riskFreeRate, null);
    assert.equal(savedCompany.description, 'وصف محدث');
    assert.ok(store.has('quarterly_financial_records/ETEL_2025_FY'));
    assert.ok(store.has('financials/etel_2025_fy'));

    // Failed transaction writes neither quarterly nor company metadata
    await assert.rejects(
      runMockTx(
        (tx) =>
          applyStockAndQuarterAtomicWrite(tx, {
            record: makeQuarterlyRec({ ticker: 'FAILCO', year: 2025, quarter: 'Q1' }),
            companyMetadata: { id: 'failco', ticker: 'FAILCO', sectorClassification: 'non_financial' },
            stamp: { updatedAt: '2026-02-01T00:00:00.000Z' },
          }),
        true
      ),
      /Simulated transaction failure/
    );
    assert.equal(store.has('quarterly_financial_records/FAILCO_2025_Q1'), false);
    assert.equal(store.has('companies/failco'), false);

    // Direct check on sanitizeCompanyMetadataPatch & buildCompanyDocWritePayload
    const sanitized = sanitizeCompanyMetadataPatch({ ticker: 'ETEL', beta: undefined, targetPE: null });
    assert.ok(sanitized);
    assert.equal('beta' in sanitized!.patch, false);
    assert.equal(sanitized!.patch.targetPE, null);
    const mergedDoc = buildCompanyDocWritePayload({ beta: 1.1, targetPE: 8 }, 'etel', 'ETEL', sanitized!.patch, {});
    assert.equal(mergedDoc.beta, 1.1);
    assert.equal(mergedDoc.targetPE, null);
  });

  it('6) preserves BLANK (null) vs 0 across Daily Trading Excel parsing, validation, price derivation, and health checks', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['الرمز', 'الإسم المختصر', 'أخر', 'التغير%', 'فتح', 'إقفال اليوم', 'قيمة التداول', 'صافي السيولة', 'حجم التداول', 'القطاع', 'الأسهم المدرجة'],
      ['ABUK.CA', 'أبو قير', 55, 0, '', '', 0, 0, 0, '', 1261.8],
      ['ORAS.CA', 'أوراسكوم', '', -1.2, 200, 198, '', '', '', 'مقاولات', ''],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Daily');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const fakeFile = {
      name: '2026-11-08.xlsx',
      arrayBuffer: async () => out,
    } as unknown as File;

    const parsed = await parseDailyTradingExcelFile(fakeFile);
    assert.equal(parsed.date, '2026-11-08');
    assert.equal(parsed.records.length, 2);

    const abuk = parsed.records[0];
    assert.equal(abuk.lastPrice, 55);
    assert.equal(abuk.changePct, 0); // real 0 preserved
    assert.equal(abuk.openPrice, null); // blank stays null
    assert.equal(abuk.closePrice, null); // closePrice is NOT overwritten by lastPrice
    assert.equal(abuk.turnoverValue, 0);
    assert.equal(abuk.sector, null);

    const oras = parsed.records[1];
    assert.equal(oras.lastPrice, null);
    assert.equal(oras.closePrice, 198);

    // Server validator accepts null and 0 strictly
    const validated = validateRecords(parsed.records, false);
    assert.equal(validated.length, 2);

    // Read-only market price derivation documents provenance accurately
    assert.deepEqual(resolveMarketPriceFromDaily(abuk), {
      price: 55,
      source: 'lastPrice',
      tradeDate: '2026-11-08',
    });
    assert.deepEqual(resolveMarketPriceFromDaily(oras), {
      price: 198,
      source: 'closePrice',
      tradeDate: '2026-11-08',
    });

    // Health check distinguishes equity=0 from missing null
    const engineStub = computeComprehensiveValuation(
      {
        ticker: 'ABUK',
        marketPrice: 55,
        sharesOutstanding: 100,
        betaRaw: 1,
        netIncomeTTM: 100,
        ocfTTM: 120,
        capexTTM: 20,
        fcfTTM: 100,
        totalEquity: 500,
        totalDebt: 0,
        cash: 10,
        dpsRegular: 1,
        sector: 'كيماويات',
        sectorClassification: 'non_financial',
      },
      FULL_MACRO
    );
    const checksZero = runStockHealthChecks({
      ticker: 'ABUK',
      dailyRecord: abuk,
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ABUK', equity: 0, totalAssets: 100 })],
      engineOutputs: engineStub,
      terminalGrowth: 0.05,
    });
    const balanceCheckZero = checksZero.find((c) => c.id === 'equity_assets_consistent')!;
    assert.equal(balanceCheckZero.status, 'pass'); // evaluated equity=0 <= assets=100, not treated as missing
    assert.match(balanceCheckZero.actualValue, /حقوق الملكية:\s*(?:0|٠)/);

    const checksNull = runStockHealthChecks({
      ticker: 'ABUK',
      dailyRecord: abuk,
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ABUK', equity: null, totalAssets: 100 })],
      engineOutputs: engineStub,
      terminalGrowth: 0.05,
    });
    const balanceCheckNull = checksNull.find((c) => c.id === 'equity_assets_consistent')!;
    assert.equal(balanceCheckNull.status, 'incomplete');
    assert.equal(balanceCheckNull.actualValue, 'بيانات غير مكتملة');
    assert.doesNotMatch(balanceCheckNull.detailsAr, /أكبر من إجمالي أصول/);

    const checksEquityViolation = runStockHealthChecks({
      ticker: 'ABUK',
      dailyRecord: abuk,
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ABUK', equity: 150, totalAssets: 100 })],
      engineOutputs: engineStub,
      terminalGrowth: 0.05,
    });
    const balanceCheckViolation = checksEquityViolation.find((c) => c.id === 'equity_assets_consistent')!;
    assert.equal(balanceCheckViolation.status, 'fail');

    const fullSharesChecks = runStockHealthChecks({
      ticker: 'ABUK',
      dailyRecord: { ...abuk, listedShares: 1_261_800_000 },
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ABUK', shares: 0 as any })],
      engineOutputs: engineStub,
      terminalGrowth: 0.05,
    });
    const sharesPositiveWhenZeroQuarter = fullSharesChecks.find((c) => c.id === 'shares_positive')!;
    assert.equal(sharesPositiveWhenZeroQuarter.status, 'fail');

    const fullDailyOnlySharesChecks = runStockHealthChecks({
      ticker: 'ABUK',
      dailyRecord: { ...abuk, listedShares: 1_261_800_000 },
      quarterlyRecords: [],
      engineOutputs: engineStub,
      terminalGrowth: 0.05,
    });
    const sharesPositiveCheck = fullDailyOnlySharesChecks.find((c) => c.id === 'shares_positive')!;
    assert.equal(sharesPositiveCheck.status, 'pass');
    assert.equal(sharesPositiveCheck.actualValue, `${(1_261_800_000).toLocaleString('ar-EG')} سهم`);
  });

  it('7) assumption priority (company_first vs global_first) stays unified across engine, scenarios, sensitivity, sources summary, and Excel export', async () => {
    const quarter = makeQuarterlyRec();
    const daily = makeDailyRec();
    const company: Company = {
      id: 'etel',
      ticker: 'ETEL',
      nameAr: 'المصرية للاتصالات',
      nameEn: 'Telecom Egypt',
      sector: 'اتصالات',
      sectorClassification: 'non_financial',
      marketPrice: 40,
      marketPriceSource: 'lastPrice',
      latestTradeDate: '2026-02-01',
      sharesOutstanding: 1707,
      sharesSource: 'quarterly_record',
      sharesPeriod: 'FY 2025',
      beta: 1.0,
      riskFreeRate: 0.20, // differs from global 0.25
      equityRiskPremium: 0.07, // differs from global 0.05
      costOfDebt: 0.14,
      taxRate: 0.225,
      targetDebtRatio: 0.2,
      sustainableGrowthRate: 0.06, // differs from global 0.05
      shortTermGrowthRate: 0.1,
      targetPE: 12, // differs from sectorPE 7
      targetPB: 1.8,
      currency: 'EGP',
    };
    const sectorPEMap = { اتصالات: 7 };

    const metrics = calculateTTMMetrics(company, [
      {
        id: 'etel_2025_fy',
        companyId: 'etel',
        year: 2025,
        quarter: 'FY',
        periodDate: '2025-12-31',
        revenueYTD: quarter.revenueYTD,
        grossProfitYTD: quarter.grossProfitYTD,
        operatingProfitYTD: quarter.ebitYTD,
        netProfitYTD: quarter.netIncomeYTD,
        operatingCashFlowYTD: quarter.ocfYTD,
        capexYTD: quarter.capexYTD,
        dividendsPaidYTD: quarter.dividendsPaidYTD,
        totalAssets: quarter.totalAssets,
        totalDebt: quarter.totalDebtWithoutTX,
        cashAndEquivalents: quarter.cash,
        totalEquity: quarter.equity,
        sharesCount: quarter.shares,
        isAudited: true,
        depreciationAmortizationYTD: quarter.depreciationAmortizationYTD,
        changeOperatingNwcYTD: quarter.changeOperatingNwcYTD,
        valuationTaxRate: quarter.valuationTaxRate,
        valuationSource: quarter.valuationSource,
        financialUnit: quarter.financialUnit,
      },
    ]);

    const companyFirst = runValuationModels(company, metrics, undefined, FULL_MACRO, {
      priority: 'company_first',
      sectorPEMap,
      quarterlyRecords: [quarter],
      latestDaily: daily,
    });
    assert.equal(companyFirst.resolvedAssumptions?.riskFreeRate.value, 0.20);
    assert.equal(companyFirst.resolvedAssumptions?.riskFreeRate.source, 'company');
    assert.equal(companyFirst.resolvedAssumptions?.targetPE.value, 12);
    assert.equal(companyFirst.resolvedAssumptions?.targetPE.source, 'company');
    assert.equal(companyFirst.scenarios.base.fairValue, companyFirst.compositeFairValue);
    assert.equal(companyFirst.sensitivityMatrix[2][2].fairValue !== null, true);

    const globalFirst = runValuationModels(company, metrics, undefined, FULL_MACRO, {
      priority: 'global_first',
      sectorPEMap,
      quarterlyRecords: [quarter],
      latestDaily: daily,
    });
    assert.equal(globalFirst.resolvedAssumptions?.riskFreeRate.value, 0.25);
    assert.equal(globalFirst.resolvedAssumptions?.riskFreeRate.source, 'global');
    assert.equal(globalFirst.resolvedAssumptions?.riskFreeRate.isOverriddenByPriority, true);
    assert.equal(globalFirst.resolvedAssumptions?.targetPE.value, 7);
    assert.equal(globalFirst.resolvedAssumptions?.targetPE.source, 'global');
    assert.equal(globalFirst.scenarios.base.fairValue, globalFirst.compositeFairValue);
    assert.notEqual(globalFirst.compositeFairValue, companyFirst.compositeFairValue);

    const wbGlobal = await buildCompanyValuationWorkbook(company, [], metrics, globalFirst, []);
    const summarySheet = XLSX.utils.sheet_to_json(wbGlobal.Sheets['ملخص التقييم'], { header: 1 }) as any[][];
    const flatSummary = summarySheet.map((r) => r.join(' | ')).join('\n');
    assert.match(flatSummary, /الافتراض العام المحفوظ أولاً/);
    assert.ok(wbGlobal.Sheets['الافتراضات_والمصادر']);
  });

  it('8) missing methodology parameters invent zero defaults and active modes skip unused parameters', () => {
    const resolvedMissing = resolveValuationAssumptions({
      company: {
        sector: 'الصناعة',
        beta: 1.0,
        riskFreeRate: 0.24,
        equityRiskPremium: 0.05,
        costOfDebt: 0.16,
        taxRate: 0.225,
        sustainableGrowthRate: 0.05,
        targetPE: 8,
        targetPB: 1.5,
      },
      paramsMap: {},
    });
    assert.equal(resolvedMissing.map.rMode.value, null);
    assert.equal(resolvedMissing.map.countryRiskLambda.value, null);
    assert.equal(resolvedMissing.map.betaRawWeight.value, null);
    assert.equal(resolvedMissing.map.betaAnchor.value, null);

    // Without Beta_Raw_Weight or r_Mode or Relative_PE_Weight/PB_Weight -> Ke, Relative, and DCF excluded cleanly
    const missingMeth = computeComprehensiveValuation(
      {
        ticker: 'IND',
        marketPrice: 20,
        sharesOutstanding: 100,
        betaRaw: 1.0,
        riskFreeRate: 0.24,
        equityRiskPremium: 0.05,
        costOfDebt: 0.16,
        taxRate: 0.225,
        terminalGrowth: 0.05,
        netIncomeTTM: 200,
        ocfTTM: 250,
        capexTTM: 50,
        fcfTTM: 200,
        fcffTTM: 150,
        totalEquity: 1000,
        totalDebt: 100,
        cash: 50,
        dpsRegular: 1,
        sector: 'الصناعة',
        sectorClassification: 'non_financial',
        companyTargetPE: 8,
        companyTargetPB: 1.5,
      },
      { Weight_DCF: 35, Weight_Relative: 25, Weight_Graham: 10 }
    );
    assert.equal(missingMeth.betaAdjusted, null);
    assert.equal(missingMeth.costOfEquity, null);
    assert.equal(missingMeth.wacc, null);
    assert.equal(missingMeth.dcfValue, null);
    assert.equal(missingMeth.relativeValue, null); // both multiples present without Relative weights
    assert.ok(missingMeth.grahamValue !== null);

    // r_Mode = 3 & Beta_Raw_Weight = 1 must NOT require CRP_Egypt, Country_Risk_Lambda, Rf_USD_10Y, or Beta_Anchor
    const localCapmRawBeta = computeComprehensiveValuation(
      {
        ticker: 'IND',
        marketPrice: 20,
        sharesOutstanding: 100,
        betaRaw: 1.2,
        riskFreeRate: 0.25,
        equityRiskPremium: 0.05,
        costOfDebt: 0.16,
        taxRate: 0.225,
        terminalGrowth: 0.05,
        netIncomeTTM: 200,
        ocfTTM: 250,
        capexTTM: 50,
        fcfTTM: 200,
        fcffTTM: 150,
        totalEquity: 1000,
        totalDebt: 100,
        cash: 50,
        dpsRegular: 1,
        sector: 'الصناعة',
        sectorClassification: 'non_financial',
        companyTargetPE: 8,
        companyTargetPB: null, // single multiple -> does not require Relative_PE_Weight/PB_Weight
      },
      {
        r_Mode: 3,
        WACC_Mode: 2,
        Beta_Raw_Weight: 1,
        Forecast_Years: 5,
        Growth_Y1: 0.1,
        Growth_Y2: 0.1,
        Growth_Y3: 0.08,
        Growth_Y4: 0.06,
        Growth_Y5: 0.05,
        Weight_DCF: 50,
        Weight_Relative: 50,
      }
    );
    assert.equal(localCapmRawBeta.betaAdjusted, 1.2);
    assert.ok(Math.abs(localCapmRawBeta.costOfEquity! - (0.25 + 1.2 * 0.05)) < 1e-9);
    assert.ok(localCapmRawBeta.dcfValue !== null);
    assert.equal(localCapmRawBeta.relativeValue, 16); // EPS (2) * 8 = 16
  });

  it('9) unknown sector classification blocks automatic DCF even with valid FCFF, while keeping stock listed', () => {
    // Without official sectorPE definitions, static Arabic sector strings must NOT be guessed as financial/non_financial
    assert.equal(classifyCompanySector('غير مصنف', null), 'unknown');
    assert.equal(classifyCompanySector('بنوك وخدمات مالية', null), 'unknown');
    assert.equal(classifyCompanySector('الاتصالات', null), 'unknown');
    assert.equal(classifyCompanySector('قطاع تجريبي غير مصنف بالسجل', null), 'unknown');
    assert.equal(classifyCompanySector('قطاع تجريبي غير مصنف بالسجل', 'non_financial'), 'non_financial');

    // With official sectorPE definitions supplied, classification follows sectorPE strictly
    const officialSectors: SectorDefinition[] = [
      {
        sectorId: 'banks_fin',
        nameAr: 'بنوك وخدمات مالية',
        aliases: ['بنوك'],
        classification: 'financial',
        multiple: 7.5,
        status: 'active',
      },
      {
        sectorId: 'telecom',
        nameAr: 'الاتصالات',
        aliases: ['اتصالات'],
        classification: 'non_financial',
        multiple: 11.0,
        status: 'active',
      },
    ];
    assert.equal(classifyCompanySector('بنوك وخدمات مالية', null, { sectorDefinitions: officialSectors }), 'financial');
    assert.equal(classifyCompanySector('الاتصالات', null, { sectorDefinitions: officialSectors }), 'non_financial');
    assert.equal(classifyCompanySector('قطاع تجريبي غير مصنف بالسجل', null, { sectorDefinitions: officialSectors }), 'unknown');

    const stocks = deriveStocksFromQuarterlyRecords([makeQuarterlyRec({ ticker: 'UNKN', stockName: 'شركة غير مصنفة' })]);
    assert.equal(stocks.length, 1);
    assert.equal(stocks[0].sectorClassification, 'unknown');

    const blockedUnknown = computeComprehensiveValuation(
      {
        ticker: 'UNKN',
        marketPrice: 20,
        sharesOutstanding: 100,
        betaRaw: 1,
        riskFreeRate: 0.25,
        equityRiskPremium: 0.05,
        costOfDebt: 0.15,
        taxRate: 0.225,
        terminalGrowth: 0.05,
        netIncomeTTM: 200,
        ocfTTM: 250,
        capexTTM: 50,
        fcfTTM: 200,
        fcffTTM: 150,
        totalEquity: 1000,
        totalDebt: 100,
        cash: 50,
        dpsRegular: 1,
        sector: 'غير معروف',
        sectorClassification: 'unknown',
      },
      FULL_MACRO
    );
    assert.equal(blockedUnknown.dcfValue, null);
    assert.ok(blockedUnknown.modelStatuses.find((m) => m.model === 'dcf')?.reasonAr?.includes('غير معروف'));
  });

  it('10) ValuationSourcesCard & Excel summary show all 6 provenance items accurately with zero Confidence Score', () => {
    const quarter = makeQuarterlyRec();
    const daily = makeDailyRec();
    const [company] = deriveStocksFromQuarterlyRecords([quarter], [], { ETEL: daily });
    const companyWithMeta: Company = {
      ...company,
      sectorClassification: 'non_financial',
      beta: 1.0,
      targetPE: 9,
      targetPB: 1.6,
    };
    const metrics = calculateTTMMetrics(companyWithMeta, [
      {
        id: 'etel_2025_fy',
        companyId: 'etel',
        year: 2025,
        quarter: 'FY',
        periodDate: '2025-12-31',
        revenueYTD: quarter.revenueYTD,
        grossProfitYTD: quarter.grossProfitYTD,
        operatingProfitYTD: quarter.ebitYTD,
        netProfitYTD: quarter.netIncomeYTD,
        operatingCashFlowYTD: quarter.ocfYTD,
        capexYTD: quarter.capexYTD,
        dividendsPaidYTD: quarter.dividendsPaidYTD,
        totalAssets: quarter.totalAssets,
        totalDebt: quarter.totalDebtWithoutTX,
        cashAndEquivalents: quarter.cash,
        totalEquity: quarter.equity,
        sharesCount: quarter.shares,
        isAudited: true,
        depreciationAmortizationYTD: quarter.depreciationAmortizationYTD,
        changeOperatingNwcYTD: quarter.changeOperatingNwcYTD,
        valuationTaxRate: quarter.valuationTaxRate,
        valuationSource: quarter.valuationSource,
        financialUnit: quarter.financialUnit,
      },
    ]);

    const val = runValuationModels(companyWithMeta, metrics, undefined, FULL_MACRO, {
      priority: 'company_first',
      quarterlyRecords: [quarter],
      latestDaily: daily,
    });

    assert.ok(val.sourcesSummary);
    assert.equal(val.sourcesSummary.latestFinancialPeriod, 'FY 2025');
    assert.equal(val.sourcesSummary.marketPrice, 40);
    assert.equal(val.sourcesSummary.marketPriceDate, '2026-02-01');
    assert.equal(val.sourcesSummary.marketPriceSource, 'lastPrice');
    assert.equal(val.sourcesSummary.sharesSource, 'quarterly_record');
    assert.equal(val.sourcesSummary.sharesPeriod, 'FY 2025');
    assert.equal(val.sourcesSummary.fcffSource, 'قوائم مالية مدققة 2025');
    assert.equal(val.sourcesSummary.fcffUnit, 'EGP_millions');

    const html = renderToStaticMarkup(React.createElement(ValuationSourcesCard, { summary: val.sourcesSummary }));
    assert.match(html, /FY 2025/);
    assert.match(html, /2026-02-01/);
    assert.match(html, /آخر سعر/);
    assert.match(html, /نهاية الفترة المسجلة وليست متوسطاً مرجحاً تاريخياً/);
    assert.match(html, /EGP_millions/);
    assert.equal(/Confidence|درجة الثقة/i.test(html), false);
  });

  it('11) delivery hygiene: root & functions lockfiles exist and no diff/changes artifacts remain in public/ or dist/', () => {
    const rootDir = path.resolve('.');
    assert.equal(fs.existsSync(path.join(rootDir, 'package-lock.json')), true);
    assert.equal(fs.existsSync(path.join(rootDir, 'functions', 'package-lock.json')), true);

    const checkDirClean = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const walk = (curr: string) => {
        for (const entry of fs.readdirSync(curr, { withFileTypes: true })) {
          const full = path.join(curr, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else {
            assert.equal(
              /\.diff$/i.test(entry.name) || /^changes_/i.test(entry.name),
              false,
              `Forbidden artifact found in delivery folder: ${full}`
            );
          }
        }
      };
      walk(dir);
    };

    checkDirClean(path.join(rootDir, 'public'));
    checkDirClean(path.join(rootDir, 'dist'));
  });
});
