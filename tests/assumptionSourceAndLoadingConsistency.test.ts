/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act } from 'react';
import { Window } from 'happy-dom';
import * as XLSX from 'xlsx';

import {
  describeBetaEffectiveSource,
  formatDocumentaryMetadataAr,
  formatScopedAssumptionStateAr,
} from '../src/core/domain';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { buildCompanyValuationWorkbook } from '../src/utils/excelExport';
import { ValuationView } from '../src/components/ValuationView';
import type {
  AssumptionPriority,
  BetaAssumptionRecord,
  Company,
  CompanyParameterOverride,
  DividendRecord,
  DividendYearStatusRecord,
  QuarterlyFinancial,
} from '../src/types/financial';
import type { DailyTradingRecord } from '../src/types';

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'co-b38',
    ticker: 'B38T',
    name: 'Batch 38 Audit Co.',
    sector: 'Industrials',
    currency: 'EGP',
    financialCurrency: 'EGP',
    marketPrice: 20,
    sharesOutstanding: 100_000_000,
    beta: 1.0,
    wacc: 0.2,
    terminalGrowthRate: 0.05,
    expectedEarningsGrowth: 0.1,
    dividendGrowthRate: 0.05,
    latestTradeDate: '2026-04-28',
    ...overrides,
  };
}

function makeQuarterly(ticker = 'B38T', companyId = 'co-b38'): QuarterlyFinancial {
  return {
    id: `${ticker}_2025_Q4`,
    companyId,
    year: 2025,
    quarter: 4,
    date: '2025-12-31',
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 450_000_000,
    operatingProfitYTD: 320_000_000,
    netProfitYTD: 250_000_000,
    netIncomeCommonYTD: 250_000_000,
    netIncomeCommonBasis: 'attested_common_ni',
    operatingCashFlowYTD: 280_000_000,
    capexYTD: 60_000_000,
    dividendsPaidYTD: 200_000_000,
    totalAssets: 2_200_000_000,
    totalLiabilities: 1_000_000_000,
    totalEquity: 1_200_000_000,
    commonEquity: 1_200_000_000,
    commonEquityBasis: 'attested_common_equity',
    cashAndEquivalents: 300_000_000,
    totalDebt: 200_000_000,
    sharesOutstanding: 100_000_000,
    financialCurrency: 'EGP',
    financialUnit: 'base',
  };
}

function makeDaily(ticker = 'B38T'): DailyTradingRecord {
  return {
    id: `${ticker}_2026-04-28`,
    ticker,
    date: '2026-04-28',
    close: 20,
    listedShares: 100_000_000,
    marketCap: 2_000_000_000,
  };
}

function makeDividends(ticker = 'B38T'): {
  records: DividendRecord[];
  statuses: DividendYearStatusRecord[];
} {
  return {
    records: [
      {
        ticker,
        fiscalYear: 2025,
        recordType: 'regular',
        distributionId: 'DIST_2025_REG',
        cashDps: 2.0,
        currency: 'EGP',
        approvalStatus: 'approved',
        distributionSemantics: 'annual_total',
        paymentDate: '2026-03-25',
        exDividendDate: '2026-03-10',
        recordDate: '2026-03-15',
        source: 'قرار الجمعية العامة',
      },
    ],
    statuses: [
      {
        ticker,
        fiscalYear: 2025,
        status: 'complete',
        source: 'مراجعة محضر الجمعية',
      },
    ],
  };
}

const BASE_MACROS: Record<string, number> = {
  r_Mode: 3,
  WACC_Mode: 2,
  Rf_Egypt_10Y: 0.20,
  ERP_Developed: 0.06,
  Beta_Raw_Weight: 0.6667,
  Beta_Anchor: 1.0,
  DDM_Growth: 0.06,
  Relative_PE_Weight: 0.6,
  Relative_PB_Weight: 0.4,
  Sector_PB_Benchmark: 2.0,
  Weight_DCF: 25,
  Weight_DDM: 25,
  Weight_RIM: 25,
  Weight_Relative: 15,
  Weight_Graham: 10,
};

