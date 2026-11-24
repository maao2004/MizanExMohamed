import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { computeRecordBusinessHash } from '../src/core/contracts';
import {
  CLEANUP_BACKUP_SCHEMA,
  verifyPostApplyDpsCleanup,
  type LegacyDpsBackupEntry,
} from '../src/core/domain/legacyDpsCleanup';
import {
  buildFirestoreUpdateForPlan,
  parseCleanupCliArgs,
  runLegacyDpsCleanup,
  runLegacyDpsRestore,
  type CleanupBackupFile,
  type CleanupCheckpointState,
  type FirestoreDbLike,
  type FirestoreDocRefLike,
  type FirestoreDocSnapshotLike,
  type FirestoreSentinels,
  type FirestoreTransactionLike,
} from '../scripts/cleanupLegacyDpsCurrent';

const DELETE_SENTINEL = { __op: 'DELETE_FIELD' } as const;
const SERVER_TS_SENTINEL = { __op: 'SERVER_TIMESTAMP' } as const;
const DOC_ID_SENTINEL = '__documentId__' as const;

interface StoredDoc {
  data: Record<string, any>;
  updateTimeMs: number;
}

function createMockFirestore(): {
  store: Map<string, Map<string, StoredDoc>>;
  db: FirestoreDbLike;
  sentinels: FirestoreSentinels;
  conflictTriggerDocIds: Set<string>;
} {
  const store = new Map<string, Map<string, StoredDoc>>([
    ['quarterly_financial_records', new Map()],
    ['financials', new Map()],
    ['daily_trading_records', new Map()],
    ['companies', new Map()],
  ]);
  const conflictTriggerDocIds = new Set<string>();

  const sentinels: FirestoreSentinels = {
    documentId: DOC_ID_SENTINEL,
    deleteField: () => DELETE_SENTINEL,
    serverTimestamp: () => SERVER_TS_SENTINEL,
  };

  const deepClone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

  const makeRef = (colName: string, docId: string): FirestoreDocRefLike => ({
    id: docId,
    async get() {
      const col = store.get(colName);
      const entry = col?.get(docId);
      const snapUpdateTimeMs = entry ? entry.updateTimeMs : 0;
      return {
        id: docId,
        exists: Boolean(entry),
        updateTime: entry ? { toDate: () => new Date(snapUpdateTimeMs) } : null,
        data: () => (entry ? deepClone(entry.data) : undefined),
        ref: makeRef(colName, docId),
      };
    },
    async update(dataPatch, precondition) {
      const col = store.get(colName);
      const entry = col?.get(docId);
      if (!entry) {
        const err: any = new Error(`Document not found: ${colName}/${docId}`);
        err.code = 5;
        throw err;
      }
      if (conflictTriggerDocIds.has(docId)) {
        entry.updateTimeMs += 5000;
        conflictTriggerDocIds.delete(docId);
      }
      if (precondition?.lastUpdateTime) {
        const expectedMs = (precondition.lastUpdateTime as { toDate(): Date }).toDate().getTime();
        if (expectedMs !== entry.updateTimeMs) {
          const err: any = new Error(`FAILED_PRECONDITION: updateTime mismatch for ${colName}/${docId}`);
          err.code = 9;
          throw err;
        }
      }

      const nextData = deepClone(entry.data);
      for (const [k, v] of Object.entries(dataPatch)) {
        if (v === DELETE_SENTINEL) {
          if (k.includes('.')) {
            const [parentKey, childKey] = k.split('.');
            if (nextData[parentKey] && typeof nextData[parentKey] === 'object') {
              delete nextData[parentKey][childKey];
            }
          } else {
            delete nextData[k];
          }
        } else if (v === SERVER_TS_SENTINEL) {
          nextData[k] = '2026-04-01T12:00:00.000Z';
        } else {
          nextData[k] = v;
        }
      }
      entry.data = nextData;
      entry.updateTimeMs += 1000;
    },
    async set(patchData, options) {
      let col = store.get(colName);
      if (!col) {
        col = new Map();
        store.set(colName, col);
      }
      const existing = col.get(docId);
      if (!options?.merge || !existing) {
        const cleanPatch = deepClone(patchData);
        if (cleanPatch.serverUpdatedAt === SERVER_TS_SENTINEL) {
          cleanPatch.serverUpdatedAt = '2026-04-01T12:00:00.000Z';
        }
        col.set(docId, { data: cleanPatch, updateTimeMs: Date.now() });
        return;
      }
      const merged = deepClone(existing.data);
      for (const [k, v] of Object.entries(patchData)) {
        if (v === SERVER_TS_SENTINEL) {
          merged[k] = '2026-04-01T12:00:00.000Z';
        } else if (
          k === 'extendedFields' &&
          v &&
          typeof v === 'object' &&
          !Array.isArray(v)
        ) {
          merged.extendedFields = { ...(merged.extendedFields ?? {}), ...v };
        } else {
          merged[k] = v;
        }
      }
      existing.data = merged;
      existing.updateTimeMs += 1000;
    },
  });

  const db: FirestoreDbLike = {
    collection(name: string) {
      let cursor: string | null = null;
      let maxLimit = 500;
      const queryObj = {
        orderBy(field: unknown) {
          assert.equal(field, DOC_ID_SENTINEL);
          return queryObj;
        },
        startAfter(c: unknown) {
          cursor = String(c);
          return queryObj;
        },
        limit(n: number) {
          maxLimit = n;
          return queryObj;
        },
        async get() {
          const col = store.get(name) ?? new Map<string, StoredDoc>();
          const sortedIds = Array.from(col.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          const filteredIds = cursor ? sortedIds.filter((id) => id > cursor!) : sortedIds;
          const sliceIds = filteredIds.slice(0, maxLimit);
          const docs: FirestoreDocSnapshotLike[] = sliceIds.map((docId) => {
            const entry = col.get(docId)!;
            const snapUpdateTimeMs = entry.updateTimeMs;
            return {
              id: docId,
              exists: true,
              updateTime: { toDate: () => new Date(snapUpdateTimeMs) },
              data: () => deepClone(entry.data),
              ref: makeRef(name, docId),
            };
          });
          return { docs };
        },
        doc(id: string) {
          return makeRef(name, id);
        },
      };
      return queryObj;
    },
    async runTransaction<T>(fn: (tx: FirestoreTransactionLike) => Promise<T>): Promise<T> {
      const tx: FirestoreTransactionLike = {
        get: (r) => r.get(),
        set: (r, d, o) => r.set(d, o),
        update: (r, d, p) => r.update(d, p),
      };
      return fn(tx);
    },
  };

  return { store, db, sentinels, conflictTriggerDocIds };
}

describe('Scoped Legacy DPS_Current Cleanup CLI Tool & Restore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mizan-cleanup-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('CLI parser enforces explicit --project and validates mutually exclusive flags', () => {
    assert.throws(() => parseCleanupCliArgs(['--dry-run']), /--project/);
    assert.throws(
      () => parseCleanupCliArgs(['--project', 'p1', '--apply', '--dry-run']),
      /--apply.*--dry-run/
    );
    assert.throws(
      () => parseCleanupCliArgs(['--project', 'p1', '--apply', '--restore', 'b.json']),
      /--apply.*--restore/
    );

    const parsed = parseCleanupCliArgs([
      '--project', 'mizan-test',
      '--database', 'mizan-db',
      '--batch-size', '50',
      '--resume-after', 'quarterly_financial_records:COMI_2025_FY',
    ]);
    assert.equal(parsed.mode, 'dry-run');
    assert.equal(parsed.projectId, 'mizan-test');
    assert.equal(parsed.databaseId, 'mizan-db');
    assert.equal(parsed.batchSize, 50);
    assert.equal(parsed.resumeAfter.quarterly_financial_records, 'COMI_2025_FY');
  });

  it('Dry-run, Apply, sibling extendedFields preservation, contentHash recomputation, Idempotency & Backup/Restore', async () => {
    const { store, db, sentinels } = createMockFirestore();

    const baseQuarterly = {
      ticker: 'COMI',
      stockName: 'CIB',
      yearQuarter: '2025FY',
      year: 2025,
      quarter: 'FY',
      shares: 100_000_000,
      revenueYTD: 1_000_000_000,
      netIncomeYTD: 250_000_000,
      ocfYTD: 300_000_000,
      capexYTD: 50_000_000,
      totalAssets: 5_000_000_000,
      totalDebtWithoutTX: 200_000_000,
      equity: 2_000_000_000,
      cash: 400_000_000,
      dateInsertData: '2026-03-01',
    };

    const legacyHash = computeRecordBusinessHash('quarterly', {
      ...baseQuarterly,
      dpsCurrent: 1.5,
      extendedFields: { dpsCurrent: 1.5, CustomKPI: 777 },
    });

    store.get('quarterly_financial_records')!.set('COMI_2025_FY', {
      updateTimeMs: 1_700_000_000_000,
      data: {
        ...baseQuarterly,
        dpsCurrent: 1.5,
        DPS_Current: 1.5,
        extendedFields: {
          dpsCurrent: 1.5,
          DPS_Current: 2.0,
          CustomKPI: 777,
        },
        contentHash: legacyHash,
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    });
    store.get('quarterly_financial_records')!.set('ABUK_2025_FY', {
      updateTimeMs: 1_700_000_000_000,
      data: {
        ...baseQuarterly,
        ticker: 'ABUK',
        stockName: 'Abukir',
        contentHash: computeRecordBusinessHash('quarterly', { ...baseQuarterly, ticker: 'ABUK', stockName: 'Abukir' }),
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    });
    store.get('financials')!.set('comi_2025_fy', {
      updateTimeMs: 1_700_000_000_000,
      data: {
        id: 'comi_2025_fy',
        companyId: 'comi',
        year: 2025,
        quarter: 'FY',
        dpsCurrent: 1.5,
        netProfitYTD: 250_000_000,
      },
    });
    // Other collections must NEVER be touched
    store.get('companies')!.set('comi', {
      updateTimeMs: 1_700_000_000_000,
      data: { id: 'comi', ticker: 'COMI', dpsCurrent: 999 },
    });

    // 1) DRY-RUN scans and reports without mutating anything
    const dryOpts = parseCleanupCliArgs(['--project', 'mizan-test', '--dry-run', '--batch-size', '1']);
    const dryRes = await runLegacyDpsCleanup({ db, sentinels, options: dryOpts });
    assert.equal(dryRes.report.mode, 'dry-run');
    assert.equal(dryRes.report.scannedDocsByCollection.quarterly_financial_records, 2);
    assert.equal(dryRes.report.matchedDocsByCollection.quarterly_financial_records, 1);
    assert.equal(dryRes.report.matchedDocsByCollection.financials, 1);
    assert.equal(dryRes.report.updatedDocsByCollection.quarterly_financial_records, 0);
    assert.equal(dryRes.report.deletedBusinessFieldCount, 5); // 4 in COMI_2025_FY + 1 in comi_2025_fy
    assert.equal(dryRes.report.metadataUpdatedCount, 0);
    assert.equal(
      store.get('quarterly_financial_records')!.get('COMI_2025_FY')!.data.dpsCurrent,
      1.5
    );

    // 2) APPLY creates backup JSON, deletes exact 4 paths, preserves CustomKPI, recomputes contentHash, skips clean doc
    const backupPath = path.join(tmpDir, 'backup.json');
    const reportPath = path.join(tmpDir, 'report.json');
    const applyOpts = parseCleanupCliArgs([
      '--project', 'mizan-test',
      '--apply',
      '--backup', backupPath,
      '--report', reportPath,
      '--batch-size', '1',
    ]);
    const applyRes = await runLegacyDpsCleanup({
      db,
      sentinels,
      options: applyOpts,
      nowIso: () => '2026-04-01T12:00:00.000Z',
    });

    assert.equal(applyRes.report.updatedDocsByCollection.quarterly_financial_records, 1);
    assert.equal(applyRes.report.updatedDocsByCollection.financials, 1);
    assert.equal(applyRes.report.skippedAlreadyCleanDocsByCollection.quarterly_financial_records, 1);
    assert.equal(applyRes.report.deletedBusinessFieldCount, 5);
    assert.equal(applyRes.report.metadataUpdatedCount, 5); // 3 (updatedAt, serverUpdatedAt, contentHash) on quarterly + 2 on financials
    assert.equal(applyRes.report.errors.length, 0);

    assert.ok(fs.existsSync(backupPath));
    assert.ok(fs.existsSync(reportPath));

    const cleanedQuarterly = store.get('quarterly_financial_records')!.get('COMI_2025_FY')!.data;
    assert.equal('dpsCurrent' in cleanedQuarterly, false);
    assert.equal('DPS_Current' in cleanedQuarterly, false);
    assert.equal('dpsCurrent' in (cleanedQuarterly.extendedFields ?? {}), false);
    assert.equal('DPS_Current' in (cleanedQuarterly.extendedFields ?? {}), false);
    assert.equal(cleanedQuarterly.extendedFields?.CustomKPI, 777);

    // Recomputed contentHash MUST match fresh clean import hash!
    const expectedCleanHash = computeRecordBusinessHash('quarterly', {
      ...baseQuarterly,
      extendedFields: { CustomKPI: 777 },
    });
    assert.equal(cleanedQuarterly.contentHash, expectedCleanHash);

    // Other collections stay untouched
    assert.equal(store.get('companies')!.get('comi')!.data.dpsCurrent, 999);

    // 3) Repeat APPLY is strictly idempotent (zero updates!)
    const repeatRes = await runLegacyDpsCleanup({ db, sentinels, options: applyOpts });
    assert.equal(repeatRes.report.updatedDocsByCollection.quarterly_financial_records, 0);
    assert.equal(repeatRes.report.updatedDocsByCollection.financials, 0);
    assert.equal(repeatRes.report.skippedAlreadyCleanDocsByCollection.quarterly_financial_records, 2);

    // 4) RESTORE brings back exact removed fields without overwriting sibling CustomKPI, and repeat RESTORE is idempotent
    const restoreOpts = parseCleanupCliArgs([
      '--project', 'mizan-test',
      '--restore', backupPath,
    ]);
    const restoreRes = await runLegacyDpsRestore({
      db,
      sentinels,
      options: restoreOpts,
      nowIso: () => '2026-04-02T00:00:00.000Z',
    });
    assert.equal(restoreRes.updatedDocsByCollection.quarterly_financial_records, 1);
    assert.equal(restoreRes.updatedDocsByCollection.financials, 1);

    const restoredQ = store.get('quarterly_financial_records')!.get('COMI_2025_FY')!.data;
    assert.equal(restoredQ.dpsCurrent, 1.5);
    assert.equal(restoredQ.DPS_Current, 1.5);
    assert.equal(restoredQ.extendedFields?.dpsCurrent, 1.5);
    assert.equal(restoredQ.extendedFields?.DPS_Current, 2.0);
    assert.equal(restoredQ.extendedFields?.CustomKPI, 777);
    assert.equal(restoredQ.contentHash, legacyHash);

    const restoreRepeat = await runLegacyDpsRestore({ db, sentinels, options: restoreOpts });
    assert.equal(restoreRepeat.updatedDocsByCollection.quarterly_financial_records, 0);
    assert.equal(restoreRepeat.skippedAlreadyCleanDocsByCollection.quarterly_financial_records, 1);
  });

  it('Aborts safely on updateTime precondition mismatch and supports checkpoint / resume-after pagination', async () => {
    const { store, db, sentinels, conflictTriggerDocIds } = createMockFirestore();

    for (const tk of ['A_DOC', 'B_DOC', 'C_DOC']) {
      store.get('financials')!.set(tk, {
        updateTimeMs: 1_700_000_000_000,
        data: { id: tk, dpsCurrent: 2.5 },
      });
    }

    // Trigger precondition mismatch on B_DOC during update
    conflictTriggerDocIds.add('B_DOC');

    const checkpointPath = path.join(tmpDir, 'ckpt.json');
    const opts = parseCleanupCliArgs([
      '--project', 'mizan-test',
      '--apply',
      '--batch-size', '2',
      '--checkpoint', checkpointPath,
      '--backup', path.join(tmpDir, 'b2.json'),
    ]);

    const res1 = await runLegacyDpsCleanup({ db, sentinels, options: opts });
    assert.equal(res1.report.updatedDocsByCollection.financials, 2); // A_DOC & C_DOC updated
    assert.equal(res1.report.abortedPreconditionDocsByCollection.financials, 1); // B_DOC aborted cleanly
    assert.equal(store.get('financials')!.get('B_DOC')!.data.dpsCurrent, 2.5); // unchanged due to abort

    // Test explicit --resume-after financials:A_DOC skips A_DOC and scans only B_DOC and C_DOC
    const resumeOpts = parseCleanupCliArgs([
      '--project', 'mizan-test',
      '--apply',
      '--batch-size', '2',
      '--resume-after', 'financials:A_DOC',
      '--backup', path.join(tmpDir, 'b3.json'),
    ]);
    const resResume = await runLegacyDpsCleanup({ db, sentinels, options: resumeOpts });
    assert.equal(resResume.report.scannedDocsByCollection.financials, 2); // B_DOC & C_DOC
    assert.equal(resResume.report.updatedDocsByCollection.financials, 1); // B_DOC now succeeds!
    assert.equal(resResume.report.skippedAlreadyCleanDocsByCollection.financials, 1); // C_DOC already clean
    assert.equal('dpsCurrent' in store.get('financials')!.get('B_DOC')!.data, false);
  });

  it('Isolates dry-run checkpoints from apply, persists/retries failedDocs, and enforces backupPath binding', async () => {
    const { store, db, sentinels, conflictTriggerDocIds } = createMockFirestore();

    for (const tk of ['A_DOC', 'B_DOC']) {
      store.get('financials')!.set(tk, {
        updateTimeMs: 1_700_000_000_000,
        data: { id: tk, dpsCurrent: 3.1 },
      });
    }

    const checkpointPath = path.join(tmpDir, 'shared-ckpt.json');
    const backupPath = path.join(tmpDir, 'bound-backup.json');

    // 1) Dry-run completes and writes checkpoint with mode='dry-run'
    const dryOpts = parseCleanupCliArgs([
      '--project', 'mizan-test',
      '--database', 'egypt-prod',
      '--dry-run',
      '--checkpoint', checkpointPath,
    ]);
    const dryRes = await runLegacyDpsCleanup({ db, sentinels, options: dryOpts });
    assert.equal(dryRes.report.completed, true);
    assert.equal(dryRes.report.scannedDocsByCollection.financials, 2);

    // 2) Subsequent apply with SAME checkpoint path MUST NOT skip docs already scanned in dry-run!
    conflictTriggerDocIds.add('B_DOC');
    const applyOpts = parseCleanupCliArgs([
      '--project', 'mizan-test',
      '--database', 'egypt-prod',
      '--apply',
      '--checkpoint', checkpointPath,
      '--backup', backupPath,
    ]);
    const applyRun1 = await runLegacyDpsCleanup({ db, sentinels, options: applyOpts });
    assert.equal(applyRun1.report.scannedDocsByCollection.financials, 2);
    assert.equal(applyRun1.report.updatedDocsByCollection.financials, 1); // A_DOC
    assert.equal(applyRun1.report.abortedPreconditionDocsByCollection.financials, 1); // B_DOC
    assert.equal(applyRun1.report.completed, false);
    assert.equal(applyRun1.report.failedDocsCount, 1);

    const savedCkpt = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as CleanupCheckpointState;
    assert.equal(savedCkpt.mode, 'apply');
    assert.equal(savedCkpt.databaseId, 'egypt-prod');
    assert.equal(savedCkpt.completed, false);
    assert.equal(savedCkpt.failedDocs.length, 1);
    assert.equal(savedCkpt.failedDocs[0].docId, 'B_DOC');
    assert.equal(savedCkpt.failedDocs[0].writeResult, 'aborted_precondition');

    // Verify backup entry records writeResult for B_DOC as aborted_precondition and A_DOC as updated
    const backupJson = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as CleanupBackupFile;
    const entryA = backupJson.entries.find((e) => e.docId === 'A_DOC');
    const entryB = backupJson.entries.find((e) => e.docId === 'B_DOC');
    assert.equal(entryA?.writeResult, 'updated');
    assert.equal(entryB?.writeResult, 'aborted_precondition');

    // 3) Mismatched --backup against checkpoint.backupPath must fail explicitly
    const mismatchBackupOpts = parseCleanupCliArgs([
      '--project', 'mizan-test',
      '--database', 'egypt-prod',
      '--apply',
      '--checkpoint', checkpointPath,
      '--backup', path.join(tmpDir, 'wrong-backup.json'),
    ]);
    await assert.rejects(
      () => runLegacyDpsCleanup({ db, sentinels, options: mismatchBackupOpts }),
      /--backup/
    );

    // 4) Resuming --apply with same checkpoint & backup retries B_DOC and marks completed=true
    const applyRun2 = await runLegacyDpsCleanup({ db, sentinels, options: applyOpts });
    assert.equal(applyRun2.report.updatedDocsByCollection.financials, 1);
    assert.equal(applyRun2.report.failedDocsCount, 0);
    assert.equal(applyRun2.report.completed, true);
    assert.equal('dpsCurrent' in store.get('financials')!.get('B_DOC')!.data, false);

    const backupAfterRetry = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as CleanupBackupFile;
    const retriedEntryB = backupAfterRetry.entries.find((e) => e.docId === 'B_DOC');
    assert.equal(retriedEntryB?.writeResult, 'updated');
  });

  it('Rejects schema/projectId/databaseId mismatches and invalid scopes/paths; skips unapplied and computes fresh hash on transactional restore', async () => {
    const { store, db, sentinels } = createMockFirestore();

    const baseQuarterly = {
      ticker: 'EFID',
      stockName: 'Edita',
      yearQuarter: '2025FY',
      year: 2025,
      quarter: 'FY',
      shares: 700_000_000,
      revenueYTD: 12_000_000_000,
      netIncomeYTD: 1_500_000_000,
      ocfYTD: 1_800_000_000,
      capexYTD: 300_000_000,
      totalAssets: 9_000_000_000,
      totalDebtWithoutTX: 500_000_000,
      equity: 4_000_000_000,
      cash: 800_000_000,
      dateInsertData: '2026-03-05',
    };

    const initialCleanHash = computeRecordBusinessHash('quarterly', {
      ...baseQuarterly,
      extendedFields: { CustomNote: 'original' },
    });

    store.get('quarterly_financial_records')!.set('EFID_2025_FY', {
      updateTimeMs: 1_700_000_000_000,
      data: {
        ...baseQuarterly,
        revenueYTD: 12_500_000_000, // Simulate sibling field modified AFTER cleanup
        dpsCurrent: undefined,
        extendedFields: { CustomNote: 'updated-sibling' },
        contentHash: 'different-live-hash',
      },
    });
    // Clean record before removal: simulate EFID cleanup succeeded previously,
    // and FWRY was aborted (writeResult: 'aborted_precondition'),
    // and ORAS doc no longer exists in DB.
    delete store.get('quarterly_financial_records')!.get('EFID_2025_FY')!.data.dpsCurrent;

    store.get('financials')!.set('fwry_2025_fy', {
      updateTimeMs: 1_700_000_000_000,
      data: { id: 'fwry_2025_fy', dpsCurrent: 0.75 },
    });

    const badArrayPath = path.join(tmpDir, 'raw-array.json');
    fs.writeFileSync(badArrayPath, JSON.stringify([]), 'utf8');
    await assert.rejects(
      () =>
        runLegacyDpsRestore({
          db,
          sentinels,
          options: parseCleanupCliArgs(['--project', 'mizan-test', '--restore', badArrayPath]),
        }),
      /schema/
    );

    const wrongDbBackupPath = path.join(tmpDir, 'wrong-db.json');
    const wrongDbFile: CleanupBackupFile = {
      schema: CLEANUP_BACKUP_SCHEMA,
      toolVersion: '2.0.0',
      runId: 'apply_1',
      projectId: 'mizan-test',
      databaseId: 'other-db',
      createdAt: '2026-04-01T00:00:00.000Z',
      collections: ['quarterly_financial_records', 'financials'],
      entries: [],
    };
    fs.writeFileSync(wrongDbBackupPath, JSON.stringify(wrongDbFile), 'utf8');
    await assert.rejects(
      () =>
        runLegacyDpsRestore({
          db,
          sentinels,
          options: parseCleanupCliArgs(['--project', 'mizan-test', '--database', '(default)', '--restore', wrongDbBackupPath]),
        }),
      /قاعدة البيانات/
    );
    await assert.rejects(
      () =>
        runLegacyDpsCleanup({
          db,
          sentinels,
          options: parseCleanupCliArgs(['--project', 'mizan-test', '--database', '(default)', '--apply', '--backup', wrongDbBackupPath]),
        }),
      /قاعدة البيانات/
    );

    // Build wrapped backup with: updated EFID entry, aborted FWRY entry, disallowed path entry, and missing doc
    const restoreFilePath = path.join(tmpDir, 'mixed-restore.json');
    const mixedEntries: LegacyDpsBackupEntry[] = [
      {
        collection: 'quarterly_financial_records',
        docId: 'EFID_2025_FY',
        updateTime: '2026-04-01T00:00:00.000Z',
        removedFields: { dpsCurrent: 1.25 },
        previousContentHash: initialCleanHash,
        newContentHash: initialCleanHash,
        previousUpdatedAt: '2026-03-05T00:00:00.000Z',
        writeResult: 'updated',
      },
      {
        collection: 'financials',
        docId: 'fwry_2025_fy',
        updateTime: '2026-04-01T00:00:00.000Z',
        removedFields: { dpsCurrent: 0.75 },
        previousContentHash: null,
        newContentHash: null,
        previousUpdatedAt: null,
        writeResult: 'aborted_precondition',
      },
      {
        collection: 'quarterly_financial_records',
        docId: 'BAD_PATH_DOC',
        updateTime: null,
        removedFields: { ['revenueYTD' as unknown as 'dpsCurrent']: 100 },
        previousContentHash: null,
        newContentHash: null,
        previousUpdatedAt: null,
        writeResult: 'updated',
      },
      {
        collection: 'financials',
        docId: 'MISSING_DOC',
        updateTime: null,
        removedFields: { dpsCurrent: 2.0 },
        previousContentHash: null,
        newContentHash: null,
        previousUpdatedAt: null,
        writeResult: 'updated',
      },
    ];
    fs.writeFileSync(
      restoreFilePath,
      JSON.stringify({
        schema: CLEANUP_BACKUP_SCHEMA,
        toolVersion: '2.0.0',
        runId: 'apply_mixed',
        projectId: 'mizan-test',
        databaseId: '(default)',
        createdAt: '2026-04-01T00:00:00.000Z',
        collections: ['quarterly_financial_records', 'financials'],
        entries: mixedEntries,
      } satisfies CleanupBackupFile),
      'utf8'
    );

    const restoreReport = await runLegacyDpsRestore({
      db,
      sentinels,
      options: parseCleanupCliArgs(['--project', 'mizan-test', '--restore', restoreFilePath]),
      nowIso: () => '2026-04-03T10:00:00.000Z',
    });

    // EFID restored using fresh live sibling data in contentHash computation
    assert.equal(restoreReport.updatedDocsByCollection.quarterly_financial_records, 1);
    const liveEfid = store.get('quarterly_financial_records')!.get('EFID_2025_FY')!.data;
    assert.equal(liveEfid.dpsCurrent, 1.25);
    assert.equal(liveEfid.revenueYTD, 12_500_000_000);
    assert.equal(
      liveEfid.contentHash,
      computeRecordBusinessHash('quarterly', {
        ...baseQuarterly,
        revenueYTD: 12_500_000_000,
        dpsCurrent: 1.25,
        extendedFields: { CustomNote: 'updated-sibling' },
      })
    );

    // FWRY skipped because writeResult !== 'updated'
    assert.equal(restoreReport.skippedNotAppliedDocsByCollection.financials, 1);

    // MISSING_DOC must NOT be created in Firestore!
    assert.equal(store.get('financials')!.has('MISSING_DOC'), false);

    // BAD_PATH_DOC + MISSING_DOC recorded in errors -> completed = false
    assert.equal(restoreReport.errors.length, 2);
    assert.equal(restoreReport.completed, false);
  });

  it('verifyPostApplyDpsCleanup validates cleaned quarterly records with validateRecords and contentHash', () => {
    const cleanData = {
      ticker: 'COMI',
      stockName: 'CIB',
      yearQuarter: '2025FY',
      year: 2025,
      quarter: 'FY',
      shares: 100_000_000,
      revenueYTD: 1_000_000_000,
      netIncomeYTD: 250_000_000,
      ocfYTD: 300_000_000,
      capexYTD: 50_000_000,
      totalAssets: 5_000_000_000,
      totalDebtWithoutTX: 200_000_000,
      equity: 2_000_000_000,
      cash: 400_000_000,
      dateInsertData: '2026-03-01',
      extendedFields: { CustomKPI: 123 },
    };
    const validHash = computeRecordBusinessHash('quarterly', cleanData);

    const okRes = verifyPostApplyDpsCleanup([
      {
        collection: 'quarterly_financial_records',
        docId: 'COMI_2025_FY',
        data: { ...cleanData, contentHash: validHash },
      },
    ]);
    assert.equal(okRes.ok, true);
    assert.equal(okRes.validCount, 1);

    const failRes = verifyPostApplyDpsCleanup([
      {
        collection: 'quarterly_financial_records',
        docId: 'COMI_2025_FY',
        data: { ...cleanData, dpsCurrent: 1.5, contentHash: validHash },
      },
    ]);
    assert.equal(failRes.ok, false);
    assert.equal(failRes.issues.length, 1);
  });
});


