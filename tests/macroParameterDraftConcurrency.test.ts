/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMacroParameterWritePayload,
  buildParameterUpdatePrecondition,
  buildParameterWritePayloadFromImport,
  computeRecordBusinessHash,
  executeAtomicParameterWrites,
  mergeMacroParametersByKey,
  normalizeMacroParameterFromFirestore,
  ParameterConcurrencyConflictError,
  planParameterPersistenceWrites,
  reconcileIncomingMacroParameterVersion,
  validateParameterRecords,
  verifyParameterPreconditions,
  type ParameterDocumentProvenance,
  type ParameterTransactionPort,
} from '../src/core/contracts';
import {
  completeSaveFailure,
  completeSaveSuccess,
  createMacroParamDraftControllerState,
  discardAllMacroParamDrafts,
  discardDeletedDraft,
  editMacroParamCustomType,
  editMacroParamDraftValue,
  getMacroParamDraftSummary,
  prepareCreateParamSubmission,
  prepareDirtySaveSubmission,
  reconcileServerMacroParams,
  resolveConflictAcceptServer,
  resolveConflictKeepDraftOnLatestBase,
} from '../src/core/domain/macroParameterDraftController';
import { FirestoreSessionManager } from '../src/core/domain/firestoreSessionManager';
import { storedValueToEditString } from '../src/core/domain/macroParameterInput';
import * as XLSX from 'xlsx';
import { buildImportPreview, parseAllParametersExcelFile } from '../src/core/imports';
import { buildAllParametersExportWorkbook } from '../src/utils/excelExport';
import { CacheService } from '../src/services/storage/cacheService';
import type { MacroParameter } from '../src/types';

function workbookToExcelFile(wb: XLSX.WorkBook, name = 'All_Parameters.xlsx'): File {
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return {
    name,
    arrayBuffer: async () => arr,
  } as unknown as File;
}

function makeProvenance(updatedBy = 'admin_1', updatedAt = '2026-05-12T10:00:00.000Z'): ParameterDocumentProvenance {
  return {
    importId: `test_${updatedAt}`,
    sourceFile: 'admin_ui',
    sourceSheet: 'bulk_parameters',
    schemaVersion: 1,
    updatedBy,
    updatedAt,
    serverUpdatedAt: updatedAt,
    isDeleted: false,
  };
}

/**
 * In-memory atomic transaction port mirroring Firestore transaction semantics
 * (all reads see consistent snapshot; aborted transaction writes nothing).
 */
function createInMemoryParameterTxPort(initialDocs: Record<string, Record<string, any>> = {}) {
  const store = new Map<string, Record<string, any>>();
  for (const [docPath, data] of Object.entries(initialDocs)) {
    store.set(docPath, { ...data });
  }

  const port: ParameterTransactionPort = {
    runTransaction: async (fn) => {
      const stagedWrites = new Map<string, { data: Record<string, any>; merge: boolean }>();
      let hasWritten = false;
      const result = await fn({
        getDocumentByPath: async (docPath) => {
          if (hasWritten) {
            throw new Error('Firestore invariant violation: reads must precede writes in a transaction.');
          }
          const existing = store.get(docPath);
          return existing ? { ...existing } : undefined;
        },
        setDocumentByPath: (docPath, data, merge) => {
          hasWritten = true;
          stagedWrites.set(docPath, { data: { ...data }, merge });
        },
      });
      // Commit atomically ONLY if transaction callback resolved without throwing
      for (const [docPath, write] of stagedWrites.entries()) {
        if (write.merge && store.has(docPath)) {
          store.set(docPath, { ...store.get(docPath)!, ...write.data });
        } else {
          store.set(docPath, { ...write.data });
        }
      }
      return result;
    },
  };

  return { store, port };
}

function makeServerMacroParam(overrides: Partial<MacroParameter> & { key: string; value: number }): MacroParameter {
  const base = normalizeMacroParameterFromFirestore(overrides.key, {
    nameAr: overrides.nameAr ?? overrides.key,
    descriptionAr: overrides.descriptionAr ?? '',
    value: overrides.value,
    valueType: overrides.valueType,
    isPercentage: overrides.isPercentage,
    unit: overrides.unit,
    asOfDate: overrides.asOfDate ?? '2026-05-01',
    source: overrides.source ?? 'لوحة الإدارة',
    revision: overrides.revision ?? 1,
    updatedAt: overrides.updatedAt ?? '2026-05-01T10:00:00.000Z',
    ...(overrides.rfMethodology ? { rfMethodology: overrides.rfMethodology } : {}),
  }) as MacroParameter;
  const contentHash =
    overrides.contentHash ??
    computeRecordBusinessHash('parameter', buildMacroParameterWritePayload(base));
  return { ...base, contentHash };
}

