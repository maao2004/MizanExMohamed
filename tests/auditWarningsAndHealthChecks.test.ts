/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import { runDataQualityAudit } from '../src/utils/auditEngine';
import { runStockHealthChecks } from '../src/core/math/healthChecks';
import { computeComprehensiveValuation } from '../src/core/math/valuation';
import { DashboardView } from '../src/components/DashboardView';
import { DataHubView, DataHubSubTab } from '../src/modules/data-hub/DataHubView';
import { HealthBadge } from '../src/shared/ui/HealthBadge';
import {
  DailyTradingRecord,
  HEALTH_CHECK_STATUS_META,
  HealthCheckStatus,
  QuarterlyFinancialRecord,
} from '../src/types';
import {
  Company,
  FinancialMetricsTTM,
  QuarterlyFinancial,
  ValuationResults,
} from '../src/types/financial';

const FULL_MACRO: Record<string, number> = {
  r_Mode: 1,
  WACC_Mode: 1,
  Country_Risk_Lambda: 1,
  Beta_Raw_Weight: 0.67,
  Beta_Anchor: 1,
  Rf_Egypt_10Y: 0.24,
  Rf_USD_10Y: 0.045,
  ERP_Developed: 0.05,
  CRP_Egypt: 0.02,
  Cost_of_Debt: 0.22,
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
  Relative_PE_Weight: 0.5,
  Relative_PB_Weight: 0.5,
  Weight_DCF: 35,
  Weight_DDM: 20,
  Weight_RIM: 25,
  Weight_Relative: 15,
  Weight_Graham: 5,
};

const makeCompany = (ticker: string, nameAr: string, sector = 'اتصالات'): Company => ({
  id: ticker.toLowerCase(),
  ticker,
  nameAr,
  nameEn: ticker,
  sector,
  sectorClassification: sector.includes('بنوك') ? 'financial' : 'non_financial',
  marketPrice: 40,
  marketPriceSource: 'closePrice',
  latestTradeDate: '2026-03-01',
  sharesOutstanding: 1_000_000,
  betaRaw: 1.0,
  currency: 'EGP',
  description: '',
});

const makeLegacyQuarter = (
  companyId: string,
  overrides: Partial<QuarterlyFinancial> = {}
): QuarterlyFinancial => ({
  id: `${companyId}_${overrides.year ?? 2025}_${overrides.quarter ?? 'Q1'}`,
  companyId,
  year: 2025,
  quarter: 'Q1',
  periodEndDate: '2025-03-31',
  revenueYTD: 1_000,
  ebitYTD: 250,
  netProfitYTD: 180,
  operatingCashFlowYTD: 220,
  capexYTD: 100,
  dividendsPaidYTD: 20,
  equity: 1_200,
  totalDebt: 300,
  cash: 150,
  sharesOutstanding: 1_000_000,
  ...overrides,
});

const makeQuarterlyRec = (
  overrides: Partial<QuarterlyFinancialRecord> = {}
): QuarterlyFinancialRecord => ({
  ticker: 'ETEL',
  year: 2025,
  quarter: 'Q1',
  periodEndDate: '2025-03-31',
  revenueYTD: 1_000,
  grossProfitYTD: 400,
  ebitYTD: 250,
  netIncomeYTD: 180,
  ocfYTD: 220,
  capexYTD: 100,
  dividendsPaidYTD: 20,
  equity: 1_200,
  totalAssets: 2_000,
  totalDebtWithoutTX: 300,
  cash: 150,
  shares: 1_000_000,
  currency: 'EGP',
  ...overrides,
});

const makeDailyRec = (overrides: Partial<DailyTradingRecord> = {}): DailyTradingRecord => ({
  ticker: 'ETEL',
  tradeDate: '2026-03-01',
  closePrice: 40,
  lastPrice: 40,
  volume: 10_000,
  turnover: 400_000,
  listedShares: 1_000_000,
  currency: 'EGP',
  ...overrides,
});

const makeMetricsStub = (): FinancialMetricsTTM => ({
  revenueTTM: 4_000,
  operatingProfitTTM: 1_000,
  netIncomeTTM: 720,
  operatingCashFlowTTM: 880,
  capexTTM: 200,
  fcfTTM: 680,
  fcffTTM: 650,
  epsTTM: 0.72,
  bvps: 1.2,
  roe: 0.15,
  roic: 0.14,
  peTTM: 10,
  pbTTM: 2,
  evToEbitda: 6,
  dividendYield: 0.04,
  netMargin: 0.18,
  debtToEquity: 0.25,
  netDebt: 150,
  marketCap: 40_000_000,
  financialCurrency: 'EGP',
  marketPriceCurrency: 'EGP',
});

const makeValuationStub = (
  engineOutputs: ReturnType<typeof computeComprehensiveValuation>
): ValuationResults => ({
  engineOutputs,
  dcfDetails: engineOutputs.dcfDetails,
  costOfEquity: engineOutputs.costOfEquity,
  wacc: engineOutputs.wacc,
  modelStatuses: engineOutputs.modelStatuses,
  resolvedAssumptions: engineOutputs.resolvedAssumptions,
  dcfFairValue: engineOutputs.dcfValue,
  ddmFairValue: engineOutputs.ddmValue,
  rimFairValue: engineOutputs.rimValue,
  relativeFairValue: engineOutputs.relativeValue,
  grahamFairValue: engineOutputs.grahamValue,
  compositeFairValue: engineOutputs.compositeFairValue,
  marketPrice: 40,
  marginOfSafetyPct: engineOutputs.marginOfSafetyPct,
  upsidePotentialPct: engineOutputs.upsidePotentialPct,
  weights: engineOutputs.weights,
  scenarios: {
    bear: { name: 'bear', nameAr: 'متحفظ', fairValue: 35, marginOfSafetyPct: -14, growthRate: 0.04, discountRate: 0.27, descriptionAr: '' },
    base: { name: 'base', nameAr: 'أساسي', fairValue: 45, marginOfSafetyPct: 11, growthRate: 0.05, discountRate: 0.25, descriptionAr: '' },
    bull: { name: 'bull', nameAr: 'متفائل', fairValue: 55, marginOfSafetyPct: 27, growthRate: 0.06, discountRate: 0.23, descriptionAr: '' },
  },
  sensitivityMatrix: [],
  growthRates: [],
  discountRates: [],
});

