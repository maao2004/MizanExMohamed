/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import * as XLSX from 'xlsx';

import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { ValuationView } from '../src/components/ValuationView';
import { buildCompanyValuationWorkbook } from '../src/utils/excelExport';
import type {
  Company,
  CompanyParameterOverride,
  DividendRecord,
  DividendYearStatusRecord,
  MacroParameter,
  QuarterlyFinancial,
} from '../src/types';

function installHappyDom() {
  const win = new Window({ url: 'http://localhost:3000/' });
  const prevGlobals: Record<string, unknown> = {
    window: (globalThis as Record<string, unknown>).window,
    document: (globalThis as Record<string, unknown>).document,
    HTMLElement: (globalThis as Record<string, unknown>).HTMLElement,
    HTMLInputElement: (globalThis as Record<string, unknown>).HTMLInputElement,
    HTMLButtonElement: (globalThis as Record<string, unknown>).HTMLButtonElement,
    Element: (globalThis as Record<string, unknown>).Element,
    Node: (globalThis as Record<string, unknown>).Node,
    Event: (globalThis as Record<string, unknown>).Event,
    InputEvent: (globalThis as Record<string, unknown>).InputEvent,
    MouseEvent: (globalThis as Record<string, unknown>).MouseEvent,
    KeyboardEvent: (globalThis as Record<string, unknown>).KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT,
  };
  const prevNav = globalThis.navigator;

  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).HTMLInputElement = win.HTMLInputElement;
  (globalThis as any).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as any).Element = win.Element;
  (globalThis as any).Node = win.Node;
  (globalThis as any).Event = win.Event;
  (globalThis as any).InputEvent = win.InputEvent;
  (globalThis as any).MouseEvent = win.MouseEvent;
  (globalThis as any).KeyboardEvent = win.KeyboardEvent;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
    writable: true,
  });

  const cleanup = async () => {
    await win.close();
    for (const [k, v] of Object.entries(prevGlobals)) {
      (globalThis as Record<string, unknown>)[k] = v;
    }
    Object.defineProperty(globalThis, 'navigator', {
      value: prevNav,
      configurable: true,
      writable: true,
    });
  };

  return { win, cleanup };
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const win = (globalThis as any).window;
  const desc = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value');
  desc?.set?.call(input, value);
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'C_DDM',
    ticker: 'DDMT',
    nameAr: 'شركة اختبار نموذج DDM',
    nameEn: 'DDM Test Co',
    sector: 'الصناعة',
    rawSector: 'الصناعة',
    sectorId: 'industrial',
    sectorClassification: 'non_financial',
    marketPrice: 12,
    marketPriceCurrency: 'EGP',
    sharesOutstanding: 100_000_000,
    beta: 1.0,
    riskFreeRate: null,
    equityRiskPremium: null,
    costOfDebt: null,
    taxRate: null,
    targetDebtRatio: null,
    sustainableGrowthRate: null,
    shortTermGrowthRate: null,
    targetPE: null,
    targetPB: null,
    currency: 'EGP',
    ...overrides,
  };
}

function makeQuarterly(ticker = 'DDMT', companyId = 'C_DDM'): QuarterlyFinancial {
  return {
    id: `${ticker}_2025_FY`,
    companyId,
    year: 2025,
    quarter: 'FY',
    periodDate: '2025-12-31',
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 450_000_000,
    operatingProfitYTD: 300_000_000,
    netProfitYTD: 350_000_000,
    netIncomeCommonYTD: 350_000_000,
    netIncomeCommonBasis: 'attested_common_ni',
    operatingCashFlowYTD: 280_000_000,
    capexYTD: 50_000_000,
    dividendsPaidYTD: 200_000_000,
    totalAssets: 2_000_000_000,
    totalLiabilities: 750_000_000,
    totalEquity: 1_250_000_000,
    commonEquity: 1_250_000_000,
    commonEquityBasis: 'attested_common_equity',
    totalDebt: 200_000_000,
    cashAndEquivalents: 150_000_000,
    sharesOutstanding: 100_000_000,
    financialCurrency: 'EGP',
    financialUnit: 'base',
  };
}