describe('Macro Parameters Draft Protection & Optimistic Concurrency', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => {
        mem.set(k, String(v));
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => mem.clear(),
      get length() {
        return mem.size;
      },
      key: (idx: number) => Array.from(mem.keys())[idx] ?? null,
    };
    CacheService.setScope({ uid: 'admin_test_user', projectId: 'demo-test', databaseId: '(default)' });
  });

  it('1) Protects local draft on param A when an unrelated server update arrives for param B', () => {
    const paramA = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const paramB = makeServerMacroParam({ key: 'RIM_Retention', value: 0.5, revision: 1 });

    let state = createMacroParamDraftControllerState([paramA, paramB], 'admin_1');
    // User edits TaxRate locally (22.5% -> 25%) without saving
    state = editMacroParamDraftValue(state, 'TaxRate', '25');
    assert.equal(state.entries.TaxRate.dirty, true);
    assert.equal(state.entries.TaxRate.draftValue, '25');
    assert.equal(state.entries.TaxRate.status, 'dirty');

    // Server sends an update for RIM_Retention (0.5 -> 0.6, rev 2), TaxRate unchanged on server
    const paramBUpdated = makeServerMacroParam({ key: 'RIM_Retention', value: 0.6, revision: 2 });
    state = reconcileServerMacroParams(state, [paramA, paramBUpdated], 'admin_1');

    // Clean param B updates immediately; dirty param A draft stays protected!
    assert.equal(state.entries.RIM_Retention.draftValue, '60');
    assert.equal(state.entries.RIM_Retention.serverRecord?.revision, 2);
    assert.equal(state.entries.RIM_Retention.status, 'clean');

    assert.equal(state.entries.TaxRate.draftValue, '25');
    assert.equal(state.entries.TaxRate.dirty, true);
    assert.equal(state.entries.TaxRate.status, 'dirty');
    assert.equal(state.entries.TaxRate.conflictServerRecord, null);
  });

  it('2) Detects explicit conflict when server updates the SAME param A being edited, preserving both versions and resolution paths', () => {
    const paramA = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    let state = createMacroParamDraftControllerState([paramA], 'admin_1');
    state = editMacroParamDraftValue(state, 'TaxRate', '25');

    // Another admin updates TaxRate on server to 0.24 (24%, rev 2)
    const paramAServerV2 = makeServerMacroParam({ key: 'TaxRate', value: 0.24, revision: 2 });
    state = reconcileServerMacroParams(state, [paramAServerV2], 'admin_1');

    assert.equal(state.entries.TaxRate.status, 'conflict');
    assert.equal(state.entries.TaxRate.draftValue, '25');
    assert.equal(state.entries.TaxRate.conflictServerRecord?.value, 0.24);
    assert.equal(state.entries.TaxRate.conflictServerRecord?.revision, 2);

    // Attempting to save while unresolved conflict exists MUST be blocked
    const blockedPrep = prepareDirtySaveSubmission(state);
    assert.equal(blockedPrep.ok, false);
    if (!blockedPrep.ok) {
      assert.equal(blockedPrep.reason, 'unresolved_conflict');
    }

    // Path A: Accept server version
    const acceptedState = resolveConflictAcceptServer(state, 'TaxRate');
    assert.equal(acceptedState.entries.TaxRate.status, 'clean');
    assert.equal(acceptedState.entries.TaxRate.dirty, false);
    assert.equal(acceptedState.entries.TaxRate.draftValue, '24');
    assert.equal(acceptedState.entries.TaxRate.serverRecord?.revision, 2);

    // Path B: Keep draft rebased on latest server version (rev 2) for explicit re-save
    const rebasedState = resolveConflictKeepDraftOnLatestBase(state, 'TaxRate');
    assert.equal(rebasedState.entries.TaxRate.status, 'dirty');
    assert.equal(rebasedState.entries.TaxRate.draftValue, '25');
    assert.equal(rebasedState.entries.TaxRate.baseRecord?.revision, 2);

    const prepAfterRebase = prepareDirtySaveSubmission(rebasedState);
    assert.equal(prepAfterRebase.ok, true);
    if (prepAfterRebase.ok) {
      assert.equal(prepAfterRebase.paramsToSave.length, 1);
      assert.equal(prepAfterRebase.preconditionsByKey.TaxRate.expectedRevision, 2);
    }
  });

  it('3) Marks param deleted_on_server when deleted during editing and blocks silent recreation on save', () => {
    const paramA = makeServerMacroParam({ key: 'Custom_Discount', value: 0.1, valueType: 'pct', isPercentage: true, revision: 2 });
    const paramB = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    let state = createMacroParamDraftControllerState([paramA, paramB], 'admin_1');

    state = editMacroParamDraftValue(state, 'Custom_Discount', '12');
    // Server deletes Custom_Discount
    state = reconcileServerMacroParams(state, [paramB], 'admin_1');

    assert.equal(state.entries.Custom_Discount.status, 'deleted_on_server');
    assert.equal(state.entries.Custom_Discount.serverRecord, null);
    assert.equal(state.entries.Custom_Discount.draftValue, '12');

    // Save is explicitly blocked so Custom_Discount is NEVER silently recreated
    const prep = prepareDirtySaveSubmission(state);
    assert.equal(prep.ok, false);
    if (!prep.ok) {
      assert.equal(prep.reason, 'deleted_on_server');
    }

    // Explicit discard removes the deleted draft cleanly
    const afterDiscard = discardDeletedDraft(state, 'Custom_Discount');
    assert.equal(afterDiscard.entries.Custom_Discount, undefined);
    assert.equal(getMacroParamDraftSummary(afterDiscard).hasUnsavedChanges, false);
  });

  it('4) Rejects saving with a stale base version atomically on the server without modifying the stored document', async () => {
    const initialDoc = {
      key: 'TaxRate',
      nameAr: 'معدل الضريبة',
      descriptionAr: 'ضريبة الشركات',
      value: 0.24,
      scope: 'global',
      ticker: null,
      unit: 'decimal',
      valueType: 'pct',
      isPercentage: true,
      asOfDate: '2026-05-01',
      source: 'لوحة الإدارة',
      revision: 2,
      contentHash: computeRecordBusinessHash('parameter', {
        key: 'TaxRate',
        value: 0.24,
        description: 'ضريبة الشركات',
        scope: 'global',
        ticker: null,
        unit: 'decimal',
        valueType: 'pct',
        isPercentage: true,
        asOfDate: '2026-05-01',
        source: 'لوحة الإدارة',
      }),
      isDeleted: false,
    };
    const { store, port } = createInMemoryParameterTxPort({ 'macro_params/TaxRate': initialDoc });

    // Stale writer still holds revision 1
    const stalePayload = buildMacroParameterWritePayload(
      { key: 'TaxRate', value: 0.25, asOfDate: '2026-05-02', source: 'لوحة الإدارة' },
      { mode: 'update', expectedRevision: 1, expectedContentHash: 'mzh1_oldhash' }
    );

    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: [stalePayload],
          provenance: makeProvenance('admin_stale'),
        }),
      (err: unknown) => {
        assert.ok(err instanceof ParameterConcurrencyConflictError);
        assert.equal(err.conflicts.length, 1);
        assert.equal(err.conflicts[0].reason, 'REVISION_MISMATCH');
        assert.equal(err.conflicts[0].expectedRevision, 1);
        assert.equal(err.conflicts[0].serverRevision, 2);
        assert.equal(err.conflicts[0].serverValue, 0.24);
        return true;
      }
    );

    // Stored document MUST remain untouched at revision 2 / value 0.24
    assert.equal(store.get('macro_params/TaxRate')?.revision, 2);
    assert.equal(store.get('macro_params/TaxRate')?.value, 0.24);

    // Even if stale payload sends the SAME value as server (0.24) with stale revision, it MUST NOT silently skip!
    const sameValueStalePayload = buildMacroParameterWritePayload(
      { key: 'TaxRate', value: 0.24, descriptionAr: 'ضريبة الشركات', asOfDate: '2026-05-01', source: 'لوحة الإدارة' },
      { mode: 'update', expectedRevision: 1 }
    );
    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: [sameValueStalePayload],
          provenance: makeProvenance('admin_stale_same_val'),
        }),
      ParameterConcurrencyConflictError
    );
  });

  it('5) Rejects concurrent creation of the same key (mode: create) without overwriting the first created document', async () => {
    const { store, port } = createInMemoryParameterTxPort();

    const firstCreate = buildMacroParameterWritePayload(
      {
        key: 'Custom_Spread',
        nameAr: 'هامش إضافي',
        value: 0.03,
        valueType: 'pct',
        isPercentage: true,
        unit: 'decimal',
        asOfDate: '2026-05-10',
        source: 'لوحة الإدارة',
      },
      { mode: 'create' }
    );
    const secondCreate = buildMacroParameterWritePayload(
      {
        key: 'Custom_Spread',
        nameAr: 'هامش إضافي',
        value: 0.05,
        valueType: 'pct',
        isPercentage: true,
        unit: 'decimal',
        asOfDate: '2026-05-10',
        source: 'لوحة الإدارة',
      },
      { mode: 'create' }
    );

    const res1 = await executeAtomicParameterWrites(port, {
      rawInputs: [firstCreate],
      provenance: makeProvenance('admin_first'),
    });
    assert.equal(res1.insertedCount, 1);
    assert.equal(res1.savedParameters[0].revision, 1);

    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: [secondCreate],
          provenance: makeProvenance('admin_second'),
        }),
      (err: unknown) => {
        assert.ok(err instanceof ParameterConcurrencyConflictError);
        assert.equal(err.conflicts[0].reason, 'ALREADY_EXISTS');
        assert.equal(err.conflicts[0].serverRevision, 1);
        assert.equal(err.conflicts[0].serverValue, 0.03);
        return true;
      }
    );

    // First created value (0.03, rev 1) remains intact
    assert.equal(store.get('macro_params/Custom_Spread')?.value, 0.03);
    assert.equal(store.get('macro_params/Custom_Spread')?.revision, 1);
  });

  it('6) Preserves draft and allows retry after save failure, and blocks overlapping double-clicks while saving', () => {
    const paramA = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    let state = createMacroParamDraftControllerState([paramA], 'admin_1');
    state = editMacroParamDraftValue(state, 'TaxRate', '24.5');

    const prep1 = prepareDirtySaveSubmission(state);
    assert.equal(prep1.ok, true);
    if (!prep1.ok) return;
    state = prep1.nextState;
    assert.equal(state.isSaving, true);
    assert.equal(state.entries.TaxRate.status, 'saving');

    // Overlapping double-click while in-flight MUST be blocked
    const overlapPrep = prepareDirtySaveSubmission(state);
    assert.equal(overlapPrep.ok, false);
    if (!overlapPrep.ok) {
      assert.equal(overlapPrep.reason, 'already_saving');
    }

    // Network error fails the save -> draft stays intact & lock releases for retry
    state = completeSaveFailure(state, 'انقطع الاتصال بالخادم أثناء الحفظ.');
    assert.equal(state.isSaving, false);
    assert.equal(state.entries.TaxRate.draftValue, '24.5');
    assert.equal(state.entries.TaxRate.dirty, true);
    assert.equal(state.entries.TaxRate.status, 'dirty');
    assert.equal(state.bannerErrorAr, 'انقطع الاتصال بالخادم أثناء الحفظ.');

    // Retry succeeds cleanly
    const retryPrep = prepareDirtySaveSubmission(state);
    assert.equal(retryPrep.ok, true);
    if (!retryPrep.ok) return;
    assert.equal(retryPrep.paramsToSave.length, 1);
    assert.equal(retryPrep.paramsToSave[0].value, 0.245);
  });

  it('7) Does NOT wipe a newer edit typed by the user while an earlier save request is in-flight', () => {
    const paramA = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const paramB = makeServerMacroParam({ key: 'RIM_Retention', value: 0.5, revision: 1 });
    let state = createMacroParamDraftControllerState([paramA, paramB], 'admin_1');

    // Edit TaxRate to 24% and click Save
    state = editMacroParamDraftValue(state, 'TaxRate', '24');
    const prep = prepareDirtySaveSubmission(state);
    assert.equal(prep.ok, true);
    if (!prep.ok) return;
    state = prep.nextState;

    // While the save request for 24% is STILL in-flight, user types 26% into TaxRate!
    state = editMacroParamDraftValue(state, 'TaxRate', '26');
    assert.equal(state.entries.TaxRate.draftValue, '26');

    // Earlier save (24%, rev 2) resolves
    const confirmedRev2 = makeServerMacroParam({ key: 'TaxRate', value: 0.24, revision: 2 });
    state = completeSaveSuccess(state, [confirmedRev2], prep.submittedSnapshots);

    // The user's newer draft "26" MUST NOT be wiped, and baseRecord advances to rev 2!
    assert.equal(state.isSaving, false);
    assert.equal(state.entries.TaxRate.draftValue, '26');
    assert.equal(state.entries.TaxRate.dirty, true);
    assert.equal(state.entries.TaxRate.status, 'dirty');
    assert.equal(state.entries.TaxRate.serverRecord?.value, 0.24);
    assert.equal(state.entries.TaxRate.serverRecord?.revision, 2);
    assert.equal(state.entries.TaxRate.baseRecord?.revision, 2);

    // Next save sends 0.26 with expectedRevision=2!
    const nextPrep = prepareDirtySaveSubmission(state);
    assert.equal(nextPrep.ok, true);
    if (nextPrep.ok) {
      assert.equal(nextPrep.paramsToSave[0].value, 0.26);
      assert.equal(nextPrep.preconditionsByKey.TaxRate.expectedRevision, 2);
    }
  });

  it('8) Partial dirty-only save merges by key in state and CacheService without losing untouched parameters', () => {
    const paramA = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const paramB = makeServerMacroParam({ key: 'RIM_Retention', value: 0.5, revision: 3 });
    const paramC = makeServerMacroParam({ key: 'ERP_Developed', value: 0.05, revision: 2 });

    // Seed full cache with 3 parameters
    CacheService.saveMacroParameters([paramA, paramB, paramC]);

    // Edit ONLY TaxRate -> controller produces ONLY [TaxRate]
    let state = createMacroParamDraftControllerState([paramA, paramB, paramC], 'admin_1');
    state = editMacroParamDraftValue(state, 'TaxRate', '23.5');
    const prep = prepareDirtySaveSubmission(state);
    assert.equal(prep.ok, true);
    if (!prep.ok) return;
    assert.deepEqual(
      prep.paramsToSave.map((p) => p.key),
      ['TaxRate']
    );

    // Simulate confirmed partial save returning ONLY updated TaxRate (rev 2)
    const savedTaxRate = makeServerMacroParam({ key: 'TaxRate', value: 0.235, revision: 2 });
    const mergedStateList = mergeMacroParametersByKey([paramA, paramB, paramC], [savedTaxRate]);
    const mergedCacheList = CacheService.mergeMacroParameters([savedTaxRate]);

    assert.equal(mergedStateList.length, 3);
    assert.equal(mergedCacheList.length, 3);
    assert.equal(CacheService.getMacroParameters().length, 3);
    assert.equal(mergedCacheList.find((p) => p.key === 'TaxRate')?.value, 0.235);
    assert.equal(mergedCacheList.find((p) => p.key === 'TaxRate')?.revision, 2);
    assert.equal(mergedCacheList.find((p) => p.key === 'RIM_Retention')?.value, 0.5);
    assert.equal(mergedCacheList.find((p) => p.key === 'ERP_Developed')?.value, 0.05);
  });

  it('9) Rejects Excel import apply when a parameter changes on the server between preview and apply', async () => {
    const existingDocRev1 = {
      key: 'TaxRate',
      nameAr: 'معدل الضريبة',
      descriptionAr: 'ضريبة الشركات',
      value: 0.225,
      scope: 'global',
      ticker: null,
      unit: 'decimal',
      valueType: 'pct',
      isPercentage: true,
      asOfDate: '2026-05-01',
      source: 'لوحة الإدارة',
      revision: 1,
      contentHash: computeRecordBusinessHash('parameter', {
        key: 'TaxRate',
        value: 0.225,
        description: 'ضريبة الشركات',
        scope: 'global',
        ticker: null,
        unit: 'decimal',
        valueType: 'pct',
        isPercentage: true,
        asOfDate: '2026-05-01',
        source: 'لوحة الإدارة',
      }),
      isDeleted: false,
    };

    // Build Excel file intending to update TaxRate to 0.25 and insert Custom_NewPct = 0.15
    const excelWb = await buildAllParametersExportWorkbook({
      macroParams: [
        makeServerMacroParam({ key: 'TaxRate', value: 0.25, asOfDate: '2026-05-12' }),
        makeServerMacroParam({
          key: 'Custom_NewPct',
          nameAr: 'نسبة مخصصة جديدة',
          value: 0.15,
          valueType: 'pct',
          isPercentage: true,
          unit: 'decimal',
          asOfDate: '2026-05-12',
        }),
      ],
      companyOverrides: [],
    });

    const parsed = await parseAllParametersExcelFile(workbookToExcelFile(excelWb));
    assert.equal(parsed.rejected.length, 0);

    // Step A: Build preview against rev 1
    const existingDocsMap = new Map<string, Record<string, any>>([['TaxRate', existingDocRev1]]);
    const preview = buildImportPreview({
      sourceType: 'parameters',
      fileName: 'All_Parameters.xlsx',
      sheetName: parsed.sheetName,
      totalRows: parsed.totalRows,
      parsedRecords: parsed.records,
      rejected: parsed.rejected,
      warnings: parsed.warnings,
      existingDocsMap,
    });

    assert.equal(preview.updates.length, 1);
    assert.equal(preview.updates[0].baseRevision, 1);
    assert.equal(preview.inserts.length, 1);
    assert.equal(preview.inserts[0].baseRevision, null);

    // Step B: Before user clicks Apply, another admin updates TaxRate on the server to rev 2!
    const { store, port } = createInMemoryParameterTxPort({
      'macro_params/TaxRate': { ...existingDocRev1, value: 0.23, revision: 2 },
    });

    const chunkPayloads = [...preview.inserts, ...preview.updates].map((item) => {
      const p = item.record;
      return buildParameterWritePayloadFromImport({
        ...p,
        precondition:
          item.status === 'insert'
            ? { mode: 'create' }
            : {
                mode: 'update',
                expectedRevision: typeof item.baseRevision === 'number' ? item.baseRevision : null,
                expectedContentHash: item.existingHash ?? null,
              },
      });
    });

    // Step C: Apply MUST fail atomically (neither TaxRate nor Custom_NewPct is written!)
    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: chunkPayloads,
          provenance: makeProvenance('import_user'),
        }),
      (err: unknown) => {
        assert.ok(err instanceof ParameterConcurrencyConflictError);
        assert.equal(err.conflicts[0].key, 'TaxRate');
        assert.equal(err.conflicts[0].reason, 'REVISION_MISMATCH');
        return true;
      }
    );

    assert.equal(store.get('macro_params/TaxRate')?.value, 0.23);
    assert.equal(store.get('macro_params/TaxRate')?.revision, 2);
    assert.equal(store.has('macro_params/Custom_NewPct'), false);
  });

  it('10) Clears local drafts on logout or user switch, and preserves RIM_Retention 50% <-> 0.5 & custom pct type round-trip', async () => {
    const rim = makeServerMacroParam({ key: 'RIM_Retention', value: 0.5, revision: 1 });
    const customPct = makeServerMacroParam({
      key: 'Custom_Margin_Pct',
      nameAr: 'هامش مخصص',
      value: 0.15,
      valueType: 'pct',
      isPercentage: true,
      unit: 'decimal',
      revision: 1,
    });

    let state = createMacroParamDraftControllerState([rim, customPct], 'admin_A');
    assert.equal(state.entries.RIM_Retention.draftValue, '50');
    assert.equal(storedValueToEditString('RIM_Retention', 0.5, rim), '50');
    assert.equal(state.entries.Custom_Margin_Pct.draftValue, '15');

    // User A makes local unsaved edits
    state = editMacroParamDraftValue(state, 'RIM_Retention', '55');
    state = editMacroParamCustomType(state, 'Custom_Margin_Pct', 'number');
    assert.equal(getMacroParamDraftSummary(state).dirtyKeys.length, 2);

    // Switching user (or logging out to 'guest') MUST clear all drafts completely!
    const afterUserSwitch = reconcileServerMacroParams(state, [rim, customPct], 'admin_B');
    assert.equal(afterUserSwitch.userScopeKey, 'admin_B');
    assert.equal(getMacroParamDraftSummary(afterUserSwitch).hasUnsavedChanges, false);
    assert.equal(afterUserSwitch.entries.RIM_Retention.draftValue, '50');
    assert.equal(afterUserSwitch.entries.Custom_Margin_Pct.draftCustomType, 'pct');
    assert.equal(afterUserSwitch.entries.Custom_Margin_Pct.draftValue, '15');

    // Discard all restores server state cleanly
    const afterDiscard = discardAllMacroParamDrafts(state);
    assert.equal(afterDiscard.entries.RIM_Retention.draftValue, '50');
    assert.equal(afterDiscard.entries.Custom_Margin_Pct.draftCustomType, 'pct');

    // Verify RIM_Retention 50% -> 0.5 and custom pct round-trip through Excel export/import
    const exportedWb = await buildAllParametersExportWorkbook({
      macroParams: [rim, customPct],
      companyOverrides: [],
    });
    const reParsed = await parseAllParametersExcelFile(workbookToExcelFile(exportedWb));
    assert.equal(reParsed.rejected.length, 0);
    const reRim = reParsed.records.find((r) => r.key === 'RIM_Retention');
    const reCustom = reParsed.records.find((r) => r.key === 'Custom_Margin_Pct');
    assert.equal(reRim?.value, 0.5);
    assert.equal(reRim?.isPercentage, true);
    assert.equal(reCustom?.value, 0.15);
    assert.equal(reCustom?.valueType, 'pct');
    assert.equal(reCustom?.isPercentage, true);
  });

  it('11) Enforces mandatory server-side preconditions on all global macro_params writes while keeping company overrides optional', async () => {
    const existingDoc = {
      key: 'TaxRate',
      nameAr: 'معدل الضريبة',
      descriptionAr: 'ضريبة الشركات',
      value: 0.24,
      scope: 'global',
      ticker: null,
      unit: 'decimal',
      valueType: 'pct',
      isPercentage: true,
      asOfDate: '2026-05-01',
      source: 'لوحة الإدارة',
      revision: 3,
      contentHash: computeRecordBusinessHash('parameter', {
        key: 'TaxRate',
        value: 0.24,
        description: 'ضريبة الشركات',
        scope: 'global',
        ticker: null,
        unit: 'decimal',
        valueType: 'pct',
        isPercentage: true,
        asOfDate: '2026-05-01',
        source: 'لوحة الإدارة',
      }),
      isDeleted: false,
    };

    // 11a. validateParameterRecords rejects global write with NO precondition
    const unconditionedGlobal = buildMacroParameterWritePayload({
      key: 'TaxRate',
      value: 0.2,
      asOfDate: '2026-05-12',
      source: 'legacy_client',
    });
    assert.throws(
      () => validateParameterRecords([unconditionedGlobal]),
      /precondition|شرط حماية التزامن/i
    );

    // 11b. Defense-in-depth: verifyParameterPreconditions & planParameterPersistenceWrites reject missing precondition even if called directly
    const existingByPath = new Map<string, Record<string, any> | undefined>([
      ['macro_params/TaxRate', existingDoc],
    ]);
    assert.throws(
      () =>
        verifyParameterPreconditions(
          [
            {
              key: 'TaxRate',
              value: 0.2,
              scope: 'global',
              ticker: null,
              unit: 'decimal',
              valueType: 'pct',
              isPercentage: true,
              asOfDate: '2026-05-12',
              source: 'legacy_client',
            },
          ],
          existingByPath
        ),
      (err: unknown) => {
        assert.ok(err instanceof ParameterConcurrencyConflictError);
        assert.equal(err.conflicts[0].reason, 'MISSING_PRECONDITION');
        assert.equal(err.conflicts[0].serverRevision, 3);
        return true;
      }
    );

    // 11c. Incomplete mode='update' precondition (no expectedRevision and no expectedContentHash) is rejected
    assert.throws(
      () =>
        verifyParameterPreconditions(
          [
            {
              key: 'TaxRate',
              value: 0.2,
              scope: 'global',
              ticker: null,
              unit: 'decimal',
              valueType: 'pct',
              isPercentage: true,
              asOfDate: '2026-05-12',
              source: 'incomplete_client',
              precondition: { mode: 'update' },
            },
          ],
          existingByPath
        ),
      (err: unknown) => {
        assert.ok(err instanceof ParameterConcurrencyConflictError);
        assert.equal(err.conflicts[0].reason, 'INCOMPLETE_PRECONDITION');
        return true;
      }
    );

    // 11d. executeAtomicParameterWrites refuses unconditioned global write and leaves stored doc untouched
    const { store, port } = createInMemoryParameterTxPort({ 'macro_params/TaxRate': existingDoc });
    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: [unconditionedGlobal],
          provenance: makeProvenance('legacy_caller'),
        }),
      /precondition|شرط حماية التزامن/i
    );
    assert.equal(store.get('macro_params/TaxRate')?.value, 0.24);
    assert.equal(store.get('macro_params/TaxRate')?.revision, 3);

    // 11e. planParameterPersistenceWrites also rejects unconditioned global write
    assert.throws(
      () =>
        planParameterPersistenceWrites({
          rawInputs: [unconditionedGlobal],
          existingByPath,
          provenance: makeProvenance('legacy_caller'),
        }),
      /precondition|شرط حماية التزامن/i
    );

    // 11f. Valid mode='update' with expectedRevision=3 succeeds and advances revision to 4
    const validUpdate = buildMacroParameterWritePayload(
      { key: 'TaxRate', value: 0.25, asOfDate: '2026-05-12', source: 'لوحة الإدارة' },
      buildParameterUpdatePrecondition(existingDoc)
    );
    const updateRes = await executeAtomicParameterWrites(port, {
      rawInputs: [validUpdate],
      provenance: makeProvenance('admin_valid'),
    });
    assert.equal(updateRes.updatedCount, 1);
    assert.equal(store.get('macro_params/TaxRate')?.value, 0.25);
    assert.equal(store.get('macro_params/TaxRate')?.revision, 4);

    // 11g. scope='company' override WITHOUT precondition remains allowed (backward-compatible)
    const companyRes = await executeAtomicParameterWrites(port, {
      rawInputs: [
        {
          key: 'TaxRate',
          value: 0.18,
          scope: 'company',
          ticker: 'COMI',
          unit: 'decimal',
          valueType: 'pct',
          isPercentage: true,
          asOfDate: '2026-05-12',
          source: 'company_override',
        },
      ],
      provenance: makeProvenance('admin_company'),
    });
    assert.equal(companyRes.insertedCount, 1);
    assert.equal(store.get('company_assumptions/COMI/parameters/TaxRate')?.value, 0.18);
  });

  it('12) Isolates late save success AND failure across user/session switches in draft controller, session manager, and CacheService', () => {
    const paramRev1 = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const paramRev2ByA = makeServerMacroParam({ key: 'TaxRate', value: 0.28, revision: 2 });
    const paramForB = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });

    // --- User A starts a save ---
    CacheService.setScope({ uid: 'user_A', projectId: 'demo-test', databaseId: '(default)' });
    const scopeKeyA = CacheService.getScopeKey();
    CacheService.saveMacroParameters([paramRev1], scopeKeyA);

    const sessionManager = new FirestoreSessionManager();
    const tokenA = sessionManager.beginSession('user_A');
    sessionManager.applyNonQuarterlySnapshot(tokenA, 'macroParams', [paramRev1], {
      fromCache: false,
      hasPendingWrites: false,
    });

    let controllerState = createMacroParamDraftControllerState([paramRev1], 'user_A');
    controllerState = editMacroParamDraftValue(controllerState, 'TaxRate', '28');
    const prepA = prepareDirtySaveSubmission(controllerState);
    assert.equal(prepA.ok, true);
    if (!prepA.ok) return;
    controllerState = prepA.nextState;

    // --- Switch to User B BEFORE User A's save settles ---
    CacheService.setScope({ uid: 'user_B', projectId: 'demo-test', databaseId: '(default)' });
    const scopeKeyB = CacheService.getScopeKey();
    assert.notEqual(scopeKeyA, scopeKeyB);
    CacheService.saveMacroParameters([paramForB], scopeKeyB);

    const tokenB = sessionManager.beginSession('user_B');
    sessionManager.applyNonQuarterlySnapshot(tokenB, 'macroParams', [paramForB], {
      fromCache: false,
      hasPendingWrites: false,
    });

    controllerState = reconcileServerMacroParams(controllerState, [paramForB], 'user_B');
    // User B starts editing TaxRate to 30%
    controllerState = editMacroParamDraftValue(controllerState, 'TaxRate', '30');
    const prepB = prepareDirtySaveSubmission(controllerState);
    assert.equal(prepB.ok, true);
    if (!prepB.ok) return;
    controllerState = prepB.nextState;

    // --- Now User A's late SUCCESS arrives ---
    const afterLateSuccessA = completeSaveSuccess(
      controllerState,
      [paramRev2ByA],
      prepA.submittedSnapshots,
      '2026-05-12T12:00:00.000Z',
      { requestId: prepA.requestId, userScopeKey: prepA.userScopeKey, mode: 'update' }
    );
    // Zero impact on User B's draft controller state or saving lock!
    assert.equal(afterLateSuccessA, controllerState);
    assert.equal(afterLateSuccessA.userScopeKey, 'user_B');
    assert.equal(afterLateSuccessA.isSaving, true);
    assert.equal(afterLateSuccessA.inFlightSubmission?.requestId, prepB.requestId);
    assert.equal(afterLateSuccessA.entries.TaxRate.draftValue, '30');
    assert.equal(afterLateSuccessA.entries.TaxRate.serverRecord?.value, 0.225);

    // Zero impact on User B's FirestoreSessionManager state!
    const smResA = sessionManager.applyMacroParamSaveConfirmation(tokenA, [paramRev2ByA]);
    assert.equal(smResA.accepted, false);
    assert.equal(sessionManager.getState().macroParams[0].value, 0.225);

    // Zero impact on User B's CacheService!
    CacheService.mergeMacroParameters([paramRev2ByA], { expectedScopeKey: scopeKeyA });
    assert.equal(CacheService.getMacroParameters()[0].value, 0.225);

    // --- Now User A's late FAILURE arrives ---
    const afterLateFailureA = completeSaveFailure(
      controllerState,
      'خطأ متأخر من جلسة المستخدم A',
      undefined,
      { requestId: prepA.requestId, userScopeKey: prepA.userScopeKey, mode: 'update' }
    );
    assert.equal(afterLateFailureA, controllerState);
    assert.equal(afterLateFailureA.isSaving, true);
    assert.equal(afterLateFailureA.bannerErrorAr, null);
    assert.equal(afterLateFailureA.entries.TaxRate.draftValue, '30');
  });

  it('13) Enforces monotonic version reconciliation: rev=2 or unverified confirmation NEVER rolls back rev=3 across controller, session manager, and cache', () => {
    const rev1 = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const rev2Delayed = makeServerMacroParam({
      key: 'TaxRate',
      value: 0.24,
      revision: 2,
      updatedAt: '2026-05-12T10:01:00.000Z',
    });
    const rev3Latest = makeServerMacroParam({
      key: 'TaxRate',
      value: 0.27,
      revision: 3,
      updatedAt: '2026-05-12T10:02:00.000Z',
    });
    const unverifiedIncoming: MacroParameter = {
      ...rev2Delayed,
      value: 0.19,
      revision: undefined,
      updatedAt: undefined,
    };

    // 13a. Direct contract check
    assert.equal(
      reconcileIncomingMacroParameterVersion(rev3Latest, rev2Delayed, {
        source: 'save_confirmation',
      }).decision,
      'ignore_stale'
    );
    assert.equal(
      reconcileIncomingMacroParameterVersion(rev3Latest, unverifiedIncoming, {
        source: 'save_confirmation',
      }).decision,
      'ignore_unverified'
    );

    // 13b. Draft controller: user submits edit (24%) -> while in-flight, live snapshot brings rev=3 (27%)
    //      and user also types a newer draft (29%) -> then delayed confirmation (rev=2) arrives!
    let state = createMacroParamDraftControllerState([rev1], 'admin_1');
    state = editMacroParamDraftValue(state, 'TaxRate', '24');
    const prep = prepareDirtySaveSubmission(state);
    assert.equal(prep.ok, true);
    if (!prep.ok) return;
    state = prep.nextState;

    // Newer server revision (rev=3) arrives via snapshot while save is in-flight
    state = reconcileServerMacroParams(state, [rev3Latest], 'admin_1');
    assert.equal(state.entries.TaxRate.serverRecord?.revision, 3);
    assert.equal(state.entries.TaxRate.serverRecord?.value, 0.27);

    // User types newer draft "29"
    state = editMacroParamDraftValue(state, 'TaxRate', '29');

    // Delayed confirmation (rev=2) arrives for prep.requestId
    const afterDelayedRev2 = completeSaveSuccess(
      state,
      [rev2Delayed],
      prep.submittedSnapshots,
      '2026-05-12T10:03:00.000Z',
      { requestId: prep.requestId, userScopeKey: prep.userScopeKey, mode: 'update' }
    );
    // MUST NOT roll back serverRecord to rev=2, MUST NOT become clean, MUST preserve draft "29" as explicit conflict against rev=3!
    assert.equal(afterDelayedRev2.isSaving, false);
    assert.equal(afterDelayedRev2.entries.TaxRate.serverRecord?.revision, 3);
    assert.equal(afterDelayedRev2.entries.TaxRate.serverRecord?.value, 0.27);
    assert.equal(afterDelayedRev2.entries.TaxRate.conflictServerRecord?.revision, 3);
    assert.equal(afterDelayedRev2.entries.TaxRate.status, 'conflict');
    assert.equal(afterDelayedRev2.entries.TaxRate.dirty, true);
    assert.equal(afterDelayedRev2.entries.TaxRate.draftValue, '29');
    assert.ok(afterDelayedRev2.bannerErrorAr);

    // Also test unverified confirmation (no revision) against rev=3
    const afterUnverified = completeSaveSuccess(
      state,
      [unverifiedIncoming],
      prep.submittedSnapshots,
      '2026-05-12T10:03:05.000Z',
      { requestId: prep.requestId, userScopeKey: prep.userScopeKey, mode: 'update' }
    );
    assert.equal(afterUnverified.entries.TaxRate.serverRecord?.revision, 3);
    assert.equal(afterUnverified.entries.TaxRate.status, 'conflict');
    assert.equal(afterUnverified.entries.TaxRate.draftValue, '29');

    // 13c. FirestoreSessionManager refuses rev=2 and unverified rollback over rev=3
    const sm = new FirestoreSessionManager();
    const token = sm.beginSession('admin_1');
    sm.applyNonQuarterlySnapshot(token, 'macroParams', [rev3Latest], {
      fromCache: false,
      hasPendingWrites: false,
    });
    sm.applyMacroParamSaveConfirmation(token, [rev2Delayed]);
    sm.applyMacroParamSaveConfirmation(token, [unverifiedIncoming]);
    sm.applyNonQuarterlySnapshot(token, 'macroParams', [rev2Delayed], {
      fromCache: false,
      hasPendingWrites: false,
    });
    assert.equal(sm.getState().macroParams[0].revision, 3);
    assert.equal(sm.getState().macroParams[0].value, 0.27);

    // 13d. CacheService refuses rev=2 and unverified rollback over rev=3
    CacheService.saveMacroParameters([rev3Latest]);
    CacheService.mergeMacroParameters([rev2Delayed]);
    CacheService.mergeMacroParameters([unverifiedIncoming]);
    assert.equal(CacheService.getMacroParameters()[0].revision, 3);
    assert.equal(CacheService.getMacroParameters()[0].value, 0.27);
  });

  it('14) Prevents stale update confirmation from reviving a deleted parameter, while allowing explicit mode=create recreation', () => {
    const customRev1 = makeServerMacroParam({
      key: 'Custom_Temp',
      nameAr: 'معامل مؤقت',
      value: 0.1,
      valueType: 'pct',
      isPercentage: true,
      revision: 1,
    });
    const customRev2OldConfirm = makeServerMacroParam({
      key: 'Custom_Temp',
      nameAr: 'معامل مؤقت',
      value: 0.12,
      valueType: 'pct',
      isPercentage: true,
      revision: 2,
    });
    const taxRate = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });

    // 14a. Draft controller: edit Custom_Temp -> submit -> server deletes Custom_Temp -> old update confirmation arrives
    let state = createMacroParamDraftControllerState([customRev1, taxRate], 'admin_1');
    state = editMacroParamDraftValue(state, 'Custom_Temp', '12');
    const prep = prepareDirtySaveSubmission(state);
    assert.equal(prep.ok, true);
    if (!prep.ok) return;
    state = prep.nextState;

    // Live snapshot omits Custom_Temp -> marked deleted_on_server immediately even while saving!
    state = reconcileServerMacroParams(state, [taxRate], 'admin_1');
    assert.equal(state.entries.Custom_Temp.status, 'deleted_on_server');
    assert.equal(state.entries.Custom_Temp.serverRecord, null);

    // Delayed update confirmation arrives -> MUST NOT revive Custom_Temp or clear deleted_on_server!
    state = completeSaveSuccess(
      state,
      [customRev2OldConfirm],
      prep.submittedSnapshots,
      '2026-05-12T11:00:00.000Z',
      { requestId: prep.requestId, userScopeKey: prep.userScopeKey, mode: 'update' }
    );
    assert.equal(state.isSaving, false);
    assert.equal(state.entries.Custom_Temp.status, 'deleted_on_server');
    assert.equal(state.entries.Custom_Temp.serverRecord, null);
    assert.equal(state.entries.Custom_Temp.draftValue, '12');

    // 14b. FirestoreSessionManager: delete Custom_Temp -> stale update confirmation MUST NOT revive it
    const sm = new FirestoreSessionManager();
    const token = sm.beginSession('admin_1');
    sm.applyNonQuarterlySnapshot(token, 'macroParams', [customRev1, taxRate], {
      fromCache: false,
      hasPendingWrites: false,
    });
    sm.applyMacroParamDeletion(token, 'Custom_Temp');
    assert.equal(sm.getState().macroParams.some((p) => p.key === 'Custom_Temp'), false);

    sm.applyMacroParamSaveConfirmation(token, [customRev2OldConfirm]);
    assert.equal(sm.getState().macroParams.some((p) => p.key === 'Custom_Temp'), false);

    // 14c. CacheService: mark deleted -> stale update confirmation MUST NOT revive it
    CacheService.saveMacroParameters([customRev1, taxRate]);
    CacheService.markMacroParameterDeleted('Custom_Temp');
    assert.equal(CacheService.getMacroParameters().some((p) => p.key === 'Custom_Temp'), false);

    CacheService.mergeMacroParameters([customRev2OldConfirm]);
    assert.equal(CacheService.getMacroParameters().some((p) => p.key === 'Custom_Temp'), false);

    // 14d. Explicit mode='create' CAN recreate Custom_Temp cleanly across controller, session manager, and cache
    const recreated = makeServerMacroParam({
      key: 'Custom_Temp',
      nameAr: 'معامل مؤقت جديد',
      value: 0.15,
      valueType: 'pct',
      isPercentage: true,
      revision: 1,
    });
    state = discardDeletedDraft(state, 'Custom_Temp');
    const createPrep = prepareCreateParamSubmission(state, recreated);
    assert.equal(createPrep.ok, true);
    if (!createPrep.ok) return;
    assert.equal(createPrep.precondition.mode, 'create');
    state = completeSaveSuccess(
      createPrep.nextState,
      [recreated],
      undefined,
      '2026-05-12T11:05:00.000Z',
      { requestId: createPrep.requestId, userScopeKey: createPrep.userScopeKey, mode: 'create' }
    );
    assert.equal(state.entries.Custom_Temp.status, 'clean');
    assert.equal(state.entries.Custom_Temp.serverRecord?.value, 0.15);

    sm.applyMacroParamSaveConfirmation(token, [recreated], { createdKeys: new Set(['Custom_Temp']) });
    assert.equal(sm.getState().macroParams.find((p) => p.key === 'Custom_Temp')?.value, 0.15);

    CacheService.mergeMacroParameters([recreated], { createdKeys: new Set(['Custom_Temp']) });
    assert.equal(CacheService.getMacroParameters().find((p) => p.key === 'Custom_Temp')?.value, 0.15);
  });

  it('15) Isolates late completion or failure of an older requestId when a newer requestId is active', () => {
    const rev1 = makeServerMacroParam({ key: 'TaxRate', value: 0.225, revision: 1 });
    const rev2 = makeServerMacroParam({ key: 'TaxRate', value: 0.24, revision: 2 });
    const rev3 = makeServerMacroParam({ key: 'TaxRate', value: 0.26, revision: 3 });

    let state = createMacroParamDraftControllerState([rev1], 'admin_1');
    state = editMacroParamDraftValue(state, 'TaxRate', '24');
    const req1 = prepareDirtySaveSubmission(state, 'req_1');
    assert.equal(req1.ok, true);
    if (!req1.ok) return;

    // Simulate req_1 finishing normally, then req_2 starting
    state = completeSaveSuccess(
      req1.nextState,
      [rev2],
      req1.submittedSnapshots,
      '2026-05-12T10:00:00.000Z',
      { requestId: 'req_1', userScopeKey: 'admin_1', mode: 'update' }
    );
    state = editMacroParamDraftValue(state, 'TaxRate', '26');
    const req2 = prepareDirtySaveSubmission(state, 'req_2');
    assert.equal(req2.ok, true);
    if (!req2.ok) return;
    state = req2.nextState;
    assert.equal(state.isSaving, true);
    assert.equal(state.inFlightSubmission?.requestId, 'req_2');

    // A duplicate/delayed callback for req_1 (success OR failure) MUST be ignored completely!
    const afterLateReq1Success = completeSaveSuccess(
      state,
      [rev2],
      req1.submittedSnapshots,
      '2026-05-12T10:00:30.000Z',
      { requestId: 'req_1', userScopeKey: 'admin_1', mode: 'update' }
    );
    assert.equal(afterLateReq1Success, state);
    assert.equal(afterLateReq1Success.isSaving, true);
    assert.equal(afterLateReq1Success.inFlightSubmission?.requestId, 'req_2');

    const afterLateReq1Fail = completeSaveFailure(
      state,
      'فشل متأخر للطلب القديم req_1',
      undefined,
      { requestId: 'req_1', userScopeKey: 'admin_1', mode: 'update' }
    );
    assert.equal(afterLateReq1Fail, state);
    assert.equal(afterLateReq1Fail.isSaving, true);
    assert.equal(afterLateReq1Fail.bannerErrorAr, null);
    assert.equal(afterLateReq1Fail.inFlightSubmission?.requestId, 'req_2');

    // Only matching req_2 resolves and clears isSaving cleanly
    const afterReq2Success = completeSaveSuccess(
      state,
      [rev3],
      req2.submittedSnapshots,
      '2026-05-12T10:01:00.000Z',
      { requestId: 'req_2', userScopeKey: 'admin_1', mode: 'update' }
    );
    assert.equal(afterReq2Success.isSaving, false);
    assert.equal(afterReq2Success.entries.TaxRate.status, 'clean');
    assert.equal(afterReq2Success.entries.TaxRate.serverRecord?.revision, 3);
    assert.equal(afterReq2Success.entries.TaxRate.draftValue, '26');
  });
});