async function withHappyDom<T>(fn: (win: Window) => Promise<T>): Promise<T> {
  const win = new Window({ url: 'http://localhost:3000/' });
  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  const prevHTMLElement = (globalThis as any).HTMLElement;
  const prevHTMLInputElement = (globalThis as any).HTMLInputElement;
  const prevHTMLButtonElement = (globalThis as any).HTMLButtonElement;
  const prevHTMLSelectElement = (globalThis as any).HTMLSelectElement;
  const prevElement = (globalThis as any).Element;
  const prevNode = (globalThis as any).Node;
  const prevEvent = (globalThis as any).Event;
  const prevInputEvent = (globalThis as any).InputEvent;
  const prevMouseEvent = (globalThis as any).MouseEvent;
  const prevActEnv = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;

  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).HTMLInputElement = win.HTMLInputElement;
  (globalThis as any).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as any).HTMLSelectElement = win.HTMLSelectElement;
  (globalThis as any).Element = win.Element;
  (globalThis as any).Node = win.Node;
  (globalThis as any).Event = win.Event;
  (globalThis as any).InputEvent = win.InputEvent;
  (globalThis as any).MouseEvent = win.MouseEvent;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  try {
    return await fn(win);
  } finally {
    (globalThis as any).window = prevWindow;
    (globalThis as any).document = prevDocument;
    (globalThis as any).HTMLElement = prevHTMLElement;
    (globalThis as any).HTMLInputElement = prevHTMLInputElement;
    (globalThis as any).HTMLButtonElement = prevHTMLButtonElement;
    (globalThis as any).HTMLSelectElement = prevHTMLSelectElement;
    (globalThis as any).Element = prevElement;
    (globalThis as any).Node = prevNode;
    (globalThis as any).Event = prevEvent;
    (globalThis as any).InputEvent = prevInputEvent;
    (globalThis as any).MouseEvent = prevMouseEvent;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    await win.happyDOM.close();
  }
}

