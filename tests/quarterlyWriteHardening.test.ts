/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Acceptance tests for Batch 31:
 * Hardening quarterly writes against lost concurrent updates (`bulk_quarterly`),
 * nested-map merge vs `contentHash` divergence (`extendedFields`, `originalValues`,
 * `manualCorrections`), and silently skipping diverged `financials` projections
 * that happen to carry the old `contentHash`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPORT_SAFE_CHUNK_SIZES,
  QuarterlyValidationError,
  applyStockAndQuarterAtomicWrite,
  canonicalizeFinancialProjection,
  computeFinancialProjectionHash,
  computeRecordBusinessHash,
  executeBulkQuarterlyTransaction,
  financialProjection,
  mergeQuarterlyNestedMap,
  resolveQuarterlyRecordWrite,
  type AtomicWriteTarget,
  type BulkQuarterlyTransactionPort,
  type BulkQuarterlyWriteTarget,
} from '../src/core/contracts';

function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

function firestoreDeepMerge(
  existing: Record<string, any>,
  incoming: Record<string, any>
): Record<string, any> {
  const out: Record<string, any> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    ) {
      out[k] = firestoreDeepMerge(out[k], v);
    } else {
      out[k] = deepClone(v);
    }
  }
  return out;
}

/**
 * In-memory Firestore-faithful transactional store with:
 * - Per-document monotonic versions and optimistic concurrency check on commit (aborts & retries
 *   just like Firestore `db.runTransaction` when any document read in the transaction changed).
 * - Accurate Firestore `merge: true` (deep map merge) vs `merge: false` (full doc replacement)
 *   semantics so any mismatch between `merge: true` and `contentHash` fails immediately.
 */
