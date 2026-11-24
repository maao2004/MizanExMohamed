/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real Firestore Emulator integration suite for quarterly write consistency & hardening:
 * - `ReportedEPS` write consistency across `quarterly_financial_records`, `financials`, and `contentHash`
 * - Transactional `bulk_quarterly` concurrency protection (no lost concurrent updates)
 * - Central nested-map policy (`extendedFields`, `originalValues`, `manualCorrections`) & hash parity
 * - Diverged `financials` projection healing even when stored `contentHash` matches (without modifying valid source)
 *
 * Architecture guarantees:
 * - Connects ONLY to `FIRESTORE_EMULATOR_HOST` under isolated `demo-*` project ID.
 * - Executes the EXACT production transactional write executors used by Cloud Functions `quarterly_record`
 *   (`applyStockAndQuarterAtomicWrite` + `createAdminStockQuarterTxTarget` inside `db.runTransaction`)
 *   and `bulk_quarterly` (`executeBulkQuarterlyTransaction` + `createFirestoreAdminBulkQuarterlyTransactionPort`).
 * - Note: Verifies real Firestore Emulator persistence, transactional contention retry,
 *   source/projection/contentHash parity, and idempotency; Cloud Functions HTTP/onCall auth
 *   wrapper transport is NOT invoked here.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  QuarterlyValidationError,
  applyStockAndQuarterAtomicWrite,
  canonicalizeFinancialProjection,
  computeFinancialProjectionHash,
  computeRecordBusinessHash,
  createAdminStockQuarterTxTarget,
  createFirestoreAdminBulkQuarterlyTransactionPort,
  executeBulkQuarterlyTransaction,
  financialProjection,
  type AdminFirestoreLike,
} from '../../src/core/contracts';
import {
  buildQuarterlyEditSubmission,
  sanitizeQuarterlyReadRecord,
} from '../../src/core/domain/quarterlyManualAudit';
import type { QuarterlyFinancialRecord } from '../../src/types';
import { createEmulatorAdminContext, type EmulatorAdminContext } from './emulatorHarness';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

const STAMP_V1 = {
  importId: 'emu_imp_1',
  sourceFile: 'emu_seed.xlsx',
  sourceSheet: 'Quarterly',
  schemaVersion: 2,
  updatedAt: '2026-10-01T10:00:00.000Z',
  updatedBy: 'admin-emu-v1',
  isDeleted: false,
};

const STAMP_V2 = {
  importId: 'emu_imp_2',
  sourceFile: 'emu_manual',
  sourceSheet: 'quarterly_record',
  schemaVersion: 2,
  updatedAt: '2026-10-02T10:00:00.000Z',
  updatedBy: 'admin-emu-v2',
  isDeleted: false,
};

const STAMP_V3 = {
  importId: 'emu_imp_3',
  sourceFile: 'emu_bulk.xlsx',
  sourceSheet: 'bulk_quarterly',
  schemaVersion: 2,
  updatedAt: '2026-10-03T10:00:00.000Z',
  updatedBy: 'admin-emu-v3',
  isDeleted: false,
};

