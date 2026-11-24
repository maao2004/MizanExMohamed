import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';

import {
  RIM_REGISTRY_KEYS,
  getParameterDefinition,
  getValuationLabField,
  validateParameterRecords,
  validateValuationLabFieldValue,
} from '../src/core/contracts';
import {
  ValuationSaveConcurrencyController,
  classifyConsistencyChecksState,
  classifyFadeScheduleState,
  describeTerminalShareState,
  getRimParameterRequirements,
} from '../src/core/domain';
import { computeComprehensiveValuation } from '../src/core/math/valuation';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { buildCompanyValuationWorkbook } from '../src/utils/excelExport';
import { ValuationView } from '../src/components/ValuationView';
import type {
  Company,
  CompanyParameterOverride,
  DailyTradingRecord,
  QuarterlyFinancial,
  RimAuditSummary,
} from '../src/types/financial';

const BASE_MACROS: Record<string, number> = {
  TaxRate: 0.225,
  Rf_Egypt_10Y: 0.15,
  ERP_Developed: 0.05,
  CRP_Egypt: 0, // Ke = 0.15 + 1.0 * 0.05 = 0.20
  Beta_Default: 1.0,
  Terminal_Growth: 0.05,
  Exit_Multiple: 6,
  Forecast_Years: 3,
  Cost_of_Debt: 0.16,
  Growth_Y1: 0.1,
  Growth_Y2: 0.08,
  Growth_Y3: 0.06,
  WACC_Mode: 1,
  DDM_Growth: 0.05,
  r_Mode: 1,
  Weight_DCF: 25,
  Weight_DDM: 15,
  Weight_RIM: 30,
  Weight_Relative: 20,
  Weight_Graham: 10,
  Beta_Raw_Weight: 1,
  Beta_Anchor: 1,
  Country_Risk_Lambda: 1,
  RIM_Retention: 0.5,
  RIM_Terminal_Method: 1,
  Relative_PE_Weight: 0.5,
  Relative_PB_Weight: 0.5,
};

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
    riskFreeRate: 0.15,
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

