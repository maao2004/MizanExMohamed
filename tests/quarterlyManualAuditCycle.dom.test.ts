/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive DOM & end-to-end server-contract acceptance suite for the quarterly manual-audit cycle:
 * - Editing a quarterly record field in `EditQuarterlyRecordModal` and reverting it back to its original value
 * - Explicit `{ [field]: null }` deletion contract in `QuarterlyFinancialRecordWritePayload` without
 *   weakening `QuarterlyFinancialRecord` or storing deletion markers in client read state
 * - Reverting one active correction while preserving sibling active corrections and `originalValues`
 * - Strict separation between numeric `0`, explicit `null` (BLANK), and omitted (`undefined`)
 * - Full persistence through `sanitizeForFirestore` + `applyStockAndQuarterAtomicWrite` + re-read
 *   (`sanitizeQuarterlyReadRecord`) and verification in `QuarterlyRecordsTable`, `RecordDetailsModal`,
 *   and Excel export (`buildQuarterlyRecordsWorkbook`).
 */

import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import * as XLSX from 'xlsx';

import type {
  QuarterlyFinancialRecord,
  QuarterlyFinancialRecordWritePayload,
} from '../src/types';
import {
  applyStockAndQuarterAtomicWrite,
  type AtomicWriteTarget,
} from '../src/core/contracts';
import {
  sanitizeQuarterlyReadRecord,
} from '../src/core/domain/quarterlyManualAudit';
import { sanitizeForFirestore } from '../src/services/firebase/firestoreWriters';
import { buildQuarterlyRecordsWorkbook } from '../src/utils/excelExport';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function attachWindowGlobals(win: Window): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  g.HTMLElement = win.HTMLElement;
  g.HTMLInputElement = win.HTMLInputElement;
  g.HTMLSelectElement = win.HTMLSelectElement;
  g.HTMLButtonElement = win.HTMLButtonElement;
  g.Node = win.Node;
  g.Event = win.Event;
  g.MouseEvent = win.MouseEvent;
  g.InputEvent = win.InputEvent;
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
    writable: true,
  });
}

function setControlledInputValue(el: HTMLInputElement, value: string): void {
  const proto = (globalThis as unknown as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new (globalThis as any).Event('input', { bubbles: true }));
  el.dispatchEvent(new (globalThis as any).Event('change', { bubbles: true }));
}

function deepClone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

/**
 * Firestore-faithful in-memory store executing the exact production
 * `applyStockAndQuarterAtomicWrite` + `sanitizeForFirestore` save path.
 */
class InMemoryQuarterlyFirestore {
  private readonly docs = new Map<string, Record<string, any>>();

  seed(record: QuarterlyFinancialRecord): Promise<void> {
    return this.saveWritePayload(record, '2026-10-01T09:00:00.000Z');
  }

  async saveWritePayload(
    payload: QuarterlyFinancialRecord | QuarterlyFinancialRecordWritePayload,
    updatedAt: string
  ): Promise<void> {
    const wirePayload = sanitizeForFirestore({ value: payload }).value as Record<string, any>;
    const txTarget: AtomicWriteTarget = {
      getDoc: async (col, docId) => {
        const stored = this.docs.get(`${col}/${docId}`);
        return stored ? deepClone(stored) : undefined;
      },
      setDoc: (col, docId, data, merge) => {
        const key = `${col}/${docId}`;
        if (!merge) {
          this.docs.set(key, deepClone(data));
        } else {
          const prev = this.docs.get(key) ?? {};
          this.docs.set(key, deepClone({ ...prev, ...data }));
        }
      },
    };
    await applyStockAndQuarterAtomicWrite(txTarget, {
      record: wirePayload,
      stamp: {
        importId: `imp_${updatedAt}`,
        sourceFile: 'manual_edit',
        sourceSheet: 'quarterly_record',
        schemaVersion: 2,
        updatedAt,
        updatedBy: 'admin_dom_test',
        isDeleted: false,
      },
    });
  }