function createOptimisticFirestoreSim() {
  interface StoredEntry {
    version: number;
    data: Record<string, any>;
  }
  const cols = new Map<string, Map<string, StoredEntry>>();
  let writeLog: Array<{ collection: string; docId: string; merge: boolean }> = [];

  const getCol = (name: string) => {
    let c = cols.get(name);
    if (!c) {
      c = new Map();
      cols.set(name, c);
    }
    return c;
  };

  const readCurrent = (col: string, docId: string): StoredEntry | undefined => {
    const entry = getCol(col).get(docId);
    return entry ? { version: entry.version, data: deepClone(entry.data) } : undefined;
  };

  const rawPut = (col: string, docId: string, data: Record<string, any>) => {
    const prev = getCol(col).get(docId);
    getCol(col).set(docId, {
      version: (prev?.version ?? 0) + 1,
      data: deepClone(data),
    });
  };

  const runTransaction = async <T,>(
    fn: (helpers: {
      getDoc: (col: string, docId: string) => Promise<Record<string, any> | undefined>;
      getDocs: BulkQuarterlyWriteTarget['getDocs'];
      setDoc: (col: string, docId: string, payload: Record<string, any>, merge: boolean) => void;
      attempt: number;
    }) => Promise<T>,
    options?: {
      afterReadBeforeWrite?: (attempt: number) => Promise<void>;
      maxAttempts?: number;
    }
  ): Promise<T> => {
    const maxAttempts = options?.maxAttempts ?? 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const readVersions = new Map<string, number>();
      const stagedWrites: Array<{
        collection: string;
        docId: string;
        payload: Record<string, any>;
        merge: boolean;
      }> = [];

      const getDoc = async (col: string, docId: string) => {
        const key = `${col}/${docId}`;
        const entry = readCurrent(col, docId);
        if (!readVersions.has(key)) {
          readVersions.set(key, entry?.version ?? 0);
        }
        return entry?.data;
      };

      const getDocs: BulkQuarterlyWriteTarget['getDocs'] = async (refSpecs) => {
        const out = new Map<string, Record<string, any>>();
        for (const spec of refSpecs) {
          const data = await getDoc(spec.collection, spec.docId);
          if (data !== undefined) {
            out.set(`${spec.collection}/${spec.docId}`, data);
          }
        }
        if (options?.afterReadBeforeWrite) {
          await options.afterReadBeforeWrite(attempt);
        }
        return out;
      };

      const setDoc = (col: string, docId: string, payload: Record<string, any>, merge: boolean) => {
        stagedWrites.push({ collection: col, docId, payload: deepClone(payload), merge });
      };

      const result = await fn({ getDoc, getDocs, setDoc, attempt });

      // Optimistic concurrency check at commit time (identical to Firestore transaction commit)
      let conflicted = false;
      for (const [key, expectedVersion] of readVersions.entries()) {
        const slashIdx = key.indexOf('/');
        const col = key.slice(0, slashIdx);
        const docId = key.slice(slashIdx + 1);
        const currentVersion = getCol(col).get(docId)?.version ?? 0;
        if (currentVersion !== expectedVersion) {
          conflicted = true;
          break;
        }
      }

      if (conflicted) {
        if (attempt === maxAttempts) {
          throw new Error('ABORTED: transaction contention retries exhausted');
        }
        continue;
      }

      // Atomic commit
      for (const w of stagedWrites) {
        const colMap = getCol(w.collection);
        const prev = colMap.get(w.docId);
        const nextData =
          w.merge && prev ? firestoreDeepMerge(prev.data, w.payload) : deepClone(w.payload);
        colMap.set(w.docId, {
          version: (prev?.version ?? 0) + 1,
          data: nextData,
        });
        writeLog.push({ collection: w.collection, docId: w.docId, merge: w.merge });
      }
      return result;
    }
    throw new Error('unreachable');
  };

  const makeBulkPort = (options?: {
    afterReadBeforeWrite?: (attempt: number) => Promise<void>;
  }): BulkQuarterlyTransactionPort => ({
    runTransaction: (fn) =>
      runTransaction(
        ({ getDocs, setDoc }) => fn({ getDocs, setDoc }),
        options
      ),
  });

  const runSingle = (record: Record<string, any>, stamp: Record<string, any>) =>
    runTransaction(({ getDoc, setDoc }) => {
      const tx: AtomicWriteTarget = { getDoc, setDoc };
      return applyStockAndQuarterAtomicWrite(tx, { record, stamp });
    });

  return {
    readDoc: (col: string, docId: string) => readCurrent(col, docId)?.data,
    rawPut,
    makeBulkPort,
    runSingle,
    getWriteLog: () => [...writeLog],
    clearWriteLog: () => {
      writeLog = [];
    },
  };
}

function makeBaseQuarter(overrides: Record<string, any> = {}) {
  return {
    ticker: 'COMI',
    stockName: 'البنك التجاري الدولي',
    yearQuarter: '2026Q3',
    year: 2026,
    quarter: 'Q3' as const,
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-09-30',
    periodDays: 273,
    shares: 100_000_000,
    intangibleAssets: 0,
    totalAssets: 5_000_000_000,
    equity: 2_000_000_000,
    totalDebtWithoutTX: 500_000_000,
    totalLiabilities: 3_000_000_000,
    revenueYTD: 100,
    grossProfitYTD: 60,
    ebitYTD: 30,
    pbtYTD: 25,
    netIncomeYTD: 10,
    ocfYTD: 15,
    netInvestingCfYTD: -5,
    dividendsPaidYTD: -2,
    cash: 40,
    interestExpenseYTD: 5,
    financeCostsYTD: 5,
    interestIncomeYTD: 2,
    taxExpenseYTD: 5,
    interestPaidYTD: 4,
    capexYTD: 3,
    reportedEps: 2,
    reportedEpsSource: 'EGX Disclosure',
    reportedEpsPeriodType: 'ytd' as const,
    reportedEpsFiscalYear: 2026,
    reportedEpsFiscalQuarter: 'Q3' as const,
    reportedEpsPeriodStart: '2026-01-01',
    reportedEpsPeriodEnd: '2026-09-30',
    dateInsertData: '2026-10-01',
    ...overrides,
  };
}