function makeQuarterFin(overrides: Partial<QuarterlyFinancial> = {}): QuarterlyFinancial {
  return {
    id: 'COMI_2025_FY',
    companyId: 'comi',
    year: 2025,
    quarter: 'FY',
    periodDate: '2025-12-31',
    periodStartDate: '2025-01-01',
    periodEndDate: '2025-12-31',
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

function makeDaily(overrides: Partial<DailyTradingRecord> = {}): DailyTradingRecord {
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

function makeBaseEngineInput(overrides: Record<string, unknown> = {}) {
  return {
    ticker: 'COMI',
    marketPrice: 60,
    sharesOutstanding: 100_000_000,
    betaRaw: 1.0,
    betaStatus: 'actual' as const,
    netIncomeTTM: 250_000_000,
    ocfTTM: 280_000_000,
    capexTTM: 30_000_000,
    fcfTTM: 250_000_000,
    totalEquity: 1_000_000_000,
    totalDebt: 0,
    cash: 100_000_000,
    sector: 'بنوك',
    sectorClassification: 'financial' as const,
    bvpsUsed: 10,
    bvpsBasis: 'common_equity_explicit',
    bvpsBasisLabelAr: 'حقوق المساهمين العاديين (صريح)',
    roeUsed: 0.25,
    roeBasis: 'common_eop',
    roeBasisLabelAr: 'عائد حقوق المساهمين العاديين (نهاية الفترة)',
    ...overrides,
  };
}

describe('Batch 3: RIM Contract, Engine Math, Governance UI & Excel Export Parity', () => {
  it('1) Aligns all 6 RIM parameters identically across parameterRegistry, valuationFieldRegistry, and server validation', () => {
    for (const key of RIM_REGISTRY_KEYS) {
      const reg = getParameterDefinition(key);
      const field = getValuationLabField(key);
      assert.ok(reg, `Missing parameterRegistry definition for ${key}`);
      assert.ok(field, `Missing valuationFieldRegistry definition for ${key}`);
      assert.equal(field.registryKey, reg.key);
      assert.equal(field.type, reg.valueType);
      assert.equal(field.unit, reg.unit);
      assert.deepEqual([...field.allowedScopes].sort(), [...reg.allowedScopes].sort());
      assert.equal(field.min, reg.min);
      assert.equal(field.max, reg.max);
      assert.equal(field.supportsSensitivityDraft, true);
    }

    const modeField = getValuationLabField('RIM_Terminal_Method');
    assert.deepEqual(
      modeField?.modeOptions?.map((o) => o.value),
      [1, 2, 3]
    );

    // UI validator & server validator enforce identical bounds and integer/mode constraints
    assert.equal(validateValuationLabFieldValue('RIM_Terminal_Method', 4).valid, false);
    assert.equal(validateValuationLabFieldValue('RIM_Terminal_Method', 1.5).valid, false);
    assert.equal(validateValuationLabFieldValue('RIM_Fade_Years', 0).valid, false);
    assert.equal(validateValuationLabFieldValue('RIM_Fade_Years', 21).valid, false);
    assert.equal(validateValuationLabFieldValue('RIM_Fade_Years', 3.5).valid, false);
    assert.equal(validateValuationLabFieldValue('RIM_Expected_ROE', -2.1).valid, false);
    assert.equal(validateValuationLabFieldValue('RIM_Expected_ROE', 5.1).valid, false);
    assert.equal(validateValuationLabFieldValue('RIM_Terminal_Retention', -0.01).valid, false);
    assert.equal(validateValuationLabFieldValue('RIM_Terminal_Retention', 1.01).valid, false);

    assert.throws(
      () => validateParameterRecords([{ key: 'RIM_Terminal_Method', value: 4, scope: 'company', ticker: 'COMI' }]),
      /RIM_Terminal_Method/
    );
    assert.throws(
      () => validateParameterRecords([{ key: 'RIM_Fade_Years', value: 2.5, scope: 'company', ticker: 'COMI' }]),
      /RIM_Fade_Years/
    );
    assert.throws(
      () => validateParameterRecords([{ key: 'Rf_USD_10Y', value: 0.04, scope: 'company', ticker: 'COMI' }]),
      /لا يدعم النطاق/
    );

    // Valid company & global payloads pass server validation
    const validBatch = validateParameterRecords([
      { key: 'RIM_Terminal_Method', value: 2, scope: 'company', ticker: 'COMI' },
      { key: 'RIM_Fade_Years', value: 5, scope: 'company', ticker: 'COMI' },
      { key: 'RIM_Expected_ROE', value: 0.28, scope: 'global', precondition: { mode: 'create' } },
      { key: 'RIM_Terminal_ROE', value: 0.22, scope: 'company', ticker: 'COMI' },
      { key: 'RIM_Terminal_Retention', value: 0.3, scope: 'company', ticker: 'COMI' },
    ]);
    assert.equal(validBatch.length, 5);
  });

  it('2) Enforces ROE === Ke => RI === 0 and FairValue === B0 across Methods 1, 2, and 3', () => {
    const scenarios: Array<{ label: string; macros: Record<string, number> }> = [
      {
        label: 'Method 1',
        macros: { ...BASE_MACROS, RIM_Terminal_Method: 1, RIM_Expected_ROE: 0.2 },
      },
      {
        label: 'Method 2 (fade to Ke)',
        macros: { ...BASE_MACROS, RIM_Terminal_Method: 2, RIM_Expected_ROE: 0.2, RIM_Fade_Years: 5 },
      },
      {
        label: 'Method 2 (explicit terminal ROE = Ke)',
        macros: {
          ...BASE_MACROS,
          RIM_Terminal_Method: 2,
          RIM_Expected_ROE: 0.2,
          RIM_Fade_Years: 4,
          RIM_Terminal_ROE: 0.2,
          RIM_Terminal_Retention: 0.4,
        },
      },
      {
        label: 'Method 3',
        macros: {
          ...BASE_MACROS,
          RIM_Terminal_Method: 3,
          RIM_Expected_ROE: 0.2,
          RIM_Terminal_ROE: 0.2,
          RIM_Terminal_Retention: 0.5, // g_B = 0.10 < Ke = 0.20
        },
      },
    ];

    for (const s of scenarios) {
      const res = computeComprehensiveValuation(makeBaseEngineInput({ bvpsUsed: 10, roeUsed: 0.3 }), s.macros);
      assert.equal(res.rimAudit.eligible, true, `${s.label} should be eligible`);
      assert.equal(res.rimAudit.cleanSurplusVerified, true, `${s.label} clean surplus`);
      for (const y of res.rimAudit.years) {
        assert.ok(Math.abs(y.residualIncome) < 1e-12, `${s.label} Y${y.year} RI must be 0`);
      }
      for (const f of res.rimAudit.fadeSchedule ?? []) {
        assert.ok(Math.abs(f.residualIncome) < 1e-12, `${s.label} fade Y${f.year} RI must be 0`);
      }
      assert.ok(Math.abs((res.rimValue ?? 0) - 10) < 1e-9, `${s.label} FV must equal B0=10`);
    }
  });

  it('3) Independently verifies ROE > Ke and ROE < Ke across Methods 1, 2 (fade + continuation), and 3', () => {
    const B0 = 10;
    const Ke = 0.2;
    const b = 0.5;
    const roeHigh = 0.3;

    // Independent manual calculation for 5-year horizon
    let curB = B0;
    let expectedPv5Y = 0;
    for (let t = 1; t <= 5; t++) {
      const ri = (roeHigh - Ke) * curB;
      expectedPv5Y += ri / Math.pow(1 + Ke, t);
      curB = curB * (1 + roeHigh * b);
    }
    const B5 = curB;

    // Method 1: TV = ((ROE - Ke) * B5 / Ke) / (1 + Ke)^5
    const expectedM1Tv = ((roeHigh - Ke) * B5) / Ke;
    const expectedM1Fv = B0 + expectedPv5Y + expectedM1Tv / Math.pow(1 + Ke, 5);
    const m1 = computeComprehensiveValuation(makeBaseEngineInput({ bvpsUsed: B0, roeUsed: 0.18 }), {
      ...BASE_MACROS,
      RIM_Terminal_Method: 1,
      RIM_Expected_ROE: roeHigh,
      RIM_Retention: b,
    });
    assert.equal(m1.rimAudit.forwardRoeBasis, 'explicit_expected_roe');
    assert.equal(m1.rimAudit.fadeScheduleStatus, 'not_applicable');
    assert.ok(Math.abs((m1.rimValue ?? 0) - expectedM1Fv) < 1e-9);
    assert.ok((m1.rimValue ?? 0) > B0);

    // Method 2: 4-year linear fade from 0.30 to 0.24, terminalRetention = 0.25 => g_B = 0.06 < 0.20
    const fadeYears = 4;
    const termRoe = 0.24;
    const termRet = 0.25;
    const gB2 = termRoe * termRet;
    let fB = B5;
    let pvFade = 0;
    for (let k = 1; k <= fadeYears; k++) {
      const roeK = roeHigh + ((termRoe - roeHigh) * k) / fadeYears;
      const riK = (roeK - Ke) * fB;
      pvFade += riK / Math.pow(1 + Ke, 5 + k);
      fB = fB * (1 + roeK * termRet);
    }
    const postFadeTv = ((termRoe - Ke) * fB) / (Ke - gB2);
    const pvPostFadeTv = postFadeTv / Math.pow(1 + Ke, 5 + fadeYears);
    const expectedM2Fv = B0 + expectedPv5Y + pvFade + pvPostFadeTv;

    const m2 = computeComprehensiveValuation(makeBaseEngineInput({ bvpsUsed: B0 }), {
      ...BASE_MACROS,
      RIM_Terminal_Method: 2,
      RIM_Expected_ROE: roeHigh,
      RIM_Retention: b,
      RIM_Fade_Years: fadeYears,
      RIM_Terminal_ROE: termRoe,
      RIM_Terminal_Retention: termRet,
    });
    assert.equal(m2.rimAudit.eligible, true);
    assert.equal(m2.rimAudit.fadeScheduleStatus, 'applicable');
    assert.equal(m2.rimAudit.fadeSchedule?.length, fadeYears);
    assert.deepEqual(
      m2.rimAudit.fadeSchedule?.map((r) => r.year),
      [6, 7, 8, 9]
    );
    // Strict Y5 -> Y6 continuity check
    assert.ok(Math.abs((m2.rimAudit.fadeSchedule?.[0].openingBvps ?? 0) - B5) < 1e-9);
    assert.ok(Math.abs((m2.rimAudit.pvPostFadeContinuationTv ?? 0) - pvPostFadeTv) < 1e-9);
    assert.ok(Math.abs((m2.rimValue ?? 0) - expectedM2Fv) < 1e-9);

    // Method 3 with ROE < Ke (value-destroying below cost of equity): ROE = 0.12, termROE = 0.12, termRet = 0.4 => g_B = 0.048 < 0.20
    const roeLow = 0.12;
    let lowB = B0;
    let lowPv5 = 0;
    for (let t = 1; t <= 5; t++) {
      lowPv5 += ((roeLow - Ke) * lowB) / Math.pow(1 + Ke, t);
      lowB = lowB * (1 + roeLow * b);
    }
    const m3LowTv = ((roeLow - Ke) * lowB) / (Ke - roeLow * 0.4);
    const expectedM3LowFv = B0 + lowPv5 + m3LowTv / Math.pow(1 + Ke, 5);
    const m3Low = computeComprehensiveValuation(makeBaseEngineInput({ bvpsUsed: B0 }), {
      ...BASE_MACROS,
      RIM_Terminal_Method: 3,
      RIM_Expected_ROE: roeLow,
      RIM_Retention: b,
      RIM_Terminal_ROE: roeLow,
      RIM_Terminal_Retention: 0.4,
    });
    assert.equal(m3Low.rimAudit.eligible, true);
    assert.equal(m3Low.rimAudit.fadeScheduleStatus, 'not_applicable');
    assert.ok((m3Low.rimValue ?? 99) < B0);
    assert.ok(Math.abs((m3Low.rimValue ?? 0) - expectedM3LowFv) < 1e-9);
  });

  it('4) Rejects missing active-method parameters, ignores missing inactive-method parameters, and enforces g_B < Ke', () => {
    // Method 1 succeeds even when RIM_Fade_Years, RIM_Terminal_ROE, RIM_Terminal_Retention are absent
    const m1Clean = computeComprehensiveValuation(makeBaseEngineInput(), {
      ...BASE_MACROS,
      RIM_Terminal_Method: 1,
    });
    assert.equal(m1Clean.rimAudit.eligible, true);

    // Method 2 without RIM_Fade_Years is excluded cleanly
    const m2NoFade = computeComprehensiveValuation(makeBaseEngineInput(), {
      ...BASE_MACROS,
      RIM_Terminal_Method: 2,
    });
    assert.equal(m2NoFade.rimAudit.eligible, false);
    assert.equal(m2NoFade.rimValue, null);
    assert.match(m2NoFade.rimAudit.exclusionReasonAr ?? '', /RIM_Fade_Years/);

    // Method 2 with RIM_Terminal_ROE != Ke and missing RIM_Terminal_Retention is excluded
    const m2NoRet = computeComprehensiveValuation(makeBaseEngineInput(), {
      ...BASE_MACROS,
      RIM_Terminal_Method: 2,
      RIM_Fade_Years: 5,
      RIM_Terminal_ROE: 0.24,
    });
    assert.equal(m2NoRet.rimAudit.eligible, false);
    assert.match(m2NoRet.rimAudit.exclusionReasonAr ?? '', /RIM_Terminal_Retention/);

    // Method 3 with g_B >= Ke is excluded
    const m3Diverge = computeComprehensiveValuation(makeBaseEngineInput(), {
      ...BASE_MACROS,
      RIM_Terminal_Method: 3,
      RIM_Terminal_ROE: 0.3,
      RIM_Terminal_Retention: 0.8, // g_B = 0.24 >= Ke = 0.20
    });
    assert.equal(m3Diverge.rimAudit.eligible, false);
    assert.match(m3Diverge.rimAudit.exclusionReasonAr ?? '', /g_B/);

    // Method 3 succeeds even when RIM_Fade_Years (inactive for Method 3) is absent
    const m3Clean = computeComprehensiveValuation(makeBaseEngineInput(), {
      ...BASE_MACROS,
      RIM_Terminal_Method: 3,
      RIM_Terminal_ROE: 0.25,
      RIM_Terminal_Retention: 0.4, // g_B = 0.10 < 0.20
    });
    assert.equal(m3Clean.rimAudit.eligible, true);
  });

  it('5) Handles negative raw RIM value clipping transparently and excludes non-finite overflow from composite fair value', () => {
    // Deep negative ROE => rawRimFairValue < 0 => clipped to 0 with explicit note & null terminalShareOfRimPct
    const negRes = computeComprehensiveValuation(makeBaseEngineInput({ bvpsUsed: 10 }), {
      ...BASE_MACROS,
      RIM_Terminal_Method: 1,
      RIM_Expected_ROE: -0.5,
      RIM_Retention: 0.1,
    });
    assert.equal(negRes.rimAudit.eligible, true);
    assert.ok((negRes.rimAudit.rawRimFairValue ?? 0) < 0);
    assert.equal(negRes.rimValue, 0);
    assert.equal(negRes.rimAudit.rawClippedToZero, true);
    assert.match(negRes.rimAudit.rawClippedReasonAr ?? '', /0\.00/);
    assert.equal(negRes.rimAudit.terminalShareOfRimPct, null);
    assert.match(describeTerminalShareState(negRes.rimAudit).valueText, /غير متاح/);

    // Non-finite overflow (extreme BVPS causing Infinity in terminal/compounding) => excluded cleanly, NEVER enters composite
    const overflowRes = computeComprehensiveValuation(
      makeBaseEngineInput({ bvpsUsed: 1e308, companyTargetPE: 10, companyTargetPB: null }),
      {
        ...BASE_MACROS,
        RIM_Terminal_Method: 1,
        RIM_Expected_ROE: 2.0,
        RIM_Retention: 0.9,
      }
    );
    assert.equal(overflowRes.rimAudit.eligible, false);
    assert.equal(overflowRes.rimValue, null);
    assert.match(overflowRes.rimAudit.exclusionReasonAr ?? '', /غير منتهٍ|NaN\/Infinity/);
    assert.ok(
      overflowRes.compositeFairValue === null || Number.isFinite(overflowRes.compositeFairValue),
      'Composite fair value must never become Infinity or NaN'
    );
  });

  it('6) Separates active vs inactive method requirements and preserves saved inactive values across method switches', () => {
    const reqM1 = getRimParameterRequirements({
      terminalMethod: 1,
      terminalRoe: 0.25,
      costOfEquity: 0.2,
      rimRetentionPolicy: 'rim_parameter',
    });
    assert.equal(reqM1.RIM_Fade_Years.status, 'inactive');
    assert.equal(reqM1.RIM_Terminal_ROE.status, 'inactive');
    assert.equal(reqM1.RIM_Terminal_Retention.status, 'inactive');

    const reqM2ToKe = getRimParameterRequirements({
      terminalMethod: 2,
      terminalRoe: 0.2,
      costOfEquity: 0.2,
      rimRetentionPolicy: 'rim_parameter',
    });
    assert.equal(reqM2ToKe.RIM_Fade_Years.status, 'required');
    assert.equal(reqM2ToKe.RIM_Terminal_ROE.status, 'optional');
    assert.equal(reqM2ToKe.RIM_Terminal_Retention.status, 'optional');

    const reqM2Diff = getRimParameterRequirements({
      terminalMethod: 2,
      terminalRoe: 0.26,
      costOfEquity: 0.2,
      rimRetentionPolicy: 'rim_parameter',
    });
    assert.equal(reqM2Diff.RIM_Terminal_Retention.status, 'required');

    const reqM3 = getRimParameterRequirements({
      terminalMethod: 3,
      terminalRoe: 0.25,
      costOfEquity: 0.2,
      rimRetentionPolicy: 'rim_parameter',
    });
    assert.equal(reqM3.RIM_Fade_Years.status, 'inactive');
    assert.equal(reqM3.RIM_Terminal_ROE.status, 'required');
    assert.equal(reqM3.RIM_Terminal_Retention.status, 'required');

    // Concurrency controller safely isolates company switches while a RIM parameter save is in flight
    const ctrl = new ValuationSaveConcurrencyController('COMI');
    const hMethod = ctrl.beginRequest('COMI', 'RIM_Terminal_Method');
    assert.ok(hMethod);
    assert.equal(ctrl.beginRequest('COMI', 'RIM_Terminal_Method'), null);
    const hFade = ctrl.beginRequest('COMI', 'RIM_Fade_Years');
    assert.ok(hFade);

    ctrl.setActiveTicker('ETEL');
    const stale = ctrl.completeRequest(hMethod!);
    assert.equal(stale.shouldApplyUiState, false);
    assert.equal(stale.staleReason, 'ticker_changed');
    const staleFade = ctrl.completeRequest(hFade!);
    assert.equal(staleFade.shouldApplyUiState, false);

    // Switching back allows immediate fresh save
    ctrl.setActiveTicker('COMI');
    const retry = ctrl.beginRequest('COMI', 'RIM_Terminal_Method');
    assert.ok(retry);
    assert.equal(ctrl.completeRequest(retry!).shouldApplyUiState, true);
  });

  it('7) Verifies Engine <-> UI <-> Excel parity for Method 2 fade schedule, inactive cards, sensitivity (0 writes), and missing-check honesty', async () => {
    const company = makeCompany();
    const q = makeQuarterFin();
    const metrics = calculateTTMMetrics(company, [q], {
      latestDaily: makeDaily(),
      dividendRecords: [],
      cutoffDate: '2026-04-01',
    });

    const companyOverridesMap: Record<string, CompanyParameterOverride> = {
      RIM_Terminal_Method: {
        ticker: 'COMI',
        key: 'RIM_Terminal_Method',
        value: 2,
        scope: 'company',
        source: 'لجنة التقييم',
        asOfDate: '2026-04-01',
      },
      RIM_Expected_ROE: {
        ticker: 'COMI',
        key: 'RIM_Expected_ROE',
        value: 0.3,
        scope: 'company',
        source: 'تقدير مستقبلي',
        asOfDate: '2026-04-01',
      },
      RIM_Fade_Years: {
        ticker: 'COMI',
        key: 'RIM_Fade_Years',
        value: 3,
        scope: 'company',
        source: 'لجنة التقييم',
        asOfDate: '2026-04-01',
      },
      RIM_Terminal_ROE: {
        ticker: 'COMI',
        key: 'RIM_Terminal_ROE',
        value: 0.22,
        scope: 'company',
        source: 'لجنة التقييم',
        asOfDate: '2026-04-01',
      },
      RIM_Terminal_Retention: {
        ticker: 'COMI',
        key: 'RIM_Terminal_Retention',
        value: 0.3,
        scope: 'company',
        source: 'لجنة التقييم',
        asOfDate: '2026-04-01',
      },
    };

    const valM2 = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      priority: 'company_first',
      companyOverridesMap,
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-04-01', source: 'EGX' },
      betaConfirmed: true,
    });

    assert.equal(valM2.rimAudit?.eligible, true);
    assert.equal(valM2.rimAudit?.terminalMethod, 2);
    assert.equal(valM2.rimAudit?.fadeSchedule?.length, 3);

    let writeCalls = 0;
    const viewHtmlM2 = renderToStaticMarkup(
      React.createElement(ValuationView, {
        company,
        metrics: { ...metrics, costOfEquity: valM2.engineOutputs?.costOfEquity ?? null, wacc: valM2.engineOutputs?.wacc ?? null },
        valuation: valM2,
        assumptionPriority: 'company_first',
        onChangePriority: () => undefined,
        rimRetentionPolicy: 'rim_parameter',
        onChangeRimRetentionPolicy: () => undefined,
        onUpdateCompanyParams: () => undefined,
        companyOverridesMap,
        paramsMap: BASE_MACROS,
        isAdmin: true,
        canEditFinancials: true,
        onSaveCompanyOverride: async () => {
          writeCalls += 1;
          return { docPath: 'company_assumptions/COMI/parameters/RIM_Terminal_Method', verifiedAt: '2026-04-01' };
        },
        initialModelTab: 'rim',
      })
    );

    assert.equal(writeCalls, 0);
    assert.match(viewHtmlM2, /rim-separation-panel/);
    assert.match(viewHtmlM2, /rim-parameters-grid/);
    assert.match(viewHtmlM2, /param-card-RIM_Terminal_Method/);
    assert.match(viewHtmlM2, /param-card-RIM_Expected_ROE/);
    assert.match(viewHtmlM2, /param-card-RIM_Fade_Years/);
    assert.match(viewHtmlM2, /param-card-RIM_Terminal_ROE/);
    assert.match(viewHtmlM2, /param-card-RIM_Terminal_Retention/);
    assert.match(viewHtmlM2, /data-fade-state="available"/);
    assert.match(viewHtmlM2, /data-consistency-state="available"/);
    assert.match(viewHtmlM2, /تقديرات مستقبلية وضمنية/);

    // Switch to Method 1 while keeping saved Method 2/3 values intact => Fade card dimmed/inactive & fade section shows "غير منطبق"
    const m1Overrides = {
      ...companyOverridesMap,
      RIM_Terminal_Method: { ...companyOverridesMap.RIM_Terminal_Method, value: 1 },
    };
    const valM1 = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      priority: 'company_first',
      companyOverridesMap: m1Overrides,
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-04-01', source: 'EGX' },
      betaConfirmed: true,
    });

    const viewHtmlM1 = renderToStaticMarkup(
      React.createElement(ValuationView, {
        company,
        metrics: { ...metrics, costOfEquity: valM1.engineOutputs?.costOfEquity ?? null, wacc: valM1.engineOutputs?.wacc ?? null },
        valuation: valM1,
        assumptionPriority: 'company_first',
        onChangePriority: () => undefined,
        rimRetentionPolicy: 'rim_parameter',
        onChangeRimRetentionPolicy: () => undefined,
        onUpdateCompanyParams: () => undefined,
        companyOverridesMap: m1Overrides,
        paramsMap: BASE_MACROS,
        initialModelTab: 'rim',
      })
    );
    assert.match(viewHtmlM1, /data-testid="param-card-RIM_Fade_Years"[^>]*data-inactive-for-method="true"/);
    assert.match(viewHtmlM1, /data-fade-state="not_applicable"/);
    assert.match(viewHtmlM1, /غير منطبق/);
    // Saved Method 2 value (3 سنة) is still displayed cleanly without being erased
    assert.match(viewHtmlM1, /3 سنة/);

    // Excel export parity for Method 2
    const wbM2 = await buildCompanyValuationWorkbook(company, [q], metrics, valM2, []);
    const rimSheetM2 = XLSX.utils.sheet_to_json(wbM2.Sheets['RIM_Audit'], { header: 1 }) as unknown[][];
    assert.ok(rimSheetM2.some((r) => r[0] === 'معاملات RIM ومصادرها المعتمدة'));
    assert.ok(rimSheetM2.some((r) => String(r[0]).startsWith('RIM_Terminal_Method')));
    assert.ok(rimSheetM2.some((r) => r[0] === 'Year' && r[2] === 'Fade ROE'));
    assert.ok(rimSheetM2.some((r) => r[0] === 'حالة فحوصات الاتساق الحسابي' && String(r[1]).includes('تم التحقق')));

    // Excel export parity for Method 1 (not_applicable fade schedule)
    const wbM1 = await buildCompanyValuationWorkbook(company, [q], metrics, valM1, []);
    const rimSheetM1 = XLSX.utils.sheet_to_json(wbM1.Sheets['RIM_Audit'], { header: 1 }) as unknown[][];
    const fadeRowM1 = rimSheetM1.find((r) => r[0] === 'جدول مرحلة التلاشي (Fade Schedule)');
    assert.ok(fadeRowM1 && String(fadeRowM1[1]).includes('غير منطبق'));

    // Missing fadeSchedule & missing consistencyChecksAr MUST be reported as unavailable (NEVER pass!)
    const partialAudit: RimAuditSummary = {
      ...valM2.rimAudit!,
      fadeSchedule: undefined,
      fadeScheduleStatus: undefined,
      consistencyChecksAr: undefined,
    };
    assert.equal(classifyFadeScheduleState(partialAudit).kind, 'unavailable');
    assert.equal(classifyConsistencyChecksState(partialAudit).kind, 'unavailable');
    assert.match(classifyConsistencyChecksState(partialAudit).descriptionAr, /لا يُعدّ/);

    const wbMissing = await buildCompanyValuationWorkbook(
      company,
      [q],
      metrics,
      { ...valM2, rimAudit: partialAudit },
      []
    );
    const rimSheetMissing = XLSX.utils.sheet_to_json(wbMissing.Sheets['RIM_Audit'], { header: 1 }) as unknown[][];
    const checksRowMissing = rimSheetMissing.find((r) => r[0] === 'فحوصات الاتساق الحسابي (consistencyChecksAr)');
    assert.ok(checksRowMissing && String(checksRowMissing[1]).includes('غير متاح'));
    assert.ok(checksRowMissing && String(checksRowMissing[1]).includes('لا يُعدّ'));
  });

  it('8) Missing RIM_Retention diagnostic explains authoritative sources, active priority, and completion steps without blaming only global macros or assuming 50%', () => {
    const company = makeCompany();
    const q = makeQuarterFin();
    const metrics = calculateTTMMetrics(company, [q], {
      latestDaily: makeDaily(),
      dividendRecords: [],
      cutoffDate: '2026-04-01',
    });

    const macrosWithoutRetention: Record<string, number> = { ...BASE_MACROS };
    delete macrosWithoutRetention.RIM_Retention;

    // 1. Missing in both company_assumptions and macro_params under company_first
    const valMissingCompanyFirst = runValuationModels(company, metrics, undefined, macrosWithoutRetention, {
      priority: 'company_first',
      companyOverridesMap: {},
      quarterlyRecords: [q],
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-04-01', source: 'EGX' },
      betaConfirmed: true,
    });
    assert.equal(valMissingCompanyFirst.rimFairValue, null);
    assert.equal(valMissingCompanyFirst.rimAudit?.eligible, false);
    const reasonCompanyFirst = valMissingCompanyFirst.rimAudit?.exclusionReasonAr ?? '';
    assert.doesNotMatch(reasonCompanyFirst, /غير محفوظة في المتغيرات الكلية/);
    assert.match(reasonCompanyFirst, /RIM_Retention/);
    assert.match(reasonCompanyFirst, /company_assumptions/);
    assert.match(reasonCompanyFirst, /macro_params/);
    assert.match(reasonCompanyFirst, /تخصيص الشركة \(company_assumptions\) ثم المرجع العام \(macro_params\)/);
    assert.match(reasonCompanyFirst, /خطوة الاستكمال/);
    const rimStatusDirect = valMissingCompanyFirst.modelStatuses?.find((m) => m.model === 'rim');
    const rimStatusCompanyFirst = valMissingCompanyFirst.sourcesSummary?.modelStatuses.find((m) => m.model === 'rim');
    assert.equal(rimStatusDirect?.reasonAr, reasonCompanyFirst);
    assert.equal(rimStatusCompanyFirst?.reasonAr, reasonCompanyFirst);

    // 2. Missing under global_first reflects centralized priority without duplicating rules in UI
    const valMissingGlobalFirst = runValuationModels(company, metrics, undefined, macrosWithoutRetention, {
      priority: 'global_first',
      companyOverridesMap: {},
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-04-01', source: 'EGX' },
      betaConfirmed: true,
    });
    const reasonGlobalFirst = valMissingGlobalFirst.rimAudit?.exclusionReasonAr ?? '';
    assert.match(reasonGlobalFirst, /المرجع العام \(macro_params\) ثم تخصيص الشركة \(company_assumptions\)/);

    // 3. UI renders the centralized engine exclusion reason & parameter hint directly
    const viewHtmlMissing = renderToStaticMarkup(
      React.createElement(ValuationView, {
        company,
        metrics: {
          ...metrics,
          costOfEquity: valMissingCompanyFirst.engineOutputs?.costOfEquity ?? null,
          wacc: valMissingCompanyFirst.engineOutputs?.wacc ?? null,
        },
        valuation: valMissingCompanyFirst,
        assumptionPriority: 'company_first',
        onChangePriority: () => undefined,
        rimRetentionPolicy: 'rim_parameter',
        onChangeRimRetentionPolicy: () => undefined,
        onUpdateCompanyParams: () => undefined,
        companyOverridesMap: {},
        paramsMap: macrosWithoutRetention,
        initialModelTab: 'rim',
      })
    );
    assert.match(viewHtmlMissing, /data-testid="rim-exclusion-banner"/);
    assert.match(viewHtmlMissing, /لا توجد قيمة فعالة لمعامل RIM_Retention في المصادر المعتمدة/);
    assert.match(viewHtmlMissing, /خطوة الاستكمال/);
    assert.doesNotMatch(viewHtmlMissing, /غير محفوظة في المتغيرات الكلية/);

    // 4. Providing RIM_Retention ONLY in company_assumptions (while absent from macro_params) qualifies RIM cleanly
    const valCompanyOnly = runValuationModels(company, metrics, undefined, macrosWithoutRetention, {
      priority: 'company_first',
      companyOverridesMap: {
        RIM_Retention: {
          ticker: 'COMI',
          key: 'RIM_Retention',
          value: 0.4,
          scope: 'company',
          source: 'تخصيص لجنة التقييم',
          asOfDate: '2026-04-01',
        },
      },
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-04-01', source: 'EGX' },
      betaConfirmed: true,
    });
    assert.equal(valCompanyOnly.rimAudit?.eligible, true);
    assert.equal(valCompanyOnly.rimAudit?.retentionUsed, 0.4);
    assert.equal(valCompanyOnly.resolvedAssumptions?.rimRetention?.source, 'company');

    // 5. Minimum policy with missing RIM_Retention also cites both authoritative sources & completion step
    const compMinimumMissing = computeComprehensiveValuation(
      makeBaseEngineInput({
        rimRetentionPolicy: 'minimum',
        historicalRetentionRatio: 0.35,
        historicalRetentionSuitableForRim: true,
      }) as Parameters<typeof computeComprehensiveValuation>[0],
      macrosWithoutRetention
    );
    assert.equal(compMinimumMissing.rimValue, null);
    assert.match(compMinimumMissing.rimAudit.exclusionReasonAr ?? '', /company_assumptions/);
    assert.match(compMinimumMissing.rimAudit.exclusionReasonAr ?? '', /macro_params/);
    assert.match(compMinimumMissing.rimAudit.exclusionReasonAr ?? '', /خطوة الاستكمال/);
  });
});