function makeDividends(ticker = 'DDMT'): {
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
        paymentDate: '2026-04-01',
        exDividendDate: '2026-03-20',
        recordDate: '2026-03-25',
        source: 'قرار الجمعية العامة',
      },
      {
        ticker,
        fiscalYear: 2025,
        recordType: 'special',
        distributionId: 'DIST_2025_SPEC',
        cashDps: 1.5,
        currency: 'EGP',
        approvalStatus: 'approved',
        distributionSemantics: 'standalone_event',
        paymentDate: '2026-04-01',
        exDividendDate: '2026-03-20',
        recordDate: '2026-03-25',
        source: 'توزيع استثنائي',
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

// Under r_Mode = 3 (EGP without CRP):
// Rf_Egypt_10Y = 0.21, ERP_Developed = 0.05, Beta = 1.0 => Ke = 0.21 + 1.0 * 0.05 = 0.26 (26%)
const BASE_MACROS_RMODE3: Record<string, number> = {
  Rf_Egypt_10Y: 0.21,
  ERP_Developed: 0.05,
  CRP_Egypt: 0.04,
  Country_Risk_Lambda: 1,
  r_Mode: 3,
  WACC_Mode: 2,
  Beta_Raw_Weight: 0.67,
  Beta_Anchor: 1,
  Cost_of_Debt: 0.22,
  TaxRate: 0.225,
  Terminal_Growth: 0.05,
  Forecast_Years: 5,
  Weight_DCF: 25,
  Weight_DDM: 25,
  Weight_RIM: 20,
  Weight_Relative: 20,
  Weight_Graham: 10,
};

function runDdmScenario(opts: {
  macros?: Record<string, number>;
  companyOverrides?: Record<string, CompanyParameterOverride>;
  priority?: 'company_first' | 'global_first';
  companyOverridesConfirmed?: boolean;
  macroParamsConfirmed?: boolean;
  company?: Company;
}) {
  const company = opts.company ?? makeCompany();
  const q = makeQuarterly(company.ticker, company.id);
  const divs = makeDividends(company.ticker);
  const metrics = calculateTTMMetrics(company, [q], {
    dividendRecords: divs.records,
    dividendYearStatuses: divs.statuses,
    valuationDate: '2026-05-01',
  });
  const valuation = runValuationModels(company, metrics, undefined, opts.macros ?? BASE_MACROS_RMODE3, {
    priority: opts.priority ?? 'company_first',
    companyOverridesMap: opts.companyOverrides ?? {},
    companyOverridesConfirmed: opts.companyOverridesConfirmed ?? true,
    macroParamsConfirmed: opts.macroParamsConfirmed ?? true,
    macroMetaMap: {
      DDM_Growth: { asOfDate: '2026-01-15', source: 'افتراضات السوق الكلية', enabledInEngine: true },
      Rf_Egypt_10Y: { asOfDate: '2026-01-10', source: 'البنك المركزي', enabledInEngine: true },
      ERP_Developed: { asOfDate: '2026-01-10', source: 'داموداران', enabledInEngine: true },
      CRP_Egypt: { asOfDate: '2026-01-10', source: 'تقييم مخاطر الدولة', enabledInEngine: true },
    },
    betaRecord: { ticker: company.ticker, beta: 1.0, asOfDate: '2026-01-05', source: 'EGX 3Y' },
    betaConfirmed: true,
    valuationDate: '2026-05-01',
    disableLegacyCompanyFallback: true,
  });
  return { company, q, metrics, valuation };
}

describe('Batch 37 — DDM_Growth Customization, Derived Ke, Audit & Export', () => {
  it('computes exact Gordon DDM = 10.60 (D0=2, Ke=26%, g=6% global) and excludes special DPS', () => {
    const { valuation } = runDdmScenario({
      macros: { ...BASE_MACROS_RMODE3, DDM_Growth: 0.06 },
    });

    assert.equal(valuation.ddmAudit?.d0, 2);
    assert.ok(Math.abs((valuation.ddmAudit?.costOfEquity ?? 0) - 0.26) < 1e-9);
    assert.ok(Math.abs((valuation.ddmAudit?.growth ?? 0) - 0.06) < 1e-9);
    assert.ok(Math.abs((valuation.ddmAudit?.d1 ?? 0) - 2.12) < 1e-9);
    assert.ok(Math.abs((valuation.ddmAudit?.keMinusG ?? 0) - 0.20) < 1e-9);
    assert.ok(Math.abs((valuation.ddmFairValue ?? 0) - 10.6) < 1e-9);
    assert.equal(valuation.ddmAudit?.growthSource, 'global');
    assert.equal(valuation.ddmAudit?.growthGlobalValue, 0.06);
    assert.equal(valuation.ddmAudit?.growthCompanyValue, null);
    assert.equal(valuation.ddmAudit?.eligible, true);
  });

  it('applies company override DDM_Growth = 2% under company_first => exact DDM = 8.50, and respects global_first => 10.60', () => {
    const companyOverrides: Record<string, CompanyParameterOverride> = {
      DDM_Growth: {
        ticker: 'DDMT',
        key: 'DDM_Growth',
        value: 0.02,
        scope: 'company',
        source: 'تقدير محلل الشركة',
        asOfDate: '2026-04-15',
      },
    };

    const companyFirst = runDdmScenario({
      macros: { ...BASE_MACROS_RMODE3, DDM_Growth: 0.06 },
      companyOverrides,
      priority: 'company_first',
    });
    assert.ok(Math.abs((companyFirst.valuation.ddmFairValue ?? 0) - 8.5) < 1e-9);
    assert.equal(companyFirst.valuation.ddmAudit?.growthSource, 'company');
    assert.equal(companyFirst.valuation.ddmAudit?.growthAsOfDate, '2026-04-15');
    assert.equal(companyFirst.valuation.ddmAudit?.growthDocumentarySource, 'تقدير محلل الشركة');
    assert.equal(companyFirst.valuation.ddmAudit?.growthCompanyValue, 0.02);
    assert.equal(companyFirst.valuation.ddmAudit?.growthGlobalValue, 0.06);
    assert.equal(companyFirst.valuation.ddmAudit?.growthOverriddenByPriority, false);

    const globalFirst = runDdmScenario({
      macros: { ...BASE_MACROS_RMODE3, DDM_Growth: 0.06 },
      companyOverrides,
      priority: 'global_first',
    });
    assert.ok(Math.abs((globalFirst.valuation.ddmFairValue ?? 0) - 10.6) < 1e-9);
    assert.equal(globalFirst.valuation.ddmAudit?.growthSource, 'global');
    assert.equal(globalFirst.valuation.ddmAudit?.growthOverriddenByPriority, true);
  });

  it('supports company-only DDM_Growth, explicit zero (0%), and negative growth (-5%) without silent defaults', () => {
    const companyOnly = runDdmScenario({
      macros: BASE_MACROS_RMODE3, // no global DDM_Growth
      companyOverrides: {
        DDM_Growth: { ticker: 'DDMT', key: 'DDM_Growth', value: 0.02, scope: 'company', asOfDate: '2026-04-20' },
      },
      priority: 'global_first',
    });
    assert.ok(Math.abs((companyOnly.valuation.ddmFairValue ?? 0) - 8.5) < 1e-9);
    assert.equal(companyOnly.valuation.ddmAudit?.growthSource, 'company');

    const zeroGrowth = runDdmScenario({
      macros: BASE_MACROS_RMODE3,
      companyOverrides: {
        DDM_Growth: { ticker: 'DDMT', key: 'DDM_Growth', value: 0, scope: 'company' },
      },
    });
    assert.equal(zeroGrowth.valuation.ddmAudit?.eligible, true);
    assert.equal(zeroGrowth.valuation.ddmAudit?.growth, 0);
    assert.ok(Math.abs((zeroGrowth.valuation.ddmFairValue ?? 0) - 2 / 0.26) < 1e-9);

    const negativeGrowth = runDdmScenario({
      macros: BASE_MACROS_RMODE3,
      companyOverrides: {
        DDM_Growth: { ticker: 'DDMT', key: 'DDM_Growth', value: -0.05, scope: 'company' },
      },
    });
    assert.equal(negativeGrowth.valuation.ddmAudit?.eligible, true);
    assert.equal(negativeGrowth.valuation.ddmAudit?.growth, -0.05);
    assert.ok(Math.abs((negativeGrowth.valuation.ddmFairValue ?? 0) - (2 * 0.95) / 0.31) < 1e-9);
  });

  it('distinguishes confirmed absence across both scopes from unconfirmed loading and excludes Ke <= g with remediation', () => {
    const confirmedMissing = runDdmScenario({
      macros: BASE_MACROS_RMODE3,
      companyOverrides: {},
      companyOverridesConfirmed: true,
      macroParamsConfirmed: true,
    });
    assert.equal(confirmedMissing.valuation.ddmFairValue, null);
    assert.equal(confirmedMissing.valuation.ddmAudit?.growthSource, 'missing');
    assert.match(confirmedMissing.valuation.ddmAudit?.exclusionReasonAr ?? '', /company_assumptions/);
    assert.match(confirmedMissing.valuation.ddmAudit?.exclusionReasonAr ?? '', /macro_params/);
    assert.ok(confirmedMissing.valuation.ddmAudit?.remediationAr);

    const unconfirmedLoading = runDdmScenario({
      macros: BASE_MACROS_RMODE3,
      companyOverrides: {},
      companyOverridesConfirmed: false,
      macroParamsConfirmed: true,
    });
    assert.equal(unconfirmedLoading.valuation.ddmFairValue, null);
    assert.equal(unconfirmedLoading.valuation.ddmAudit?.growthSource, 'loading_unconfirmed');
    assert.match(unconfirmedLoading.valuation.ddmAudit?.exclusionReasonAr ?? '', /غير مؤكدة/);

    const keEqualsG = runDdmScenario({
      macros: { ...BASE_MACROS_RMODE3, DDM_Growth: 0.26 },
    });
    assert.equal(keEqualsG.valuation.ddmFairValue, null);
    assert.equal(keEqualsG.valuation.ddmAudit?.eligible, false);
    assert.match(keEqualsG.valuation.ddmAudit?.exclusionReasonAr ?? '', /Ke/);
    assert.ok(keEqualsG.valuation.ddmAudit?.remediationAr);

    const keLessThanG = runDdmScenario({
      macros: { ...BASE_MACROS_RMODE3, DDM_Growth: 0.3 },
    });
    assert.equal(keLessThanG.valuation.ddmFairValue, null);
    assert.equal(keLessThanG.valuation.ddmAudit?.eligible, false);
    assert.ok((keLessThanG.valuation.ddmAudit?.keMinusG ?? 0) < 0);
    assert.ok(keLessThanG.valuation.ddmAudit?.remediationAr);
  });

  it('derives Ke formula metadata accurately across r_Mode 1, 2, and 3', () => {
    const mode1 = runDdmScenario({
      macros: { ...BASE_MACROS_RMODE3, r_Mode: 1, DDM_Growth: 0.06 },
    });
    // Ke = 0.21 + 1.0*0.05 + 1*0.04 = 0.30
    assert.equal(mode1.valuation.ddmAudit?.keMode, 1);
    assert.match(mode1.valuation.ddmAudit?.keFormulaAr ?? '', /CRP_Egypt/);
    assert.ok(Math.abs((mode1.valuation.ddmAudit?.costOfEquity ?? 0) - 0.3) < 1e-9);

    const mode2 = runDdmScenario({
      macros: { ...BASE_MACROS_RMODE3, r_Mode: 2, Rf_USD_10Y: 0.045, DDM_Growth: 0.03 },
    });
    assert.equal(mode2.valuation.ddmAudit?.keMode, 2);
    assert.match(mode2.valuation.ddmAudit?.keFormulaAr ?? '', /Rf_USD_10Y/);
    assert.match(mode2.valuation.ddmAudit?.keFormulaAr ?? '', /CRP_Egypt/);

    const mode3 = runDdmScenario({
      macros: { ...BASE_MACROS_RMODE3, r_Mode: 3, DDM_Growth: 0.06 },
    });
    assert.equal(mode3.valuation.ddmAudit?.keMode, 3);
    assert.doesNotMatch(mode3.valuation.ddmAudit?.keFormulaAr ?? '', /CRP_Egypt/);
  });

  it('renders DDM_Growth card, derived Ke panel, local sensitivity draft (0 writes), save/delete/permissions, and company switch in ValuationView DOM', async () => {
    const { win, cleanup } = installHappyDom();
    const { createRoot } = await import('react-dom/client');
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container);

    const macros = { ...BASE_MACROS_RMODE3, r_Mode: 1, Rf_Egypt_10Y: 0.17, CRP_Egypt: 0.04, DDM_Growth: 0.06 };
    // Ke = 0.17 + 1.0*0.05 + 1*0.04 = 0.26 => base DDM = 10.60
    const base = runDdmScenario({ macros });

    const savedCompanyCalls: Array<{ ticker: string; key: string; value: number }> = [];
    const deletedCompanyCalls: Array<{ ticker: string; key: string }> = [];
    const savedGlobalCalls: Array<{ key: string; value: number }> = [];
    let dividendNavClicks = 0;

    const macroParams: MacroParameter[] = [
      {
        key: 'DDM_Growth',
        nameAr: 'معدل نمو التوزيعات (DDM_Growth)',
        descriptionAr: 'معدل نمو التوزيعات',
        value: 0.06,
        category: 'growth',
        isPercentage: true,
        unit: 'decimal',
        asOfDate: '2026-01-15',
        source: 'افتراضات السوق الكلية',
        enabledInEngine: true,
      },
    ];

    const renderView = async (propsOverrides: Record<string, any> = {}) => {
      await act(async () => {
        root.render(
          React.createElement(ValuationView, {
            company: base.company,
            metrics: {
              ...base.metrics,
              costOfEquity: base.valuation.costOfEquity,
              wacc: base.valuation.wacc,
            },
            valuation: base.valuation,
            assumptionPriority: 'company_first',
            onChangePriority: () => {},
            onUpdateCompanyParams: () => {},
            companyOverridesMap: {},
            companyOverridesConfirmed: true,
            paramsMap: macros,
            macroParams,
            macroParamsConfirmed: true,
            macroMetaMap: {
              DDM_Growth: { asOfDate: '2026-01-15', source: 'افتراضات السوق الكلية', enabledInEngine: true },
            },
            selectedBetaRecord: {
              ticker: 'DDMT',
              beta: 1.0,
              asOfDate: '2026-01-05',
              source: 'EGX 3Y',
            },
            betaConfirmed: true,
            isAdmin: false,
            canEditFinancials: true,
            onSaveCompanyOverride: async (input) => {
              savedCompanyCalls.push({ ticker: input.ticker, key: input.key, value: input.value });
              return { docPath: `company_assumptions/${input.ticker}/parameters/${input.key}`, updatedAt: '2026-05-01T00:00:00Z' };
            },
            onDeleteCompanyOverride: async (ticker, key) => {
              deletedCompanyCalls.push({ ticker, key });
              return { docPath: `company_assumptions/${ticker}/parameters/${key}` };
            },
            onSaveGlobalMacroParam: async (param) => {
              savedGlobalCalls.push({ key: param.key, value: param.value });
              return { docPath: `macro_params/${param.key}`, updatedAt: '2026-05-01T00:00:00Z' };
            },
            onOpenDividendRecords: () => {
              dividendNavClicks += 1;
            },
            initialModelTab: 'ddm',
            userScopeKey: 'user-data-entry',
            ...propsOverrides,
          })
        );
      });
    };

    try {
      await renderView();

      const fairValEl = container.querySelector('[data-testid="ddm-tab-fair-value"]');
      assert.ok(fairValEl);
      assert.match(fairValEl.textContent ?? '', /10\.60/);

      // Derived Ke panel present with shared-impact warning and active CRP_Egypt card (without sensitivity draft button)
      const kePanel = container.querySelector('[data-testid="ddm-ke-panel"]');
      assert.ok(kePanel);
      assert.match(kePanel.textContent ?? '', /لا يوجد تجاوز يدوي مباشر لـ Ke/);
      assert.match(kePanel.textContent ?? '', /تأثير مشترك عبر النماذج/);
      const crpCard = kePanel.querySelector('[data-testid="param-card-CRP_Egypt"]');
      assert.ok(crpCard, 'CRP_Egypt card should render when r_Mode=1');
      const crpButtons = Array.from(crpCard.querySelectorAll('button')).map((b) => b.textContent ?? '');
      assert.equal(
        crpButtons.some((t) => t.includes('تجربة مؤقتة')),
        false,
        'CRP_Egypt must respect supportsSensitivityDraft=false'
      );

      // DDM_Growth card present with unit clarity and Data Entry permissions (company save yes, global save no)
      const ddmCard = container.querySelector('[data-testid="param-card-DDM_Growth"]');
      assert.ok(ddmCard);
      assert.match(ddmCard.textContent ?? '', /5 وتُحفظ ككسر عشري 0\.05/);
      const ddmButtons = Array.from(ddmCard.querySelectorAll('button'));
      const btnSensitivity = ddmButtons.find((b) => (b.textContent ?? '').includes('تجربة مؤقتة'));
      const btnSaveCompany = ddmButtons.find((b) => (b.textContent ?? '').includes('حفظ للشركة'));
      const btnSaveGlobal = ddmButtons.find((b) => (b.textContent ?? '').includes('تعديل العام'));
      assert.ok(btnSensitivity);
      assert.ok(btnSaveCompany);
      assert.equal(btnSaveGlobal, undefined, 'Data entry must not see global save button');

      // 1) Temporary sensitivity draft = 2% => DDM immediately becomes 8.50 with ZERO Firestore writes
      const ddmInput = ddmCard.querySelector('input') as HTMLInputElement;
      assert.ok(ddmInput);
      await act(async () => {
        setReactInputValue(ddmInput, '2');
      });
      await act(async () => {
        btnSensitivity.click();
      });
      assert.match(
        container.querySelector('[data-testid="ddm-tab-fair-value"]')?.textContent ?? '',
        /8\.50/,
        'Local sensitivity draft 2% must recompute DDM to 8.50'
      );
      assert.equal(savedCompanyCalls.length, 0);
      assert.equal(savedGlobalCalls.length, 0);

      // 2) Switching company resets local sensitivity draft cleanly
      const company2 = makeCompany({ id: 'C_OTHER', ticker: 'OTHR', nameAr: 'شركة أخرى' });
      const otherScenario = runDdmScenario({ company: company2, macros });
      await renderView({
        company: otherScenario.company,
        metrics: {
          ...otherScenario.metrics,
          costOfEquity: otherScenario.valuation.costOfEquity,
          wacc: otherScenario.valuation.wacc,
        },
        valuation: otherScenario.valuation,
      });
      assert.match(
        container.querySelector('[data-testid="ddm-tab-fair-value"]')?.textContent ?? '',
        /10\.60/,
        'Switching company must clear prior stock sensitivity draft'
      );

      // 3) Switch back to DDMT, save company override = 2% => stored as 0.02 (no double conversion)
      await renderView();
      const ddmCard2 = container.querySelector('[data-testid="param-card-DDM_Growth"]')!;
      const ddmInput2 = ddmCard2.querySelector('input') as HTMLInputElement;
      const btnSaveCompany2 = Array.from(ddmCard2.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('حفظ للشركة')
      )!;
      await act(async () => {
        setReactInputValue(ddmInput2, '2');
      });
      await act(async () => {
        btnSaveCompany2.click();
      });
      assert.equal(savedCompanyCalls.length, 1);
      assert.deepEqual(savedCompanyCalls[0], { ticker: 'DDMT', key: 'DDM_Growth', value: 0.02 });

      // 4) Re-render with saved company override + admin role => test delete override reverts to global 6.00% (never 0) & admin sees global save
      const withOverride = runDdmScenario({
        macros,
        companyOverrides: {
          DDM_Growth: {
            ticker: 'DDMT',
            key: 'DDM_Growth',
            value: 0.02,
            scope: 'company',
            source: 'تخصيص اختبار',
            asOfDate: '2026-05-01',
          },
        },
      });
      await renderView({
        valuation: withOverride.valuation,
        companyOverridesMap: {
          DDM_Growth: {
            ticker: 'DDMT',
            key: 'DDM_Growth',
            value: 0.02,
            scope: 'company',
            source: 'تخصيص اختبار',
            asOfDate: '2026-05-01',
          },
        },
        isAdmin: true,
        canEditFinancials: true,
      });
      const ddmCardAdmin = container.querySelector('[data-testid="param-card-DDM_Growth"]')!;
      const adminButtons = Array.from(ddmCardAdmin.querySelectorAll('button'));
      assert.ok(
        adminButtons.find((b) => (b.textContent ?? '').includes('تعديل العام')),
        'Admin must see global macro save button'
      );
      const btnDeleteOverride = adminButtons.find((b) =>
        (b.textContent ?? '').includes('مسح تخصيص الشركة')
      );
      assert.ok(btnDeleteOverride);
      await act(async () => {
        btnDeleteOverride.click();
      });
      assert.equal(deletedCompanyCalls.length, 1);
      assert.deepEqual(deletedCompanyCalls[0], { ticker: 'DDMT', key: 'DDM_Growth' });
      assert.match(container.textContent ?? '', /6\.00%/, 'Delete feedback should reflect global fallback 6.00%, not 0%');

      // 5) Clicking DPS_Actual navigation link invokes callback
      const openDivBtn = container.querySelector('[data-testid="ddm-open-dividend-records-btn"]') as HTMLButtonElement;
      assert.ok(openDivBtn);
      await act(async () => {
        openDivBtn.click();
      });
      assert.equal(dividendNavClicks, 1);

      // 6) Viewer role cannot save company or global overrides
      await renderView({ isAdmin: false, canEditFinancials: false });
      const ddmCardViewer = container.querySelector('[data-testid="param-card-DDM_Growth"]')!;
      const viewerButtons = Array.from(ddmCardViewer.querySelectorAll('button')).map((b) => b.textContent ?? '');
      assert.equal(viewerButtons.some((t) => t.includes('حفظ للشركة')), false);
      assert.equal(viewerButtons.some((t) => t.includes('تعديل العام')), false);

      // 7) Unconfirmed loading state distinguishes loading from confirmed absence
      const unconfirmedScenario = runDdmScenario({
        macros: BASE_MACROS_RMODE3,
        companyOverrides: {},
        companyOverridesConfirmed: false,
      });
      await renderView({
        valuation: unconfirmedScenario.valuation,
        paramsMap: BASE_MACROS_RMODE3,
        companyOverridesConfirmed: false,
      });
      assert.match(container.querySelector('[data-testid="param-card-DDM_Growth"]')?.textContent ?? '', /قيد تأكيد التحميل/);
    } finally {
      await act(async () => {
        root.unmount();
      });
      await cleanup();
    }
  });

  it('exports active DDM_Growth provenance, scope, company/global values, and exact DDM fair value in Excel workbook', async () => {
    const { company, q, metrics, valuation } = runDdmScenario({
      macros: { ...BASE_MACROS_RMODE3, DDM_Growth: 0.06 },
      companyOverrides: {
        DDM_Growth: {
          ticker: 'DDMT',
          key: 'DDM_Growth',
          value: 0.02,
          scope: 'company',
          source: 'تخصيص مجلس الإدارة',
          asOfDate: '2026-04-28',
        },
      },
      priority: 'company_first',
    });

    const wb = await buildCompanyValuationWorkbook(company, [q], metrics, valuation, []);
    assert.ok(wb.SheetNames.includes('DDM_Audit'));
    assert.ok(wb.SheetNames.includes('الافتراضات_والمصادر'));

    const ddmSheet = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['DDM_Audit'], { header: 1 });
    const rowMap = new Map<string, any>(ddmSheet.map((r) => [String(r[0]), r[1]]));

    assert.equal(rowMap.get('معدل النمو المستدام للتوزيعات g (DDM_Growth)'), '2.00%');
    assert.equal(rowMap.get('نطاق ومصدر DDM_Growth المعتمد'), 'تخصيص الشركة (company_assumptions)');
    assert.match(
      String(rowMap.get('تخصيص الشركة لـ DDM_Growth')),
      /^2\.00% \(تخصيص مجلس الإدارة · 2026-04-28\)$/
    );
    assert.match(
      String(rowMap.get('المرجع العام لـ DDM_Growth (macro_params)')),
      /^6\.00% \(افتراضات السوق الكلية · 2026-01-15\)$/
    );
    assert.match(String(rowMap.get('تاريخ ومصدر توثيق DDM_Growth')), /2026-04-28/);
    assert.ok(Math.abs(Number(rowMap.get('القيمة العادلة للسهم (DDM — EGP)')) - 8.5) < 1e-6);

    const assumptionsSheet = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['الافتراضات_والمصادر'], { header: 1 });
    const ddmGrowthRow = assumptionsSheet.find((r) => r[1] === 'DDM_Growth');
    assert.ok(ddmGrowthRow, 'DDM_Growth row must exist in الافتراضات_والمصادر');
    assert.equal(ddmGrowthRow[3], '2.00%');
    assert.equal(ddmGrowthRow[6], '2.00%');
    assert.equal(ddmGrowthRow[7], '6.00%');
  });
});
