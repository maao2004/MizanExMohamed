/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Batch 33 Interactive DOM & Rendering Tests:
 * Verifies AddCompanyModal, EditQuarterlyRecordModal, MetricAuditCard, ValuationSourcesCard,
 * and QuarterlyRecordsTable against the central WeightedAvgShares_Basis registry and
 * AccountingEPS eligibility contract.
 */

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';

import {
  WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR,
  WEIGHTED_AVG_SHARES_BASIS_OPTIONS,
  WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR,
} from '../src/core/contracts';
import { resolveMetricAuditBundle } from '../src/core/domain';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { MetricAuditCard } from '../src/components/MetricAuditCard';
import { ValuationSourcesCard } from '../src/components/ValuationSourcesCard';
import { QuarterlyRecordsTable } from '../src/modules/data-hub/QuarterlyRecordsTable';
import type { Company, DailyTradingRecord, QuarterlyFinancial, QuarterlyFinancialRecord } from '../src/types';

// Bootstrap happy-dom globals BEFORE importing react-dom/client
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const bootWindow = new Window({ url: 'http://localhost:3000/' });
function installDomGlobals(win: Window): void {
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).HTMLInputElement = win.HTMLInputElement;
  (globalThis as any).HTMLSelectElement = win.HTMLSelectElement;
  (globalThis as any).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as any).HTMLFormElement = win.HTMLFormElement;
  (globalThis as any).Element = win.Element;
  (globalThis as any).Node = win.Node;
  (globalThis as any).Event = win.Event;
  (globalThis as any).InputEvent = win.InputEvent;
  (globalThis as any).MouseEvent = win.MouseEvent;
  (globalThis as any).CustomEvent = win.CustomEvent;
  (globalThis as any).localStorage = win.localStorage;
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
}
installDomGlobals(bootWindow);

function makeBaseRecord(
  overrides: Partial<QuarterlyFinancialRecord> = {}
): QuarterlyFinancialRecord {
  return {
    ticker: 'TEST',
    stockName: 'شركة اختبار',
    year: 2026,
    quarter: 'Q1',
    shares: 100,
    intangibleAssets: 0,
    totalAssets: 500,
    equity: 300,
    totalDebtWithoutTX: 50,
    totalLiabilities: 200,
    revenueYTD: 100,
    grossProfitYTD: 60,
    ebitYTD: 45,
    pbtYTD: 40,
    netIncomeYTD: 30,
    ocfYTD: 35,
    netInvestingCfYTD: -5,
    dividendsPaidYTD: 0,
    cash: 60,
    interestExpenseYTD: 0,
    financeCostsYTD: 0,
    interestIncomeYTD: 0,
    taxExpenseYTD: 10,
    interestPaidYTD: 0,
    capexYTD: 5,
    dateInsertData: '2026-04-15',
    currency: 'EGP',
    netIncomeCommonYTD: 30,
    netIncomeCommonBasis: 'explicit_common',
    equityCommon: 300,
    equityCommonBasis: 'explicit_common',
    weightedAvgSharesYTD: 100,
    weightedAvgSharesBasis: 'standalone_quarter',
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-03-31',
    periodDays: 90,
    isPeriodStandard: true,
    isCapitalActionAdjusted: true,
    ...overrides,
  };
}

let createRoot: typeof import('react-dom/client').createRoot;
let EditQuarterlyRecordModal: typeof import('../src/modules/data-hub/EditQuarterlyRecordModal').EditQuarterlyRecordModal;
let AddCompanyModal: typeof import('../src/components/AddCompanyModal').AddCompanyModal;