function runScenario(opts: {
  macros?: Record<string, number>;
  macroMetaMap?: Record<string, { source?: string; asOfDate?: string }>;
  companyOverrides?: Record<string, CompanyParameterOverride>;
  companyOverridesConfirmed?: boolean;
  macroParamsConfirmed?: boolean;
  priority?: AssumptionPriority;
  betaRecord?: BetaAssumptionRecord | null;
  betaConfirmed?: boolean;
  betaError?: string | null;
  sensitivityDraftKeys?: string[];
}) {
  const company = makeCompany();
  const q = makeQuarterly(company.ticker, company.id);
  const daily = makeDaily(company.ticker);
  const divs = makeDividends(company.ticker);

  const metrics = calculateTTMMetrics(company, [q], {
    dividendRecords: divs.records,
    dividendYearStatuses: divs.statuses,
    valuationDate: '2026-04-28',
  });

  const macros = opts.macros ?? BASE_MACROS;
  const macroMetaMap = opts.macroMetaMap ?? {
    Rf_Egypt_10Y: { source: 'CBE', asOfDate: '2026-04-20' },
    ERP_Developed: { source: 'Damodaran', asOfDate: '2026-04-20' },
    DDM_Growth: { source: 'افتراضات السوق الكلية', asOfDate: '2026-04-20' },
    Relative_PE_Weight: { source: 'سياسة الدمج العامة', asOfDate: '2026-04-20' },
    Relative_PB_Weight: { source: 'سياسة الدمج العامة', asOfDate: '2026-04-20' },
  };

  const valuation = runValuationModels(company, metrics, undefined, macros, {
    priority: opts.priority ?? 'company_first',
    sectorPEMap: { Industrials: 10 },
    sectorPeConfirmed: true,
    latestDaily: daily,
    betaRecord: opts.betaRecord === undefined ? null : opts.betaRecord,
    betaConfirmed: opts.betaConfirmed ?? true,
    betaError: opts.betaError ?? null,
    companyOverridesMap: opts.companyOverrides ?? {},
    companyOverridesConfirmed: opts.companyOverridesConfirmed ?? true,
    macroParamsConfirmed: opts.macroParamsConfirmed ?? true,
    macroMetaMap,
    valuationDate: '2026-04-28',
    disableLegacyCompanyFallback: true,
    sensitivityDraftKeys: opts.sensitivityDraftKeys,
  });

  return { company, q, daily, divs, metrics, valuation, macros, macroMetaMap };
}

async function mountWithHappyDom(element: React.ReactElement) {
  const win = new Window({ url: 'http://localhost:3000' });
  const keys = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'HTMLInputElement',
    'Event',
    'MouseEvent',
  ] as const;
  const prevDescriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const k of keys) {
    prevDescriptors.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value: (win as any)[k],
    });
  }
  const prevAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  const { createRoot } = await import('react-dom/client');
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  const setInputValue = async (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      'value'
    )?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      input.dispatchEvent(new win.Event('change', { bubbles: true }));
    });
  };

  const clickButton = async (btn: HTMLElement) => {
    await act(async () => {
      btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    });
  };

  const unmount = async () => {
    await act(async () => {
      root.unmount();
    });
    win.close();
    for (const k of keys) {
      const desc = prevDescriptors.get(k);
      if (desc) {
        Object.defineProperty(globalThis, k, desc);
      } else {
        delete (globalThis as any)[k];
      }
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = prevAct;
  };

  return { win, container, root, setInputValue, clickButton, unmount };
}

