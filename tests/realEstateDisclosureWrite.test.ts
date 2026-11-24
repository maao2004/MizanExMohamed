/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Authoritative unit & transactional tests for single-record server save/update
 * of Documented Real Estate Disclosures (`executeSaveRealEstateDisclosure`).
 *
 * Scope transparency:
 * - Exercises the EXACT production transactional business service (`executeSaveRealEstateDisclosure`),
 *   canonical business hashing (`computeRecordBusinessHash('real_estate_disclosure', ...)`),
 *   optimistic concurrency preconditions, no-op idempotency (zero writes), and read-only
 *   linkage verification against an instrumented in-memory `RealEstateDisclosureTransactionPort`.
 * - Does NOT invoke the deployed Cloud Functions `onCall` transport/auth wrapper directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRecordBusinessHash,
  executeSaveRealEstateDisclosure,
  QUARTERLY_FINANCIAL_RECORDS_COLLECTION,
  REAL_ESTATE_DISCLOSURES_COLLECTION,
  REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH,
  REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS,
  RealEstateDisclosureConcurrencyConflictError,
  RealEstateDisclosureValidationError,
  type RealEstateDisclosureDocumentProvenance,
  type RealEstateDisclosureTransactionPort,
} from '../src/core/contracts';

interface InstrumentedMemoryStore {
  docs: Map<string, Record<string, any>>;
  writeLog: Array<{ docPath: string; merge: boolean; data: Record<string, any> }>;
  port: RealEstateDisclosureTransactionPort;
}

function createInstrumentedMemoryStore(
  initialDocs: Record<string, Record<string, any>> = {}
): InstrumentedMemoryStore {
  const docs = new Map<string, Record<string, any>>();
  for (const [k, v] of Object.entries(initialDocs)) {
    docs.set(k, structuredClone(v));
  }
  const writeLog: Array<{ docPath: string; merge: boolean; data: Record<string, any> }> = [];

  const port: RealEstateDisclosureTransactionPort = {
    async runTransaction<T>(
      fn: (txCtx: {
        getDocumentByPath(docPath: string): Promise<Record<string, any> | undefined>;
        setDocumentByPath(docPath: string, data: Record<string, any>, merge: boolean): void;
      }) => Promise<T>
    ): Promise<T> {
      const stagedWrites: Array<{ docPath: string; merge: boolean; data: Record<string, any> }> = [];
      let wroteAny = false;

      const txCtx = {
        getDocumentByPath: async (docPath: string) => {
          if (wroteAny) {
            throw new Error('Firestore transaction violation: read after write inside transaction.');
          }
          const found = docs.get(docPath);
          return found ? structuredClone(found) : undefined;
        },
        setDocumentByPath: (docPath: string, data: Record<string, any>, merge: boolean) => {
          wroteAny = true;
          stagedWrites.push({ docPath, merge, data: structuredClone(data) });
        },
      };

      const result = await fn(txCtx);
      // Commit atomically ONLY when fn succeeds without throwing
      for (const w of stagedWrites) {
        if (w.merge && docs.has(w.docPath)) {
          docs.set(w.docPath, { ...docs.get(w.docPath)!, ...w.data });
        } else {
          docs.set(w.docPath, w.data);
        }
        writeLog.push(w);
      }
      return result;
    },
  };

  return { docs, writeLog, port };
}

function makeProvenance(
  overrides: Partial<RealEstateDisclosureDocumentProvenance> = {}
): RealEstateDisclosureDocumentProvenance {
  return {
    importId: 'manual_re_1',
    sourceFile: 'manual_ui',
    sourceSheet: 'real_estate_disclosure',
    schemaVersion: 3,
    updatedBy: 'entry-uid-1',
    updatedAt: '2026-06-01T10:00:00.000Z',
    serverUpdatedAt: { __serverTimestamp: true },
    isDeleted: false,
    ...overrides,
  };
}

function buildCompleteDisclosureInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    disclosureId: 'inv_prop_total',
    ticker: 'tmgh.ca',
    fiscalYear: 2025,
    fiscalQuarter: 'FY',
    balanceSheetDate: '2025-12-31',
    statementScope: 'consolidated',
    assetCategory: 'investment_property',
    assetUsageDescription: 'مراكز تجارية ومبانٍ إدارية مؤجرة للغير\nبعقود طويلة الأجل',
    accountingPolicy: 'cost_model',
    aggregationLevel: 'total_summary',
    parentDisclosureId: null,
    carryingValue: 12_500_000_000,
    disclosedFairValue: 28_000_000_000,
    fairValueDate: '2025-12-31',
    fairValueStatementScope: 'consolidated',
    fairValueAssetScopeMatchesCarrying: true,
    fairValueSource: 'خبير تقييم عقاري معتمد لدى الهيئة العامة للرقابة المالية',
    fairValueSourceType: 'independent_valuer',
    footnoteReference: 'إيضاح رقم (11) — الاستثمارات العقارية',
    explanatoryNote: 'تقييم سنوي وفق القوائم المالية الموحدة المدققة.\nلا يشمل الأراضي قيد التطوير.',
    ...overrides,
  };
}

