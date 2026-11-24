/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real Firestore Emulator integration suite for `macro_params` atomic optimistic concurrency.
 *
 * Architecture guarantees:
 * - Connects ONLY to `FIRESTORE_EMULATOR_HOST` under isolated `demo-*` project ID.
 * - Executes the EXACT production transactional executor (`executeAtomicParameterWrites` +
 *   `createFirestoreAdminParameterTransactionPort`) used by Cloud Functions `bulk_parameters`
 *   and `macro_parameter` against real Firestore Emulator `db.runTransaction`.
 * - Note: This verifies real Firestore Emulator transaction atomicity and server-side precondition
 *   enforcement; Cloud Functions HTTP/onCall auth wrapper transport is NOT invoked here.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMacroParameterWritePayload,
  buildParameterUpdatePrecondition,
  buildParameterWritePayloadFromImport,
  createFirestoreAdminParameterTransactionPort,
  executeAtomicParameterWrites,
  normalizeMacroParameterFromFirestore,
  ParameterConcurrencyConflictError,
  type ParameterAdminFirestoreLike,
  type ParameterDocumentProvenance,
} from '../../src/core/contracts';
import * as XLSX from 'xlsx';
import { buildImportPreview, parseAllParametersExcelFile } from '../../src/core/imports';
import { buildAllParametersExportWorkbook } from '../../src/utils/excelExport';
import type { MacroParameter } from '../../src/types';
import { createEmulatorAdminContext, type EmulatorAdminContext } from './emulatorHarness';

function workbookToExcelFile(wb: XLSX.WorkBook, name = 'All_Parameters.xlsx'): File {
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return {
    name,
    arrayBuffer: async () => arr,
  } as unknown as File;
}

function makeProvenance(updatedBy: string, updatedAt: string): ParameterDocumentProvenance {
  return {
    importId: `emu_${updatedBy}_${updatedAt}`,
    sourceFile: 'emulator_test',
    sourceSheet: 'bulk_parameters',
    schemaVersion: 1,
    updatedBy,
    updatedAt,
    serverUpdatedAt: updatedAt,
    isDeleted: false,
  };
}

