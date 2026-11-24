/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real Firestore Emulator integration suite for legacy `DPS_Current` cleanup & restore tool
 * (`scripts/cleanupLegacyDpsCurrent.ts`).
 *
 * Verifies against real Firestore Emulator via Firebase Admin SDK:
 * - `--dry-run` performs ZERO modifications.
 * - `--apply` deletes ONLY the 4 exact legacy paths (real `FieldValue.delete()`, NOT `null`),
 *   preserves zero/null/sibling fields and unrelated collections (`dividend_records`),
 *   recomputes `contentHash` on `quarterly_financial_records`, and writes backup/report/checkpoint JSONs.
 * - Repeating `--apply` is idempotent (0 updates).
 * - `--restore` restores exact removed fields (`0`, `null`, positive numbers, nested `extendedFields`),
 *   rejects project/database mismatches, is idempotent, and NEVER recreates a deleted document.
 * - `--resume-after` / checkpoint pagination works across batches.
 * - Concurrent modification (`lastUpdateTime` precondition) aborts cleanly and retries on resume.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseCleanupCliArgs,
  runLegacyDpsCleanup,
  runLegacyDpsRestore,
  type CleanupBackupFile,
  type CleanupCheckpointState,
  type FirestoreDbLike,
  type FirestoreSentinels,
} from '../../scripts/cleanupLegacyDpsCurrent';
import { CLEANUP_BACKUP_SCHEMA } from '../../src/core/domain/legacyDpsCleanup';
import { createEmulatorAdminContext, type EmulatorAdminContext } from './emulatorHarness';