describe('Real Estate Disclosures — Authoritative Single-Record Server Save & Concurrency', () => {
  it('creates a disclosure record, updates it under valid preconditions, and stamps server metadata cleanly', async () => {
    const store = createInstrumentedMemoryStore({
      'companies/tmgh': { id: 'tmgh', ticker: 'TMGH', nameAr: 'طلعت مصطفى', isDeleted: false },
      'quarterly_financial_records/TMGH_2025_FY': {
        ticker: 'TMGH',
        year: 2025,
        quarter: 'FY',
        periodEndDate: '2025-12-31',
        isDeleted: false,
      },
    });

    const createReceipt = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput(),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance({
        updatedBy: 'entry-uid-1',
        updatedAt: '2026-06-01T10:00:00.000Z',
      }),
    });

    assert.equal(createReceipt.status, 'created');
    assert.equal(createReceipt.collection, REAL_ESTATE_DISCLOSURES_COLLECTION);
    assert.equal(createReceipt.docId, 'TMGH_2025_FY_consolidated_inv_prop_total');
    assert.equal(createReceipt.docPath, 'real_estate_disclosures/TMGH_2025_FY_consolidated_inv_prop_total');
    assert.equal(createReceipt.revision, 1);
    assert.equal(createReceipt.wroteToDatabase, true);
    assert.equal(store.writeLog.length, 1);
    assert.equal(createReceipt.record.ticker, 'TMGH');
    assert.equal(createReceipt.record.linkedQuarterlyDocId, 'TMGH_2025_FY');
    assert.equal(createReceipt.record.completenessStatus, 'complete_comparable');
    assert.equal(createReceipt.statusBreakdown.comparabilityStatus, 'comparable');
    assert.equal(createReceipt.linkage.overallLinkageStatus, 'verified');
    assert.equal(createReceipt.linkage.companyExists, true);
    assert.equal(createReceipt.linkage.quarterlyRecordExists, true);
    assert.deepEqual(createReceipt.linkage.warningsAr, []);
    assert.equal(createReceipt.createdBy, 'entry-uid-1');
    assert.equal(createReceipt.createdAt, '2026-06-01T10:00:00.000Z');
    assert.ok(createReceipt.contentHash.startsWith('mzh1_'));

    // Update under valid revision + hash + expectedDocId preconditions
    const updateReceipt = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({
          disclosedFairValue: 29_400_000_000,
          explanatoryNote: 'تحديث القيمة العادلة بعد مراجعة الملحق التكميلي.',
        }),
        precondition: {
          mode: 'update',
          expectedDocId: createReceipt.docId,
          expectedRevision: createReceipt.revision,
          expectedContentHash: createReceipt.contentHash,
        },
      },
      provenance: makeProvenance({
        updatedBy: 'admin-uid-2',
        updatedAt: '2026-06-02T14:30:00.000Z',
      }),
    });

    assert.equal(updateReceipt.status, 'updated');
    assert.equal(updateReceipt.revision, 2);
    assert.equal(updateReceipt.wroteToDatabase, true);
    assert.equal(store.writeLog.length, 2);
    assert.notEqual(updateReceipt.contentHash, createReceipt.contentHash);
    assert.equal(updateReceipt.record.disclosedFairValue, 29_400_000_000);
    // Audit creation stamps preserved across updates
    assert.equal(updateReceipt.createdBy, 'entry-uid-1');
    assert.equal(updateReceipt.createdAt, '2026-06-01T10:00:00.000Z');
    assert.equal(updateReceipt.updatedBy, 'admin-uid-2');
    assert.equal(updateReceipt.updatedAt, '2026-06-02T14:30:00.000Z');

    const storedDoc = store.docs.get(updateReceipt.docPath);
    assert.equal(storedDoc?.revision, 2);
    assert.equal(storedDoc?.createdBy, 'entry-uid-1');
    assert.equal(storedDoc?.updatedBy, 'admin-uid-2');
    assert.equal(storedDoc?.isDeleted, false);
  });

  it('performs ZERO Firestore writes on unchanged resubmission (both update no-op and idempotent create retry)', async () => {
    const store = createInstrumentedMemoryStore({
      'companies/tmgh': { id: 'tmgh', ticker: 'TMGH', isDeleted: false },
      'quarterly_financial_records/TMGH_2025_FY': {
        ticker: 'TMGH',
        year: 2025,
        quarter: 'FY',
        periodEndDate: '2025-12-31',
        isDeleted: false,
      },
    });

    const first = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput(),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance({
        updatedBy: 'entry-uid-1',
        updatedAt: '2026-06-01T10:00:00.000Z',
      }),
    });
    assert.equal(store.writeLog.length, 1);

    // 1) Idempotent create retry with identical canonical content -> ZERO writes, revision unchanged
    const createRetry = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({ ticker: '  TMGH  ' }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance({
        importId: 'retry_import_2',
        updatedBy: 'entry-uid-1',
        updatedAt: '2026-06-01T10:05:00.000Z',
      }),
    });
    assert.equal(createRetry.status, 'unchanged');
    assert.equal(createRetry.wroteToDatabase, false);
    assert.equal(createRetry.revision, 1);
    assert.equal(createRetry.contentHash, first.contentHash);
    assert.equal(createRetry.updatedAt, '2026-06-01T10:00:00.000Z');
    assert.equal(store.writeLog.length, 1);

    // 2) Update resubmitting identical canonical content under valid preconditions -> ZERO writes
    const updateNoOp = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput(),
        precondition: {
          mode: 'update',
          expectedDocId: first.docId,
          expectedRevision: first.revision,
          expectedContentHash: first.contentHash,
        },
      },
      provenance: makeProvenance({
        importId: 'noop_update_3',
        updatedBy: 'admin-uid-2',
        updatedAt: '2026-06-02T09:00:00.000Z',
      }),
    });
    assert.equal(updateNoOp.status, 'unchanged');
    assert.equal(updateNoOp.wroteToDatabase, false);
    assert.equal(updateNoOp.revision, 1);
    assert.equal(updateNoOp.updatedBy, 'entry-uid-1');
    assert.equal(store.writeLog.length, 1);
  });

  it('rejects stale updates (REVISION_MISMATCH / HASH_MISMATCH), duplicate create with different content (ALREADY_EXISTS), and deleted/missing updates', async () => {
    const store = createInstrumentedMemoryStore();

    const r1 = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({ carryingValue: 100 }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance({ updatedBy: 'u1', updatedAt: '2026-06-01T10:00:00.000Z' }),
    });

    // Duplicate create with DIFFERENT content -> ALREADY_EXISTS (no write!)
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(store.port, {
          rawPayload: {
            record: buildCompleteDisclosureInput({ carryingValue: 200 }),
            precondition: { mode: 'create' },
          },
          provenance: makeProvenance({ updatedBy: 'u2', updatedAt: '2026-06-01T10:01:00.000Z' }),
        }),
      (err: unknown) => {
        assert.ok(err instanceof RealEstateDisclosureConcurrencyConflictError);
        assert.equal(err.conflict.reason, 'ALREADY_EXISTS');
        assert.equal(err.conflict.serverRevision, 1);
        assert.equal(err.conflict.serverContentHash, r1.contentHash);
        return true;
      }
    );
    assert.equal(store.writeLog.length, 1);

    // Advance to revision 2
    const r2 = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({ carryingValue: 150 }),
        precondition: {
          mode: 'update',
          expectedDocId: r1.docId,
          expectedRevision: 1,
          expectedContentHash: r1.contentHash,
        },
      },
      provenance: makeProvenance({ updatedBy: 'u2', updatedAt: '2026-06-01T11:00:00.000Z' }),
    });
    assert.equal(r2.revision, 2);
    assert.equal(store.writeLog.length, 2);

    // Stale update using old revision 1 -> REVISION_MISMATCH (even if payload matches rev 2!)
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(store.port, {
          rawPayload: {
            record: buildCompleteDisclosureInput({ carryingValue: 150 }),
            precondition: {
              mode: 'update',
              expectedDocId: r1.docId,
              expectedRevision: 1,
              expectedContentHash: r1.contentHash,
            },
          },
          provenance: makeProvenance({ updatedBy: 'u1', updatedAt: '2026-06-01T12:00:00.000Z' }),
        }),
      (err: unknown) => {
        assert.ok(err instanceof RealEstateDisclosureConcurrencyConflictError);
        assert.equal(err.conflict.reason, 'REVISION_MISMATCH');
        assert.equal(err.conflict.expectedRevision, 1);
        assert.equal(err.conflict.serverRevision, 2);
        return true;
      }
    );
    assert.equal(store.writeLog.length, 2);

    // Hash mismatch with matching revision -> HASH_MISMATCH
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(store.port, {
          rawPayload: {
            record: buildCompleteDisclosureInput({ carryingValue: 175 }),
            precondition: {
              mode: 'update',
              expectedDocId: r2.docId,
              expectedRevision: 2,
              expectedContentHash: 'mzh1_00000000000000000000000000000000',
            },
          },
          provenance: makeProvenance(),
        }),
      (err: unknown) => {
        assert.ok(err instanceof RealEstateDisclosureConcurrencyConflictError);
        assert.equal(err.conflict.reason, 'HASH_MISMATCH');
        return true;
      }
    );

    // Update targeting non-existent document -> DELETED_ON_SERVER
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(store.port, {
          rawPayload: {
            record: buildCompleteDisclosureInput({ disclosureId: 'does_not_exist' }),
            precondition: {
              mode: 'update',
              expectedDocId: 'TMGH_2025_FY_consolidated_does_not_exist',
              expectedRevision: 1,
            },
          },
          provenance: makeProvenance(),
        }),
      (err: unknown) => {
        assert.ok(err instanceof RealEstateDisclosureConcurrencyConflictError);
        assert.equal(err.conflict.reason, 'DELETED_ON_SERVER');
        return true;
      }
    );

    // Missing or incomplete precondition rejected
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(store.port, {
          rawPayload: { record: buildCompleteDisclosureInput() },
          provenance: makeProvenance(),
        }),
      (err: unknown) =>
        err instanceof RealEstateDisclosureConcurrencyConflictError &&
        err.conflict.reason === 'MISSING_PRECONDITION'
    );
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(store.port, {
          rawPayload: {
            record: buildCompleteDisclosureInput(),
            precondition: { mode: 'update', expectedDocId: r2.docId },
          },
          provenance: makeProvenance(),
        }),
      (err: unknown) =>
        err instanceof RealEstateDisclosureConcurrencyConflictError &&
        err.conflict.reason === 'INCOMPLETE_PRECONDITION'
    );
  });

  it('requires expectedDocId on update (even with expectedRevision/expectedContentHash) and blocks mutating A into B at identical revision without modifying either doc', async () => {
    const store = createInstrumentedMemoryStore();

    // Create two distinct disclosures A and B both at revision 1
    const docA = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({ disclosureId: 'disclosure_A', carryingValue: 1_000 }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance({ updatedBy: 'u1', updatedAt: '2026-06-01T10:00:00.000Z' }),
    });
    const docB = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({ disclosureId: 'disclosure_B', carryingValue: 2_000 }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance({ updatedBy: 'u1', updatedAt: '2026-06-01T10:01:00.000Z' }),
    });
    assert.equal(docA.revision, 1);
    assert.equal(docB.revision, 1);
    assert.equal(store.docs.size, 2);
    assert.equal(store.writeLog.length, 2);

    // 1) Update WITHOUT expectedDocId MUST be rejected even when expectedRevision AND expectedContentHash are supplied
    for (const omitted of [undefined, null, '', '   ']) {
      await assert.rejects(
        () =>
          executeSaveRealEstateDisclosure(store.port, {
            rawPayload: {
              record: buildCompleteDisclosureInput({ disclosureId: 'disclosure_A', carryingValue: 1_111 }),
              precondition: {
                mode: 'update',
                ...(omitted !== undefined ? { expectedDocId: omitted } : {}),
                expectedRevision: docA.revision,
                expectedContentHash: docA.contentHash,
              },
            },
            provenance: makeProvenance(),
          }),
        (err: unknown) => {
          assert.ok(err instanceof RealEstateDisclosureConcurrencyConflictError);
          assert.equal(err.conflict.reason, 'INCOMPLETE_PRECONDITION');
          assert.match(err.message, /expectedDocId/);
          return true;
        }
      );
    }

    // 2) Mutating A's edit so its derived identity points to B (same revision=1!) MUST be rejected
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(store.port, {
          rawPayload: {
            record: buildCompleteDisclosureInput({ disclosureId: 'disclosure_B', carryingValue: 9_999 }),
            precondition: {
              mode: 'update',
              expectedDocId: docA.docId,
              expectedRevision: docA.revision,
              expectedContentHash: docA.contentHash,
            },
          },
          provenance: makeProvenance(),
        }),
      (err: unknown) => {
        assert.ok(err instanceof RealEstateDisclosureConcurrencyConflictError);
        assert.equal(err.conflict.reason, 'IDENTITY_MISMATCH');
        assert.equal(err.conflict.expectedDocId, docA.docId);
        assert.equal(err.conflict.docId, docB.docId);
        return true;
      }
    );

    // 3) Also reject mutating any other identity axis (ticker, fiscalQuarter, statementScope)
    for (const mut of [
      { label: 'ticker', patch: { disclosureId: 'disclosure_A', ticker: 'PHDC' } },
      { label: 'fiscalQuarter', patch: { disclosureId: 'disclosure_A', fiscalQuarter: 'Q3' } },
      { label: 'statementScope', patch: { disclosureId: 'disclosure_A', statementScope: 'standalone' } },
    ]) {
      await assert.rejects(
        () =>
          executeSaveRealEstateDisclosure(store.port, {
            rawPayload: {
              record: buildCompleteDisclosureInput(mut.patch),
              precondition: {
                mode: 'update',
                expectedDocId: docA.docId,
                expectedRevision: docA.revision,
                expectedContentHash: docA.contentHash,
              },
            },
            provenance: makeProvenance(),
          }),
        (err: unknown) => {
          assert.ok(
            err instanceof RealEstateDisclosureConcurrencyConflictError,
            `Expected conflict on ${mut.label}`
          );
          assert.equal(err.conflict.reason, 'IDENTITY_MISMATCH');
          return true;
        }
      );
    }

    // ZERO writes happened on rejection; both A and B are completely untouched
    assert.equal(store.docs.size, 2);
    assert.equal(store.writeLog.length, 2);
    assert.equal(store.docs.get(docA.docPath)?.carryingValue, 1_000);
    assert.equal(store.docs.get(docA.docPath)?.revision, 1);
    assert.equal(store.docs.get(docB.docPath)?.carryingValue, 2_000);
    assert.equal(store.docs.get(docB.docPath)?.revision, 1);

    // 4) Valid update targeting A with matching expectedDocId succeeds (rev 2), while B remains rev 1
    const updatedA = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({ disclosureId: 'disclosure_A', carryingValue: 1_500 }),
        precondition: {
          mode: 'update',
          expectedDocId: docA.docId,
          expectedRevision: docA.revision,
          expectedContentHash: docA.contentHash,
        },
      },
      provenance: makeProvenance({ updatedBy: 'u2', updatedAt: '2026-06-02T10:00:00.000Z' }),
    });
    assert.equal(updatedA.status, 'updated');
    assert.equal(updatedA.revision, 2);
    assert.equal(store.docs.get(docA.docPath)?.carryingValue, 1_500);
    assert.equal(store.docs.get(docB.docPath)?.carryingValue, 2_000);
    assert.equal(store.docs.get(docB.docPath)?.revision, 1);

    // 5) Stale update against A using rev 1 is still rejected with REVISION_MISMATCH
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(store.port, {
          rawPayload: {
            record: buildCompleteDisclosureInput({ disclosureId: 'disclosure_A', carryingValue: 1_750 }),
            precondition: {
              mode: 'update',
              expectedDocId: docA.docId,
              expectedRevision: 1,
              expectedContentHash: docA.contentHash,
            },
          },
          provenance: makeProvenance(),
        }),
      (err: unknown) =>
        err instanceof RealEstateDisclosureConcurrencyConflictError &&
        err.conflict.reason === 'REVISION_MISMATCH'
    );
  });

  it('preserves 0 distinctly from null, preserves full Arabic/multiline texts, ignores forged derived fields, and saves partial records without complete_comparable', async () => {
    const store = createInstrumentedMemoryStore();

    const fullArabicUsage = 'أراضٍ فضاء ومبانٍ تجارية مؤجرة\nالطابق الأرضي والأول — القاهرة الجديدة';
    const fullNote = 'السطر الأول: قيمة دفترية صفرية بعد الإهلاك الكامل.\nالسطر الثاني: لم يُفصح عن قيمة عادلة لهذا البند.';

    const receipt = await executeSaveRealEstateDisclosure(store.port, {
      rawPayload: {
        record: {
          disclosureId: 'zero_carrying_partial',
          ticker: 'ORHD',
          fiscalYear: 2025,
          fiscalQuarter: 'Q3',
          balanceSheetDate: '2025-09-30',
          statementScope: 'consolidated',
          assetCategory: 'investment_property',
          assetUsageDescription: fullArabicUsage,
          accountingPolicy: 'cost_model',
          aggregationLevel: 'standalone_item',
          parentDisclosureId: null,
          carryingValue: 0,
          disclosedFairValue: null,
          fairValueDate: null,
          fairValueStatementScope: null,
          fairValueAssetScopeMatchesCarrying: null,
          fairValueSource: null,
          fairValueSourceType: 'unspecified',
          footnoteReference: 'إيضاح 9 — استثمارات عقارية',
          explanatoryNote: fullNote,
          // Forged client-supplied derived/audit fields that MUST be ignored by server:
          linkedQuarterlyDocId: 'FAKE_1999_Q1',
          completenessStatus: 'complete_comparable',
          revision: 999,
          contentHash: 'mzh1_forged',
          createdBy: 'forged-user',
          updatedBy: 'forged-user',
          isDeleted: true,
        },
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance({ updatedBy: 'real-entry-uid' }),
    });

    assert.equal(receipt.status, 'created');
    assert.equal(receipt.revision, 1);
    assert.equal(receipt.createdBy, 'real-entry-uid');
    assert.equal(receipt.updatedBy, 'real-entry-uid');
    assert.equal(receipt.record.carryingValue, 0);
    assert.equal(receipt.record.disclosedFairValue, null);
    assert.equal(receipt.record.assetUsageDescription, fullArabicUsage);
    assert.equal(receipt.record.explanatoryNote, fullNote);
    // Server-derived linkage and completeness override forged client fields:
    assert.equal(receipt.record.linkedQuarterlyDocId, 'ORHD_2025_Q3');
    assert.equal(receipt.record.completenessStatus, 'partial_missing_fair_value');
    assert.notEqual(receipt.record.completenessStatus, 'complete_comparable');
    assert.equal(receipt.statusBreakdown.comparabilityStatus, 'blocked');
    assert.equal(receipt.statusBreakdown.comparabilityBlocked, true);

    const persisted = store.docs.get(receipt.docPath);
    assert.equal(persisted?.isDeleted, false);
    assert.equal(persisted?.revision, 1);
    assert.equal(persisted?.carryingValue, 0);
    assert.equal(persisted?.disclosedFairValue, null);
    assert.equal(persisted?.completenessStatus, 'partial_missing_fair_value');
  });

  it('rejects over-limit texts without silent truncation, invalid enums, and invalid IDs (>80 chars, whitespace, path tokens)', async () => {
    const store = createInstrumentedMemoryStore();

    // Over-limit text in each of the 4 free-text fields
    for (const [field, limit] of Object.entries(REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS)) {
      await assert.rejects(
        () =>
          executeSaveRealEstateDisclosure(store.port, {
            rawPayload: {
              record: buildCompleteDisclosureInput({ [field]: 'أ'.repeat(limit + 1) }),
              precondition: { mode: 'create' },
            },
            provenance: makeProvenance(),
          }),
        (err: unknown) => {
          assert.ok(err instanceof RealEstateDisclosureValidationError);
          assert.match(err.message, new RegExp(String(limit)));
          assert.match(err.message, new RegExp(String(limit + 1)));
          return true;
        }
      );
    }

    // Unrecognized enum
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(store.port, {
          rawPayload: {
            record: buildCompleteDisclosureInput({ assetCategory: 'ias40_assumed' }),
            precondition: { mode: 'create' },
          },
          provenance: makeProvenance(),
        }),
      RealEstateDisclosureValidationError
    );

    // Invalid IDs (> 80 chars, spaces, slash)
    for (const badId of ['a'.repeat(REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH + 1), 'inv prop', 'inv/prop', 'inv..prop']) {
      await assert.rejects(
        () =>
          executeSaveRealEstateDisclosure(store.port, {
            rawPayload: {
              record: buildCompleteDisclosureInput({ disclosureId: badId }),
              precondition: { mode: 'create' },
            },
            provenance: makeProvenance(),
          }),
        RealEstateDisclosureValidationError
      );
    }

    assert.equal(store.writeLog.length, 0);
    assert.equal(store.docs.size, 0);
  });

  it('honestly separates document existence from identity validity/conflicts across companies & quarterly_financial_records, supports documented non-calendar FY, and never auto-creates or mutates reference docs', async () => {
    // Case A: Both company and quarterly_financial_records missing -> never auto-created
    const storeMissing = createInstrumentedMemoryStore();
    const resMissing = await executeSaveRealEstateDisclosure(storeMissing.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput(),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(resMissing.linkage.hasLogicalQuarterlyReference, true);
    assert.equal(resMissing.linkage.logicalQuarterlyDocId, 'TMGH_2025_FY');
    assert.equal(resMissing.linkage.companyExists, false);
    assert.equal(resMissing.linkage.companyLinkStatus, 'missing_company');
    assert.equal(resMissing.linkage.quarterlyRecordExists, false);
    assert.equal(resMissing.linkage.quarterlyLinkStatus, 'missing_quarterly_record');
    assert.equal(resMissing.linkage.overallLinkageStatus, 'missing_reference');
    assert.equal(resMissing.linkage.warningsAr.length, 2);
    assert.equal(storeMissing.docs.has('companies/tmgh'), false);
    assert.equal(storeMissing.docs.has(`${QUARTERLY_FINANCIAL_RECORDS_COLLECTION}/TMGH_2025_FY`), false);
    assert.equal(storeMissing.docs.size, 1);

    // Case B: Existing company & quarterly docs with INVALID ticker -> unverified (NEVER verified)
    const storeInvalidTicker = createInstrumentedMemoryStore({
      'companies/tmgh': { id: 'tmgh', ticker: '@@@BAD_TICKER@@@', isDeleted: false },
      'quarterly_financial_records/TMGH_2025_FY': {
        ticker: '!!!BAD!!!',
        year: 2025,
        quarter: 'FY',
        periodEndDate: '2025-12-31',
        isDeleted: false,
      },
    });
    const resInvalidTicker = await executeSaveRealEstateDisclosure(storeInvalidTicker.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput(),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(resInvalidTicker.linkage.companyExists, true);
    assert.equal(resInvalidTicker.linkage.companyLinkStatus, 'unverified_company_identity');
    assert.equal(resInvalidTicker.linkage.quarterlyRecordExists, true);
    assert.equal(resInvalidTicker.linkage.quarterlyLinkStatus, 'unverified_quarterly_identity');
    assert.equal(resInvalidTicker.linkage.overallLinkageStatus, 'partial_unverified');
    assert.notEqual(resInvalidTicker.linkage.overallLinkageStatus, 'verified');

    // Case C: Existing company & quarterly docs with MISSING identity fields -> unverified (NEVER verified)
    const storeMissingIdentity = createInstrumentedMemoryStore({
      'companies/tmgh': { id: 'tmgh', nameAr: 'بدون رمز', isDeleted: false },
      'quarterly_financial_records/TMGH_2025_FY': {
        periodEndDate: '2025-12-31',
        isDeleted: false,
      },
    });
    const resMissingIdentity = await executeSaveRealEstateDisclosure(storeMissingIdentity.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput(),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(resMissingIdentity.linkage.companyExists, true);
    assert.equal(resMissingIdentity.linkage.companyLinkStatus, 'unverified_company_identity');
    assert.equal(resMissingIdentity.linkage.quarterlyRecordExists, true);
    assert.equal(resMissingIdentity.linkage.quarterlyLinkStatus, 'unverified_quarterly_identity');
    assert.equal(resMissingIdentity.linkage.overallLinkageStatus, 'partial_unverified');
    // Verify reference documents were NOT mutated
    assert.equal(storeMissingIdentity.docs.get('companies/tmgh')?.ticker, undefined);
    assert.equal(
      storeMissingIdentity.docs.get('quarterly_financial_records/TMGH_2025_FY')?.ticker,
      undefined
    );

    // Case D: Conflicting year in quarterly_financial_records -> period_conflict + overall conflict
    const storeYearConflict = createInstrumentedMemoryStore({
      'companies/tmgh': { id: 'tmgh', ticker: 'TMGH', isDeleted: false },
      'quarterly_financial_records/TMGH_2025_FY': {
        ticker: 'TMGH',
        year: 2024,
        quarter: 'FY',
        periodEndDate: '2025-12-31',
        isDeleted: false,
      },
    });
    const resYearConflict = await executeSaveRealEstateDisclosure(storeYearConflict.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({ fiscalYear: 2025, fiscalQuarter: 'FY' }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(resYearConflict.linkage.quarterlyLinkStatus, 'period_conflict');
    assert.equal(resYearConflict.linkage.quarterlyYear, 2024);
    assert.equal(resYearConflict.linkage.overallLinkageStatus, 'conflict');

    // Case E: Conflicting quarter in quarterly_financial_records -> period_conflict + overall conflict
    const storeQuarterConflict = createInstrumentedMemoryStore({
      'companies/tmgh': { id: 'tmgh', ticker: 'TMGH', isDeleted: false },
      'quarterly_financial_records/TMGH_2025_FY': {
        ticker: 'TMGH',
        year: 2025,
        quarter: 'Q3',
        periodEndDate: '2025-12-31',
        isDeleted: false,
      },
    });
    const resQuarterConflict = await executeSaveRealEstateDisclosure(storeQuarterConflict.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({ fiscalYear: 2025, fiscalQuarter: 'FY' }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(resQuarterConflict.linkage.quarterlyLinkStatus, 'period_conflict');
    assert.equal(resQuarterConflict.linkage.quarterlyQuarter, 'Q3');
    assert.equal(resQuarterConflict.linkage.overallLinkageStatus, 'conflict');

    // Case F: Conflicting ticker on company doc -> company_ticker_conflict + overall conflict
    const storeCompanyTickerConflict = createInstrumentedMemoryStore({
      'companies/tmgh': { id: 'tmgh', ticker: 'PHDC', isDeleted: false },
      'quarterly_financial_records/TMGH_2025_FY': {
        ticker: 'TMGH',
        year: 2025,
        quarter: 'FY',
        periodEndDate: '2025-12-31',
        isDeleted: false,
      },
    });
    const resCompanyConflict = await executeSaveRealEstateDisclosure(storeCompanyTickerConflict.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput(),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(resCompanyConflict.linkage.companyLinkStatus, 'company_ticker_conflict');
    assert.equal(resCompanyConflict.linkage.overallLinkageStatus, 'conflict');

    // Case G: Date conflict (balanceSheetDate !== periodEndDate) -> date_conflict
    const storeConflict = createInstrumentedMemoryStore({
      'companies/tmgh': { id: 'tmgh', ticker: 'TMGH', isDeleted: false },
      'quarterly_financial_records/TMGH_2025_FY': {
        ticker: 'TMGH',
        year: 2025,
        quarter: 'FY',
        periodEndDate: '2025-06-30',
        isDeleted: false,
      },
    });
    const resConflict = await executeSaveRealEstateDisclosure(storeConflict.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({ balanceSheetDate: '2025-12-31' }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(resConflict.linkage.companyLinkStatus, 'verified');
    assert.equal(resConflict.linkage.quarterlyRecordExists, true);
    assert.equal(resConflict.linkage.quarterlyLinkStatus, 'date_conflict');
    assert.equal(resConflict.linkage.quarterlyPeriodEndDate, '2025-06-30');
    assert.equal(resConflict.linkage.disclosureBalanceSheetDate, '2025-12-31');
    assert.equal(resConflict.linkage.overallLinkageStatus, 'conflict');
    assert.ok(resConflict.linkage.warningsAr.some((w) => w.includes('2025-12-31') && w.includes('2025-06-30')));

    // Case H: Documented non-calendar fiscal year (July–June, FY ending 2025-06-30) -> verified!
    const storeNonCalendar = createInstrumentedMemoryStore({
      'companies/east': { id: 'east', ticker: 'EAST', isDeleted: false },
      'quarterly_financial_records/EAST_2025_FY': {
        ticker: 'EAST',
        year: 2025,
        quarter: 'FY',
        periodStartDate: '2024-07-01',
        periodEndDate: '2025-06-30',
        isDeleted: false,
      },
    });
    const resNonCalendar = await executeSaveRealEstateDisclosure(storeNonCalendar.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({
          ticker: 'EAST',
          fiscalYear: 2025,
          fiscalQuarter: 'FY',
          balanceSheetDate: '2025-06-30',
          fairValueDate: '2025-06-30',
        }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(resNonCalendar.linkage.companyLinkStatus, 'verified');
    assert.equal(resNonCalendar.linkage.quarterlyLinkStatus, 'verified');
    assert.equal(resNonCalendar.linkage.overallLinkageStatus, 'verified');
    assert.deepEqual(resNonCalendar.linkage.warningsAr, []);

    // Case I: Quarterly doc exists without periodEndDate -> no assumed fiscal year end
    const storeNoEndDate = createInstrumentedMemoryStore({
      'companies/tmgh': { id: 'tmgh', ticker: 'TMGH', isDeleted: false },
      'quarterly_financial_records/TMGH_2025_FY': {
        ticker: 'TMGH',
        year: 2025,
        quarter: 'FY',
        isDeleted: false,
      },
    });
    const resNoEndDate = await executeSaveRealEstateDisclosure(storeNoEndDate.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput(),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(resNoEndDate.linkage.quarterlyLinkStatus, 'verified_without_period_end_date');
    assert.equal(resNoEndDate.linkage.overallLinkageStatus, 'partial_unverified');

    // Case J: Standalone balanceSheetDate without fiscalYear/fiscalQuarter -> not_linked_period
    const storeDateOnly = createInstrumentedMemoryStore({
      'companies/tmgh': { id: 'tmgh', ticker: 'TMGH', isDeleted: false },
    });
    const resDateOnly = await executeSaveRealEstateDisclosure(storeDateOnly.port, {
      rawPayload: {
        record: buildCompleteDisclosureInput({
          fiscalYear: null,
          fiscalQuarter: null,
          balanceSheetDate: '2025-06-30',
          fairValueDate: '2025-06-30',
        }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(resDateOnly.docId, 'TMGH_2025-06-30_consolidated_inv_prop_total');
    assert.equal(resDateOnly.linkage.hasLogicalQuarterlyReference, false);
    assert.equal(resDateOnly.linkage.quarterlyLinkStatus, 'not_linked_period');
    assert.equal(resDateOnly.linkage.overallLinkageStatus, 'partial_unverified');
  });

  it('computes deterministic business hash sensitive to substantive fields and invariant to volatile metadata', () => {
    const base = {
      disclosureId: 'd1',
      ticker: 'TMGH',
      fiscalYear: 2025,
      fiscalQuarter: 'FY' as const,
      linkedQuarterlyDocId: 'TMGH_2025_FY',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated' as const,
      assetCategory: 'investment_property' as const,
      assetUsageDescription: 'مكاتب مؤجرة',
      accountingPolicy: 'cost_model' as const,
      aggregationLevel: 'standalone_item' as const,
      parentDisclosureId: null,
      carryingValue: 0,
      disclosedFairValue: null,
      fairValueDate: null,
      fairValueStatementScope: null,
      fairValueAssetScopeMatchesCarrying: null,
      fairValueSource: null,
      fairValueSourceType: 'unspecified' as const,
      footnoteReference: 'إيضاح 11',
      explanatoryNote: null,
      completenessStatus: 'partial_missing_fair_value' as const,
    };

    const h1 = computeRecordBusinessHash('real_estate_disclosure', {
      ...base,
      revision: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'user-a',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user-a',
      contentHash: 'mzh1_old',
    });
    const h2 = computeRecordBusinessHash('real_estate_disclosure', {
      ...base,
      revision: 5,
      updatedAt: '2026-06-01T00:00:00.000Z',
      updatedBy: 'user-b',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'user-a',
      importId: 'other',
      isDeleted: false,
    });
    assert.equal(h1, h2);

    // 0 vs null must produce distinct hashes
    const hNullCarrying = computeRecordBusinessHash('real_estate_disclosure', {
      ...base,
      carryingValue: null,
    });
    assert.notEqual(h1, hNullCarrying);

    // false vs null on fairValueAssetScopeMatchesCarrying must produce distinct hashes
    const hFalseScope = computeRecordBusinessHash('real_estate_disclosure', {
      ...base,
      fairValueAssetScopeMatchesCarrying: false,
    });
    assert.notEqual(h1, hFalseScope);
  });
});
