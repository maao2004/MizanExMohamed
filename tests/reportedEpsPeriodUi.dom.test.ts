/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive DOM tests (`happy-dom` + `react-dom/client` + `React.act`) for the
 * constrained ReportedEPS period UI in `EditQuarterlyRecordModal` and `AddCompanyModal`,
 * verifying:
 * 1. Arabic dropdown selection → canonical internal code saving → reload → Excel round-trip.
 * 2. Legacy ambiguous record opens explicitly as `needs_review` with legacy reference banner
 *    and NEVER selects an operational default.
 * 3. Invalid/missing dates on operational types are rejected with a clear Arabic error.
 * 4. AddCompanyModal saves structured July–June FY ReportedEPS period cleanly.
 */

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import * as XLSX from 'xlsx';

import { buildQuarterlyRecordsWorkbook } from '../src/utils/excelExport';
import { parseQuarterlyFinancialsExcelDetailed } from '../src/core/imports/parsers';
import type { QuarterlyFinancialRecord } from '../src/types';

function workbookToMockFile(wb: XLSX.WorkBook, name = 'QuarterlyFinancialsData.xlsx'): File {
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return {
    name,
    arrayBuffer: async () => arr,
  } as unknown as File;
}

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

function setControlledValue(
  el: HTMLInputElement | HTMLSelectElement,
  value: string
): void {
  const proto =
    el.tagName === 'SELECT'
      ? (globalThis as any).HTMLSelectElement.prototype
      : (globalThis as any).HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && typeof descriptor.set === 'function') {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
  el.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
}

function makeBaseRecord(
  overrides: Partial<QuarterlyFinancialRecord> = {}
): QuarterlyFinancialRecord {
  return {
    ticker: 'COMI',
    stockName: 'البنك التجاري الدولي',
    year: 2026,
    quarter: 'Q3',
    shares: 3_000_000_000,
    intangibleAssets: 0,
    totalAssets: 900_000_000_000,
    equity: 120_000_000_000,
    totalDebtWithoutTX: 10_000_000_000,
    totalLiabilities: 780_000_000_000,
    revenueYTD: 70_000_000_000,
    grossProfitYTD: 60_000_000_000,
    ebitYTD: 50_000_000_000,
    pbtYTD: 48_000_000_000,
    netIncomeYTD: 36_000_000_000,
    ocfYTD: 40_000_000_000,
    netInvestingCfYTD: -5_000_000_000,
    dividendsPaidYTD: -2_000_000_000,
    cash: 80_000_000_000,
    interestExpenseYTD: 0,
    financeCostsYTD: 0,
    interestIncomeYTD: 0,
    taxExpenseYTD: 12_000_000_000,
    interestPaidYTD: 0,
    capexYTD: 2_000_000_000,
    dateInsertData: '2026-10-30',
    currency: 'EGP',
    netIncomeCommonYTD: 36_000_000_000,
    netIncomeCommonBasis: 'explicit_common',
    equityCommon: 120_000_000_000,
    equityCommonBasis: 'explicit_common',
    weightedAvgSharesYTD: 3_000_000_000,
    weightedAvgSharesBasis: 'ytd_weighted_avg',
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-09-30',
    periodDays: 273,
    isPeriodStandard: true,
    reportedEps: 4.15,
    ...overrides,
  };
}