  getRawSource(docId: string): Record<string, any> | undefined {
    const raw = this.docs.get(`quarterly_financial_records/${docId}`);
    return raw ? deepClone(raw) : undefined;
  }

  getRawFinancial(docId: string): Record<string, any> | undefined {
    const raw = this.docs.get(`financials/${docId}`);
    return raw ? deepClone(raw) : undefined;
  }

  readQuarterlyRecord(docId: string): QuarterlyFinancialRecord {
    const raw = this.getRawSource(docId);
    assert.ok(raw, `Expected stored quarterly record ${docId}`);
    return sanitizeQuarterlyReadRecord(raw as QuarterlyFinancialRecord);
  }
}

function makeSeedRecord(overrides: Partial<QuarterlyFinancialRecord> = {}): QuarterlyFinancialRecord {
  return {
    ticker: 'COMI',
    stockName: 'البنك التجاري الدولي',
    yearQuarter: '2026Q3',
    year: 2026,
    quarter: 'Q3',
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-09-30',
    periodDays: 273,
    shares: 100_000_000,
    intangibleAssets: null,
    totalAssets: 5_000_000_000,
    equity: 2_000_000_000,
    totalDebtWithoutTX: 500_000_000,
    totalLiabilities: 3_000_000_000,
    revenueYTD: 100,
    grossProfitYTD: 60,
    ebitYTD: 40,
    pbtYTD: 30,
    netIncomeYTD: 10,
    ocfYTD: 15,
    netInvestingCfYTD: -5,
    dividendsPaidYTD: 0,
    cash: 0,
    interestExpenseYTD: 2,
    financeCostsYTD: 2,
    interestIncomeYTD: 1,
    taxExpenseYTD: 5,
    interestPaidYTD: 2,
    capexYTD: 3,
    dateInsertData: '2026-10-01',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('Quarterly Manual Audit Cycle — DOM, Server Contract, Re-read, Table Badges & Excel Export', () => {
  const bootWindow = new Window({ url: 'http://localhost:3000/' });
  attachWindowGlobals(bootWindow);

  let React: typeof import('react');
  let act: typeof import('react').act;
  let createRoot: typeof import('react-dom/client').createRoot;
  let EditQuarterlyRecordModal: typeof import('../src/modules/data-hub/EditQuarterlyRecordModal').EditQuarterlyRecordModal;
  let QuarterlyRecordsTable: typeof import('../src/modules/data-hub/QuarterlyRecordsTable').QuarterlyRecordsTable;
  let RecordDetailsModal: typeof import('../src/modules/data-hub/RecordDetailsModal').RecordDetailsModal;

  let currentWindow: Window;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null = null;

  before(async () => {
    React = await import('react');
    act = React.act;
    ({ createRoot } = await import('react-dom/client'));
    ({ EditQuarterlyRecordModal } = await import('../src/modules/data-hub/EditQuarterlyRecordModal'));
    ({ QuarterlyRecordsTable } = await import('../src/modules/data-hub/QuarterlyRecordsTable'));
    ({ RecordDetailsModal } = await import('../src/modules/data-hub/RecordDetailsModal'));
  });

  beforeEach(() => {
    currentWindow = new Window({ url: 'http://localhost:3000/' });
    attachWindowGlobals(currentWindow);
    container = currentWindow.document.createElement('div');
    currentWindow.document.body.appendChild(container);
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

  async function submitModalEdit(
    record: QuarterlyFinancialRecord,
    edits: Array<{ field: string; inputValue: string }>
  ): Promise<{
    readRecord: QuarterlyFinancialRecord;
    writePayload: QuarterlyFinancialRecordWritePayload;
  }> {
    let capturedRead: QuarterlyFinancialRecord | null = null;
    let capturedWrite: QuarterlyFinancialRecordWritePayload | null = null;

    await act(async () => {
      root!.render(
        React.createElement(EditQuarterlyRecordModal, {
          isOpen: true,
          onClose: () => {},
          record,
          onSave: async (readRec, writePayload) => {
            capturedRead = readRec;
            capturedWrite = (writePayload ?? readRec) as QuarterlyFinancialRecordWritePayload;
          },
        })
      );
    });

    for (const edit of edits) {
      const input = container.querySelector<HTMLInputElement>(`[data-field="${edit.field}"]`);
      assert.ok(input, `Expected input [data-field="${edit.field}"]`);
      await act(async () => {
        setControlledInputValue(input, edit.inputValue);
      });
    }

    const form = container.querySelector('form');
    assert.ok(form, 'Expected form in EditQuarterlyRecordModal');
    await act(async () => {
      form.dispatchEvent(new (globalThis as any).Event('submit', { bubbles: true, cancelable: true }));
    });

    assert.ok(capturedRead, 'onSave must emit clean readRecord');
    assert.ok(capturedWrite, 'onSave must emit explicit writePayload');
    return { readRecord: capturedRead, writePayload: capturedWrite };
  }

  it('1) DOM full cycle: editing revenueYTD 100 -> 200 then reverting 200 -> 100 clears active correction on server, re-read, table badges, details modal, and Excel export', async () => {
    const store = new InMemoryQuarterlyFirestore();
    await store.seed(makeSeedRecord());

    // Step 1: Edit revenueYTD 100 -> 200 through the DOM modal
    const initial = store.readQuarterlyRecord('COMI_2026_Q3');
    const step1 = await submitModalEdit(initial, [{ field: 'revenueYTD', inputValue: '200' }]);

    assert.equal(step1.readRecord.revenueYTD, 200);
    assert.deepEqual(step1.readRecord.originalValues, { revenueYTD: 100 });
    assert.equal(step1.readRecord.manualCorrections?.revenueYTD?.originalValue, 100);
    assert.equal(step1.readRecord.manualCorrections?.revenueYTD?.correctedValue, 200);

    await store.saveWritePayload(step1.writePayload, '2026-10-02T10:00:00.000Z');
    const afterEdit = store.readQuarterlyRecord('COMI_2026_Q3');
    assert.equal(afterEdit.revenueYTD, 200);
    assert.equal(afterEdit.manualCorrections?.revenueYTD?.correctedValue, 200);

    // Verify table shows badge «معدّل (1)» and Excel export includes correctedValue = 200
    await act(async () => {
      root!.render(
        React.createElement(QuarterlyRecordsTable, {
          selectedTicker: 'COMI',
          records: [afterEdit],
          userRole: 'admin',
          onRequestEdit: () => {},
          onRequestDelete: () => {},
        })
      );
    });
    assert.ok(container.textContent?.includes('معدّل (1)'), 'Table must display active correction count (1)');

    const wbEdited = await buildQuarterlyRecordsWorkbook([afterEdit]);
    assert.ok(wbEdited.SheetNames.includes('Manual_Corrections'));
    const editedCorrectionsRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wbEdited.Sheets['Manual_Corrections']
    );
    assert.equal(editedCorrectionsRows.length, 1);
    assert.equal(editedCorrectionsRows[0]['Field'], 'revenueYTD');
    assert.equal(editedCorrectionsRows[0]['OriginalValue'], 100);
    assert.equal(editedCorrectionsRows[0]['CorrectedValue'], 200);

    // Step 2: Reopen modal on edited record and revert revenueYTD 200 -> 100
    const step2 = await submitModalEdit(afterEdit, [{ field: 'revenueYTD', inputValue: '100' }]);

    // Write payload uses explicit null deletion marker; readRecord NEVER stores deletion markers!
    assert.equal(step2.writePayload.revenueYTD, 100);
    assert.deepEqual(step2.writePayload.manualCorrections, { revenueYTD: null });
    assert.deepEqual(step2.writePayload.originalValues, { revenueYTD: 100 });
    assert.equal(step2.readRecord.manualCorrections, undefined);
    assert.equal('manualCorrections' in step2.readRecord, false);
    assert.deepEqual(step2.readRecord.originalValues, { revenueYTD: 100 });

    // Persist on server and re-read from Firestore
    await store.saveWritePayload(step2.writePayload, '2026-10-03T10:00:00.000Z');
    const rawStored = store.getRawSource('COMI_2026_Q3')!;
    const rawProj = store.getRawFinancial('comi_2026_q3')!;
    assert.equal(rawStored.revenueYTD, 100);
    assert.equal(rawProj.revenueYTD, 100);
    assert.equal(rawStored.manualCorrections, null);
    assert.deepEqual(rawStored.originalValues, { revenueYTD: 100 });

    const afterRevert = store.readQuarterlyRecord('COMI_2026_Q3');
    assert.equal(afterRevert.revenueYTD, 100);
    assert.equal(afterRevert.manualCorrections, undefined);
    assert.deepEqual(afterRevert.originalValues, { revenueYTD: 100 });

    // Table MUST NOT show any «معدّل» badge or counter after revert & re-read
    await act(async () => {
      root!.render(
        React.createElement(QuarterlyRecordsTable, {
          selectedTicker: 'COMI',
          records: [afterRevert],
          userRole: 'admin',
          onRequestEdit: () => {},
          onRequestDelete: () => {},
        })
      );
    });
    assert.equal(container.textContent?.includes('معدّل ('), false);
    assert.equal(
      Array.from(container.querySelectorAll('span')).some((s) => s.textContent?.trim() === 'معدّل'),
      false,
      'No cell should display the active «معدّل» badge after revert'
    );

    // RecordDetailsModal hides active manual corrections banner while preserving originalValues
    await act(async () => {
      root!.render(
        React.createElement(RecordDetailsModal, {
          isOpen: true,
          onClose: () => {},
          title: 'تفاصيل COMI',
          record: afterRevert,
        })
      );
    });
    assert.equal(container.textContent?.includes('سجل التعديلات اليدوية الموثقة'), false);
    assert.equal(container.textContent?.includes('معدّل يدوياً'), false);
    assert.ok(container.textContent?.includes('القيم الأصلية المرجعية (originalValues — 1)'));

    // Excel export MUST NOT include old correctedValue = 200 or Manual_Corrections sheet
    const wbReverted = await buildQuarterlyRecordsWorkbook([afterRevert]);
    assert.equal(wbReverted.SheetNames.includes('Manual_Corrections'), false);
    const metaRows = XLSX.utils.sheet_to_json<Array<string | number>>(
      wbReverted.Sheets['Export_Metadata'],
      { header: 1 }
    );
    const countRow = metaRows.find((r) => r[0] === 'إجمالي التعديلات اليدوية الموثقة');
    assert.ok(countRow);
    assert.equal(countRow[1], 0);
  });

  it('2) Reverting one active correction preserves sibling active correction & originalValues across save, re-read, badges, and export', async () => {
    const store = new InMemoryQuarterlyFirestore();
    await store.seed(makeSeedRecord({ revenueYTD: 100, netIncomeYTD: 10 }));

    // Edit BOTH revenueYTD (100 -> 200) and netIncomeYTD (10 -> 25)
    const initial = store.readQuarterlyRecord('COMI_2026_Q3');
    const step1 = await submitModalEdit(initial, [
      { field: 'revenueYTD', inputValue: '200' },
      { field: 'netIncomeYTD', inputValue: '25' },
    ]);
    await store.saveWritePayload(step1.writePayload, '2026-10-02T10:00:00.000Z');

    const withTwo = store.readQuarterlyRecord('COMI_2026_Q3');
    assert.equal(Object.keys(withTwo.manualCorrections ?? {}).length, 2);

    // Revert ONLY revenueYTD (200 -> 100), leaving netIncomeYTD = 25 untouched
    const step2 = await submitModalEdit(withTwo, [{ field: 'revenueYTD', inputValue: '100' }]);

    // Write payload targets ONLY revenueYTD for deletion (does NOT overwrite sibling netIncomeYTD)
    assert.deepEqual(step2.writePayload.manualCorrections, { revenueYTD: null });
    assert.deepEqual(Object.keys(step2.readRecord.manualCorrections ?? {}), ['netIncomeYTD']);
    assert.equal(step2.readRecord.manualCorrections?.netIncomeYTD?.correctedValue, 25);
    assert.equal(step2.readRecord.manualCorrections?.netIncomeYTD?.originalValue, 10);
    assert.deepEqual(step2.readRecord.originalValues, { revenueYTD: 100, netIncomeYTD: 10 });

    await store.saveWritePayload(step2.writePayload, '2026-10-03T10:00:00.000Z');
    const afterPartialRevert = store.readQuarterlyRecord('COMI_2026_Q3');

    assert.equal(afterPartialRevert.revenueYTD, 100);
    assert.equal(afterPartialRevert.netIncomeYTD, 25);
    assert.deepEqual(Object.keys(afterPartialRevert.manualCorrections ?? {}), ['netIncomeYTD']);
    assert.equal(afterPartialRevert.manualCorrections?.netIncomeYTD?.correctedValue, 25);
    assert.equal('revenueYTD' in (afterPartialRevert.manualCorrections ?? {}), false);
    assert.deepEqual(afterPartialRevert.originalValues, { revenueYTD: 100, netIncomeYTD: 10 });

    // Table shows «معدّل (1)» (NOT 2)
    await act(async () => {
      root!.render(
        React.createElement(QuarterlyRecordsTable, {
          selectedTicker: 'COMI',
          records: [afterPartialRevert],
          userRole: 'admin',
          onRequestEdit: () => {},
          onRequestDelete: () => {},
        })
      );
    });
    assert.ok(container.textContent?.includes('معدّل (1)'));
    assert.equal(container.textContent?.includes('معدّل (2)'), false);

    // Excel export lists ONLY netIncomeYTD (25), NEVER old revenueYTD (200)
    const wb = await buildQuarterlyRecordsWorkbook([afterPartialRevert]);
    assert.ok(wb.SheetNames.includes('Manual_Corrections'));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Manual_Corrections']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['Field'], 'netIncomeYTD');
    assert.equal(rows[0]['OriginalValue'], 10);
    assert.equal(rows[0]['CorrectedValue'], 25);
  });

  it('3) Strictly separates 0, null (BLANK), and omitted when reverting back to 0 or back to original null', async () => {
    const store = new InMemoryQuarterlyFirestore();
    await store.seed(
      makeSeedRecord({
        cash: 0,
        intangibleAssets: null,
      })
    );

    // Step 1: Edit cash (0 -> 500) and intangibleAssets (null -> 250)
    const v1 = store.readQuarterlyRecord('COMI_2026_Q3');
    const edit1 = await submitModalEdit(v1, [
      { field: 'cash', inputValue: '500' },
      { field: 'intangibleAssets', inputValue: '250' },
    ]);
    await store.saveWritePayload(edit1.writePayload, '2026-10-02T10:00:00.000Z');

    const v2 = store.readQuarterlyRecord('COMI_2026_Q3');
    assert.deepEqual(v2.originalValues, { cash: 0, intangibleAssets: null });
    assert.equal(v2.manualCorrections?.cash?.originalValue, 0);
    assert.equal(v2.manualCorrections?.cash?.correctedValue, 500);
    assert.equal(v2.manualCorrections?.intangibleAssets?.originalValue, null);
    assert.equal(v2.manualCorrections?.intangibleAssets?.correctedValue, 250);

    // Step 2: Change cash to BLANK ("") and intangibleAssets to "0" — NEITHER equals its original!
    const editSwap = await submitModalEdit(v2, [
      { field: 'cash', inputValue: '' },
      { field: 'intangibleAssets', inputValue: '0' },
    ]);
    await store.saveWritePayload(editSwap.writePayload, '2026-10-03T10:00:00.000Z');

    const v3 = store.readQuarterlyRecord('COMI_2026_Q3');
    assert.equal(v3.cash, null);
    assert.equal(v3.intangibleAssets, 0);
    // Both MUST remain active corrections because 0 !== null!
    assert.equal(v3.manualCorrections?.cash?.originalValue, 0);
    assert.equal(v3.manualCorrections?.cash?.correctedValue, null);
    assert.equal(v3.manualCorrections?.intangibleAssets?.originalValue, null);
    assert.equal(v3.manualCorrections?.intangibleAssets?.correctedValue, 0);

    // Step 3: Revert cash back to "0" AND intangibleAssets back to BLANK ("")
    const revertBoth = await submitModalEdit(v3, [
      { field: 'cash', inputValue: '0' },
      { field: 'intangibleAssets', inputValue: '' },
    ]);
    assert.deepEqual(revertBoth.writePayload.manualCorrections, {
      cash: null,
      intangibleAssets: null,
    });
    assert.equal(revertBoth.readRecord.manualCorrections, undefined);
    assert.deepEqual(revertBoth.readRecord.originalValues, { cash: 0, intangibleAssets: null });

    await store.saveWritePayload(revertBoth.writePayload, '2026-10-04T10:00:00.000Z');

    const rawStored = store.getRawSource('COMI_2026_Q3')!;
    assert.equal(rawStored.cash, 0);
    assert.equal(rawStored.intangibleAssets, null);
    assert.equal(rawStored.manualCorrections, null);
    assert.deepEqual(rawStored.originalValues, { cash: 0, intangibleAssets: null });

    const v4 = store.readQuarterlyRecord('COMI_2026_Q3');
    assert.equal(v4.cash, 0);
    assert.equal(v4.intangibleAssets, null);
    assert.equal(v4.manualCorrections, undefined);
    assert.deepEqual(v4.originalValues, { cash: 0, intangibleAssets: null });

    const wb = await buildQuarterlyRecordsWorkbook([v4]);
    assert.equal(wb.SheetNames.includes('Manual_Corrections'), false);
    const qRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Quarterly_Financials']);
    assert.equal(qRows[0]['Cash'], 0);
    assert.equal(qRows[0]['IntangibleAssets'] ?? null, null);
    assert.deepEqual(
      JSON.parse(String(qRows[0]['originalValues (القيم الأصلية)'])),
      { cash: 0, intangibleAssets: null }
    );
  });

  it('4) Preserves server extendedFields when EditQuarterlyRecordModal saves a revert without editing extendedFields', async () => {
    const store = new InMemoryQuarterlyFirestore();
    await store.seed(
      makeSeedRecord({
        revenueYTD: 100,
        extendedFields: { customMetricA: 42, customMetricB: 99 },
      })
    );

    const v1 = store.readQuarterlyRecord('COMI_2026_Q3');
    const edit1 = await submitModalEdit(v1, [{ field: 'revenueYTD', inputValue: '200' }]);
    assert.equal('extendedFields' in edit1.writePayload, false);
    await store.saveWritePayload(edit1.writePayload, '2026-10-02T10:00:00.000Z');

    const v2 = store.readQuarterlyRecord('COMI_2026_Q3');
    assert.deepEqual(v2.extendedFields, { customMetricA: 42, customMetricB: 99 });

    const revert = await submitModalEdit(v2, [{ field: 'revenueYTD', inputValue: '100' }]);
    await store.saveWritePayload(revert.writePayload, '2026-10-03T10:00:00.000Z');

    const v3 = store.readQuarterlyRecord('COMI_2026_Q3');
    assert.equal(v3.revenueYTD, 100);
    assert.equal(v3.manualCorrections, undefined);
    assert.deepEqual(v3.extendedFields, { customMetricA: 42, customMetricB: 99 });
  });
});