describe('Batch 35 & 36: Accounting Audit Warnings Routing & Health Check Sources/Semantics', () => {
  it('1) CapEx YTD drop from 100 to 80 emits structured multi-record targets and renders title + both values in DataHubView', () => {
    const etel = makeCompany('ETEL', 'المصرية للاتصالات');
    const financials: QuarterlyFinancial[] = [
      makeLegacyQuarter('etel', { year: 2025, quarter: 'Q1', revenueYTD: 1_000, capexYTD: 100 }),
      makeLegacyQuarter('etel', { year: 2025, quarter: 'Q2', revenueYTD: 2_000, capexYTD: 80 }),
    ];

    const warnings = runDataQualityAudit(etel, financials);
    assert.equal(warnings.length, 1);
    const capexWarn = warnings[0];
    assert.equal(capexWarn.type, 'capex_drop');
    assert.equal(capexWarn.title, 'تراجع غير معتاد في الإنفاق الاستثماري التراكمي (CapEx YTD)');
    assert.equal(capexWarn.companyTicker, 'ETEL');

    // Structured multi-record targets directly from engine (no Arabic text parsing)
    assert.ok(capexWarn.relatedRecords && capexWarn.relatedRecords.length === 2);
    assert.deepEqual(
      capexWarn.relatedRecords.map((r) => ({
        ticker: r.ticker,
        year: r.year,
        quarter: r.quarter,
        field: r.field,
      })),
      [
        { ticker: 'ETEL', year: 2025, quarter: 'Q2', field: 'capexYTD' },
        { ticker: 'ETEL', year: 2025, quarter: 'Q1', field: 'capexYTD' },
      ]
    );

    const engineOutputs = computeComprehensiveValuation(
      {
        ticker: 'ETEL',
        marketPrice: 40,
        sharesOutstanding: 1_000_000,
        betaRaw: 1,
        netIncomeTTM: 720,
        ocfTTM: 880,
        capexTTM: 200,
        fcfTTM: 680,
        totalEquity: 1_200,
        totalDebt: 300,
        cash: 150,
        sector: 'اتصالات',
      },
      FULL_MACRO
    );
    const healthChecks = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: makeDailyRec({ ticker: 'ETEL' }),
      quarterlyRecords: [
        makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'Q1', capexYTD: 100 }),
        makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'Q2', capexYTD: 80 }),
      ],
      engineOutputs,
      terminalGrowth: 0.05,
    });

    const html = renderToStaticMarkup(
      React.createElement(DataHubView, {
        selectedTicker: 'ETEL',
        onSelectTicker: () => {},
        availableTickers: ['ETEL'],
        dailyRecords: [makeDailyRec({ ticker: 'ETEL' })],
        quarterlyRecords: [
          makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'Q1', capexYTD: 100 }),
          makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'Q2', capexYTD: 80 }),
        ],
        healthChecks,
        auditWarnings: warnings,
        requestedSubTab: 'audit_warnings',
        onImportDailyRecords: () => {},
        onImportQuarterlyRecords: () => {},
        onDeleteQuarterlyRecord: () => {},
        userRole: 'admin',
      })
    );

    assert.match(html, /تراجع غير معتاد في الإنفاق الاستثماري التراكمي \(CapEx YTD\)/);
    assert.match(html, /(?:100|١٠٠)/);
    assert.match(html, /(?:80|٨٠)/);
    assert.match(html, /فحص جودة واكتمال بيانات السهم \(9 قواعد\)/);
    assert.match(html, /إجمالي ملاحظات التدقيق للسهم:[\s\S]*?1/);
  });

  it('2) Interactive DOM flow (happy-dom): Dashboard alert -> DataHub audit warnings -> filter/reset -> stock switch isolation -> multi-record edit routing -> zero writes', async () => {
    const etel = makeCompany('ETEL', 'المصرية للاتصالات');
    const abuk = makeCompany('ABUK', 'أبو قير للأسمدة', 'كيماويات');

    const etelFinancials: QuarterlyFinancial[] = [
      makeLegacyQuarter('etel', { year: 2025, quarter: 'Q1', revenueYTD: 1_000, capexYTD: 100 }),
      makeLegacyQuarter('etel', { year: 2025, quarter: 'Q2', revenueYTD: 800, capexYTD: 80 }),
    ];
    const abukFinancials: QuarterlyFinancial[] = [
      makeLegacyQuarter('abuk', { year: 2025, quarter: 'Q1', revenueYTD: 0, capexYTD: 50 }),
    ];

    const etelWarnings = runDataQualityAudit(etel, etelFinancials);
    const abukWarnings = runDataQualityAudit(abuk, abukFinancials);
    assert.equal(etelWarnings.length, 2);
    assert.equal(abukWarnings.length, 1);

    // Zero revenue is preserved (not converted to null) and does NOT claim automatic business shutdown
    assert.equal(abukFinancials[0].revenueYTD, 0);
    assert.equal(abukWarnings[0].detectedValues.enteredValue, 0);
    assert.doesNotMatch(abukWarnings[0].reasonAr, /يعني توقف نشاط الشركة التام/);
    assert.match(abukWarnings[0].reasonAr, /لا يعني تلقائياً توقف نشاط الشركة/);
    assert.match(abukWarnings[0].reviewActionAr, /أبقِ القيمة الصفرية/);

    const quarterlyRecords: QuarterlyFinancialRecord[] = [
      makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'Q1', revenueYTD: 1_000, capexYTD: 100 }),
      makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'Q2', revenueYTD: 800, capexYTD: 80 }),
      makeQuarterlyRec({ ticker: 'ABUK', year: 2025, quarter: 'Q1', revenueYTD: 0, capexYTD: 50 }),
    ];
    const dailyRecords: DailyTradingRecord[] = [
      makeDailyRec({ ticker: 'ETEL' }),
      makeDailyRec({ ticker: 'ABUK' }),
    ];

    const engineOutputs = computeComprehensiveValuation(
      {
        ticker: 'ETEL',
        marketPrice: 40,
        sharesOutstanding: 1_000_000,
        betaRaw: 1,
        netIncomeTTM: 720,
        ocfTTM: 880,
        capexTTM: 200,
        fcfTTM: 680,
        totalEquity: 1_200,
        totalDebt: 300,
        cash: 150,
        sector: 'اتصالات',
      },
      FULL_MACRO
    );
    const valuationStub = makeValuationStub(engineOutputs);
    const metricsStub = makeMetricsStub();

    let mutationCallCount = 0;

    await withHappyDom(async (win) => {
      const { createRoot } = await import('react-dom/client');
      const { act } = await import('react');

      const Harness: React.FC = () => {
        const [activeTab, setActiveTab] = useState<'dashboard' | 'data'>('dashboard');
        const [selectedTicker, setSelectedTicker] = useState<string>('ETEL');
        const [requestedSubTab, setRequestedSubTab] = useState<DataHubSubTab | null>(null);

        const activeCompany = selectedTicker === 'ETEL' ? etel : abuk;
        const activeWarnings = selectedTicker === 'ETEL' ? etelWarnings : abukWarnings;
        const activeChecks = runStockHealthChecks({
          ticker: selectedTicker,
          dailyRecord: dailyRecords.find((d) => d.ticker === selectedTicker),
          quarterlyRecords: quarterlyRecords.filter((q) => q.ticker === selectedTicker),
          engineOutputs,
          terminalGrowth: 0.05,
        });

        if (activeTab === 'dashboard') {
          return React.createElement(DashboardView, {
            company: activeCompany,
            metrics: metricsStub,
            valuation: valuationStub,
            warnings: activeWarnings,
            onNavigateToTab: (t) => setActiveTab(t as 'dashboard' | 'data'),
            onOpenAuditWarnings: () => {
              setRequestedSubTab('audit_warnings');
              setActiveTab('data');
            },
          });
        }

        return React.createElement(DataHubView, {
          selectedTicker,
          onSelectTicker: setSelectedTicker,
          availableTickers: ['ETEL', 'ABUK'],
          dailyRecords,
          quarterlyRecords,
          healthChecks: activeChecks,
          auditWarnings: [...etelWarnings, ...abukWarnings],
          requestedSubTab,
          onClearRequestedSubTab: () => setRequestedSubTab(null),
          onImportDailyRecords: () => {
            mutationCallCount += 1;
          },
          onImportQuarterlyRecords: () => {
            mutationCallCount += 1;
          },
          onDeleteQuarterlyRecord: () => {
            mutationCallCount += 1;
          },
          onUpdateQuarterlyRecord: () => {
            mutationCallCount += 1;
          },
          userRole: 'admin',
        });
      };

      const container = win.document.createElement('div');
      win.document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(React.createElement(Harness));
      });

      const alertEl = container.querySelector<HTMLElement>('[data-testid="dashboard-audit-alert"]');
      assert.ok(alertEl, 'Dashboard audit alert must render when warnings exist');
      assert.match(alertEl.textContent || '', /رصد 2 ملاحظات محاسبية/);

      await act(async () => {
        alertEl.click();
      });

      const panel = container.querySelector<HTMLElement>('[data-testid="accounting-audit-warnings-panel"]');
      assert.ok(panel, 'Clicking Dashboard alert must open the Accounting Audit Warnings section');
      // Suspicion label must distinguish review flag from confirmed accounting error
      assert.match(panel.textContent || '', /اشتباه حرج للمراجعة/);
      assert.doesNotMatch(panel.textContent || '', /خطأ حرج/);
      assert.match(container.querySelector('[data-testid="audit-total-count"]')?.textContent || '', /2/);
      assert.match(container.querySelector('[data-testid="audit-visible-count"]')?.textContent || '', /2/);
      assert.doesNotMatch(panel.textContent || '', /مراجعة القيمة الصفرية للإيرادات/);

      const critBtn = container.querySelector<HTMLButtonElement>('[data-testid="audit-filter-severity-critical"]');
      assert.ok(critBtn);
      await act(async () => {
        critBtn.click();
      });
      assert.match(container.querySelector('[data-testid="audit-total-count"]')?.textContent || '', /2/);
      assert.match(container.querySelector('[data-testid="audit-visible-count"]')?.textContent || '', /1/);

      const clearBtn = container.querySelector<HTMLButtonElement>('[data-testid="audit-clear-filters-btn"]');
      assert.ok(clearBtn, 'Clear filters button must be visible while filter is active');
      await act(async () => {
        clearBtn.click();
      });
      assert.match(container.querySelector('[data-testid="audit-visible-count"]')?.textContent || '', /2/);

      const capexWarn = etelWarnings.find((w) => w.type === 'capex_drop')!;
      const editQ2Btn = container.querySelector<HTMLButtonElement>(
        `[data-testid="audit-edit-btn-${capexWarn.id}-2025-Q2-capexYTD"]`
      );
      const editQ1Btn = container.querySelector<HTMLButtonElement>(
        `[data-testid="audit-edit-btn-${capexWarn.id}-2025-Q1-capexYTD"]`
      );
      assert.ok(editQ2Btn && editQ1Btn, 'Multi-record warning must expose edit buttons for both Q2 and Q1');

      await act(async () => {
        editQ2Btn.click();
      });
      let capexInput = container.querySelector<HTMLInputElement>('input[data-field="capexYTD"]');
      assert.ok(capexInput, 'EditQuarterlyRecordModal must open with capexYTD input');
      assert.equal(capexInput.value, '80');

      const cancelBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('إلغاء')
      );
      assert.ok(cancelBtn);
      await act(async () => {
        cancelBtn.click();
      });

      await act(async () => {
        editQ1Btn.click();
      });
      capexInput = container.querySelector<HTMLInputElement>('input[data-field="capexYTD"]');
      assert.ok(capexInput);
      assert.equal(capexInput.value, '100');

      const cancelBtn2 = Array.from(container.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('إلغاء')
      );
      assert.ok(cancelBtn2);
      await act(async () => {
        cancelBtn2.click();
      });

      const stockSelect = container.querySelector<HTMLSelectElement>(
        'select[aria-label="اختيار السهم في ملاحظات التدقيق"]'
      );
      assert.ok(stockSelect);
      await act(async () => {
        stockSelect.value = 'ABUK';
        stockSelect.dispatchEvent(new win.Event('change', { bubbles: true }));
      });
      assert.match(container.querySelector('[data-testid="audit-total-count"]')?.textContent || '', /1/);
      assert.match(panel.textContent || '', /مراجعة القيمة الصفرية للإيرادات/);
      assert.doesNotMatch(panel.textContent || '', /تراجع غير معتاد في الإنفاق الاستثماري/);
      assert.equal(mutationCallCount, 0);

      await act(async () => {
        root.unmount();
      });
    });
  });

  it('3) Edit routing blocks unauthorized viewer and handles missing record cleanly without picking fallback or creating record', async () => {
    const etel = makeCompany('ETEL', 'المصرية للاتصالات');
    const warnings = runDataQualityAudit(etel, [
      makeLegacyQuarter('etel', { year: 2025, quarter: 'Q1', revenueYTD: 1_000, capexYTD: 100 }),
      makeLegacyQuarter('etel', { year: 2025, quarter: 'Q2', revenueYTD: 2_000, capexYTD: 80 }),
    ]);
    const capexWarn = warnings[0];

    await withHappyDom(async (win) => {
      const { createRoot } = await import('react-dom/client');
      const { act } = await import('react');
      let writeCalls = 0;

      const container = win.document.createElement('div');
      win.document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          React.createElement(DataHubView, {
            selectedTicker: 'ETEL',
            onSelectTicker: () => {},
            availableTickers: ['ETEL'],
            dailyRecords: [makeDailyRec({ ticker: 'ETEL' })],
            quarterlyRecords: [
              makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'Q1', capexYTD: 100 }),
              makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'Q2', capexYTD: 80 }),
            ],
            healthChecks: [],
            auditWarnings: warnings,
            requestedSubTab: 'audit_warnings',
            onImportDailyRecords: () => {
              writeCalls += 1;
            },
            onImportQuarterlyRecords: () => {
              writeCalls += 1;
            },
            onDeleteQuarterlyRecord: () => {
              writeCalls += 1;
            },
            onUpdateQuarterlyRecord: () => {
              writeCalls += 1;
            },
            userRole: 'viewer',
          })
        );
      });

      const editBtn = container.querySelector<HTMLButtonElement>(
        `[data-testid="audit-edit-btn-${capexWarn.id}-2025-Q2-capexYTD"]`
      );
      assert.ok(editBtn);
      await act(async () => {
        editBtn.click();
      });

      assert.equal(container.querySelector('input[data-field="capexYTD"]'), null);
      const notice = container.querySelector('[role="alert"]');
      assert.ok(notice, 'Unauthorized click must show an explanatory alert');
      assert.match(notice.textContent || '', /لا تملك صلاحية تعديل السجل المالي/);
      assert.equal(writeCalls, 0);

      await act(async () => {
        root.unmount();
      });
    });

    await withHappyDom(async (win) => {
      const { createRoot } = await import('react-dom/client');
      const { act } = await import('react');
      let writeCalls = 0;

      const container = win.document.createElement('div');
      win.document.body.appendChild(container);
      const root = createRoot(container);

      await act(async () => {
        root.render(
          React.createElement(DataHubView, {
            selectedTicker: 'ETEL',
            onSelectTicker: () => {},
            availableTickers: ['ETEL'],
            dailyRecords: [makeDailyRec({ ticker: 'ETEL' })],
            quarterlyRecords: [
              makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'Q1', capexYTD: 100 }),
            ],
            healthChecks: [],
            auditWarnings: warnings,
            requestedSubTab: 'audit_warnings',
            onImportDailyRecords: () => {
              writeCalls += 1;
            },
            onImportQuarterlyRecords: () => {
              writeCalls += 1;
            },
            onDeleteQuarterlyRecord: () => {
              writeCalls += 1;
            },
            onUpdateQuarterlyRecord: () => {
              writeCalls += 1;
            },
            userRole: 'admin',
          })
        );
      });

      const missingQ2Btn = container.querySelector<HTMLButtonElement>(
        `[data-testid="audit-edit-btn-${capexWarn.id}-2025-Q2-capexYTD"]`
      );
      assert.ok(missingQ2Btn);
      await act(async () => {
        missingQ2Btn.click();
      });

      assert.equal(container.querySelector('input[data-field="capexYTD"]'), null);
      const notice = container.querySelector('[role="alert"]');
      assert.ok(notice, 'Missing record click must show clear not_found explanation');
      assert.match(notice.textContent || '', /تعذر العثور على السجل المالي المطابق/);
      assert.match(notice.textContent || '', /لم يُنشأ سجل بديل/);
      assert.equal(writeCalls, 0);

      await act(async () => {
        root.unmount();
      });
    });
  });

  it('4) P/E check strictly separates imported daily peRatio from engine-attested EPS (positive, zero, negative, missing, and diverging)', () => {
    const baseEngine = computeComprehensiveValuation(
      {
        ticker: 'ETEL',
        marketPrice: 40,
        sharesOutstanding: 1_000_000,
        betaRaw: 1,
        netIncomeTTM: 720,
        ocfTTM: 880,
        capexTTM: 200,
        fcfTTM: 680,
        totalEquity: 1_200,
        totalDebt: 300,
        cash: 150,
        sector: 'اتصالات',
        sectorClassification: 'non_financial',
      },
      FULL_MACRO
    );

    // 4A. Positive imported dailyRecord.peRatio + MISSING engine epsTTM -> MUST be incomplete, NEVER claim attested common earnings!
    const dailyWithImportedPe = makeDailyRec({
      ticker: 'ETEL',
      tradeDate: '2026-03-01',
      closePrice: 40,
      lastPrice: 40,
      peRatio: 11.25,
    });
    const checksImportedOnly = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: dailyWithImportedPe,
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'FY' })],
      engineOutputs: { ...baseEngine, epsTTM: null },
      terminalGrowth: 0.05,
    });
    const peImportedOnly = checksImportedOnly.find((c) => c.id === 'pe_ratio_positive')!;
    assert.equal(peImportedOnly.status, 'incomplete');
    assert.doesNotMatch(peImportedOnly.detailsAr, /ربحية موثقة للأسهم العادية/);
    assert.match(String(peImportedOnly.actualValue), /11\.25x/);
    assert.match(String(peImportedOnly.actualValue), /2026-03-01/);
    assert.match(peImportedOnly.detailsAr, /مرجع فقط/);
    assert.match(peImportedOnly.detailsAr, /لا يُعد دليلاً على توثيق NetIncomeCommon أو EPS/);
    // Daily record must NOT be mutated
    assert.equal(dailyWithImportedPe.peRatio, 11.25);

    // 4B. Divergence between computed P/E (40 / 4 = 10.00x) and imported daily P/E (14.50x) -> BOTH sources shown without silent replacement
    const dailyDivergent = makeDailyRec({
      ticker: 'ETEL',
      tradeDate: '2026-03-01',
      closePrice: 40,
      lastPrice: 40,
      peRatio: 14.5,
    });
    const checksDivergent = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: dailyDivergent,
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'FY' })],
      engineOutputs: { ...baseEngine, epsTTM: 4 },
      terminalGrowth: 0.05,
    });
    const peDivergent = checksDivergent.find((c) => c.id === 'pe_ratio_positive')!;
    assert.equal(peDivergent.status, 'pass');
    assert.match(String(peDivergent.actualValue), /10\.00x/);
    assert.match(String(peDivergent.actualValue), /14\.50x/);
    assert.match(peDivergent.detailsAr, /10\.00x/);
    assert.match(peDivergent.detailsAr, /14\.50x/);
    assert.match(peDivergent.detailsAr, /دون استبدال صامت/);
    assert.equal(dailyDivergent.peRatio, 14.5);

    // 4C. Zero attested EPS (epsTTM === 0) even with positive imported peRatio -> MUST fail on attested EPS = 0 while preserving imported ref
    const checksZeroEps = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: dailyWithImportedPe,
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'FY' })],
      engineOutputs: { ...baseEngine, epsTTM: 0 },
      terminalGrowth: 0.05,
    });
    const peZeroEps = checksZeroEps.find((c) => c.id === 'pe_ratio_positive')!;
    assert.equal(peZeroEps.status, 'fail');
    assert.match(String(peZeroEps.actualValue), /EPS_TTM = 0/);
    assert.match(String(peZeroEps.actualValue), /11\.25x/);
    assert.match(peZeroEps.detailsAr, /تساوي صفراً/);

    // 4D. Negative attested EPS (epsTTM = -2 -> computed -20.00x) even with positive imported peRatio -> MUST fail on negative computed P/E
    const checksNegEps = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: dailyWithImportedPe,
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'FY' })],
      engineOutputs: { ...baseEngine, epsTTM: -2 },
      terminalGrowth: 0.05,
    });
    const peNegEps = checksNegEps.find((c) => c.id === 'pe_ratio_positive')!;
    assert.equal(peNegEps.status, 'fail');
    assert.match(String(peNegEps.actualValue), /-20\.00x/);
    assert.match(String(peNegEps.actualValue), /11\.25x/);
    assert.match(peNegEps.detailsAr, /سالب فعلياً/);
  });

  it('5) WACC > g applicability uses active terminalValueMethod (exit_multiple with dcfDetails=null -> not_applicable) and preserves perpetuity_growth + financial sector rules', () => {
    const baseEngine = computeComprehensiveValuation(
      {
        ticker: 'ETEL',
        marketPrice: 40,
        sharesOutstanding: 1_000_000,
        betaRaw: 1,
        netIncomeTTM: 720,
        ocfTTM: 880,
        capexTTM: 200,
        fcfTTM: 680,
        totalEquity: 1_200,
        totalDebt: 300,
        cash: 150,
        sector: 'اتصالات',
        sectorClassification: 'non_financial',
      },
      FULL_MACRO
    );

    // 5A. exit_multiple with dcfDetails === null -> WACC > g MUST be not_applicable AND note discount rate still required for DCF
    const exitMultipleNoDetails = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: makeDailyRec({ ticker: 'ETEL' }),
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'FY' })],
      engineOutputs: { ...baseEngine, dcfDetails: null, dcfValue: null, wacc: null },
      terminalGrowth: 0.05,
      terminalValueMethod: 'exit_multiple',
    });
    const waccExit = exitMultipleNoDetails.find((c) => c.id === 'wacc_greater_than_g')!;
    assert.equal(waccExit.status, 'not_applicable');
    assert.match(waccExit.detailsAr, /exit_multiple/);
    assert.match(waccExit.detailsAr, /لا يعفي ذلك نموذج DCF من الحاجة إلى معدل خصم/);

    // 5B. perpetuity_growth: missing inputs -> incomplete
    const perpMissing = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: makeDailyRec({ ticker: 'ETEL' }),
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'FY' })],
      engineOutputs: { ...baseEngine, wacc: null },
      terminalGrowth: 0.05,
      terminalValueMethod: 'perpetuity_growth',
    });
    assert.equal(perpMissing.find((c) => c.id === 'wacc_greater_than_g')!.status, 'incomplete');

    // 5C. perpetuity_growth: WACC > g -> pass
    const perpPass = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: makeDailyRec({ ticker: 'ETEL' }),
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'FY' })],
      engineOutputs: { ...baseEngine, wacc: 0.2 },
      terminalGrowth: 0.05,
      terminalValueMethod: 'perpetuity_growth',
    });
    assert.equal(perpPass.find((c) => c.id === 'wacc_greater_than_g')!.status, 'pass');

    // 5D. perpetuity_growth: WACC === g -> fail
    const perpEqual = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: makeDailyRec({ ticker: 'ETEL' }),
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'FY' })],
      engineOutputs: { ...baseEngine, wacc: 0.05 },
      terminalGrowth: 0.05,
      terminalValueMethod: 'perpetuity_growth',
    });
    const waccEq = perpEqual.find((c) => c.id === 'wacc_greater_than_g')!;
    assert.equal(waccEq.status, 'fail');
    assert.match(waccEq.detailsAr, /تساوي/);

    // 5E. perpetuity_growth: WACC < g -> fail
    const perpLess = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: makeDailyRec({ ticker: 'ETEL' }),
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'FY' })],
      engineOutputs: { ...baseEngine, wacc: 0.04 },
      terminalGrowth: 0.05,
      terminalValueMethod: 'perpetuity_growth',
    });
    const waccLt = perpLess.find((c) => c.id === 'wacc_greater_than_g')!;
    assert.equal(waccLt.status, 'fail');
    assert.match(waccLt.detailsAr, /أقل من/);
  });

  it('6) runStockHealthChecks separates missing, zero, negative, positive, not_applicable AND uses evidence-bounded Arabic phrasing', () => {
    const baseEngine = computeComprehensiveValuation(
      {
        ticker: 'ETEL',
        marketPrice: 40,
        sharesOutstanding: 1_000_000,
        betaRaw: 1,
        netIncomeTTM: 720,
        ocfTTM: 880,
        capexTTM: 200,
        fcfTTM: 680,
        totalEquity: 1_200,
        totalDebt: 300,
        cash: 150,
        sector: 'اتصالات',
        sectorClassification: 'non_financial',
      },
      FULL_MACRO
    );

    // 6A. Positive OCF & valid daily record must NOT overclaim earnings quality or external EGX screen match
    const positiveChecks = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: makeDailyRec({ ticker: 'ETEL', tradeDate: '2026-03-01', closePrice: 40, lastPrice: 40 }),
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'ETEL', year: 2025, quarter: 'FY', ocfYTD: 500, capexYTD: 100 })],
      engineOutputs: baseEngine,
      terminalGrowth: 0.05,
    });
    const ocfPos = positiveChecks.find((c) => c.id === 'ocf_positive')!;
    assert.equal(ocfPos.status, 'pass');
    assert.doesNotMatch(ocfPos.detailsAr, /يؤكد جودة الأرباح/);
    assert.match(ocfPos.detailsAr, /لا تكفي إيجابية OCF وحدها لإثبات جودة الأرباح/);

    const dailyPos = positiveChecks.find((c) => c.id === 'clean_daily_data')!;
    assert.equal(dailyPos.status, 'pass');
    assert.doesNotMatch(dailyPos.detailsAr, /محدث ومتطابق مع شاشة تداول/);
    assert.match(dailyPos.detailsAr, /لا يثبت ذلك بذاته حداثة البيانات أو مطابقتها الخارجية/);

    // 6B. Missing FCF & Equity & Assets -> incomplete, NEVER described as negative or Equity > Assets
    const missingChecks = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: makeDailyRec({ ticker: 'ETEL' }),
      quarterlyRecords: [
        makeQuarterlyRec({
          ticker: 'ETEL',
          year: 2025,
          quarter: 'FY',
          ocfYTD: 500,
          capexYTD: null,
          equity: null,
          totalAssets: 1_000,
          shares: null,
        }),
      ],
      engineOutputs: { ...baseEngine, wacc: null, dcfValue: null, epsTTM: null },
      terminalGrowth: null,
    });
    const fcfMissing = missingChecks.find((c) => c.id === 'fcf_positive')!;
    assert.equal(fcfMissing.status, 'incomplete');
    assert.equal(fcfMissing.actualValue, 'BLANK');
    assert.doesNotMatch(fcfMissing.detailsAr, /التدفق النقدي الحر سالب/);

    const eqMissing = missingChecks.find((c) => c.id === 'equity_assets_consistent')!;
    assert.equal(eqMissing.status, 'incomplete');
    assert.equal(eqMissing.actualValue, 'بيانات غير مكتملة');
    assert.doesNotMatch(eqMissing.detailsAr, /أكبر من إجمالي أصول/);

    // 6C. Explicit Zero (0) values -> fail with explicit zero message (NOT BLANK and NOT negative)
    const zeroChecks = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: makeDailyRec({ ticker: 'ETEL', closePrice: 0, lastPrice: 0 }),
      quarterlyRecords: [
        makeQuarterlyRec({
          ticker: 'ETEL',
          year: 2025,
          quarter: 'FY',
          ocfYTD: 0,
          capexYTD: 0,
          equity: 0,
          totalAssets: 100,
          shares: 0,
        }),
      ],
      engineOutputs: { ...baseEngine, wacc: 0.05, dcfValue: 0, epsTTM: 0 },
      terminalGrowth: 0.05,
    });
    assert.equal(zeroChecks.find((c) => c.id === 'ocf_positive')!.status, 'fail');
    assert.match(zeroChecks.find((c) => c.id === 'ocf_positive')!.detailsAr, /يساوي صفراً/);
    assert.equal(zeroChecks.find((c) => c.id === 'fcf_positive')!.status, 'fail');
    assert.match(zeroChecks.find((c) => c.id === 'fcf_positive')!.detailsAr, /يساوي صفراً/);
    assert.equal(zeroChecks.find((c) => c.id === 'equity_assets_consistent')!.status, 'pass');
    assert.equal(zeroChecks.find((c) => c.id === 'shares_positive')!.status, 'fail');
    assert.match(zeroChecks.find((c) => c.id === 'shares_positive')!.detailsAr, /يساوي صفراً/);
    assert.equal(zeroChecks.find((c) => c.id === 'dcf_price_positive')!.status, 'fail');
    assert.match(zeroChecks.find((c) => c.id === 'dcf_price_positive')!.detailsAr, /تساوي صفراً/);
    assert.equal(zeroChecks.find((c) => c.id === 'clean_daily_data')!.status, 'fail');
    assert.match(zeroChecks.find((c) => c.id === 'clean_daily_data')!.detailsAr, /يساوي صفراً/);

    // 6D. Negative values & Equity > TotalAssets -> fail
    const negativeChecks = runStockHealthChecks({
      ticker: 'ETEL',
      dailyRecord: makeDailyRec({ ticker: 'ETEL', closePrice: -5, lastPrice: -5 }),
      quarterlyRecords: [
        makeQuarterlyRec({
          ticker: 'ETEL',
          year: 2025,
          quarter: 'FY',
          ocfYTD: -100,
          capexYTD: 50,
          equity: 500,
          totalAssets: 400,
          shares: -10,
        }),
      ],
      engineOutputs: { ...baseEngine, wacc: 0.04, dcfValue: -12, epsTTM: -2 },
      terminalGrowth: 0.05,
    });
    assert.equal(negativeChecks.find((c) => c.id === 'ocf_positive')!.status, 'fail');
    assert.equal(negativeChecks.find((c) => c.id === 'fcf_positive')!.status, 'fail');
    assert.equal(negativeChecks.find((c) => c.id === 'equity_assets_consistent')!.status, 'fail');
    assert.match(negativeChecks.find((c) => c.id === 'equity_assets_consistent')!.detailsAr, /أكبر من إجمالي أصول/);
    assert.equal(negativeChecks.find((c) => c.id === 'dcf_price_positive')!.status, 'fail');

    // 6E. Financial sector -> DCF & WACC>g marked not_applicable cleanly
    const bankEngine = computeComprehensiveValuation(
      {
        ticker: 'COMI',
        marketPrice: 80,
        sharesOutstanding: 3_000_000_000,
        betaRaw: 1.0,
        netIncomeTTM: 40_000_000_000,
        ocfTTM: null,
        capexTTM: null,
        fcfTTM: null,
        totalEquity: 150_000_000_000,
        totalDebt: 0,
        cash: 0,
        sector: 'بنوك',
        sectorClassification: 'financial',
      },
      FULL_MACRO
    );
    const bankChecks = runStockHealthChecks({
      ticker: 'COMI',
      dailyRecord: makeDailyRec({ ticker: 'COMI', closePrice: 80, lastPrice: 80 }),
      quarterlyRecords: [makeQuarterlyRec({ ticker: 'COMI', year: 2025, quarter: 'FY' })],
      engineOutputs: bankEngine,
      terminalGrowth: 0.05,
    });
    assert.equal(bankChecks.find((c) => c.id === 'dcf_price_positive')!.status, 'not_applicable');
    assert.equal(bankChecks.find((c) => c.id === 'wacc_greater_than_g')!.status, 'not_applicable');

    // 6F. HealthBadge renders every central status distinctly
    const allStatuses: HealthCheckStatus[] = ['pass', 'fail', 'incomplete', 'not_applicable', 'warning'];
    for (const status of allStatuses) {
      const badgeHtml = renderToStaticMarkup(React.createElement(HealthBadge, { status }));
      assert.match(badgeHtml, new RegExp(`data-health-status="${status}"`));
      assert.ok(badgeHtml.includes(HEALTH_CHECK_STATUS_META[status].labelAr));
    }
  });

  it('7) Independent expected-value regression test: valuation engine matches closed-form expected Ke, WACC, DCF, DDM, Relative, Graham, and Composite values', () => {
    const regressionMacro: Record<string, number> = {
      r_Mode: 1,
      WACC_Mode: 1,
      Country_Risk_Lambda: 1,
      Beta_Raw_Weight: 0.67,
      Beta_Anchor: 1,
      Rf_Egypt_10Y: 0.2,
      Rf_USD_10Y: 0.045,
      ERP_Developed: 0.05,
      CRP_Egypt: 0.01,
      Cost_of_Debt: 0.2,
      TaxRate: 0.25,
      Terminal_Growth: 0.06,
      Forecast_Years: 2,
      Growth_Y1: 0.1,
      Growth_Y2: 0.1,
      DDM_Growth: 0.06,
      RIM_Retention: 0.5,
      Relative_PE_Weight: 0.6,
      Relative_PB_Weight: 0.4,
      Weight_DCF: 35,
      Weight_DDM: 20,
      Weight_RIM: 25,
      Weight_Relative: 15,
      Weight_Graham: 5,
    };

    const out = computeComprehensiveValuation(
      {
        ticker: 'REGR',
        marketPrice: 40,
        sharesOutstanding: 1_000_000,
        betaRaw: 1.0,
        betaStatus: 'available',
        netIncomeTTM: 4_000_000,
        ocfTTM: 12_000_000,
        capexTTM: 2_000_000,
        fcfTTM: 10_000_000,
        fcffTTM: 10_000_000,
        totalEquity: 25_000_000,
        totalDebt: 10_000_000,
        cash: 5_000_000,
        dpsRegular: 2.0,
        sector: 'اتصالات',
        sectorClassification: 'non_financial',
        companyTargetPE: 10,
        companyTargetPB: 2,
        epsUsed: 4.0,
        epsBasis: 'analytical_common_ni_eop_shares',
        bvpsUsed: 25.0,
        bvpsBasis: 'reported_common_equity',
        roeUsed: 0.16,
        financialCurrency: 'EGP',
        financialCurrencyStatus: 'explicit',
        marketPriceCurrency: 'EGP',
        macroParamsConfirmed: true,
        companyOverridesConfirmed: true,
      },
      regressionMacro
    );

    // Independent closed-form expected calculations:
    // 1) Ke = 0.20 + (0.67 * 1.0 + 0.33 * 1.0) * 0.05 + 1.0 * 0.01 = 0.26
    const expectedKe = 0.26;
    // 2) WACC = (40M / 50M) * 0.26 + (10M / 50M) * (0.20 * (1 - 0.25)) = 0.208 + 0.030 = 0.238
    const expectedWacc = 0.238;
    // 3) DCF (2 years @ 10% growth, g = 6%, WACC = 23.8%, Net Debt = 5M, Shares = 1M):
    const fcf1 = 10_000_000 * 1.1;
    const fcf2 = fcf1 * 1.1;
    const tv = (fcf2 * 1.06) / (expectedWacc - 0.06);
    const ev =
      fcf1 / (1 + expectedWacc) +
      fcf2 / Math.pow(1 + expectedWacc, 2) +
      tv / Math.pow(1 + expectedWacc, 2);
    const expectedDcf = (ev - 5_000_000) / 1_000_000;
    // 4) DDM = 2.0 * (1 + 0.06) / (0.26 - 0.06) = 10.60
    const expectedDdm = 10.6;
    // 5) Relative = 0.6 * (4.0 * 10) + 0.4 * (25.0 * 2) = 24 + 20 = 44.0
    const expectedRelative = 44.0;
    // 6) Graham = sqrt(22.5 * 4.0 * 25.0) = sqrt(2250)
    const expectedGraham = Math.sqrt(22.5 * 4.0 * 25.0);

    assert.ok(out.costOfEquity !== null);
    assert.ok(Math.abs(out.costOfEquity - expectedKe) < 1e-9);
    assert.ok(out.wacc !== null);
    assert.ok(Math.abs(out.wacc - expectedWacc) < 1e-9);
    assert.ok(out.dcfValue !== null);
    assert.ok(Math.abs(out.dcfValue - expectedDcf) < 1e-6);
    assert.ok(out.ddmValue !== null);
    assert.ok(Math.abs(out.ddmValue - expectedDdm) < 1e-9);
    assert.ok(out.relativeValue !== null);
    assert.ok(Math.abs(out.relativeValue - expectedRelative) < 1e-9);
    assert.ok(out.grahamValue !== null);
    assert.ok(Math.abs(out.grahamValue - expectedGraham) < 1e-9);

    // 7) Composite = weighted average of active models with exact configured weights
    const activeEntries: Array<[number, number]> = [
      [expectedDcf, 35],
      [expectedDdm, 20],
      [expectedRelative, 15],
      [expectedGraham, 5],
    ];
    if (out.rimValue !== null) {
      activeEntries.push([out.rimValue, 25]);
    }
    const weightTotal = activeEntries.reduce((acc, [, w]) => acc + w, 0);
    const expectedComposite = activeEntries.reduce((acc, [v, w]) => acc + v * (w / weightTotal), 0);

    assert.ok(out.compositeFairValue !== null);
    assert.ok(Math.abs(out.compositeFairValue - expectedComposite) < 1e-6);
  });
});