describe('Batch 33 — WeightedAvgShares_Basis UI, Unrecognized Preservation & Audit Display', () => {
  let activeWindow: Window;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null = null;

  before(async () => {
    const reactDomClient = await import('react-dom/client');
    createRoot = reactDomClient.createRoot;
    const editMod = await import('../src/modules/data-hub/EditQuarterlyRecordModal');
    EditQuarterlyRecordModal = editMod.EditQuarterlyRecordModal;
    const addMod = await import('../src/components/AddCompanyModal');
    AddCompanyModal = addMod.AddCompanyModal;
  });

  beforeEach(() => {
    activeWindow = new Window({ url: 'http://localhost:3000/' });
    installDomGlobals(activeWindow);
    container = activeWindow.document.createElement('div') as unknown as HTMLDivElement;
    activeWindow.document.body.appendChild(container as any);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
    await activeWindow.happyDOM.close();
  });

  after(async () => {
    await bootWindow.happyDOM.close();
  });

  it('AddCompanyModal renders all 5 central options, share-count guidance, and capital-action note from central contract', async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(AddCompanyModal, {
          isOpen: true,
          onClose: () => {},
          onSaveStockAndQuarter: async () => {},
          sectorDefinitions: [{ key: 'industrial', nameAr: 'صناعي', pe: 12 }],
          sectorPeConfirmed: true,
          sectorPeStatus: 'loaded',
        })
      );
    });

    const text = container.textContent ?? '';
    assert.ok(text.includes(WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR));
    assert.ok(text.includes(WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR));

    const selects = Array.from(container.querySelectorAll('select'));
    const basisSelect = selects.find((sel) =>
      Array.from(sel.options).some((opt) => opt.value === 'ytd_weighted_avg')
    );
    assert.ok(basisSelect, 'WeightedAvgShares_Basis select must exist in AddCompanyModal');
    const optionValues = Array.from(basisSelect!.options).map((o) => o.value);
    for (const opt of WEIGHTED_AVG_SHARES_BASIS_OPTIONS) {
      assert.ok(
        optionValues.includes(opt.code),
        `AddCompanyModal missing central option ${opt.code}`
      );
    }
    // Verify the select defaults to empty (BLANK), not silently forcing an assumption
    assert.equal(basisSelect!.value, '');
  });

  it('EditQuarterlyRecordModal preserves unrecognized stored WeightedAvgShares_Basis visibly without snapping to first option and blocks submission until resolved', async () => {
    const weirdRecord = makeBaseRecord({
      weightedAvgSharesBasis: 'legacy_weird_basis' as any,
    });
    let saveCalls = 0;

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(EditQuarterlyRecordModal, {
          isOpen: true,
          onClose: () => {},
          record: weirdRecord,
          onSave: async () => {
            saveCalls += 1;
          },
        })
      );
    });

    const basisSelect = Array.from(container.querySelectorAll('select')).find((sel) =>
      Array.from(sel.options).some((opt) => opt.value === 'ytd_weighted_avg')
    );
    assert.ok(basisSelect, 'WeightedAvgShares_Basis select must exist in EditQuarterlyRecordModal');

    // Must preserve unrecognized stored value instead of defaulting to ytd_weighted_avg
    assert.equal(basisSelect!.value, 'legacy_weird_basis');
    const text = container.textContent ?? '';
    assert.ok(text.includes(WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR));
    assert.ok(text.includes(WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR));
    assert.ok(text.includes('legacy_weird_basis'));

    // Submitting without resolving unrecognized basis must be blocked with clear Arabic error
    const form = container.querySelector('form')!;
    assert.ok(form);
    await act(async () => {
      form.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(saveCalls, 0);
    assert.match(container.textContent ?? '', /WeightedAvgShares_Basis/);
  });

  it('EditQuarterlyRecordModal saves documented Q1 standalone_quarter without mutating it to ytd_weighted_avg', async () => {
    const q1Record = makeBaseRecord({
      weightedAvgSharesBasis: 'standalone_quarter',
    });
    let savedRecord: QuarterlyFinancialRecord | null = null;

    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(EditQuarterlyRecordModal, {
          isOpen: true,
          onClose: () => {},
          record: q1Record,
          onSave: async (updated) => {
            savedRecord = updated;
          },
        })
      );
    });

    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
    });

    assert.ok(savedRecord);
    assert.equal((savedRecord as QuarterlyFinancialRecord).weightedAvgSharesBasis, 'standalone_quarter');
  });

  it('MetricAuditCard and ValuationSourcesCard display original vs effective basis on Q1 equivalence and show remediation when blocked', () => {
    const testCompany: Company = {
      id: 'test',
      ticker: 'TEST',
      name: 'Test Industrial Co.',
      nameAr: 'شركة اختبار',
      sector: 'industrial',
      marketPrice: 15,
      tradingCurrency: 'EGP',
      financialCurrency: 'EGP',
      sharesOutstanding: 100,
    };

    const q1Equiv: QuarterlyFinancial = {
      id: 'TEST_2026_Q1',
      companyId: 'test',
      year: 2026,
      quarter: 'Q1',
      periodDate: '2026-03-31',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-03-31',
      revenueYTD: 100,
      grossProfitYTD: 60,
      operatingProfitYTD: 45,
      netProfitYTD: 30,
      netIncomeCommonYTD: 30,
      netIncomeCommonBasis: 'explicit_common',
      operatingCashFlowYTD: 35,
      capexYTD: 5,
      dividendsPaidYTD: 0,
      totalAssets: 500,
      totalDebt: 50,
      cashAndEquivalents: 60,
      totalEquity: 300,
      commonEquity: 300,
      commonEquityBasis: 'explicit_common',
      sharesCount: 100,
      weightedAvgSharesYTD: 100,
      weightedAvgSharesBasis: 'standalone_quarter',
      isCapitalActionAdjusted: true,
      financialCurrency: 'EGP',
      financialUnit: 'base',
      isAudited: true,
    };

    const daily: DailyTradingRecord = {
      ticker: 'TEST',
      tradeDate: '2026-04-15',
      closePrice: 15,
      volume: 100000,
      valueTraded: 1500000,
      listedShares: 100,
      marketCap: 1500,
      currency: 'EGP',
    };

    const metrics = calculateTTMMetrics(testCompany, [q1Equiv], daily);
    const val = runValuationModels(
      testCompany,
      metrics,
      {
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
      },
      {},
      {
        sectorPE: 12,
        dailyRecords: [daily],
        quarterlyRecords: [],
        betaRecord: { ticker: 'TEST', beta: 1.0, asOfDate: '2026-04-01', source: 'EGX' },
        betaConfirmed: true,
      }
    );

    const equivBundle = metrics.metricAudit!;
    const auditHtml = renderToStaticMarkup(
      React.createElement(MetricAuditCard, {
        metricAudit: equivBundle,
        finCurrencyLabel: 'ج.م',
        defaultExpanded: true,
      })
    );
    assert.match(auditHtml, /تكافؤ Q1 موثق/);
    assert.match(auditHtml, /standalone_quarter/);
    assert.match(auditHtml, /q1_standalone_equivalent_to_ytd/);

    const sourcesHtml = renderToStaticMarkup(
      React.createElement(ValuationSourcesCard, {
        summary: val.sourcesSummary,
      })
    );
    assert.match(sourcesHtml, /standalone_quarter/);
    assert.match(sourcesHtml, /تكافؤ Q1 موثق/);

    // Blocked Q1 missing dates -> shows actionable missing-field card with remediationAr
    const blockedBundle = resolveMetricAuditBundle({
      company: testCompany,
      financials: [
        {
          ...q1Equiv,
          periodStartDate: null,
          periodEndDate: null,
          periodDays: 90,
        },
      ],
      netIncomeTTM: null,
      finCurrencyAllowed: true,
      currencySuffix: ' ج.م',
    });
    const blockedHtml = renderToStaticMarkup(
      React.createElement(MetricAuditCard, {
        metricAudit: blockedBundle,
        finCurrencyLabel: 'ج.م',
        defaultExpanded: true,
        ticker: 'TEST',
        onRequestEditTarget: () => {},
      })
    );
    assert.match(blockedHtml, /استكمال الحقول المحاسبية والفترية الناقصة/);
    assert.match(blockedHtml, /PeriodStartDate/);
    assert.match(blockedHtml, /خطوة الاستكمال:/);
    assert.match(blockedHtml, /edit-missing-2026-Q1-periodStartDate/);
    assert.match(blockedHtml, /تعديل الحقل في السجل/);
  });

  it('QuarterlyRecordsTable renders preserved basis code and highlights unrecognized stored values without mutating them', () => {
    const tableHtml = renderToStaticMarkup(
      React.createElement(QuarterlyRecordsTable, {
        selectedTicker: 'TEST',
        records: [
          makeBaseRecord({ year: 2026, quarter: 'Q1', weightedAvgSharesBasis: 'standalone_quarter' }),
          makeBaseRecord({ year: 2025, quarter: 'FY', weightedAvgSharesBasis: 'legacy_weird_basis' as any }),
        ],
        userRole: 'admin',
        onRequestEdit: () => {},
        onRequestDelete: () => {},
      })
    );
    assert.match(tableHtml, /standalone_quarter/);
    assert.match(tableHtml, /ربع منفرد فقط/);
    assert.match(tableHtml, /legacy_weird_basis/);
    assert.match(tableHtml, /غير معروف/);
  });
});