describe('Batch 38 — Assumption Source Descriptions, Independent Loading States & Sensitivity Consistency', () => {
  it('1) describes all Beta effective source states accurately without falsely attributing defaulted or unavailable Beta to historical records', () => {
    const missingDefaulted = describeBetaEffectiveSource({
      betaStatus: 'defaulted_missing',
      effectiveBetaForKe: 1.0,
      betaConfirmed: true,
      betaError: false,
    });
    assert.equal(missingDefaulted.kind, 'defaulted_missing');
    assert.match(missingDefaulted.shortBadgeAr, /1\.00/);
    assert.match(missingDefaulted.labelAr, /افتراضية = 1\.00.*ليست سجلاً تاريخياً/);

    const historicalActual = describeBetaEffectiveSource({
      betaStatus: 'actual',
      effectiveBetaForKe: 1.133,
      betaConfirmed: true,
    });
    assert.equal(historicalActual.kind, 'historical_actual');
    assert.match(historicalActual.shortBadgeAr, /beta_assumptions/);
    assert.match(historicalActual.labelAr, /بيتا تاريخية فعلية/);

    const analyticalSaved = describeBetaEffectiveSource({
      betaStatus: 'defaulted_missing',
      effectiveBetaForKe: 1.35,
      savedAnalyticalBetaValue: 1.35,
      betaConfirmed: true,
    });
    assert.equal(analyticalSaved.kind, 'analytical_override');
    assert.match(analyticalSaved.labelAr, /Beta_Analytical.*company_assumptions/);

    const loadingUnconfirmed = describeBetaEffectiveSource({
      betaStatus: 'unavailable_error',
      effectiveBetaForKe: null,
      betaConfirmed: false,
      betaError: false,
    });
    assert.equal(loadingUnconfirmed.kind, 'unavailable_unconfirmed');
    assert.match(loadingUnconfirmed.labelAr, /غير مؤكد/);
    assert.doesNotMatch(loadingUnconfirmed.labelAr, /بيتا تاريخية فعلية|افتراضية = 1\.00/);

    const serverError = describeBetaEffectiveSource({
      betaStatus: 'unavailable_error',
      effectiveBetaForKe: null,
      betaConfirmed: false,
      betaError: true,
    });
    assert.equal(serverError.kind, 'unavailable_unconfirmed');
    assert.match(serverError.shortBadgeAr, /فشل تأكيد/);

    const draftBeta = describeBetaEffectiveSource({
      betaStatus: 'actual',
      effectiveBetaForKe: 1.25,
      draftBeta: 1.375,
      betaConfirmed: true,
    });
    assert.equal(draftBeta.kind, 'sensitivity_draft_historical');
    assert.equal(draftBeta.isSensitivityDraft, true);
    assert.match(draftBeta.labelAr, /مسودة حساسية مؤقتة/);

    const draftAnalytical = describeBetaEffectiveSource({
      betaStatus: 'actual',
      effectiveBetaForKe: 1.4,
      draftAnalyticalBeta: 1.4,
      betaConfirmed: true,
    });
    assert.equal(draftAnalytical.kind, 'sensitivity_draft_analytical');
    assert.equal(draftAnalytical.isSensitivityDraft, true);
    assert.match(draftAnalytical.labelAr, /مسودة حساسية مؤقتة لـ Beta_Analytical/);
  });

  it('2) aligns Beta source wording between ValuationBetaPanel and DDM Ke panel across confirmed missing (1.00), actual, analytical, unconfirmed, error, and local drafts', async () => {
    const scenarios: Array<{
      name: string;
      betaRecord: BetaAssumptionRecord | null;
      betaConfirmed: boolean;
      betaError: boolean;
      companyOverrides?: Record<string, CompanyParameterOverride>;
      expectedBadgeRe: RegExp;
      forbiddenLabelRe?: RegExp;
    }> = [
      {
        name: 'confirmed missing => defaulted 1.00',
        betaRecord: null,
        betaConfirmed: true,
        betaError: false,
        expectedBadgeRe: /سياسة غياب السجل المؤكد = 1\.00/,
        forbiddenLabelRe: /بيتا تاريخية فعلية/,
      },
      {
        name: 'actual historical beta',
        betaRecord: {
          ticker: 'B38T',
          beta: 1.2,
          asOfDate: '2026-04-20',
          source: 'EGX_Regression',
        },
        betaConfirmed: true,
        betaError: false,
        expectedBadgeRe: /beta_assumptions \(فعلي\)/,
      },
      {
        name: 'saved analytical override',
        betaRecord: {
          ticker: 'B38T',
          beta: 1.2,
          asOfDate: '2026-04-20',
          source: 'EGX_Regression',
        },
        betaConfirmed: true,
        betaError: false,
        companyOverrides: {
          Beta_Analytical: {
            ticker: 'B38T',
            key: 'Beta_Analytical',
            value: 1.35,
            scope: 'company',
            source: 'تقدير لجنة الاستثمار',
            asOfDate: '2026-04-28',
          },
        },
        expectedBadgeRe: /Beta_Analytical \(تخصيص تحليلي\)/,
      },
      {
        name: 'unconfirmed loading',
        betaRecord: null,
        betaConfirmed: false,
        betaError: false,
        expectedBadgeRe: /قيد تأكيد تحميل بيتا/,
        forbiddenLabelRe: /بيتا تاريخية فعلية|افتراضية = 1\.00/,
      },
      {
        name: 'server confirmation error',
        betaRecord: null,
        betaConfirmed: false,
        betaError: true,
        expectedBadgeRe: /فشل تأكيد سجل بيتا/,
        forbiddenLabelRe: /بيتا تاريخية فعلية|افتراضية = 1\.00/,
      },
    ];

    for (const sc of scenarios) {
      const data = runScenario({
        betaRecord: sc.betaRecord,
        betaConfirmed: sc.betaConfirmed,
        betaError: sc.betaError ? 'تعذر التحميل' : null,
        companyOverrides: sc.companyOverrides,
      });

      const mounted = await mountWithHappyDom(
        React.createElement(ValuationView, {
          company: data.company,
          metrics: data.metrics,
          valuation: data.valuation,
          assumptionPriority: 'company_first',
          onChangePriority: () => {},
          onUpdateCompanyParams: () => {},
          paramsMap: data.macros,
          macroMetaMap: data.macroMetaMap,
          companyOverridesMap: sc.companyOverrides ?? {},
          companyOverridesConfirmed: true,
          macroParamsConfirmed: true,
          selectedBetaRecord: sc.betaRecord,
          betaConfirmed: sc.betaConfirmed,
          betaError: sc.betaError,
          selectedLatestDaily: data.daily,
          valuationDate: '2026-04-28',
          canEditCompanyParams: true,
          isAdmin: true,
          initialModelTab: 'ddm',
        })
      );

      try {
        const panelBadge = mounted.container.querySelector(
          '[data-testid="beta-panel-effective-source-badge"]'
        )?.textContent?.trim();
        const ddmBadge = mounted.container.querySelector(
          '[data-testid="ddm-ke-beta-source-badge"]'
        )?.textContent?.trim();
        const ddmLabel = mounted.container.querySelector(
          '[data-testid="ddm-ke-beta-source-label"]'
        )?.textContent?.trim();

        assert.equal(ddmBadge, panelBadge, `DDM badge must match ValuationBetaPanel for ${sc.name}`);
        assert.match(ddmBadge ?? '', sc.expectedBadgeRe, `Unexpected badge for ${sc.name}`);
        if (sc.forbiddenLabelRe) {
          assert.doesNotMatch(ddmLabel ?? '', sc.forbiddenLabelRe, `Forbidden attribution for ${sc.name}`);
        }
      } finally {
        await mounted.unmount();
      }
    }
  });

  it('3) handles independent company_assumptions vs macro_params loading confirmation, explicit zero (0), and missing documentary source across DDM_Audit, Relative weights, and الافتراضات_والمصادر in Excel', async () => {
    // Helper assertions on shared formatter first
    const zeroAvailable = formatScopedAssumptionStateAr({
      value: 0,
      scopeConfirmed: true,
      formatValue: (v) => `${(v * 100).toFixed(2)}%`,
      documentarySource: null,
      asOfDate: null,
      includeMissingDocumentaryNote: true,
    });
    assert.equal(zeroAvailable.state, 'available');
    assert.equal(zeroAvailable.valueTextAr, '0.00%');
    assert.match(zeroAvailable.fullTextAr, /0\.00%.*المصدر التوثيقي غير موثق/);

    const missingDocMeta = formatDocumentaryMetadataAr({
      hasEffectiveValue: true,
      loadingUnconfirmed: false,
      documentarySource: undefined,
      asOfDate: undefined,
    });
    assert.match(missingDocMeta, /المصدر التوثيقي غير موثق \(القيمة متاحة\)/);

    // Case A: Both scopes unconfirmed
    {
      const sc = runScenario({
        macros: { r_Mode: 3, Rf_Egypt_10Y: 0.2, ERP_Developed: 0.06, Beta_Raw_Weight: 0.6667, Beta_Anchor: 1.0, Sector_PB_Benchmark: 2.0 },
        companyOverrides: {},
        companyOverridesConfirmed: false,
        macroParamsConfirmed: false,
      });
      const wb = await buildCompanyValuationWorkbook(sc.company, [sc.q], sc.metrics, sc.valuation, []);
      const ddmMap = new Map(XLSX.utils.sheet_to_json<any[]>(wb.Sheets['DDM_Audit'], { header: 1 }).map((r) => [String(r[0]), String(r[1] ?? '')]));
      assert.match(ddmMap.get('تخصيص الشركة لـ DDM_Growth') ?? '', /قيد تأكيد التحميل/);
      assert.match(ddmMap.get('المرجع العام لـ DDM_Growth (macro_params)') ?? '', /قيد تأكيد التحميل/);
      assert.doesNotMatch(ddmMap.get('تخصيص الشركة لـ DDM_Growth') ?? '', /غير محفوظ/);
      assert.doesNotMatch(ddmMap.get('المرجع العام لـ DDM_Growth (macro_params)') ?? '', /غير محفوظ/);

      const summaryRows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['ملخص التقييم'], { header: 1 });
      const peRow = summaryRows.find((r) => String(r[0] ?? '').includes('Relative_PE_Weight'));
      assert.ok(peRow);
      assert.match(String(peRow[3]), /تخصيص الشركة: قيد تأكيد التحميل/);
      assert.match(String(peRow[3]), /المتغيرات الكلية: قيد تأكيد التحميل/);
      assert.doesNotMatch(String(peRow[3]), /غير محفوظ/);

      const assumpRows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['الافتراضات_والمصادر'], { header: 1 });
      const ddmAssump = assumpRows.find((r) => r[1] === 'DDM_Growth');
      assert.ok(ddmAssump);
      assert.equal(ddmAssump[6], 'قيد تأكيد التحميل');
      assert.equal(ddmAssump[7], 'قيد تأكيد التحميل');
    }

    // Case B: Company confirmed absent, Macro unconfirmed
    {
      const sc = runScenario({
        macros: { r_Mode: 3, Rf_Egypt_10Y: 0.2, ERP_Developed: 0.06, Beta_Raw_Weight: 0.6667, Beta_Anchor: 1.0, Sector_PB_Benchmark: 2.0 },
        companyOverrides: {},
        companyOverridesConfirmed: true,
        macroParamsConfirmed: false,
      });
      const wb = await buildCompanyValuationWorkbook(sc.company, [sc.q], sc.metrics, sc.valuation, []);
      const ddmMap = new Map(XLSX.utils.sheet_to_json<any[]>(wb.Sheets['DDM_Audit'], { header: 1 }).map((r) => [String(r[0]), String(r[1] ?? '')]));
      assert.equal(ddmMap.get('تخصيص الشركة لـ DDM_Growth'), 'غير محفوظ (غياب مؤكد)');
      assert.match(ddmMap.get('المرجع العام لـ DDM_Growth (macro_params)') ?? '', /قيد تأكيد التحميل/);

      const summaryRows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['ملخص التقييم'], { header: 1 });
      const peRow = summaryRows.find((r) => String(r[0] ?? '').includes('Relative_PE_Weight'));
      assert.ok(peRow);
      assert.match(String(peRow[3]), /تخصيص الشركة: غير محفوظ \(غياب مؤكد\)/);
      assert.match(String(peRow[3]), /المتغيرات الكلية: قيد تأكيد التحميل/);
    }

    // Case C: Company unconfirmed, Macro confirmed absent
    {
      const sc = runScenario({
        macros: { r_Mode: 3, Rf_Egypt_10Y: 0.2, ERP_Developed: 0.06, Beta_Raw_Weight: 0.6667, Beta_Anchor: 1.0, Sector_PB_Benchmark: 2.0 },
        companyOverrides: {},
        companyOverridesConfirmed: false,
        macroParamsConfirmed: true,
      });
      const wb = await buildCompanyValuationWorkbook(sc.company, [sc.q], sc.metrics, sc.valuation, []);
      const ddmMap = new Map(XLSX.utils.sheet_to_json<any[]>(wb.Sheets['DDM_Audit'], { header: 1 }).map((r) => [String(r[0]), String(r[1] ?? '')]));
      assert.match(ddmMap.get('تخصيص الشركة لـ DDM_Growth') ?? '', /قيد تأكيد التحميل/);
      assert.equal(ddmMap.get('المرجع العام لـ DDM_Growth (macro_params)'), 'غير محفوظ (غياب مؤكد)');

      const summaryRows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['ملخص التقييم'], { header: 1 });
      const peRow = summaryRows.find((r) => String(r[0] ?? '').includes('Relative_PE_Weight'));
      assert.ok(peRow);
      assert.match(String(peRow[3]), /تخصيص الشركة: قيد تأكيد التحميل/);
      assert.match(String(peRow[3]), /المتغيرات الكلية: غير محفوظ \(غياب مؤكد\)/);
    }

    // Case D + E + F: Both confirmed, explicit ZERO (DDM_Growth = 0, Relative_PB_Weight = 0) with missing documentary source
    {
      const sc = runScenario({
        macros: {
          ...BASE_MACROS,
          DDM_Growth: 0,
          Relative_PE_Weight: 1,
          Relative_PB_Weight: 0,
        },
        macroMetaMap: {
          Rf_Egypt_10Y: { source: 'CBE', asOfDate: '2026-04-20' },
          ERP_Developed: { source: 'Damodaran', asOfDate: '2026-04-20' },
          // Intentionally omit documentary source/date for DDM_Growth & Relative_PB_Weight
        },
        companyOverrides: {},
        companyOverridesConfirmed: true,
        macroParamsConfirmed: true,
      });
      const wb = await buildCompanyValuationWorkbook(sc.company, [sc.q], sc.metrics, sc.valuation, []);
      const ddmMap = new Map(XLSX.utils.sheet_to_json<any[]>(wb.Sheets['DDM_Audit'], { header: 1 }).map((r) => [String(r[0]), String(r[1] ?? '')]));
      assert.equal(ddmMap.get('معدل النمو المستدام للتوزيعات g (DDM_Growth)'), '0.00%');
      assert.equal(ddmMap.get('تخصيص الشركة لـ DDM_Growth'), 'غير محفوظ (غياب مؤكد)');
      assert.match(ddmMap.get('المرجع العام لـ DDM_Growth (macro_params)') ?? '', /^0\.00% \(المصدر التوثيقي غير موثق\)$/);
      assert.match(ddmMap.get('تاريخ ومصدر توثيق DDM_Growth') ?? '', /المصدر التوثيقي غير موثق \(القيمة متاحة\)/);

      const summaryRows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['ملخص التقييم'], { header: 1 });
      const pbRow = summaryRows.find((r) => String(r[0] ?? '').includes('Relative_PB_Weight'));
      assert.ok(pbRow);
      assert.equal(String(pbRow[1]), '0');
      assert.match(String(pbRow[3]), /المصدر التوثيقي: المصدر التوثيقي غير موثق \(القيمة متاحة\)/);
      assert.match(String(pbRow[3]), /المتغيرات الكلية: 0 \(المصدر التوثيقي غير موثق\)/);
      assert.match(String(pbRow[3]), /تخصيص الشركة: غير محفوظ \(غياب مؤكد\)/);

      const assumpRows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['الافتراضات_والمصادر'], { header: 1 });
      const ddmAssump = assumpRows.find((r) => r[1] === 'DDM_Growth');
      assert.ok(ddmAssump);
      assert.equal(ddmAssump[3], '0.00%');
      assert.equal(ddmAssump[6], 'غير محفوظ (غياب مؤكد)');
      assert.equal(ddmAssump[7], '0.00%');
      assert.equal(ddmAssump[10], 'المصدر التوثيقي غير موثق (القيمة متاحة)');
    }
  });

  it('4) preserves exact Gordon DDM values (10.60 global 6% and 8.50 at 2%) and ensures DdmAuditCard & Ke panel never label a temporary sensitivity draft as a saved assumption (0 Firestore writes)', async () => {
    const baseData = runScenario({
      macros: BASE_MACROS, // D0 = 2, Ke = 20% + 1.0*6% = 26%, g = 6% => 10.60
      companyOverrides: {},
      companyOverridesConfirmed: true,
      macroParamsConfirmed: true,
      betaRecord: null,
      betaConfirmed: true,
    });
    assert.ok(Math.abs((baseData.valuation.ddmFairValue ?? 0) - 10.6) < 1e-6);

    const savedCompanyData = runScenario({
      macros: BASE_MACROS,
      companyOverrides: {
        DDM_Growth: {
          ticker: 'B38T',
          key: 'DDM_Growth',
          value: 0.02,
          scope: 'company',
          source: 'تقدير المحلل',
          asOfDate: '2026-04-28',
        },
      },
      companyOverridesConfirmed: true,
      macroParamsConfirmed: true,
      betaRecord: null,
      betaConfirmed: true,
    });
    assert.ok(Math.abs((savedCompanyData.valuation.ddmFairValue ?? 0) - 8.5) < 1e-6);

    let firestoreWrites = 0;
    const mounted = await mountWithHappyDom(
      React.createElement(ValuationView, {
        company: baseData.company,
        metrics: baseData.metrics,
        valuation: baseData.valuation,
        assumptionPriority: 'company_first',
        onChangePriority: () => {},
        onUpdateCompanyParams: () => {
          firestoreWrites++;
        },
        paramsMap: baseData.macros,
        macroMetaMap: baseData.macroMetaMap,
        companyOverridesMap: {},
        companyOverridesConfirmed: true,
        macroParamsConfirmed: true,
        selectedBetaRecord: null,
        betaConfirmed: true,
        betaError: false,
        selectedLatestDaily: baseData.daily,
        valuationDate: '2026-04-28',
        canEditCompanyParams: true,
        isAdmin: true,
        initialModelTab: 'ddm',
        onSaveCompanyOverride: async () => {
          firestoreWrites++;
          return {
            ticker: 'B38T',
            key: 'DDM_Growth',
            savedValue: 0.02,
            updatedAtIso: '2026-04-28T00:00:00Z',
          };
        },
        onSaveGlobalMacroParam: async () => {
          firestoreWrites++;
        },
      })
    );

    try {
      // Baseline check: 10.60, saved macro_params, no sensitivity badge
      assert.match(
        mounted.container.querySelector('[data-testid="ddm-tab-fair-value"]')?.textContent ?? '',
        /10\.60/
      );
      assert.equal(
        mounted.container.querySelector('[data-testid="ddm-audit-sensitivity-badge"]'),
        null
      );
      assert.match(
        mounted.container.querySelector('[data-testid="ddm-audit-growth-source"]')?.textContent ?? '',
        /المتغيرات الكلية \(macro_params\)/
      );

      // Enter temporary local sensitivity draft DDM_Growth = 2%
      const ddmCard = mounted.container.querySelector('[data-testid="param-card-DDM_Growth"]');
      assert.ok(ddmCard);
      const ddmInput = ddmCard.querySelector('input') as HTMLInputElement | null;
      assert.ok(ddmInput);
      await mounted.setInputValue(ddmInput, '2');

      const tryBtn = Array.from(ddmCard.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('تجربة مؤقتة')
      ) as HTMLElement | null;
      assert.ok(tryBtn);
      await mounted.clickButton(tryBtn);

      // Fair value updates to 8.50 with ZERO Firestore writes
      assert.equal(firestoreWrites, 0);
      assert.match(
        mounted.container.querySelector('[data-testid="ddm-tab-fair-value"]')?.textContent ?? '',
        /8\.50/
      );

      // DdmAuditCard MUST label the draft as temporary local sensitivity, NEVER company_assumptions or macro_params
      const badge = mounted.container.querySelector(
        '[data-testid="ddm-audit-sensitivity-badge"]'
      )?.textContent;
      const notice = mounted.container.querySelector(
        '[data-testid="ddm-audit-sensitivity-notice"]'
      )?.textContent;
      const growthSourceText = mounted.container.querySelector(
        '[data-testid="ddm-audit-growth-source"]'
      )?.textContent ?? '';

      assert.ok(badge && /مسودة حساسية مؤقتة/.test(badge));
      assert.ok(notice && /مسودة حساسية مؤقتة/.test(notice));
      assert.match(growthSourceText, /مسودة حساسية مؤقتة/);
      assert.doesNotMatch(growthSourceText, /company_assumptions|macro_params/);

      // Also test local sensitivity drafts on BOTH historical Beta and Beta_Analytical (0 writes)
      const betaNumInputs = Array.from(
        mounted.container.querySelectorAll('#valuation-beta-panel input[type="number"]')
      ) as HTMLInputElement[];
      assert.equal(betaNumInputs.length, 2, 'Expected historical Beta and Beta_Analytical numeric inputs');
      const tryBetaButtons = Array.from(
        mounted.container.querySelectorAll('#valuation-beta-panel button')
      ).filter((b) => (b.textContent ?? '').includes('تجربة مؤقتة'));
      assert.equal(tryBetaButtons.length, 2, 'Expected two sensitivity buttons in Beta panel');

      // Historical Beta draft
      await mounted.setInputValue(betaNumInputs[0], '1.25');
      await mounted.clickButton(tryBetaButtons[0] as HTMLElement);
      assert.equal(firestoreWrites, 0);
      assert.equal(
        mounted.container.querySelector('[data-testid="ddm-ke-beta-source-badge"]')?.textContent?.trim(),
        mounted.container.querySelector('[data-testid="beta-panel-effective-source-badge"]')?.textContent?.trim()
      );
      assert.match(
        mounted.container.querySelector('[data-testid="ddm-ke-beta-source-badge"]')?.textContent ?? '',
        /مسودة حساسية مؤقتة \(Beta\)/
      );

      // Analytical Beta draft (takes priority over historical draft)
      await mounted.setInputValue(betaNumInputs[1], '1.5');
      await mounted.clickButton(tryBetaButtons[1] as HTMLElement);
      assert.equal(firestoreWrites, 0);
      const panelBetaBadge =
        mounted.container.querySelector('[data-testid="beta-panel-effective-source-badge"]')?.textContent?.trim() ?? '';
      const ddmBetaBadge =
        mounted.container.querySelector('[data-testid="ddm-ke-beta-source-badge"]')?.textContent?.trim() ?? '';
      assert.equal(ddmBetaBadge, panelBetaBadge);
      assert.match(ddmBetaBadge, /مسودة حساسية مؤقتة \(Beta_Analytical\)/);
    } finally {
      await mounted.unmount();
    }
  });

  it('5) renders independent scope confirmation states (company confirmed vs macro unconfirmed) consistently in ValuationView DDM and Relative tabs', async () => {
    const partialData = runScenario({
      macros: {
        r_Mode: 3,
        WACC_Mode: 2,
        Rf_Egypt_10Y: 0.2,
        ERP_Developed: 0.06,
        Beta_Raw_Weight: 0.6667,
        Beta_Anchor: 1.0,
        Sector_PB_Benchmark: 2.0,
      },
      companyOverrides: {},
      companyOverridesConfirmed: true,
      macroParamsConfirmed: false,
    });

    const mounted = await mountWithHappyDom(
      React.createElement(ValuationView, {
        company: partialData.company,
        metrics: partialData.metrics,
        valuation: partialData.valuation,
        assumptionPriority: 'company_first',
        onChangePriority: () => {},
        onUpdateCompanyParams: () => {},
        paramsMap: partialData.macros,
        macroMetaMap: partialData.macroMetaMap,
        companyOverridesMap: {},
        companyOverridesConfirmed: true,
        macroParamsConfirmed: false,
        selectedBetaRecord: null,
        betaConfirmed: true,
        betaError: false,
        selectedLatestDaily: partialData.daily,
        valuationDate: '2026-04-28',
        canEditCompanyParams: true,
        isAdmin: true,
        initialModelTab: 'ddm',
      })
    );

    try {
      const ddmSectionText =
        mounted.container.querySelector('[data-testid="ddm-growth-customization-section"]')?.textContent ?? '';
      assert.match(ddmSectionText, /تخصيص الشركة:\s*غير محفوظ \(غياب مؤكد\)/);
      assert.match(ddmSectionText, /المرجع العام:\s*قيد تأكيد التحميل/);
    } finally {
      await mounted.unmount();
    }

    const mountedRel = await mountWithHappyDom(
      React.createElement(ValuationView, {
        company: partialData.company,
        metrics: partialData.metrics,
        valuation: partialData.valuation,
        assumptionPriority: 'company_first',
        onChangePriority: () => {},
        onUpdateCompanyParams: () => {},
        paramsMap: partialData.macros,
        macroMetaMap: partialData.macroMetaMap,
        companyOverridesMap: {},
        companyOverridesConfirmed: true,
        macroParamsConfirmed: false,
        selectedBetaRecord: null,
        betaConfirmed: true,
        betaError: false,
        selectedLatestDaily: partialData.daily,
        valuationDate: '2026-04-28',
        canEditCompanyParams: true,
        isAdmin: true,
        initialModelTab: 'relative',
      })
    );

    try {
      const relText = mountedRel.container.textContent ?? '';
      assert.match(relText, /تخصيص الشركة \(company_assumptions\):\s*غير محفوظ \(غياب مؤكد\)/);
      assert.match(relText, /المتغيرات الكلية \(macro_params\):\s*قيد تأكيد التحميل/);
    } finally {
      await mountedRel.unmount();
    }
  });
});