describe('Real Firestore Emulator — Legacy DPS_Current Cleanup & Restore Tool (Admin SDK)', () => {
  let ctx: EmulatorAdminContext;
  let tmpDir: string;

  const getSentinels = (): FirestoreSentinels => ({
    documentId: ctx.FieldPath.documentId(),
    deleteField: () => ctx.FieldValue.delete(),
    serverTimestamp: () => ctx.FieldValue.serverTimestamp(),
  });

  before(() => {
    ctx = createEmulatorAdminContext('dps-cleanup');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mizanex-dps-emu-'));
  });

  beforeEach(async () => {
    await ctx.resetDatabase();
  });

  after(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (ctx) {
      await ctx.cleanup();
    }
  });

  async function seedRepresentativeData() {
    await ctx.db.collection('quarterly_financial_records').doc('COMI_2024_FY').set({
      ticker: 'COMI',
      stockName: 'البنك التجاري الدولي',
      yearQuarter: '2024FY',
      year: 2024,
      quarter: 'FY',
      revenueYTD: 100_000_000,
      netIncomeYTD: 25_000_000,
      dpsCurrent: 1.75,
      DPS_Current: 0, // Explicit numeric zero MUST be backed up and deleted
      extendedFields: {
        dpsCurrent: null, // Explicit null MUST be backed up and deleted
        DPS_Current: 2.25,
        CustomKPI: 99.5, // Sibling MUST be preserved untouched
      },
      contentHash: 'mzh1_old_placeholder',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await ctx.db.collection('quarterly_financial_records').doc('EAST_2024_FY').set({
      ticker: 'EAST',
      stockName: 'الشرقية للدخان',
      yearQuarter: '2024FY',
      year: 2024,
      quarter: 'FY',
      revenueYTD: 50_000_000,
      netIncomeYTD: 12_000_000,
      extendedFields: {
        CustomOnly: 'keep-me',
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await ctx.db.collection('financials').doc('comi_2024_FY').set({
      companyId: 'comi',
      year: 2024,
      quarter: 'FY',
      revenue: 100_000_000,
      netIncome: 25_000_000,
      dpsCurrent: 0,
      DPS_Current: null,
      extendedFields: {
        DPS_Current: 3.1,
        RetainedNote: 'keep',
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // Unrelated collection MUST NEVER be touched
    await ctx.db.collection('dividend_records').doc('COMI_2024_1').set({
      ticker: 'COMI',
      fiscalYear: 2024,
      dpsCash: 1.75,
      dpsCurrent: 1.75, // Even if a field shares name in another collection, scope MUST ignore it
    });
  }

  it('executes --dry-run (no-op), --apply (real field deletion + backup/report/checkpoint + contentHash), repeat idempotency, and --restore with safety checks', async () => {
    await seedRepresentativeData();
    const projectId = ctx.info.projectId;
    const runDir = path.join(tmpDir, 'full-flow');
    const dryReportPath = path.join(runDir, 'dry_report.json');
    const applyBackupPath = path.join(runDir, 'backup.json');
    const applyCheckpointPath = path.join(runDir, 'checkpoint.json');
    const applyReportPath = path.join(runDir, 'apply_report.json');
    const restoreReportPath = path.join(runDir, 'restore_report.json');

    const beforeQSnap = await ctx.db
      .collection('quarterly_financial_records')
      .doc('COMI_2024_FY')
      .get();
    const beforeFSnap = await ctx.db.collection('financials').doc('comi_2024_FY').get();
    const beforeDivSnap = await ctx.db.collection('dividend_records').doc('COMI_2024_1').get();

    // 1) --dry-run MUST NOT mutate any Firestore document
    const dryOpts = parseCleanupCliArgs([
      '--project',
      projectId,
      '--dry-run',
      '--report',
      dryReportPath,
    ]);
    const dryRes = await runLegacyDpsCleanup({
      db: ctx.db as unknown as FirestoreDbLike,
      sentinels: getSentinels(),
      options: dryOpts,
    });
    assert.equal(dryRes.report.mode, 'dry-run');
    assert.equal(dryRes.report.completed, true);
    assert.equal(dryRes.report.matchedDocsByCollection.quarterly_financial_records, 1);
    assert.equal(dryRes.report.matchedDocsByCollection.financials, 1);
    assert.equal(dryRes.report.updatedDocsByCollection.quarterly_financial_records, 0);
    assert.equal(dryRes.report.updatedDocsByCollection.financials, 0);

    const afterDryQSnap = await ctx.db
      .collection('quarterly_financial_records')
      .doc('COMI_2024_FY')
      .get();
    assert.equal(
      afterDryQSnap.updateTime?.toMillis(),
      beforeQSnap.updateTime?.toMillis(),
      '--dry-run must NOT modify updateTime'
    );
    assert.deepEqual(afterDryQSnap.data(), beforeQSnap.data());

    // 2) --apply MUST actually delete ONLY the 4 targeted fields (NOT null them), recompute contentHash, preserve siblings & dividend_records
    const applyOpts = parseCleanupCliArgs([
      '--project',
      projectId,
      '--apply',
      '--backup',
      applyBackupPath,
      '--checkpoint',
      applyCheckpointPath,
      '--report',
      applyReportPath,
    ]);
    const applyRes = await runLegacyDpsCleanup({
      db: ctx.db as unknown as FirestoreDbLike,
      sentinels: getSentinels(),
      options: applyOpts,
    });
    assert.equal(applyRes.report.completed, true);
    assert.equal(applyRes.report.errors.length, 0);
    assert.equal(applyRes.report.updatedDocsByCollection.quarterly_financial_records, 1);
    assert.equal(applyRes.report.updatedDocsByCollection.financials, 1);
    assert.equal(applyRes.report.skippedAlreadyCleanDocsByCollection.quarterly_financial_records, 1);
    assert.equal(applyRes.report.deletedBusinessFieldCount, 7);

    const cleanedQ = (
      await ctx.db.collection('quarterly_financial_records').doc('COMI_2024_FY').get()
    ).data()!;
    assert.equal(Object.prototype.hasOwnProperty.call(cleanedQ, 'dpsCurrent'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(cleanedQ, 'DPS_Current'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(cleanedQ.extendedFields, 'dpsCurrent'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(cleanedQ.extendedFields, 'DPS_Current'), false);
    assert.equal(cleanedQ.extendedFields.CustomKPI, 99.5, 'Sibling nested field must remain intact');
    assert.equal(cleanedQ.revenueYTD, 100_000_000, 'Business field revenueYTD must remain intact');
    assert.notEqual(cleanedQ.contentHash, 'mzh1_old_placeholder', 'contentHash must be recomputed');
    assert.ok(String(cleanedQ.contentHash).startsWith('mzh1_'));

    const cleanedF = (await ctx.db.collection('financials').doc('comi_2024_FY').get()).data()!;
    assert.equal(Object.prototype.hasOwnProperty.call(cleanedF, 'dpsCurrent'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(cleanedF, 'DPS_Current'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(cleanedF.extendedFields, 'DPS_Current'), false);
    assert.equal(cleanedF.extendedFields.RetainedNote, 'keep');
    assert.equal(cleanedF.revenue, 100_000_000);

    // dividend_records MUST remain untouched
    const afterDivSnap = await ctx.db.collection('dividend_records').doc('COMI_2024_1').get();
    assert.deepEqual(afterDivSnap.data(), beforeDivSnap.data());
    assert.equal(afterDivSnap.updateTime?.toMillis(), beforeDivSnap.updateTime?.toMillis());

    // Inspect persisted backup, report, and checkpoint JSON files
    const backupFile = JSON.parse(fs.readFileSync(applyBackupPath, 'utf8')) as CleanupBackupFile;
    assert.equal(backupFile.schema, CLEANUP_BACKUP_SCHEMA);
    assert.equal(backupFile.projectId, projectId);
    assert.equal(backupFile.databaseId, '(default)');
    assert.equal(backupFile.entries.length, 2);
    assert.ok(backupFile.entries.every((e) => e.writeResult === 'updated'));

    const checkpointFile = JSON.parse(
      fs.readFileSync(applyCheckpointPath, 'utf8')
    ) as CleanupCheckpointState;
    assert.equal(checkpointFile.completed, true);
    assert.equal(checkpointFile.failedDocs.length, 0);
    assert.equal(checkpointFile.lastProcessedDocIdByCollection.quarterly_financial_records, 'EAST_2024_FY');
    assert.equal(checkpointFile.lastProcessedDocIdByCollection.financials, 'comi_2024_FY');

    const persistedReport = JSON.parse(fs.readFileSync(applyReportPath, 'utf8'));
    assert.equal(persistedReport.completed, true);
    assert.equal(persistedReport.deletedBusinessFieldCount, 7);

    // 3) Repeating --apply on a fresh run MUST be completely idempotent (0 updates)
    const repeatOpts = parseCleanupCliArgs([
      '--project',
      projectId,
      '--apply',
      '--backup',
      path.join(runDir, 'backup_repeat.json'),
    ]);
    const repeatRes = await runLegacyDpsCleanup({
      db: ctx.db as unknown as FirestoreDbLike,
      sentinels: getSentinels(),
      options: repeatOpts,
    });
    assert.equal(repeatRes.report.completed, true);
    assert.equal(repeatRes.report.matchedDocsByCollection.quarterly_financial_records, 0);
    assert.equal(repeatRes.report.matchedDocsByCollection.financials, 0);
    assert.equal(repeatRes.report.updatedDocsByCollection.quarterly_financial_records, 0);
    assert.equal(repeatRes.report.updatedDocsByCollection.financials, 0);

    // 4) --restore MUST reject mismatched --project or --database
    await assert.rejects(
      () =>
        runLegacyDpsRestore({
          db: ctx.db as unknown as FirestoreDbLike,
          sentinels: getSentinels(),
          options: parseCleanupCliArgs([
            '--project',
            'demo-wrong-project',
            '--restore',
            applyBackupPath,
          ]),
        }),
      /المشروع/
    );
    await assert.rejects(
      () =>
        runLegacyDpsRestore({
          db: ctx.db as unknown as FirestoreDbLike,
          sentinels: getSentinels(),
          options: parseCleanupCliArgs([
            '--project',
            projectId,
            '--database',
            'wrong-db',
            '--restore',
            applyBackupPath,
          ]),
        }),
      /قاعدة البيانات/
    );

    // 5) Valid --restore MUST restore exact original values (including 0 and null) without disturbing siblings
    const restoreOpts = parseCleanupCliArgs([
      '--project',
      projectId,
      '--restore',
      applyBackupPath,
      '--report',
      restoreReportPath,
    ]);
    const restoreRep = await runLegacyDpsRestore({
      db: ctx.db as unknown as FirestoreDbLike,
      sentinels: getSentinels(),
      options: restoreOpts,
    });
    assert.equal(restoreRep.completed, true);
    assert.equal(restoreRep.errors.length, 0);
    assert.equal(restoreRep.updatedDocsByCollection.quarterly_financial_records, 1);
    assert.equal(restoreRep.updatedDocsByCollection.financials, 1);

    const restoredQ = (
      await ctx.db.collection('quarterly_financial_records').doc('COMI_2024_FY').get()
    ).data()!;
    assert.equal(restoredQ.dpsCurrent, 1.75);
    assert.equal(restoredQ.DPS_Current, 0);
    assert.equal(restoredQ.extendedFields.dpsCurrent, null);
    assert.equal(restoredQ.extendedFields.DPS_Current, 2.25);
    assert.equal(restoredQ.extendedFields.CustomKPI, 99.5);

    const restoredF = (await ctx.db.collection('financials').doc('comi_2024_FY').get()).data()!;
    assert.equal(restoredF.dpsCurrent, 0);
    assert.equal(restoredF.DPS_Current, null);
    assert.equal(restoredF.extendedFields.DPS_Current, 3.1);
    assert.equal(restoredF.extendedFields.RetainedNote, 'keep');
    assert.equal(restoredF.revenue, beforeFSnap.data()!.revenue);

    // Repeating --restore MUST be idempotent (0 new writes)
    const restoreRep2 = await runLegacyDpsRestore({
      db: ctx.db as unknown as FirestoreDbLike,
      sentinels: getSentinels(),
      options: restoreOpts,
    });
    assert.equal(restoreRep2.completed, true);
    assert.equal(restoreRep2.updatedDocsByCollection.quarterly_financial_records, 0);
    assert.equal(restoreRep2.updatedDocsByCollection.financials, 0);
    assert.equal(restoreRep2.skippedAlreadyCleanDocsByCollection.quarterly_financial_records, 1);
    assert.equal(restoreRep2.skippedAlreadyCleanDocsByCollection.financials, 1);
  });

  it('supports --resume-after pagination, aborts cleanly on real updateTime precondition conflict, retries via checkpoint, and never recreates deleted docs on restore', async () => {
    const projectId = ctx.info.projectId;
    const runDir = path.join(tmpDir, 'resume-precondition');

    await ctx.db.collection('quarterly_financial_records').doc('AAA_2024_FY').set({
      ticker: 'AAA',
      year: 2024,
      quarter: 'FY',
      revenueYTD: 100,
      dpsCurrent: 1.1,
    });
    await ctx.db.collection('quarterly_financial_records').doc('BBB_2024_FY').set({
      ticker: 'BBB',
      year: 2024,
      quarter: 'FY',
      revenueYTD: 200,
      dpsCurrent: 2.2,
    });

    // 1) --resume-after skips AAA_2024_FY and processes ONLY BBB_2024_FY
    const resumeOpts = parseCleanupCliArgs([
      '--project',
      projectId,
      '--apply',
      '--batch-size',
      '1',
      '--resume-after',
      'quarterly_financial_records:AAA_2024_FY',
      '--backup',
      path.join(runDir, 'resume_backup.json'),
    ]);
    const resumeRes = await runLegacyDpsCleanup({
      db: ctx.db as unknown as FirestoreDbLike,
      sentinels: getSentinels(),
      options: resumeOpts,
    });
    assert.equal(resumeRes.report.completed, true);
    assert.equal(resumeRes.report.updatedDocsByCollection.quarterly_financial_records, 1);
    assert.equal(
      (await ctx.db.collection('quarterly_financial_records').doc('AAA_2024_FY').get()).data()
        ?.dpsCurrent,
      1.1,
      'AAA_2024_FY before cursor must remain untouched'
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        (await ctx.db.collection('quarterly_financial_records').doc('BBB_2024_FY').get()).data()!,
        'dpsCurrent'
      ),
      false,
      'BBB_2024_FY after cursor must be cleaned'
    );

    // 2) Concurrent modification triggers real Firestore Emulator FAILED_PRECONDITION on lastUpdateTime
    const conflictBackupPath = path.join(runDir, 'conflict_backup.json');
    const conflictCheckpointPath = path.join(runDir, 'conflict_checkpoint.json');
    let racedOnce = false;

    const realDb = ctx.db;
    const racingDbProxy: FirestoreDbLike = {
      collection(name: string) {
        const col = realDb.collection(name);
        const wrapQuery = (q: any): any => ({
          orderBy: (f: unknown) => wrapQuery(q.orderBy(f)),
          startAfter: (c: unknown) => wrapQuery(q.startAfter(c)),
          limit: (n: number) => wrapQuery(q.limit(n)),
          get: async () => {
            const snap = await q.get();
            if (name === 'quarterly_financial_records' && !racedOnce) {
              const target = snap.docs.find((d: any) => d.id === 'AAA_2024_FY');
              if (target) {
                racedOnce = true;
                // Mutate AAA_2024_FY in real Firestore Emulator after scan snapshot was taken
                await realDb
                  .collection('quarterly_financial_records')
                  .doc('AAA_2024_FY')
                  .update({ revenueYTD: 150 });
              }
            }
            return snap;
          },
        });
        return {
          ...wrapQuery(col),
          doc: (id: string) => col.doc(id) as any,
        };
      },
      runTransaction: (fn) => realDb.runTransaction(fn as any),
    };

    const conflictOpts = parseCleanupCliArgs([
      '--project',
      projectId,
      '--apply',
      '--backup',
      conflictBackupPath,
      '--checkpoint',
      conflictCheckpointPath,
    ]);
    const conflictRes = await runLegacyDpsCleanup({
      db: racingDbProxy,
      sentinels: getSentinels(),
      options: conflictOpts,
    });
    assert.equal(conflictRes.report.completed, false);
    assert.equal(conflictRes.report.abortedPreconditionDocsByCollection.quarterly_financial_records, 1);
    assert.equal(conflictRes.report.failedDocsCount, 1);
    // Concurrent edit (revenueYTD: 150) preserved and dpsCurrent not blindly overwritten
    const afterAbort = (
      await ctx.db.collection('quarterly_financial_records').doc('AAA_2024_FY').get()
    ).data()!;
    assert.equal(afterAbort.revenueYTD, 150);
    assert.equal(afterAbort.dpsCurrent, 1.1);

    // Resuming with the same checkpoint MUST retry AAA_2024_FY and complete cleanly
    const retryRes = await runLegacyDpsCleanup({
      db: ctx.db as unknown as FirestoreDbLike,
      sentinels: getSentinels(),
      options: conflictOpts,
    });
    assert.equal(retryRes.report.completed, true);
    assert.equal(retryRes.report.updatedDocsByCollection.quarterly_financial_records, 1);
    const afterRetry = (
      await ctx.db.collection('quarterly_financial_records').doc('AAA_2024_FY').get()
    ).data()!;
    assert.equal(afterRetry.revenueYTD, 150);
    assert.equal(Object.prototype.hasOwnProperty.call(afterRetry, 'dpsCurrent'), false);

    // 3) Deleting AAA_2024_FY before --restore MUST NOT recreate a stub/partial document
    await ctx.db.collection('quarterly_financial_records').doc('AAA_2024_FY').delete();
    const restoreDeletedRep = await runLegacyDpsRestore({
      db: ctx.db as unknown as FirestoreDbLike,
      sentinels: getSentinels(),
      options: parseCleanupCliArgs([
        '--project',
        projectId,
        '--restore',
        conflictBackupPath,
      ]),
    });
    assert.equal(restoreDeletedRep.completed, false);
    assert.equal(restoreDeletedRep.errors.length, 1);
    assert.equal(
      (await ctx.db.collection('quarterly_financial_records').doc('AAA_2024_FY').get()).exists,
      false,
      'Restore MUST NOT recreate a deleted document'
    );
  });
});