describe('Real Firestore Emulator — macro_params Atomic Optimistic Concurrency', () => {
  let ctx: EmulatorAdminContext;

  before(() => {
    ctx = createEmulatorAdminContext('macro-param-concurrency');
  });

  beforeEach(async () => {
    await ctx.resetDatabase();
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('rejects concurrent creation of the same macro_params key atomically and preserves first revision', async () => {
    const port = createFirestoreAdminParameterTransactionPort(
      ctx.db as unknown as ParameterAdminFirestoreLike
    );

    const payload1 = buildMacroParameterWritePayload(
      {
        key: 'Custom_Risk_Buffer',
        nameAr: 'هامش أمان مخصص',
        value: 0.04,
        valueType: 'pct',
        isPercentage: true,
        unit: 'decimal',
        asOfDate: '2026-05-12',
        source: 'لوحة الإدارة',
      },
      { mode: 'create' }
    );
    const payload2 = buildMacroParameterWritePayload(
      {
        key: 'Custom_Risk_Buffer',
        nameAr: 'هامش أمان مخصص',
        value: 0.09,
        valueType: 'pct',
        isPercentage: true,
        unit: 'decimal',
        asOfDate: '2026-05-12',
        source: 'لوحة الإدارة',
      },
      { mode: 'create' }
    );

    const firstRes = await executeAtomicParameterWrites(port, {
      rawInputs: [payload1],
      provenance: makeProvenance('admin_a', '2026-05-12T10:00:00.000Z'),
    });
    assert.equal(firstRes.insertedCount, 1);
    assert.equal(firstRes.savedParameters[0].revision, 1);

    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: [payload2],
          provenance: makeProvenance('admin_b', '2026-05-12T10:00:05.000Z'),
        }),
      (err: unknown) => {
        assert.ok(err instanceof ParameterConcurrencyConflictError);
        assert.equal(err.conflicts[0].reason, 'ALREADY_EXISTS');
        assert.equal(err.conflicts[0].serverRevision, 1);
        assert.equal(err.conflicts[0].serverValue, 0.04);
        return true;
      }
    );

    const snap = await ctx.db.collection('macro_params').doc('Custom_Risk_Buffer').get();
    assert.equal(snap.exists, true);
    assert.equal(snap.data()?.value, 0.04);
    assert.equal(snap.data()?.revision, 1);
    assert.equal(snap.data()?.valueType, 'pct');
    assert.equal(snap.data()?.isPercentage, true);
  });

  it('rejects stale-revision update and aborts entire multi-parameter transaction atomically', async () => {
    const port = createFirestoreAdminParameterTransactionPort(
      ctx.db as unknown as ParameterAdminFirestoreLike
    );

    // Seed TaxRate (rev 1) and RIM_Retention (rev 1)
    await executeAtomicParameterWrites(port, {
      rawInputs: [
        buildMacroParameterWritePayload(
          { key: 'TaxRate', value: 0.225, asOfDate: '2026-05-01', source: 'لوحة الإدارة' },
          { mode: 'create' }
        ),
        buildMacroParameterWritePayload(
          { key: 'RIM_Retention', value: 0.5, asOfDate: '2026-05-01', source: 'لوحة الإدارة' },
          { mode: 'create' }
        ),
      ],
      provenance: makeProvenance('admin_seed', '2026-05-12T09:00:00.000Z'),
    });

    const taxSnapV1 = await ctx.db.collection('macro_params').doc('TaxRate').get();
    const rimSnapV1 = await ctx.db.collection('macro_params').doc('RIM_Retention').get();
    const staleTaxPrecondition = buildParameterUpdatePrecondition(taxSnapV1.data()!);
    const validRimPrecondition = buildParameterUpdatePrecondition(rimSnapV1.data()!);

    // Another session updates TaxRate -> rev 2 (value 0.24)
    await executeAtomicParameterWrites(port, {
      rawInputs: [
        buildMacroParameterWritePayload(
          { key: 'TaxRate', value: 0.24, asOfDate: '2026-05-12', source: 'لوحة الإدارة' },
          staleTaxPrecondition
        ),
      ],
      provenance: makeProvenance('admin_newer', '2026-05-12T09:05:00.000Z'),
    });

    // Stale session submits BOTH RIM_Retention (valid rev 1) + TaxRate (stale rev 1)
    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: [
            buildMacroParameterWritePayload(
              { key: 'RIM_Retention', value: 0.6, asOfDate: '2026-05-12', source: 'لوحة الإدارة' },
              validRimPrecondition
            ),
            buildMacroParameterWritePayload(
              { key: 'TaxRate', value: 0.26, asOfDate: '2026-05-12', source: 'لوحة الإدارة' },
              staleTaxPrecondition
            ),
          ],
          provenance: makeProvenance('admin_stale', '2026-05-12T09:06:00.000Z'),
        }),
      (err: unknown) => {
        assert.ok(err instanceof ParameterConcurrencyConflictError);
        assert.equal(err.conflicts[0].key, 'TaxRate');
        assert.equal(err.conflicts[0].reason, 'REVISION_MISMATCH');
        assert.equal(err.conflicts[0].serverRevision, 2);
        return true;
      }
    );

    // Transaction aborted atomically: NEITHER TaxRate NOR RIM_Retention was modified!
    const taxAfter = await ctx.db.collection('macro_params').doc('TaxRate').get();
    const rimAfter = await ctx.db.collection('macro_params').doc('RIM_Retention').get();
    assert.equal(taxAfter.data()?.value, 0.24);
    assert.equal(taxAfter.data()?.revision, 2);
    assert.equal(rimAfter.data()?.value, 0.5);
    assert.equal(rimAfter.data()?.revision, 1);
  });

  it('rejects update on a parameter deleted on the server without silently recreating it', async () => {
    const port = createFirestoreAdminParameterTransactionPort(
      ctx.db as unknown as ParameterAdminFirestoreLike
    );

    await executeAtomicParameterWrites(port, {
      rawInputs: [
        buildMacroParameterWritePayload(
          {
            key: 'Temp_Macro_Param',
            nameAr: 'معامل مؤقت',
            value: 10,
            valueType: 'number',
            isPercentage: false,
            asOfDate: '2026-05-12',
          },
          { mode: 'create' }
        ),
      ],
      provenance: makeProvenance('admin_a', '2026-05-12T10:00:00.000Z'),
    });

    const snapBeforeDelete = await ctx.db.collection('macro_params').doc('Temp_Macro_Param').get();
    const updatePrecondition = buildParameterUpdatePrecondition(snapBeforeDelete.data()!);

    // Delete on server
    await ctx.db.collection('macro_params').doc('Temp_Macro_Param').delete();

    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: [
            buildMacroParameterWritePayload(
              {
                key: 'Temp_Macro_Param',
                nameAr: 'معامل مؤقت',
                value: 20,
                valueType: 'number',
                isPercentage: false,
                asOfDate: '2026-05-12',
              },
              updatePrecondition
            ),
          ],
          provenance: makeProvenance('admin_b', '2026-05-12T10:02:00.000Z'),
        }),
      (err: unknown) => {
        assert.ok(err instanceof ParameterConcurrencyConflictError);
        assert.equal(err.conflicts[0].reason, 'DELETED_ON_SERVER');
        return true;
      }
    );

    const snapAfter = await ctx.db.collection('macro_params').doc('Temp_Macro_Param').get();
    assert.equal(snapAfter.exists, false);
  });

  it('rejects Excel import apply in real Firestore if a parameter mutates between preview and apply', async () => {
    const port = createFirestoreAdminParameterTransactionPort(
      ctx.db as unknown as ParameterAdminFirestoreLike
    );

    await executeAtomicParameterWrites(port, {
      rawInputs: [
        buildMacroParameterWritePayload(
          { key: 'TaxRate', value: 0.225, asOfDate: '2026-05-01', source: 'لوحة الإدارة' },
          { mode: 'create' }
        ),
      ],
      provenance: makeProvenance('admin_seed', '2026-05-12T08:00:00.000Z'),
    });

    const previewSnap = await ctx.db.collection('macro_params').doc('TaxRate').get();
    const existingDocsMap = new Map<string, Record<string, any>>([
      ['TaxRate', previewSnap.data()!],
    ]);

    const excelWb = await buildAllParametersExportWorkbook({
      macroParams: [
        normalizeMacroParameterFromFirestore('TaxRate', {
          value: 0.25,
          asOfDate: '2026-05-12',
          source: 'Excel',
        }) as MacroParameter,
      ],
      companyOverrides: [],
    });
    const parsed = await parseAllParametersExcelFile(workbookToExcelFile(excelWb));
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

    // Concurrent mutation happens AFTER preview and BEFORE apply
    await executeAtomicParameterWrites(port, {
      rawInputs: [
        buildMacroParameterWritePayload(
          { key: 'TaxRate', value: 0.23, asOfDate: '2026-05-12', source: 'تعديل متزامن' },
          buildParameterUpdatePrecondition(previewSnap.data()!)
        ),
      ],
      provenance: makeProvenance('admin_concurrent', '2026-05-12T08:05:00.000Z'),
    });

    const importPayloads = [...preview.inserts, ...preview.updates].map((item) =>
      buildParameterWritePayloadFromImport({
        ...item.record,
        precondition:
          item.status === 'insert'
            ? { mode: 'create' }
            : {
                mode: 'update',
                expectedRevision: typeof item.baseRevision === 'number' ? item.baseRevision : null,
                expectedContentHash: item.existingHash ?? null,
              },
      })
    );

    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: importPayloads,
          provenance: makeProvenance('admin_importer', '2026-05-12T08:06:00.000Z'),
        }),
      (err: unknown) => {
        assert.ok(err instanceof ParameterConcurrencyConflictError);
        assert.equal(err.conflicts[0].reason, 'REVISION_MISMATCH');
        assert.equal(err.conflicts[0].serverValue, 0.23);
        return true;
      }
    );

    const finalSnap = await ctx.db.collection('macro_params').doc('TaxRate').get();
    assert.equal(finalSnap.data()?.value, 0.23);
    assert.equal(finalSnap.data()?.revision, 2);
  });

  it('rejects unconditioned global macro_params writes in real Firestore without modifying existing docs', async () => {
    const port = createFirestoreAdminParameterTransactionPort(
      ctx.db as unknown as ParameterAdminFirestoreLike
    );

    await executeAtomicParameterWrites(port, {
      rawInputs: [
        buildMacroParameterWritePayload(
          { key: 'TaxRate', value: 0.24, asOfDate: '2026-05-12', source: 'لوحة الإدارة' },
          { mode: 'create' }
        ),
      ],
      provenance: makeProvenance('admin_seed', '2026-05-12T08:00:00.000Z'),
    });

    // Attempt legacy/unconditioned global write (no precondition)
    const unconditionedPayload = buildMacroParameterWritePayload({
      key: 'TaxRate',
      value: 0.19,
      asOfDate: '2026-05-12',
      source: 'legacy_client',
    });

    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: [unconditionedPayload],
          provenance: makeProvenance('legacy_caller', '2026-05-12T08:05:00.000Z'),
        }),
      /precondition|شرط حماية التزامن/i
    );

    const snap = await ctx.db.collection('macro_params').doc('TaxRate').get();
    assert.equal(snap.exists, true);
    assert.equal(snap.data()?.value, 0.24);
    assert.equal(snap.data()?.revision, 1);
  });

  it('rejects incomplete mode=update precondition on global macro_params while allowing valid update and company overrides', async () => {
    const port = createFirestoreAdminParameterTransactionPort(
      ctx.db as unknown as ParameterAdminFirestoreLike
    );

    await executeAtomicParameterWrites(port, {
      rawInputs: [
        buildMacroParameterWritePayload(
          { key: 'TaxRate', value: 0.225, asOfDate: '2026-05-12', source: 'لوحة الإدارة' },
          { mode: 'create' }
        ),
      ],
      provenance: makeProvenance('admin_seed', '2026-05-12T08:00:00.000Z'),
    });

    const incompleteUpdatePayload = buildMacroParameterWritePayload(
      { key: 'TaxRate', value: 0.3, asOfDate: '2026-05-12', source: 'incomplete_client' },
      { mode: 'update' }
    );

    await assert.rejects(
      () =>
        executeAtomicParameterWrites(port, {
          rawInputs: [incompleteUpdatePayload],
          provenance: makeProvenance('incomplete_caller', '2026-05-12T08:05:00.000Z'),
        }),
      /expectedRevision|expectedContentHash|شرط حماية التزامن/i
    );

    const unchangedSnap = await ctx.db.collection('macro_params').doc('TaxRate').get();
    assert.equal(unchangedSnap.data()?.value, 0.225);
    assert.equal(unchangedSnap.data()?.revision, 1);

    // Valid update with expectedRevision succeeds
    const validUpdatePayload = buildMacroParameterWritePayload(
      { key: 'TaxRate', value: 0.25, asOfDate: '2026-05-12', source: 'لوحة الإدارة' },
      buildParameterUpdatePrecondition(unchangedSnap.data()!)
    );
    const updateRes = await executeAtomicParameterWrites(port, {
      rawInputs: [validUpdatePayload],
      provenance: makeProvenance('admin_valid', '2026-05-12T08:06:00.000Z'),
    });
    assert.equal(updateRes.updatedCount, 1);
    const updatedSnap = await ctx.db.collection('macro_params').doc('TaxRate').get();
    assert.equal(updatedSnap.data()?.value, 0.25);
    assert.equal(updatedSnap.data()?.revision, 2);

    // Company override without precondition remains permitted
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
      provenance: makeProvenance('admin_company', '2026-05-12T08:07:00.000Z'),
    });
    assert.equal(companyRes.insertedCount, 1);
    const companySnap = await ctx.db
      .collection('company_assumptions')
      .doc('COMI')
      .collection('parameters')
      .doc('TaxRate')
      .get();
    assert.equal(companySnap.exists, true);
    assert.equal(companySnap.data()?.value, 0.18);
  });
});