function makeSeedYtdRecord(ticker: string, overrides: Record<string, any> = {}) {
  return {
    ticker,
    stockName: `شركة ${ticker}`,
    yearQuarter: '2026Q3',
    year: 2026,
    quarter: 'Q3' as const,
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-09-30',
    periodDays: 273,
    shares: 100_000_000,
    intangibleAssets: null,
    totalAssets: 5_000_000_000,
    equity: 2_400_000_000,
    totalDebtWithoutTX: 500_000_000,
    totalLiabilities: 2_600_000_000,
    revenueYTD: 1_250_000_000,
    grossProfitYTD: 550_000_000,
    ebitYTD: 420_000_000,
    pbtYTD: 400_000_000,
    netIncomeYTD: 340_000_000,
    ocfYTD: 360_000_000,
    netInvestingCfYTD: -80_000_000,
    dividendsPaidYTD: 50_000_000,
    cash: 300_000_000,
    interestExpenseYTD: 25_000_000,
    financeCostsYTD: 25_000_000,
    interestIncomeYTD: 10_000_000,
    taxExpenseYTD: 60_000_000,
    interestPaidYTD: 20_000_000,
    capexYTD: 70_000_000,
    reportedEps: 3.1,
    reportedEpsSource: 'إفصاح البورصة المصرية',
    reportedEpsPeriodType: 'ytd' as const,
    reportedEpsFiscalYear: 2026,
    reportedEpsFiscalQuarter: 'Q3' as const,
    reportedEpsPeriodStart: '2026-01-01',
    reportedEpsPeriodEnd: '2026-09-30',
    dateInsertData: '2026-10-01',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('Real Firestore Emulator — Quarterly Write Consistency, Concurrency, Nested Maps & Projection Healing', () => {
  let ctx: EmulatorAdminContext;

  before(() => {
    ctx = createEmulatorAdminContext('reported-eps-consistency');
  });

  beforeEach(async () => {
    await ctx.resetDatabase();
  });

  after(async () => {
    await ctx.cleanup();
  });

  async function runSingleWrite(record: Record<string, any>, stamp = STAMP_V1) {
    return ctx.db.runTransaction(async (tx) => {
      const txTarget = createAdminStockQuarterTxTarget(
        ctx.db as unknown as AdminFirestoreLike,
        tx as unknown as Parameters<typeof createAdminStockQuarterTxTarget>[1]
      );
      return applyStockAndQuarterAtomicWrite(txTarget, {
        record,
        stamp,
      });
    });
  }

  async function runBulkWrites(
    records: Record<string, any>[],
    stamp = STAMP_V1,
    options?: {
      afterReadBeforeWrite?: (attempt: number) => Promise<void>;
    }
  ) {
    const port = createFirestoreAdminBulkQuarterlyTransactionPort(
      ctx.db as unknown as AdminFirestoreLike,
      options
    );
    return executeBulkQuarterlyTransaction(port, {
      rawRecords: records,
      stamp,
    });
  }

  it('rejects partial free-text ReportedEPS updates (positive, zero, negative) and keeps existing YTD source, projection, and contentHash untouched', async () => {
    const seed = makeSeedYtdRecord('COMI');
    const seedRes = await runSingleWrite(seed, STAMP_V1);
    assert.equal(seedRes.insertedCount, 1);

    const beforeSource = (await ctx.db.collection('quarterly_financial_records').doc('COMI_2026_Q3').get()).data()!;
    const beforeProj = (await ctx.db.collection('financials').doc('comi_2026_q3').get()).data()!;
    assert.equal(beforeSource.contentHash, beforeProj.contentHash);
    assert.equal(beforeSource.contentHash, computeRecordBusinessHash('quarterly', beforeSource));

    for (const epsVal of [3.4, 0, -0.75]) {
      await assert.rejects(
        () =>
          runSingleWrite(
            {
              ticker: 'COMI',
              year: 2026,
              quarter: 'Q3',
              reportedEps: epsVal,
              reportedEpsPeriod: '9M 2026 free text',
            },
            STAMP_V2
          ),
        (err: unknown) => err instanceof QuarterlyValidationError
      );

      await assert.rejects(
        () =>
          runBulkWrites(
            [
              {
                ticker: 'COMI',
                year: 2026,
                quarter: 'Q3',
                reportedEps: epsVal,
                reportedEpsPeriod: '9M 2026 free text',
              },
            ],
            STAMP_V2
          ),
        (err: unknown) => err instanceof QuarterlyValidationError
      );
    }

    const afterSource = (await ctx.db.collection('quarterly_financial_records').doc('COMI_2026_Q3').get()).data()!;
    const afterProj = (await ctx.db.collection('financials').doc('comi_2026_q3').get()).data()!;
    assert.deepEqual(afterSource, beforeSource);
    assert.deepEqual(afterProj, beforeProj);
  });

  it('reproduces and prevents stale YTD subfields, projection drift, and partial contentHash on partial update to needs_review (single & bulk)', async () => {
    for (const [mode, ticker] of [
      ['single', 'EFID'],
      ['bulk', 'TMGH'],
    ] as const) {
      const seed = makeSeedYtdRecord(ticker);
      if (mode === 'single') {
        await runSingleWrite(seed, STAMP_V1);
      } else {
        await runBulkWrites([seed], STAMP_V1);
      }

      const partialToNeedsReview = {
        ticker,
        year: 2026,
        quarter: 'Q3',
        reportedEps: 3.45,
        reportedEpsPeriodType: 'needs_review',
      };

      if (mode === 'single') {
        const res = await runSingleWrite(partialToNeedsReview, STAMP_V2);
        assert.equal(res.updatedCount, 1);
      } else {
        const res = await runBulkWrites([partialToNeedsReview], STAMP_V2);
        assert.equal(res.updatedCount, 1);
      }

      const qDocId = `${ticker}_2026_Q3`;
      const fDocId = `${ticker.toLowerCase()}_2026_q3`;
      const src = (await ctx.db.collection('quarterly_financial_records').doc(qDocId).get()).data()!;
      const proj = (await ctx.db.collection('financials').doc(fDocId).get()).data()!;

      assert.equal(src.reportedEps, 3.45);
      assert.equal(src.reportedEpsSource, 'إفصاح البورصة المصرية');
      assert.equal(src.reportedEpsPeriodType, 'needs_review');
      assert.equal(src.reportedEpsFiscalYear, null);
      assert.equal(src.reportedEpsFiscalQuarter, null);
      assert.equal(src.reportedEpsPeriodStart, null);
      assert.equal(src.reportedEpsPeriodEnd, null);
      assert.equal(src.reportedEpsPeriod, null);

      assert.equal(proj.reportedEps, 3.45);
      assert.equal(proj.reportedEpsSource, 'إفصاح البورصة المصرية');
      assert.equal(proj.reportedEpsPeriodType, 'needs_review');
      assert.equal(proj.reportedEpsFiscalYear, null);
      assert.equal(proj.reportedEpsFiscalQuarter, null);
      assert.equal(proj.reportedEpsPeriodStart, null);
      assert.equal(proj.reportedEpsPeriodEnd, null);
      assert.equal(proj.reportedEpsPeriod, null);

      assert.equal(src.revenueYTD, 1_250_000_000);
      assert.equal(src.netIncomeYTD, 340_000_000);
      assert.equal(src.equity, 2_400_000_000);
      assert.equal(src.shares, 100_000_000);
      assert.equal(proj.revenueYTD, 1_250_000_000);
      assert.equal(proj.netProfitYTD, 340_000_000);
      assert.equal(proj.totalEquity, 2_400_000_000);
      assert.equal(proj.sharesCount, 100_000_000);

      const expectedHash = computeRecordBusinessHash('quarterly', src);
      assert.equal(src.contentHash, expectedHash);
      assert.equal(proj.contentHash, expectedHash);

      const replayStamp = { ...STAMP_V2, updatedAt: '2026-10-03T10:00:00.000Z' };
      if (mode === 'single') {
        const replay = await runSingleWrite({ ...src }, replayStamp);
        assert.equal(replay.skippedUnchangedCount, 1);
        assert.equal(replay.updatedCount, 0);
      } else {
        const replay = await runBulkWrites([{ ...src }], replayStamp);
        assert.equal(replay.skippedUnchangedCount, 1);
        assert.equal(replay.updatedCount, 0);
        assert.equal(replay.writeOps, 0);
      }

      const srcAfterReplay = (await ctx.db.collection('quarterly_financial_records').doc(qDocId).get()).data()!;
      assert.equal(srcAfterReplay.updatedAt, STAMP_V2.updatedAt);
    }
  });

  it('clears incompatible quarter/year fields when switching period types (ytd -> fy -> ttm) and clearing reportedEps to null in real Firestore', async () => {
    await runSingleWrite(makeSeedYtdRecord('ETEL'), STAMP_V1);

    await runSingleWrite(
      {
        ticker: 'ETEL',
        year: 2026,
        quarter: 'Q3',
        reportedEpsPeriodType: 'fy',
        reportedEpsFiscalYear: 2025,
        reportedEpsPeriodStart: '2025-01-01',
        reportedEpsPeriodEnd: '2025-12-31',
      },
      STAMP_V2
    );
    let src = (await ctx.db.collection('quarterly_financial_records').doc('ETEL_2026_Q3').get()).data()!;
    let proj = (await ctx.db.collection('financials').doc('etel_2026_q3').get()).data()!;
    assert.equal(src.reportedEpsPeriodType, 'fy');
    assert.equal(src.reportedEpsFiscalYear, 2025);
    assert.equal(src.reportedEpsFiscalQuarter, null);
    assert.equal(proj.reportedEpsFiscalQuarter, null);
    assert.equal(src.contentHash, proj.contentHash);
    assert.equal(src.contentHash, computeRecordBusinessHash('quarterly', src));

    await runBulkWrites(
      [
        {
          ticker: 'ETEL',
          year: 2026,
          quarter: 'Q3',
          reportedEpsPeriodType: 'ttm',
          reportedEpsPeriodStart: '2025-10-01',
          reportedEpsPeriodEnd: '2026-09-30',
        },
      ],
      STAMP_V2
    );
    src = (await ctx.db.collection('quarterly_financial_records').doc('ETEL_2026_Q3').get()).data()!;
    proj = (await ctx.db.collection('financials').doc('etel_2026_q3').get()).data()!;
    assert.equal(src.reportedEpsPeriodType, 'ttm');
    assert.equal(src.reportedEpsFiscalYear, null);
    assert.equal(src.reportedEpsFiscalQuarter, null);
    assert.equal(proj.reportedEpsFiscalYear, null);
    assert.equal(proj.reportedEpsFiscalQuarter, null);
    assert.equal(src.contentHash, proj.contentHash);

    await runSingleWrite(
      {
        ticker: 'ETEL',
        year: 2026,
        quarter: 'Q3',
        revenueYTD: 1_400_000_000,
      },
      STAMP_V2
    );
    src = (await ctx.db.collection('quarterly_financial_records').doc('ETEL_2026_Q3').get()).data()!;
    proj = (await ctx.db.collection('financials').doc('etel_2026_q3').get()).data()!;
    assert.equal(src.revenueYTD, 1_400_000_000);
    assert.equal(proj.revenueYTD, 1_400_000_000);
    assert.equal(src.reportedEps, 3.1);
    assert.equal(src.reportedEpsPeriodType, 'ttm');
    assert.equal(proj.reportedEpsPeriodType, 'ttm');
    assert.equal(src.contentHash, proj.contentHash);

    await runSingleWrite(
      {
        ticker: 'ETEL',
        year: 2026,
        quarter: 'Q3',
        reportedEps: null,
      },
      STAMP_V2
    );
    src = (await ctx.db.collection('quarterly_financial_records').doc('ETEL_2026_Q3').get()).data()!;
    proj = (await ctx.db.collection('financials').doc('etel_2026_q3').get()).data()!;
    assert.equal(src.reportedEps, null);
    assert.equal(src.reportedEpsPeriodType, null);
    assert.equal(src.reportedEpsPeriodStart, null);
    assert.equal(src.reportedEpsPeriodEnd, null);
    assert.equal(proj.reportedEps, null);
    assert.equal(proj.reportedEpsPeriodType, null);
    assert.equal(proj.revenueYTD, 1_400_000_000);
    assert.equal(src.contentHash, proj.contentHash);
    assert.equal(src.contentHash, computeRecordBusinessHash('quarterly', src));
  });

  it('Batch 31.1 — real Firestore Emulator concurrency: concurrent bulk_quarterly and quarterly_record both succeed without lock deadlock and preserve revenue=200 & netIncome=20', async () => {
    // Case A: Launch single quarterly_record edit the instant bulk_quarterly finishes its transactional read
    // WITHOUT awaiting the competing write inside the lock-holding transaction callback (prevents pessimistic-lock deadlock).
    await runSingleWrite(
      makeSeedYtdRecord('RACE', { revenueYTD: 100, netIncomeYTD: 10 }),
      STAMP_V1
    );

    let attemptsSeen = 0;
    let bulkReadSignaled = false;
    let resolveBulkRead!: () => void;
    let rejectBulkRead!: (err: unknown) => void;
    const bulkReadCompleted = new Promise<void>((resolve, reject) => {
      resolveBulkRead = resolve;
      rejectBulkRead = reject;
    });

    const bulkPromise = runBulkWrites(
      [{ ticker: 'RACE', year: 2026, quarter: 'Q3', netIncomeYTD: 20 }],
      STAMP_V3,
      {
        afterReadBeforeWrite: async (attempt) => {
          attemptsSeen = Math.max(attemptsSeen, attempt);
          if (!bulkReadSignaled) {
            bulkReadSignaled = true;
            // Deterministic non-blocking signal: immediately yields control so Firestore can
            // either serialize via pessimistic locking or abort & retry cleanly without deadlock.
            resolveBulkRead();
          }
        },
      }
    );
    bulkPromise.catch((err) => {
      if (!bulkReadSignaled) {
        rejectBulkRead(err);
      }
    });

    await withTimeout(bulkReadCompleted, 10_000, 'bulk_quarterly initial transactional read');

    const singlePromise = runSingleWrite(
      { ticker: 'RACE', year: 2026, quarter: 'Q3', revenueYTD: 200 },
      STAMP_V2
    );

    const [bulkRes, singleRes] = await withTimeout(
      Promise.all([bulkPromise, singlePromise]),
      20_000,
      'concurrent bulk_quarterly and quarterly_record completion (Case A)'
    );

    assert.ok(attemptsSeen >= 1, 'bulk_quarterly must execute inside a Firestore transaction');
    assert.equal(bulkRes.updatedCount, 1);
    assert.equal(singleRes.updatedCount, 1);

    const src = (await ctx.db.collection('quarterly_financial_records').doc('RACE_2026_Q3').get()).data()!;
    const proj = (await ctx.db.collection('financials').doc('race_2026_q3').get()).data()!;

    assert.equal(src.revenueYTD, 200);
    assert.equal(src.netIncomeYTD, 20);
    assert.equal(proj.revenueYTD, 200);
    assert.equal(proj.netProfitYTD, 20);
    const expectedHash = computeRecordBusinessHash('quarterly', src);
    assert.equal(src.contentHash, expectedHash);
    assert.equal(proj.contentHash, expectedHash);
    assert.equal(
      computeFinancialProjectionHash(proj),
      computeFinancialProjectionHash(financialProjection(src))
    );

    // Case B: Simultaneous same-tick dispatch of both transactions (accepting either safe serialization or retry)
    await runSingleWrite(
      makeSeedYtdRecord('RACE2', { revenueYTD: 100, netIncomeYTD: 10 }),
      STAMP_V1
    );

    const [simSingleRes, simBulkRes] = await withTimeout(
      Promise.all([
        runSingleWrite({ ticker: 'RACE2', year: 2026, quarter: 'Q3', revenueYTD: 200 }, STAMP_V2),
        runBulkWrites([{ ticker: 'RACE2', year: 2026, quarter: 'Q3', netIncomeYTD: 20 }], STAMP_V3),
      ]),
      20_000,
      'simultaneous quarterly_record and bulk_quarterly completion (Case B)'
    );

    assert.equal(simSingleRes.updatedCount, 1);
    assert.equal(simBulkRes.updatedCount, 1);

    const src2 = (await ctx.db.collection('quarterly_financial_records').doc('RACE2_2026_Q3').get()).data()!;
    const proj2 = (await ctx.db.collection('financials').doc('race2_2026_q3').get()).data()!;
    assert.equal(src2.revenueYTD, 200);
    assert.equal(src2.netIncomeYTD, 20);
    assert.equal(proj2.revenueYTD, 200);
    assert.equal(proj2.netProfitYTD, 20);
    const expectedHash2 = computeRecordBusinessHash('quarterly', src2);
    assert.equal(src2.contentHash, expectedHash2);
    assert.equal(proj2.contentHash, expectedHash2);
    assert.equal(
      computeFinancialProjectionHash(proj2),
      computeFinancialProjectionHash(financialProjection(src2))
    );
  });

  it('Batch 31.2 — nested maps (extendedFields, originalValues, manualCorrections) match stored Firestore doc and contentHash across patch, omit, {}, key delete, and null clear', async () => {
    await runSingleWrite(
      makeSeedYtdRecord('MAPS', {
        extendedFields: { a: 1, b: 2 },
        originalValues: { revenueYTD: 100, cash: null },
        manualCorrections: {
          revenueYTD: {
            field: 'revenueYTD',
            originalValue: 100,
            correctedValue: 1_250_000_000,
            editedAt: '2026-10-01T10:00:00.000Z',
          },
          cash: {
            field: 'cash',
            originalValue: null,
            correctedValue: 300_000_000,
            editedAt: '2026-10-01T10:00:00.000Z',
          },
        },
      }),
      STAMP_V1
    );

    // 1. Patch { a: 9 } preserves `b: 2` AND stored contentHash matches { a: 9, b: 2 }
    await runBulkWrites(
      [{ ticker: 'MAPS', year: 2026, quarter: 'Q3', extendedFields: { a: 9 } }],
      STAMP_V2
    );
    let src = (await ctx.db.collection('quarterly_financial_records').doc('MAPS_2026_Q3').get()).data()!;
    let proj = (await ctx.db.collection('financials').doc('maps_2026_q3').get()).data()!;
    assert.deepEqual(src.extendedFields, { a: 9, b: 2 });
    assert.equal(src.contentHash, computeRecordBusinessHash('quarterly', src));
    assert.equal(proj.contentHash, src.contentHash);

    // 2. Omitted extendedFields and empty {} preserve { a: 9, b: 2 } with zero writes
    const omitRes = await runSingleWrite({ ticker: 'MAPS', year: 2026, quarter: 'Q3' }, STAMP_V3);
    assert.equal(omitRes.skippedUnchangedCount, 1);
    const emptyRes = await runSingleWrite(
      { ticker: 'MAPS', year: 2026, quarter: 'Q3', extendedFields: {} },
      STAMP_V3
    );
    assert.equal(emptyRes.skippedUnchangedCount, 1);

    // 3. Explicit key deletion `{ b: null }` removes `b` in real Firestore AND updates contentHash
    await runSingleWrite(
      { ticker: 'MAPS', year: 2026, quarter: 'Q3', extendedFields: { b: null } },
      STAMP_V3
    );
    src = (await ctx.db.collection('quarterly_financial_records').doc('MAPS_2026_Q3').get()).data()!;
    assert.deepEqual(src.extendedFields, { a: 9 });
    assert.equal('b' in src.extendedFields, false);
    assert.equal(src.contentHash, computeRecordBusinessHash('quarterly', src));

    // 4. Explicit top-level `extendedFields: null` clears map in real Firestore AND updates contentHash
    await runSingleWrite(
      { ticker: 'MAPS', year: 2026, quarter: 'Q3', extendedFields: null },
      STAMP_V3
    );
    src = (await ctx.db.collection('quarterly_financial_records').doc('MAPS_2026_Q3').get()).data()!;
    assert.equal(src.extendedFields, null);
    assert.equal(src.contentHash, computeRecordBusinessHash('quarterly', src));

    // 5. `originalValues` preserves scalar `null`; `manualCorrections` deletes key on `null`
    await runSingleWrite(
      {
        ticker: 'MAPS',
        year: 2026,
        quarter: 'Q3',
        originalValues: { ebitYTD: 400_000_000 },
        manualCorrections: { cash: null },
      },
      STAMP_V3
    );
    src = (await ctx.db.collection('quarterly_financial_records').doc('MAPS_2026_Q3').get()).data()!;
    assert.deepEqual(src.originalValues, {
      revenueYTD: 100,
      cash: null,
      ebitYTD: 400_000_000,
    });
    assert.equal('cash' in src.manualCorrections, false);
    assert.ok(src.manualCorrections.revenueYTD);
  });

  it('Batch 31.3 — heals diverged financials projection despite matching stored contentHash WITHOUT modifying valid source doc, then skips subsequent identical saves', async () => {
    for (const [mode, ticker] of [
      ['single', 'HEAL1'],
      ['bulk', 'HEAL2'],
    ] as const) {
      const seed = makeSeedYtdRecord(ticker, { reportedEps: 2 });
      await runSingleWrite(seed, STAMP_V1);

      const qDocId = `${ticker}_2026_Q3`;
      const fDocId = `${ticker.toLowerCase()}_2026_q3`;
      const srcBefore = (await ctx.db.collection('quarterly_financial_records').doc(qDocId).get()).data()!;
      const projBefore = (await ctx.db.collection('financials').doc(fDocId).get()).data()!;

      // Corrupt projection business field while keeping identical stored contentHash
      await ctx.db.collection('financials').doc(fDocId).set({
        ...projBefore,
        reportedEps: 999,
        contentHash: srcBefore.contentHash,
      });

      if (mode === 'single') {
        const res = await runSingleWrite(seed, STAMP_V2);
        assert.equal(res.updatedCount, 1);
        assert.equal(res.skippedUnchangedCount, 0);
        assert.equal(res.sourceWritten, false);
        assert.equal(res.projectionWritten, true);
      } else {
        const res = await runBulkWrites([seed], STAMP_V2);
        assert.equal(res.updatedCount, 1);
        assert.equal(res.skippedUnchangedCount, 0);
        assert.equal(res.writeOps, 1);
      }

      const srcAfter = (await ctx.db.collection('quarterly_financial_records').doc(qDocId).get()).data()!;
      const projAfter = (await ctx.db.collection('financials').doc(fDocId).get()).data()!;

      // Valid source document MUST remain untouched (same updatedAt / updatedBy / importId)
      assert.deepEqual(srcAfter, srcBefore);
      // Projection MUST be healed back to reportedEps = 2
      assert.equal(projAfter.reportedEps, 2);
      assert.equal(projAfter.contentHash, srcBefore.contentHash);
      assert.deepEqual(
        canonicalizeFinancialProjection(projAfter),
        canonicalizeFinancialProjection(financialProjection(srcAfter))
      );

      // Next identical save MUST skip cleanly with zero writes
      if (mode === 'single') {
        const replay = await runSingleWrite(seed, STAMP_V3);
        assert.equal(replay.skippedUnchangedCount, 1);
        assert.equal(replay.sourceWritten, false);
        assert.equal(replay.projectionWritten, false);
      } else {
        const replay = await runBulkWrites([seed], STAMP_V3);
        assert.equal(replay.skippedUnchangedCount, 1);
        assert.equal(replay.writeOps, 0);
      }
      const projAfterReplay = (await ctx.db.collection('financials').doc(fDocId).get()).data()!;
      assert.equal(projAfterReplay.updatedAt, STAMP_V2.updatedAt);
    }
  });

  it('Batch 32.1 — manual correction revert cycle on real Firestore Emulator deletes ONLY reverted key while preserving originalValues and sibling corrections', async () => {
    const seed = makeSeedYtdRecord('AUDT', {
      revenueYTD: 100,
      netIncomeYTD: 10,
      cash: 0,
      intangibleAssets: null,
    });
    await runSingleWrite(seed, STAMP_V1);

    // Step 1: Edit revenueYTD (100 -> 200), netIncomeYTD (10 -> 20), cash (0 -> 50), intangibleAssets (null -> 75)
    const rawV1 = (await ctx.db.collection('quarterly_financial_records').doc('AUDT_2026_Q3').get()).data()!;
    const readV1 = sanitizeQuarterlyReadRecord(rawV1 as QuarterlyFinancialRecord);
    const editAll = buildQuarterlyEditSubmission(
      readV1,
      { ...readV1, revenueYTD: 200, netIncomeYTD: 20, cash: 50, intangibleAssets: 75 },
      '2026-10-02T10:00:00.000Z'
    );
    await runSingleWrite(editAll.writePayload, STAMP_V2);

    const rawV2 = (await ctx.db.collection('quarterly_financial_records').doc('AUDT_2026_Q3').get()).data()!;
    const readV2 = sanitizeQuarterlyReadRecord(rawV2 as QuarterlyFinancialRecord);
    assert.equal(readV2.revenueYTD, 200);
    assert.equal(Object.keys(readV2.manualCorrections ?? {}).length, 4);
    assert.deepEqual(readV2.originalValues, {
      revenueYTD: 100,
      netIncomeYTD: 10,
      cash: 0,
      intangibleAssets: null,
    });

    // Step 2: Revert ONLY revenueYTD (200 -> 100), cash (50 -> 0), intangibleAssets (75 -> null), keeping netIncomeYTD = 20
    const revertPartial = buildQuarterlyEditSubmission(
      readV2,
      { ...readV2, revenueYTD: 100, cash: 0, intangibleAssets: null },
      '2026-10-03T10:00:00.000Z'
    );
    assert.deepEqual(revertPartial.writePayload.manualCorrections, {
      revenueYTD: null,
      cash: null,
      intangibleAssets: null,
    });
    assert.deepEqual(Object.keys(revertPartial.readRecord.manualCorrections ?? {}), ['netIncomeYTD']);

    await runSingleWrite(revertPartial.writePayload, STAMP_V3);

    const rawV3 = (await ctx.db.collection('quarterly_financial_records').doc('AUDT_2026_Q3').get()).data()!;
    const readV3 = sanitizeQuarterlyReadRecord(rawV3 as QuarterlyFinancialRecord);
    assert.equal(readV3.revenueYTD, 100);
    assert.equal(readV3.cash, 0);
    assert.equal(readV3.intangibleAssets, null);
    assert.equal(readV3.netIncomeYTD, 20);
    assert.deepEqual(Object.keys(readV3.manualCorrections ?? {}), ['netIncomeYTD']);
    assert.equal(readV3.manualCorrections?.netIncomeYTD?.correctedValue, 20);
    assert.deepEqual(readV3.originalValues, {
      revenueYTD: 100,
      netIncomeYTD: 10,
      cash: 0,
      intangibleAssets: null,
    });

    // Step 3: Revert final remaining correction netIncomeYTD (20 -> 10) -> manualCorrections cleared to null in Firestore & omitted on read
    const revertLast = buildQuarterlyEditSubmission(
      readV3,
      { ...readV3, netIncomeYTD: 10 },
      '2026-10-04T10:00:00.000Z'
    );
    assert.deepEqual(revertLast.writePayload.manualCorrections, { netIncomeYTD: null });
    assert.equal(revertLast.readRecord.manualCorrections, undefined);

    await runSingleWrite(revertLast.writePayload, {
      ...STAMP_V3,
      updatedAt: '2026-10-04T10:00:00.000Z',
    });

    const rawV4 = (await ctx.db.collection('quarterly_financial_records').doc('AUDT_2026_Q3').get()).data()!;
    assert.equal(rawV4.manualCorrections, null);
    const readV4 = sanitizeQuarterlyReadRecord(rawV4 as QuarterlyFinancialRecord);
    assert.equal(readV4.manualCorrections, undefined);
    assert.deepEqual(readV4.originalValues, {
      revenueYTD: 100,
      netIncomeYTD: 10,
      cash: 0,
      intangibleAssets: null,
    });
  });
});