const STAMP_1 = {
  importId: 'imp_1',
  sourceFile: 'seed.xlsx',
  sourceSheet: 'Quarterly',
  schemaVersion: 2,
  updatedAt: '2026-10-01T10:00:00.000Z',
  updatedBy: 'admin_1',
  isDeleted: false,
};

const STAMP_2 = {
  importId: 'imp_2',
  sourceFile: 'manual_ui',
  sourceSheet: 'quarterly_record',
  schemaVersion: 2,
  updatedAt: '2026-10-02T10:00:00.000Z',
  updatedBy: 'admin_2',
  isDeleted: false,
};

const STAMP_3 = {
  importId: 'imp_3',
  sourceFile: 'import_patch.xlsx',
  sourceSheet: 'bulk_quarterly',
  schemaVersion: 2,
  updatedAt: '2026-10-03T10:00:00.000Z',
  updatedBy: 'admin_3',
  isDeleted: false,
};

describe('Batch 31: Quarterly Write Hardening (Concurrency, Nested Maps & Projection Healing)', () => {
  it('1) prevents lost concurrent update in bulk_quarterly: retries on contention and preserves BOTH concurrent revenue=200 and bulk netIncome=20', async () => {
    const sim = createOptimisticFirestoreSim();
    await sim.runSingle(makeBaseQuarter({ revenueYTD: 100, netIncomeYTD: 10 }), STAMP_1);

    let attemptsObserved = 0;
    let singleEditCommitted = false;

    const bulkPort = sim.makeBulkPort({
      afterReadBeforeWrite: async (attempt) => {
        attemptsObserved = attempt;
        if (attempt === 1) {
          // Interleave a concurrent single quarterly_record write changing revenueYTD 100 -> 200
          const singleRes = await sim.runSingle(
            { ticker: 'COMI', year: 2026, quarter: 'Q3', revenueYTD: 200 },
            STAMP_2
          );
          assert.equal(singleRes.updatedCount, 1);
          singleEditCommitted = true;
        }
      },
    });

    const bulkRes = await executeBulkQuarterlyTransaction(bulkPort, {
      rawRecords: [{ ticker: 'COMI', year: 2026, quarter: 'Q3', netIncomeYTD: 20 }],
      stamp: STAMP_3,
      importBatchLog: {
        logId: 'imp_3_c0',
        data: { importId: 'imp_3', chunkIndex: 0, operationType: 'bulk_quarterly' },
      },
    });

    assert.equal(singleEditCommitted, true);
    assert.equal(attemptsObserved, 2, 'bulk_quarterly transaction must retry after concurrent edit');
    assert.equal(bulkRes.updatedCount, 1);
    assert.equal(bulkRes.skippedUnchangedCount, 0);

    const storedSource = sim.readDoc('quarterly_financial_records', 'COMI_2026_Q3')!;
    const storedProj = sim.readDoc('financials', 'comi_2026_q3')!;
    const batchLog = sim.readDoc('import_batches', 'imp_3_c0')!;

    // NEITHER concurrent revenue=200 NOR bulk netIncome=20 may be lost
    assert.equal(storedSource.revenueYTD, 200);
    assert.equal(storedSource.netIncomeYTD, 20);
    assert.equal(storedProj.revenueYTD, 200);
    assert.equal(storedProj.netProfitYTD, 20);
    // Untouched fields preserved
    assert.equal(storedSource.reportedEps, 2);
    assert.equal(storedProj.reportedEps, 2);

    // Source, projection, and contentHash strictly consistent
    const recomputedHash = computeRecordBusinessHash('quarterly', storedSource);
    assert.equal(storedSource.contentHash, recomputedHash);
    assert.equal(storedProj.contentHash, recomputedHash);
    assert.equal(
      computeFinancialProjectionHash(storedProj),
      computeFinancialProjectionHash(financialProjection(storedSource))
    );
    assert.equal(batchLog.updatedCount, 1);
    assert.equal(batchLog.processedCount, 1);
  });

  it('1b) preserves supported bulk_quarterly batch size (180 records = 361 ops <= 500) atomically and rejects >180 without silently splitting', async () => {
    const sim = createOptimisticFirestoreSim();
    const maxAllowed = IMPORT_SAFE_CHUNK_SIZES.quarterly;
    assert.equal(maxAllowed, 180);

    const oversized = Array.from({ length: maxAllowed + 1 }, (_, idx) =>
      makeBaseQuarter({ ticker: `STK${idx + 1}`, year: 2026, quarter: 'Q3' })
    );
    await assert.rejects(
      () =>
        executeBulkQuarterlyTransaction(sim.makeBulkPort(), {
          rawRecords: oversized,
          stamp: STAMP_1,
        }),
      (err: unknown) => err instanceof QuarterlyValidationError
    );

    // A full 180-record batch with importBatchLog commits in one single transaction (361 ops <= 500)
    const fullBatch = Array.from({ length: maxAllowed }, (_, idx) =>
      makeBaseQuarter({ ticker: `STK${idx + 1}`, year: 2026, quarter: 'Q3' })
    );
    const res = await executeBulkQuarterlyTransaction(sim.makeBulkPort(), {
      rawRecords: fullBatch,
      stamp: STAMP_1,
      importBatchLog: {
        logId: 'imp_full_c0',
        data: { importId: 'imp_full', chunkIndex: 0, operationType: 'bulk_quarterly' },
      },
    });
    assert.equal(res.insertedCount, maxAllowed);
    assert.equal(res.writeOps, maxAllowed * 2 + 1);
  });

  it('2) enforces central nested-map policy for extendedFields, originalValues, and manualCorrections with exact stored contentHash parity', async () => {
    // Unit-level policy verification on mergeQuarterlyNestedMap
    assert.deepEqual(mergeQuarterlyNestedMap('extendedFields', { a: 1, b: 2 }, undefined), {
      a: 1,
      b: 2,
    });
    assert.deepEqual(mergeQuarterlyNestedMap('extendedFields', { a: 1, b: 2 }, {}), {
      a: 1,
      b: 2,
    });
    assert.deepEqual(mergeQuarterlyNestedMap('extendedFields', { a: 1, b: 2 }, { a: 9 }), {
      a: 9,
      b: 2,
    });
    assert.deepEqual(mergeQuarterlyNestedMap('extendedFields', { a: 1, b: 2 }, { b: null }), {
      a: 1,
    });
    assert.equal(mergeQuarterlyNestedMap('extendedFields', { a: 1, b: 2 }, null), null);
    assert.equal(mergeQuarterlyNestedMap('extendedFields', undefined, {}), null);
    assert.deepEqual(
      mergeQuarterlyNestedMap('extendedFields', { nested: { x: 1, y: 2 }, b: 2 }, { nested: { x: 9 } }),
      { nested: { x: 9, y: 2 }, b: 2 }
    );
    assert.throws(
      () => mergeQuarterlyNestedMap('extendedFields', { a: 1 }, ['not-a-map']),
      (err: unknown) => err instanceof QuarterlyValidationError
    );

    // End-to-end persistence verification (single & bulk) against Firestore-faithful store
    const sim = createOptimisticFirestoreSim();
    await sim.runSingle(
      makeBaseQuarter({
        extendedFields: { a: 1, b: 2 },
        originalValues: { revenueYTD: 90, cash: null },
        manualCorrections: {
          revenueYTD: {
            field: 'revenueYTD',
            originalValue: 90,
            correctedValue: 100,
            editedAt: '2026-10-01T10:00:00.000Z',
          },
          cash: {
            field: 'cash',
            originalValue: null,
            correctedValue: 40,
            editedAt: '2026-10-01T10:00:00.000Z',
          },
        },
      }),
      STAMP_1
    );

    // Case A (proven bug): incoming.extendedFields = { a: 9 } on existing { a: 1, b: 2 }
    const patchRes = await executeBulkQuarterlyTransaction(sim.makeBulkPort(), {
      rawRecords: [{ ticker: 'COMI', year: 2026, quarter: 'Q3', extendedFields: { a: 9 } }],
      stamp: STAMP_2,
    });
    assert.equal(patchRes.updatedCount, 1);
    let stored = sim.readDoc('quarterly_financial_records', 'COMI_2026_Q3')!;
    assert.deepEqual(stored.extendedFields, { a: 9, b: 2 });
    assert.equal(stored.contentHash, computeRecordBusinessHash('quarterly', stored));
    assert.equal(
      sim.readDoc('financials', 'comi_2026_q3')!.contentHash,
      stored.contentHash
    );

    // Case B: Omitted extendedFields AND empty {} preserve { a: 9, b: 2 } with ZERO writes
    sim.clearWriteLog();
    const omitRes = await sim.runSingle(
      { ticker: 'COMI', year: 2026, quarter: 'Q3' },
      STAMP_3
    );
    assert.equal(omitRes.skippedUnchangedCount, 1);
    assert.equal(sim.getWriteLog().length, 0);

    const emptyMapRes = await sim.runSingle(
      { ticker: 'COMI', year: 2026, quarter: 'Q3', extendedFields: {} },
      STAMP_3
    );
    assert.equal(emptyMapRes.skippedUnchangedCount, 1);
    assert.equal(sim.getWriteLog().length, 0);
    assert.deepEqual(sim.readDoc('quarterly_financial_records', 'COMI_2026_Q3')!.extendedFields, {
      a: 9,
      b: 2,
    });

    // Case C: Explicit nested key deletion `{ b: null }` removes `b` cleanly in storage AND hash
    const delKeyRes = await sim.runSingle(
      { ticker: 'COMI', year: 2026, quarter: 'Q3', extendedFields: { b: null } },
      STAMP_3
    );
    assert.equal(delKeyRes.updatedCount, 1);
    stored = sim.readDoc('quarterly_financial_records', 'COMI_2026_Q3')!;
    assert.deepEqual(stored.extendedFields, { a: 9 });
    assert.equal('b' in stored.extendedFields, false);
    assert.equal(stored.contentHash, computeRecordBusinessHash('quarterly', stored));

    // Case D: Explicit top-level `extendedFields: null` clears the entire map in storage AND hash
    const clearMapRes = await sim.runSingle(
      { ticker: 'COMI', year: 2026, quarter: 'Q3', extendedFields: null },
      STAMP_3
    );
    assert.equal(clearMapRes.updatedCount, 1);
    stored = sim.readDoc('quarterly_financial_records', 'COMI_2026_Q3')!;
    assert.equal(stored.extendedFields, null);
    assert.equal(stored.contentHash, computeRecordBusinessHash('quarterly', stored));

    // Case E: `originalValues` preserves scalar `null` & untouched keys; `manualCorrections` deletes key on `null`
    await sim.runSingle(
      {
        ticker: 'COMI',
        year: 2026,
        quarter: 'Q3',
        originalValues: { ebitYTD: 28 },
        manualCorrections: { cash: null },
      },
      STAMP_3
    );
    stored = sim.readDoc('quarterly_financial_records', 'COMI_2026_Q3')!;
    assert.deepEqual(stored.originalValues, { revenueYTD: 90, cash: null, ebitYTD: 28 });
    assert.equal('cash' in stored.manualCorrections, false);
    assert.ok(stored.manualCorrections.revenueYTD);

    // Clearing originalValues & manualCorrections explicitly with top-level null
    await sim.runSingle(
      {
        ticker: 'COMI',
        year: 2026,
        quarter: 'Q3',
        originalValues: null,
        manualCorrections: null,
      },
      STAMP_3
    );
    stored = sim.readDoc('quarterly_financial_records', 'COMI_2026_Q3')!;
    assert.equal(stored.originalValues, null);
    assert.equal(stored.manualCorrections, null);
  });

  it('3) heals diverged financials projection even when its stored contentHash still matches, WITHOUT modifying the valid source doc, and skips once healthy', async () => {
    for (const mode of ['single', 'bulk'] as const) {
      const sim = createOptimisticFirestoreSim();
      await sim.runSingle(makeBaseQuarter({ reportedEps: 2 }), STAMP_1);

      const sourceBefore = sim.readDoc('quarterly_financial_records', 'COMI_2026_Q3')!;
      const projBefore = sim.readDoc('financials', 'comi_2026_q3')!;
      assert.equal(sourceBefore.reportedEps, 2);
      assert.equal(projBefore.reportedEps, 2);
      assert.equal(projBefore.contentHash, sourceBefore.contentHash);

      // Corrupt ONLY the projection's business content while preserving the EXACT same stored contentHash
      sim.rawPut('financials', 'comi_2026_q3', {
        ...projBefore,
        reportedEps: 999,
        contentHash: sourceBefore.contentHash,
      });

      // Verify canonical projection representation catches the drift despite identical stored contentHash
      const corruptedProj = sim.readDoc('financials', 'comi_2026_q3')!;
      assert.equal(corruptedProj.contentHash, sourceBefore.contentHash);
      assert.notEqual(
        computeFinancialProjectionHash(corruptedProj),
        computeFinancialProjectionHash(financialProjection(sourceBefore))
      );

      // Pure resolver check: sourceNeedsWrite=false, projectionNeedsWrite=true
      const resolvedCheck = resolveQuarterlyRecordWrite(
        sourceBefore,
        makeBaseQuarter({ reportedEps: 2 }),
        corruptedProj
      );
      assert.equal(resolvedCheck.sourceNeedsWrite, false);
      assert.equal(resolvedCheck.projectionNeedsWrite, true);
      assert.equal(resolvedCheck.isUnchanged, false);

      // Re-save the valid source record
      sim.clearWriteLog();
      if (mode === 'single') {
        const res = await sim.runSingle(makeBaseQuarter({ reportedEps: 2 }), STAMP_2);
        assert.equal(res.updatedCount, 1);
        assert.equal(res.skippedUnchangedCount, 0);
        assert.equal(res.sourceWritten, false);
        assert.equal(res.projectionWritten, true);
      } else {
        const res = await executeBulkQuarterlyTransaction(sim.makeBulkPort(), {
          rawRecords: [makeBaseQuarter({ reportedEps: 2 })],
          stamp: STAMP_2,
        });
        assert.equal(res.updatedCount, 1);
        assert.equal(res.skippedUnchangedCount, 0);
        assert.equal(res.writeOps, 1);
      }

      // Only `financials` was written — valid source document was NOT touched!
      const writes = sim.getWriteLog();
      assert.equal(writes.length, 1);
      assert.equal(writes[0].collection, 'financials');
      assert.equal(writes[0].merge, false);

      const sourceAfter = sim.readDoc('quarterly_financial_records', 'COMI_2026_Q3')!;
      const projAfter = sim.readDoc('financials', 'comi_2026_q3')!;
      assert.deepEqual(sourceAfter, sourceBefore);
      assert.equal(projAfter.reportedEps, 2);
      assert.equal(projAfter.contentHash, sourceBefore.contentHash);
      assert.deepEqual(
        canonicalizeFinancialProjection(projAfter),
        canonicalizeFinancialProjection(financialProjection(sourceAfter))
      );

      // Re-saving a healthy source + healthy projection with different server stamps MUST skip with ZERO writes
      sim.clearWriteLog();
      if (mode === 'single') {
        const replay = await sim.runSingle(makeBaseQuarter({ reportedEps: 2 }), STAMP_3);
        assert.equal(replay.skippedUnchangedCount, 1);
        assert.equal(replay.updatedCount, 0);
        assert.equal(replay.sourceWritten, false);
        assert.equal(replay.projectionWritten, false);
      } else {
        const replay = await executeBulkQuarterlyTransaction(sim.makeBulkPort(), {
          rawRecords: [makeBaseQuarter({ reportedEps: 2 })],
          stamp: STAMP_3,
        });
        assert.equal(replay.skippedUnchangedCount, 1);
        assert.equal(replay.updatedCount, 0);
        assert.equal(replay.writeOps, 0);
      }
      assert.equal(sim.getWriteLog().length, 0);
    }
  });
});