describe('ReportedEPS Constrained UI (Interactive DOM)', () => {
  let createRoot: typeof import('react-dom/client').createRoot;
  let EditQuarterlyRecordModal: typeof import('../src/modules/data-hub/EditQuarterlyRecordModal').EditQuarterlyRecordModal;
  let AddCompanyModal: typeof import('../src/components/AddCompanyModal').AddCompanyModal;

  let currentWindow: Window;
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
    currentWindow = new Window({ url: 'http://localhost:3000/' });
    installDomGlobals(currentWindow);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
    container.remove();
    currentWindow.close();
  });

  after(() => {
    bootWindow.close();
  });

  it('selects Arabic dropdown option → saves canonical internal code → reloads cleanly → round-trips through Excel', async () => {
    let savedRecord: QuarterlyFinancialRecord | null = null;
    const initialRecord = makeBaseRecord();

    await act(async () => {
      root!.render(
        React.createElement(EditQuarterlyRecordModal, {
          isOpen: true,
          onClose: () => {},
          record: initialRecord,
          onSave: async (rec) => {
            savedRecord = rec;
          },
        })
      );
    });

    const typeSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="reported-eps-period-type-select"]'
    );
    assert.ok(typeSelect, 'ReportedEPS period type dropdown must render');

    // Verify exact Arabic option text is present
    const optionLabels = Array.from(typeSelect.options).map((o) => o.textContent?.trim());
    assert.ok(optionLabels.includes('ربع مالي منفرد'));
    assert.ok(optionLabels.includes('تراكمي منذ بداية السنة المالية YTD'));
    assert.ok(optionLabels.includes('سنة مالية كاملة FY'));
    assert.ok(optionLabels.includes('آخر 12 شهراً TTM'));
    assert.ok(optionLabels.includes('غير محدد / يحتاج مراجعة'));

    // Select «ربع مالي منفرد» by finding its option value
    const standaloneOpt = Array.from(typeSelect.options).find(
      (o) => o.textContent?.trim() === 'ربع مالي منفرد'
    );
    assert.ok(standaloneOpt);
    await act(async () => {
      setControlledValue(typeSelect, standaloneOpt.value);
    });

    const quarterSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="reported-eps-fiscal-quarter-select"]'
    );
    const startInput = container.querySelector<HTMLInputElement>(
      '[data-testid="reported-eps-period-start-input"]'
    );
    const endInput = container.querySelector<HTMLInputElement>(
      '[data-testid="reported-eps-period-end-input"]'
    );
    assert.ok(quarterSelect && startInput && endInput);

    await act(async () => {
      setControlledValue(quarterSelect, 'Q3');
      setControlledValue(startInput, '2026-07-01');
      setControlledValue(endInput, '2026-09-30');
    });

    // Check read-only derived display reflects the structured selection
    const derivedEl = container.querySelector('[data-testid="reported-eps-period-derived"]');
    assert.ok(derivedEl?.textContent?.includes('Q3 2026'));
    assert.ok(derivedEl?.textContent?.includes('2026-07-01'));

    // Submit form
    const form = container.querySelector('form');
    assert.ok(form);
    await act(async () => {
      form.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
    });

    assert.ok(savedRecord, 'onSave must be called with normalized record');
    const saved = savedRecord as QuarterlyFinancialRecord;
    assert.equal(saved.reportedEpsPeriodType, 'standalone_quarter');
    assert.equal(saved.reportedEpsFiscalYear, 2026);
    assert.equal(saved.reportedEpsFiscalQuarter, 'Q3');
    assert.equal(saved.reportedEpsPeriodStart, '2026-07-01');
    assert.equal(saved.reportedEpsPeriodEnd, '2026-09-30');
    // Independent from the financial record's own YTD boundaries (2026-01-01..2026-09-30)
    assert.equal(saved.periodStartDate, '2026-01-01');
    assert.equal(saved.periodEndDate, '2026-09-30');

    // Reload modal with saved record -> dropdown and inputs restore canonical values
    await act(async () => {
      root!.render(
        React.createElement(EditQuarterlyRecordModal, {
          isOpen: true,
          onClose: () => {},
          record: saved,
          onSave: async () => {},
        })
      );
    });

    const reloadedType = container.querySelector<HTMLSelectElement>(
      '[data-testid="reported-eps-period-type-select"]'
    );
    const reloadedQuarter = container.querySelector<HTMLSelectElement>(
      '[data-testid="reported-eps-fiscal-quarter-select"]'
    );
    const reloadedStart = container.querySelector<HTMLInputElement>(
      '[data-testid="reported-eps-period-start-input"]'
    );
    const reloadedEnd = container.querySelector<HTMLInputElement>(
      '[data-testid="reported-eps-period-end-input"]'
    );
    assert.equal(reloadedType?.value, 'standalone_quarter');
    assert.equal(reloadedQuarter?.value, 'Q3');
    assert.equal(reloadedStart?.value, '2026-07-01');
    assert.equal(reloadedEnd?.value, '2026-09-30');

    // Round-trip through Excel export & re-import
    const wb = await buildQuarterlyRecordsWorkbook([saved]);
    const reimported = await parseQuarterlyFinancialsExcelDetailed(workbookToMockFile(wb));
    assert.equal(reimported.rejected.length, 0);
    assert.equal(reimported.records.length, 1);
    assert.equal(reimported.records[0].reportedEpsPeriodType, 'standalone_quarter');
    assert.equal(reimported.records[0].reportedEpsFiscalYear, 2026);
    assert.equal(reimported.records[0].reportedEpsFiscalQuarter, 'Q3');
    assert.equal(reimported.records[0].reportedEpsPeriodStart, '2026-07-01');
    assert.equal(reimported.records[0].reportedEpsPeriodEnd, '2026-09-30');
  });

  it('opens ambiguous legacy record as needs_review without picking an operational default and blocks invalid operational saves', async () => {
    let saveCalls = 0;
    const ambiguousLegacyRecord = makeBaseRecord({
      year: 2026,
      quarter: 'FY',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-12-31',
      periodDays: 365,
      reportedEps: 2.8,
      reportedEpsPeriod: 'Q4 2026 standalone',
      reportedEpsPeriodType: undefined,
      reportedEpsFiscalYear: undefined,
      reportedEpsFiscalQuarter: undefined,
      reportedEpsPeriodStart: undefined,
      reportedEpsPeriodEnd: undefined,
    });

    await act(async () => {
      root!.render(
        React.createElement(EditQuarterlyRecordModal, {
          isOpen: true,
          onClose: () => {},
          record: ambiguousLegacyRecord,
          onSave: async () => {
            saveCalls += 1;
          },
        })
      );
    });

    const typeSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="reported-eps-period-type-select"]'
    );
    assert.equal(
      typeSelect?.value,
      'needs_review',
      'Ambiguous legacy record MUST open as needs_review, never an operational default'
    );

    const legacyBanner = container.querySelector('[data-testid="reported-eps-legacy-review-banner"]');
    assert.ok(legacyBanner, 'Legacy review banner must be displayed');
    assert.ok(legacyBanner.textContent?.includes('Q4 2026 standalone'));

    // Switching to an operational type ("fy") WITHOUT filling dates must block save with an error!
    await act(async () => {
      setControlledValue(typeSelect!, 'fy');
    });

    const form = container.querySelector('form');
    assert.ok(form);
    await act(async () => {
      form.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
    });

    assert.equal(saveCalls, 0, 'Save must be blocked when operational ReportedEPS dates are missing');
    assert.ok(
      container.textContent?.includes('تاريخ بداية') || container.textContent?.includes('تاريخ'),
      'Validation error message must explain missing period dates'
    );
  });

  it('AddCompanyModal saves constrained July–June FY ReportedEPS period with canonical code', async () => {
    let savedPayload: { quarterlyRecord: QuarterlyFinancialRecord } | null = null;

    await act(async () => {
      root!.render(
        React.createElement(AddCompanyModal, {
          isOpen: true,
          onClose: () => {},
          sectorDefinitions: [
            {
              sectorId: 'banks',
              nameAr: 'البنوك',
              canonicalKey: 'البنوك',
              multiple: 7.5,
              status: 'active',
              aliases: ['البنوك'],
            },
          ],
          sectorPeConfirmed: true,
          sectorPeStatus: 'loaded',
          onSaveStockAndQuarter: async (payload) => {
            savedPayload = payload;
          },
        })
      );
    });

    // Fill minimum required fields in AddCompanyModal
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'));
    const tickerInput = inputs.find((el) => el.placeholder?.includes('COMI'));
    const nameInput = inputs.find((el) => el.placeholder?.includes('الرمز'));
    const sharesInput = inputs.find((el) => el.placeholder?.includes('3070850000'));
    assert.ok(tickerInput && nameInput && sharesInput);

    await act(async () => {
      setControlledValue(tickerInput, 'EGXJ');
      setControlledValue(nameInput, 'شركة يوليو يونيو');
      setControlledValue(sharesInput, '100000000');
    });

    // Set ReportedEPS numeric value
    const epsInput = container.querySelector<HTMLInputElement>(
      '[data-testid="add-company-reported-eps-input"]'
    );
    const typeSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="reported-eps-period-type-select"]'
    );
    assert.ok(epsInput && typeSelect);

    await act(async () => {
      setControlledValue(epsInput, '3.75');
      setControlledValue(typeSelect, 'fy');
    });

    const fyInput = container.querySelector<HTMLInputElement>(
      '[data-testid="reported-eps-fiscal-year-input"]'
    );
    const startInput = container.querySelector<HTMLInputElement>(
      '[data-testid="reported-eps-period-start-input"]'
    );
    const endInput = container.querySelector<HTMLInputElement>(
      '[data-testid="reported-eps-period-end-input"]'
    );
    assert.ok(fyInput && startInput && endInput);

    await act(async () => {
      setControlledValue(fyInput, '2026');
      setControlledValue(startInput, '2025-07-01');
      setControlledValue(endInput, '2026-06-30');
    });

    const form = container.querySelector('form');
    assert.ok(form);
    await act(async () => {
      form.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
    });

    assert.ok(savedPayload, 'AddCompanyModal must submit cleanly');
    const qRec = (savedPayload as { quarterlyRecord: QuarterlyFinancialRecord }).quarterlyRecord;
    assert.equal(qRec.reportedEps, 3.75);
    assert.equal(qRec.reportedEpsPeriodType, 'fy');
    assert.equal(qRec.reportedEpsFiscalYear, 2026);
    assert.equal(qRec.reportedEpsFiscalQuarter ?? null, null);
    assert.equal(qRec.reportedEpsPeriodStart, '2025-07-01');
    assert.equal(qRec.reportedEpsPeriodEnd, '2026-06-30');
  });

  it('shows conflict banner in EditQuarterlyRecordModal for FY 2026 (2025-07-01 → 2026-06-30) on calendar record without substituting record dates', async () => {
    const conflictingLegacyRecord = makeBaseRecord({
      year: 2026,
      quarter: 'FY',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-12-31',
      periodDays: 365,
      reportedEps: 4.0,
      reportedEpsPeriod: 'FY 2026 (2025-07-01 → 2026-06-30)',
      reportedEpsPeriodType: undefined,
      reportedEpsFiscalYear: undefined,
      reportedEpsFiscalQuarter: undefined,
      reportedEpsPeriodStart: undefined,
      reportedEpsPeriodEnd: undefined,
    });

    await act(async () => {
      root!.render(
        React.createElement(EditQuarterlyRecordModal, {
          isOpen: true,
          onClose: () => {},
          record: conflictingLegacyRecord,
          onSave: async () => {},
        })
      );
    });

    const typeSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="reported-eps-period-type-select"]'
    );
    assert.equal(
      typeSelect?.value,
      'needs_review',
      'Conflicting legacy date range must open as needs_review, never silently mapped to 2026-01-01..2026-12-31'
    );

    const legacyBanner = container.querySelector('[data-testid="reported-eps-legacy-review-banner"]');
    assert.ok(legacyBanner, 'Conflict banner must be displayed');
    assert.ok(legacyBanner.textContent?.includes('FY 2026 (2025-07-01 → 2026-06-30)'));
    assert.ok(
      legacyBanner.textContent?.includes('2025-07-01') ||
        legacyBanner.textContent?.includes('2026-06-30'),
      'Conflict banner must explain the conflicting embedded dates'
    );

    const epsInput = container.querySelector<HTMLInputElement>('input[data-field="reportedEps"]');
    assert.equal(epsInput?.value, '4', 'Original ReportedEPS numeric value must be preserved');
  });

  it('opens legacy zero/negative ReportedEPS with blank period as needs_review and blocks saving when period is cleared to empty in both modals', async () => {
    let editSaves = 0;
    const legacyZeroEpsRecord = makeBaseRecord({
      reportedEps: 0,
      reportedEpsPeriod: null,
      reportedEpsPeriodType: null,
      reportedEpsFiscalYear: null,
      reportedEpsFiscalQuarter: null,
      reportedEpsPeriodStart: null,
      reportedEpsPeriodEnd: null,
    });

    await act(async () => {
      root!.render(
        React.createElement(EditQuarterlyRecordModal, {
          isOpen: true,
          onClose: () => {},
          record: legacyZeroEpsRecord,
          onSave: async () => {
            editSaves += 1;
          },
        })
      );
    });

    const editTypeSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="reported-eps-period-type-select"]'
    );
    assert.equal(
      editTypeSelect?.value,
      'needs_review',
      'Legacy record with ReportedEPS=0 and blank period must open as needs_review'
    );
    const reviewBanner = container.querySelector('[data-testid="reported-eps-legacy-review-banner"]');
    assert.ok(reviewBanner, 'Review banner must explain undocumented ReportedEPS period');

    // Clearing the dropdown to empty ("") while ReportedEPS=0 must be rejected by the central contract
    await act(async () => {
      setControlledValue(editTypeSelect!, '');
    });
    const editForm = container.querySelector('form');
    assert.ok(editForm);
    await act(async () => {
      editForm.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(editSaves, 0, 'EditQuarterlyRecordModal must block saving ReportedEPS=0 with empty period');
    assert.ok(container.textContent?.includes('ReportedEPS'));

    // Now test AddCompanyModal with negative ReportedEPS (-1.5) and empty period -> blocked; then needs_review -> saved preserving -1.5
    let addSaved: { quarterlyRecord: QuarterlyFinancialRecord } | null = null;
    await act(async () => {
      root!.render(
        React.createElement(AddCompanyModal, {
          isOpen: true,
          onClose: () => {},
          sectorDefinitions: [
            {
              sectorId: 'banks',
              nameAr: 'البنوك',
              canonicalKey: 'البنوك',
              multiple: 7.5,
              status: 'active',
              aliases: ['البنوك'],
            },
          ],
          sectorPeConfirmed: true,
          sectorPeStatus: 'loaded',
          onSaveStockAndQuarter: async (payload) => {
            addSaved = payload;
          },
        })
      );
    });

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input'));
    const tickerInput = inputs.find((el) => el.placeholder?.includes('COMI'));
    const nameInput = inputs.find((el) => el.placeholder?.includes('الرمز'));
    const sharesInput = inputs.find((el) => el.placeholder?.includes('3070850000'));
    const epsInput = container.querySelector<HTMLInputElement>(
      '[data-testid="add-company-reported-eps-input"]'
    );
    const addTypeSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="reported-eps-period-type-select"]'
    );
    assert.ok(tickerInput && nameInput && sharesInput && epsInput && addTypeSelect);

    await act(async () => {
      setControlledValue(tickerInput, 'NEGX');
      setControlledValue(nameInput, 'شركة خسارة');
      setControlledValue(sharesInput, '100000000');
      setControlledValue(epsInput, '-1.5');
    });

    const addForm = container.querySelector('form');
    assert.ok(addForm);
    await act(async () => {
      addForm.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(addSaved, null, 'AddCompanyModal must block saving negative ReportedEPS with empty period');
    assert.ok(container.textContent?.includes('ReportedEPS'));

    // Switching explicitly to needs_review allows saving while preserving -1.5
    await act(async () => {
      setControlledValue(addTypeSelect, 'needs_review');
    });
    await act(async () => {
      addForm.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.ok(addSaved, 'AddCompanyModal must allow explicit needs_review for negative ReportedEPS');
    const savedRec = (addSaved as { quarterlyRecord: QuarterlyFinancialRecord }).quarterlyRecord;
    assert.equal(savedRec.reportedEps, -1.5);
    assert.equal(savedRec.reportedEpsPeriodType, 'needs_review');
  });
});

