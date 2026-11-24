/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real Firestore Emulator integration suite for Sector Linkage Integrity & Governance.
 *
 * Architecture guarantees:
 * - Connects ONLY to `FIRESTORE_EMULATOR_HOST` under isolated `demo-*` project ID.
 * - Seeds protected collections via Firebase Admin SDK (WITHOUT weakening `firestore.rules`).
 * - Executes the EXACT production Firestore Admin adapter (`createFirestoreAdminSectorMutationPort`,
 *   `applyAdminCompanyMetadataTx`, `applyAdminCreateCompanyTx`, `createAdminStockQuarterTxTarget`)
 *   and real Firestore Emulator transactions (`db.runTransaction` + `tx.get(query)`).
 * - Note: This verifies real Firestore Emulator transactions & production server-side mutation logic;
 *   Cloud Functions HTTP/onCall auth wrapper enforcement is NOT invoked here.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyAdminCompanyMetadataTx,
  applyAdminCreateCompanyTx,
  applyStockAndQuarterAtomicWrite,
  createAdminStockQuarterTxTarget,
  createFirestoreAdminSectorMutationPort,
  executeDeleteSectorGovernance,
  executeToggleSectorStatusGovernance,
  SectorGovernanceConflictError,
  type AdminFirestoreLike,
  type SectorMutationPort,
} from '../../src/core/contracts';
import { createEmulatorAdminContext, type EmulatorAdminContext } from './emulatorHarness';

const STAMP = {
  updatedAt: '2026-05-10T10:00:00.000Z',
  updatedBy: 'admin-emu-test',
  isDeleted: false,
};

function makeSampleQuarter(ticker: string) {
  return {
    ticker,
    stockName: `شركة ${ticker}`,
    yearQuarter: '2025FY',
    year: 2025,
    quarter: 'FY' as const,
    shares: 100_000_000,
    intangibleAssets: null,
    totalAssets: 5_000_000_000,
    equity: 2_000_000_000,
    totalDebtWithoutTX: 500_000_000,
    totalLiabilities: 3_000_000_000,
    revenueYTD: 3_000_000_000,
    grossProfitYTD: 1_000_000_000,
    ebitYTD: 700_000_000,
    pbtYTD: 600_000_000,
    netIncomeYTD: 450_000_000,
    ocfYTD: 500_000_000,
    netInvestingCfYTD: -100_000_000,
    dividendsPaidYTD: 100_000_000,
    cash: 300_000_000,
    interestExpenseYTD: 50_000_000,
    financeCostsYTD: 50_000_000,
    interestIncomeYTD: 10_000_000,
    taxExpenseYTD: 150_000_000,
    interestPaidYTD: 45_000_000,
    capexYTD: 120_000_000,
    dateInsertData: '2026-03-01',
    updatedAt: '2026-03-01T10:00:00.000Z',
  };
}

describe('Real Firestore Emulator — Sector Linkage Integrity & Governance (Admin SDK)', () => {
  let ctx: EmulatorAdminContext;

  const buildPort = (options?: {
    beforeTransaction?: (txIndex: number) => Promise<void>;
  }): SectorMutationPort => {
    const db = ctx.db;
    const basePort = createFirestoreAdminSectorMutationPort(db as unknown as AdminFirestoreLike, {
      buildSectorTombstone: (sectorId: string) => ({
        ref: db.collection('tombstones').doc(`sectorPE__${sectorId}`) as any,
        data: {
          id: `sectorPE__${sectorId}`,
          collection: 'sectorPE',
          docId: sectorId,
          ticker: null,
          deletedAt: STAMP.updatedAt,
          serverUpdatedAt: ctx.FieldValue.serverTimestamp(),
          deletedBy: STAMP.updatedBy,
          expiresAtMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
        },
      }),
    });

    if (!options?.beforeTransaction) return basePort;

    let txIndex = 0;
    return {
      ...basePort,
      runTransaction: async (fn) => {
        txIndex += 1;
        await options.beforeTransaction!(txIndex);
        return basePort.runTransaction(fn);
      },
    };
  };

  before(() => {
    ctx = createEmulatorAdminContext('sector-linkage');
  });

  beforeEach(async () => {
    await ctx.resetDatabase();
  });

  after(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  it('1) New explicit sectorId preserves old rawSector untouched and is strictly authoritative', async () => {
    await ctx.db.collection('sectorPE').doc('sec_old').set({
      sectorId: 'sec_old',
      nameAr: 'أسمنت قديم',
      aliases: [],
      classification: 'non_financial',
      multiple: 8.5,
      status: 'active',
      isDeleted: false,
    });
    await ctx.db.collection('sectorPE').doc('sec_new').set({
      sectorId: 'sec_new',
      nameAr: 'صناعات هندسية',
      aliases: [],
      classification: 'non_financial',
      multiple: null, // Active sector with multiple: null MUST be allowed
      status: 'active',
      isDeleted: false,
    });
    await ctx.db.collection('companies').doc('arcc').set({
      id: 'arcc',
      ticker: 'ARCC',
      nameAr: 'العربية للأسمنت',
      sectorId: 'sec_old',
      sector: 'أسمنت قديم',
      rawSector: 'أسمنت قديم',
      sectorClassification: 'non_financial',
      isDeleted: false,
    });

    await applyAdminCompanyMetadataTx(ctx.db as unknown as AdminFirestoreLike, {
      rawPayload: {
        id: 'arcc',
        ticker: 'ARCC',
        sectorId: 'sec_new',
        sector: 'اسم عشوائي يجب تجاهله',
      },
      stamp: STAMP,
    });

    const snap = await ctx.db.collection('companies').doc('arcc').get();
    const data = snap.data();
    assert.equal(data?.sectorId, 'sec_new');
    assert.equal(data?.sector, 'صناعات هندسية', 'Authoritative nameAr must come from sectorPE');
    assert.equal(data?.sectorClassification, 'non_financial');
    assert.equal(data?.rawSector, 'أسمنت قديم', 'Old rawSector must remain preserved for audit');

    // Deleting sec_old without reassignToSectorId must now succeed because arcc belongs strictly to sec_new
    const delOld = await executeDeleteSectorGovernance(buildPort(), {
      rawPayload: { sectorId: 'sec_old' },
      stamp: STAMP,
    });
    assert.equal(delOld.report.completed, true);
    assert.equal(delOld.report.linkedCompaniesCount, 0);
    assert.equal((await ctx.db.collection('sectorPE').doc('sec_old').get()).exists, false);
  });

  it('2) Rejects assignment to missing, deleted, disabled, or pendingDelete sectors across create_company, company_metadata, and applyStockAndQuarterAtomicWrite', async () => {
    await ctx.db.collection('sectorPE').doc('sec_disabled').set({
      sectorId: 'sec_disabled',
      nameAr: 'قطاع معطّل',
      aliases: [],
      classification: 'non_financial',
      multiple: 9,
      status: 'disabled',
      isDeleted: false,
    });
    await ctx.db.collection('sectorPE').doc('sec_deleted').set({
      sectorId: 'sec_deleted',
      nameAr: 'قطاع محذوف منطقياً',
      aliases: [],
      classification: 'non_financial',
      multiple: 9,
      status: 'active',
      isDeleted: true,
    });
    await ctx.db.collection('sectorPE').doc('sec_pending').set({
      sectorId: 'sec_pending',
      nameAr: 'قطاع قيد الحذف',
      aliases: [],
      classification: 'non_financial',
      multiple: 9,
      status: 'active',
      pendingDelete: true,
      pendingDeleteOperationId: 'op_lock_1',
      isDeleted: false,
    });
    await ctx.db.collection('sectorPE').doc('banks').set({
      sectorId: 'banks',
      nameAr: 'البنوك',
      aliases: [],
      classification: 'financial',
      multiple: 6.5,
      status: 'active',
      isDeleted: false,
    });

    for (const badSectorId of ['sec_nonexistent', 'sec_deleted', 'sec_disabled', 'sec_pending']) {
      await assert.rejects(
        () =>
          applyAdminCreateCompanyTx(ctx.db as unknown as AdminFirestoreLike, {
            rawPayload: { id: 'badco', ticker: 'BADCO', sectorId: badSectorId },
            stamp: STAMP,
          }),
        (err: unknown) => err instanceof SectorGovernanceConflictError
      );
      assert.equal((await ctx.db.collection('companies').doc('badco').get()).exists, false);
    }

    // Reject classification spoofing on bank sector
    await assert.rejects(
      () =>
        applyAdminCreateCompanyTx(ctx.db as unknown as AdminFirestoreLike, {
          rawPayload: {
            id: 'comi',
            ticker: 'COMI',
            sectorId: 'banks',
            sectorClassification: 'non_financial',
          },
          stamp: STAMP,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // Reject disabled sector inside atomic quarter + company write transaction
    await assert.rejects(
      () =>
        ctx.db.runTransaction(async (tx) => {
          await applyStockAndQuarterAtomicWrite(
            createAdminStockQuarterTxTarget(ctx.db as unknown as AdminFirestoreLike, tx as any),
            {
              record: makeSampleQuarter('NEWQ'),
              companyMetadata: { id: 'newq', ticker: 'NEWQ', sectorId: 'sec_disabled' },
              stamp: STAMP,
            }
          );
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );
    assert.equal((await ctx.db.collection('companies').doc('newq').get()).exists, false);
    assert.equal(
      (await ctx.db.collection('quarterly_financial_records').doc('NEWQ_2025_FY').get()).exists,
      false
    );
  });

  it('3) Allows independent financial and metadata edits on a company already linked to a disabled sector', async () => {
    await ctx.db.collection('sectorPE').doc('sec_dis').set({
      sectorId: 'sec_dis',
      nameAr: 'قطاع معطّل قائم',
      aliases: [],
      classification: 'non_financial',
      multiple: 10,
      status: 'disabled',
      isDeleted: false,
    });
    await ctx.db.collection('companies').doc('oldco').set({
      id: 'oldco',
      ticker: 'OLDCO',
      nameAr: 'شركة قائمة',
      sectorId: 'sec_dis',
      sector: 'قطاع معطّل قائم',
      rawSector: 'قطاع معطّل قائم',
      sectorClassification: 'non_financial',
      description: 'وصف قديم',
      isDeleted: false,
    });

    await applyAdminCompanyMetadataTx(ctx.db as unknown as AdminFirestoreLike, {
      rawPayload: {
        id: 'oldco',
        ticker: 'OLDCO',
        description: 'تعديل وصفي مستقل',
        rimRetentionPolicy: 'historical_retention',
      },
      stamp: STAMP,
    });

    await ctx.db.runTransaction(async (tx) => {
      await applyStockAndQuarterAtomicWrite(
        createAdminStockQuarterTxTarget(ctx.db as unknown as AdminFirestoreLike, tx as any),
        {
          record: makeSampleQuarter('OLDCO'),
          companyMetadata: { id: 'oldco', ticker: 'OLDCO', description: 'تحديث مع قوائم 2025' },
          stamp: STAMP,
        }
      );
    });

    const compSnap = await ctx.db.collection('companies').doc('oldco').get();
    assert.equal(compSnap.data()?.sectorId, 'sec_dis');
    assert.equal(compSnap.data()?.description, 'تحديث مع قوائم 2025');
    assert.equal(compSnap.data()?.rimRetentionPolicy, 'historical_retention');
    assert.equal(
      (await ctx.db.collection('quarterly_financial_records').doc('OLDCO_2025_FY').get()).exists,
      true
    );
  });

  it('4 & 9) Reassigns companies then deletes sector with zero dangling references, tombstone created, and untouched financial collections', async () => {
    await ctx.db.collection('sectorPE').doc('sec_src').set({
      sectorId: 'sec_src',
      nameAr: 'قطاع قديم',
      aliases: ['قديم'],
      classification: 'non_financial',
      multiple: 9.5,
      status: 'active',
      isDeleted: false,
    });
    await ctx.db.collection('sectorPE').doc('sec_dst').set({
      sectorId: 'sec_dst',
      nameAr: 'قطاع بديل',
      aliases: [],
      classification: 'non_financial',
      multiple: 11.0,
      status: 'active',
      isDeleted: false,
    });
    await ctx.db.collection('companies').doc('c1').set({
      id: 'c1',
      ticker: 'C1',
      sectorId: 'sec_src',
      sector: 'قطاع قديم',
      rawSector: 'قطاع قديم',
      sectorClassification: 'non_financial',
      isDeleted: false,
    });
    await ctx.db.collection('companies').doc('c2').set({
      id: 'c2',
      ticker: 'C2',
      sectorId: null,
      sector: 'قديم',
      rawSector: 'قديم',
      isDeleted: false,
    });

    // Seed independent financial collections that MUST remain 100% untouched
    const qPayload = { ticker: 'C1', year: 2025, quarter: 'FY', revenueYTD: 123456, netIncomeYTD: 45678 };
    const fPayload = { companyId: 'c1', year: 2025, quarter: 'FY', revenue: 123456, netIncome: 45678 };
    const dPayload = { ticker: 'C1', tradeDate: '2026-04-20', closePrice: 52.5, sector: 'قطاع قديم' };
    const divPayload = { ticker: 'C1', fiscalYear: 2025, dpsCash: 1.5 };

    await ctx.db.collection('quarterly_financial_records').doc('C1_2025_FY').set(qPayload);
    await ctx.db.collection('financials').doc('c1_2025_FY').set(fPayload);
    await ctx.db.collection('daily_trading_records').doc('C1_2026-04-20').set(dPayload);
    await ctx.db.collection('dividend_records').doc('C1_2025_1').set(divPayload);

    const res = await executeDeleteSectorGovernance(buildPort(), {
      rawPayload: { sectorId: 'sec_src', reassignToSectorId: 'sec_dst' },
      stamp: STAMP,
    });

    assert.equal(res.report.completed, true);
    assert.equal(res.report.reassignedCount, 2);
    assert.equal((await ctx.db.collection('sectorPE').doc('sec_src').get()).exists, false);

    // Zero dangling references in companies
    const dangling = await ctx.db
      .collection('companies')
      .where('sectorId', '==', 'sec_src')
      .get();
    assert.equal(dangling.size, 0);

    const c1After = (await ctx.db.collection('companies').doc('c1').get()).data();
    const c2After = (await ctx.db.collection('companies').doc('c2').get()).data();
    assert.equal(c1After?.sectorId, 'sec_dst');
    assert.equal(c1After?.rawSector, 'قطاع قديم');
    assert.equal(c2After?.sectorId, 'sec_dst');
    assert.equal(c2After?.rawSector, 'قديم');

    // Verify tombstone written
    const tombSnap = await ctx.db.collection('tombstones').doc('sectorPE__sec_src').get();
    assert.equal(tombSnap.exists, true);
    assert.equal(tombSnap.data()?.collection, 'sectorPE');
    assert.equal(tombSnap.data()?.docId, 'sec_src');

    // Verify all 4 independent financial collections remain completely untouched
    assert.deepEqual(
      (await ctx.db.collection('quarterly_financial_records').doc('C1_2025_FY').get()).data(),
      qPayload
    );
    assert.deepEqual((await ctx.db.collection('financials').doc('c1_2025_FY').get()).data(), fPayload);
    assert.deepEqual(
      (await ctx.db.collection('daily_trading_records').doc('C1_2026-04-20').get()).data(),
      dPayload
    );
    assert.deepEqual(
      (await ctx.db.collection('dividend_records').doc('C1_2025_1').get()).data(),
      divPayload
    );
  });

  it('5) Detects company linkage change AND replacement sector disable between preview and transaction without blindly overwriting', async () => {
    await ctx.db.collection('sectorPE').doc('sec_src').set({
      sectorId: 'sec_src',
      nameAr: 'مصدر',
      aliases: [],
      classification: 'non_financial',
      multiple: 10,
      status: 'active',
      isDeleted: false,
    });
    await ctx.db.collection('sectorPE').doc('sec_dst').set({
      sectorId: 'sec_dst',
      nameAr: 'بديل',
      aliases: [],
      classification: 'non_financial',
      multiple: 12,
      status: 'active',
      isDeleted: false,
    });
    await ctx.db.collection('sectorPE').doc('sec_third').set({
      sectorId: 'sec_third',
      nameAr: 'ثالث',
      aliases: [],
      classification: 'financial',
      multiple: 7,
      status: 'active',
      isDeleted: false,
    });
    for (const id of ['c1', 'c2', 'c3']) {
      await ctx.db.collection('companies').doc(id).set({
        id,
        ticker: id.toUpperCase(),
        sectorId: 'sec_src',
        sector: 'مصدر',
        isDeleted: false,
      });
    }

    // 5a) Move c2 to sec_third in real Firestore right between preview and chunk transaction
    let movedC2 = false;
    const portA = buildPort({
      beforeTransaction: async (txIndex) => {
        if (txIndex === 1 && !movedC2) {
          movedC2 = true;
          await ctx.db.collection('companies').doc('c2').set(
            { sectorId: 'sec_third', sector: 'ثالث', sectorClassification: 'financial' },
            { merge: true }
          );
        }
      },
    });

    const repA = (
      await executeDeleteSectorGovernance(portA, {
        rawPayload: { sectorId: 'sec_src', reassignToSectorId: 'sec_dst', batchLimit: 2 },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;

    assert.equal(repA.completed, false);
    assert.equal(repA.reassignedCount, 1);
    assert.equal(repA.conflictedCount, 1);
    assert.equal((await ctx.db.collection('companies').doc('c2').get()).data()?.sectorId, 'sec_third');
    assert.equal((await ctx.db.collection('companies').doc('c1').get()).data()?.sectorId, 'sec_dst');

    // 5b) Disable sec_dst in real Firestore right between preview and chunk transaction -> MUST reject
    let disabledDst = false;
    const portB = buildPort({
      beforeTransaction: async (txIndex) => {
        if (txIndex === 1 && !disabledDst) {
          disabledDst = true;
          await ctx.db.collection('sectorPE').doc('sec_dst').set({ status: 'disabled' }, { merge: true });
        }
      },
    });

    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(portB, {
          rawPayload: {
            sectorId: 'sec_src',
            reassignToSectorId: 'sec_dst',
            mutationId: repA.mutationId,
            resumeAfterCompanyId: repA.resumeAfterCompanyId,
            batchLimit: 2,
          },
          stamp: STAMP,
          maxAtomicCompanies: 2,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );
    assert.equal((await ctx.db.collection('companies').doc('c3').get()).data()?.sectorId, 'sec_src');
  });

  it('6) Resolves concurrent company assignment vs sector deletion safely under both orderings', async () => {
    await ctx.db.collection('sectorPE').doc('sec_race').set({
      sectorId: 'sec_race',
      nameAr: 'قطاع سباق',
      aliases: [],
      classification: 'non_financial',
      multiple: 10,
      status: 'active',
      isDeleted: false,
    });
    await ctx.db.collection('sectorPE').doc('sec_alt').set({
      sectorId: 'sec_alt',
      nameAr: 'قطاع آمن',
      aliases: [],
      classification: 'non_financial',
      multiple: 11,
      status: 'active',
      isDeleted: false,
    });

    // Ordering A: Company links to sec_race right before delete transaction reads -> delete without replacement MUST reject
    let injectedRaceCo = false;
    const racePort = buildPort({
      beforeTransaction: async () => {
        if (!injectedRaceCo) {
          injectedRaceCo = true;
          await ctx.db.collection('companies').doc('race_co').set({
            id: 'race_co',
            ticker: 'RACE',
            sectorId: 'sec_race',
            sector: 'قطاع سباق',
            isDeleted: false,
          });
        }
      },
    });
    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(racePort, {
          rawPayload: { sectorId: 'sec_race' },
          stamp: STAMP,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );
    assert.equal((await ctx.db.collection('sectorPE').doc('sec_race').get()).exists, true);

    // Ordering B: Multi-batch deletion locks sec_race with pendingDelete=true -> concurrent company assignment MUST reject
    await ctx.db.collection('companies').doc('race_co2').set({
      id: 'race_co2',
      ticker: 'RACE2',
      sectorId: 'sec_race',
      sector: 'قطاع سباق',
      isDeleted: false,
    });
    const b1 = (
      await executeDeleteSectorGovernance(buildPort(), {
        rawPayload: { sectorId: 'sec_race', reassignToSectorId: 'sec_alt', batchLimit: 1 },
        stamp: STAMP,
        maxAtomicCompanies: 1,
      })
    ).report;
    assert.equal(b1.completed, false);
    assert.equal((await ctx.db.collection('sectorPE').doc('sec_race').get()).data()?.pendingDelete, true);

    await assert.rejects(
      () =>
        applyAdminCreateCompanyTx(ctx.db as unknown as AdminFirestoreLike, {
          rawPayload: { id: 'late_new', ticker: 'LNEW', sectorId: 'sec_race' },
          stamp: STAMP,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );
    assert.equal((await ctx.db.collection('companies').doc('late_new').get()).exists, false);
  });

  it('7 & 8) Multi-batch resume catches company added BEHIND cursor, rejects mismatched mutationId, and re-run is idempotent', async () => {
    await ctx.db.collection('sectorPE').doc('sec_src').set({
      sectorId: 'sec_src',
      nameAr: 'قطاع مرحلي',
      aliases: [],
      classification: 'non_financial',
      multiple: 8,
      status: 'active',
      isDeleted: false,
    });
    await ctx.db.collection('sectorPE').doc('sec_dst').set({
      sectorId: 'sec_dst',
      nameAr: 'قطاع وجهة',
      aliases: [],
      classification: 'non_financial',
      multiple: 10,
      status: 'active',
      isDeleted: false,
    });
    for (const id of ['b1', 'b2', 'b3']) {
      await ctx.db.collection('companies').doc(id).set({
        id,
        ticker: id.toUpperCase(),
        sectorId: 'sec_src',
        sector: 'قطاع مرحلي',
        rawSector: 'قطاع مرحلي',
        isDeleted: false,
      });
    }

    // Batch 1 moves b1, b2 -> cursor = 'b2'
    const r1 = (
      await executeDeleteSectorGovernance(buildPort(), {
        rawPayload: { sectorId: 'sec_src', reassignToSectorId: 'sec_dst', batchLimit: 2 },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;
    assert.equal(r1.completed, false);
    assert.equal(r1.resumeAfterCompanyId, 'b2');
    assert.ok(r1.mutationId);

    // Mismatched mutationId must reject
    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(buildPort(), {
          rawPayload: {
            sectorId: 'sec_src',
            reassignToSectorId: 'sec_dst',
            mutationId: 'bad_mutation_id',
            resumeAfterCompanyId: r1.resumeAfterCompanyId,
            batchLimit: 2,
          },
          stamp: STAMP,
          maxAtomicCompanies: 2,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // Seed company 'a0' BEHIND cursor 'b2' in real Firestore Emulator
    await ctx.db.collection('companies').doc('a0').set({
      id: 'a0',
      ticker: 'A0',
      sectorId: 'sec_src',
      sector: 'قطاع مرحلي',
      rawSector: 'قطاع مرحلي',
      isDeleted: false,
    });

    // Batch 2 processes 'b3', MUST catch 'a0' behind cursor and NOT delete sec_src yet
    const r2 = (
      await executeDeleteSectorGovernance(buildPort(), {
        rawPayload: {
          sectorId: 'sec_src',
          reassignToSectorId: 'sec_dst',
          mutationId: r1.mutationId,
          resumeAfterCompanyId: r1.resumeAfterCompanyId,
          batchLimit: 2,
        },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;
    assert.equal(r2.completed, false);
    assert.equal(r2.remainingLinkedCount, 1);
    assert.equal(r2.resumeAfterCompanyId, null);
    assert.equal((await ctx.db.collection('sectorPE').doc('sec_src').get()).exists, true);

    // Batch 3 sweeps 'a0' and completes deletion atomically
    const r3 = (
      await executeDeleteSectorGovernance(buildPort(), {
        rawPayload: {
          sectorId: 'sec_src',
          reassignToSectorId: 'sec_dst',
          mutationId: r1.mutationId,
          resumeAfterCompanyId: r2.resumeAfterCompanyId,
          batchLimit: 2,
        },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;
    assert.equal(r3.completed, true);
    assert.equal(r3.remainingLinkedCount, 0);
    assert.equal((await ctx.db.collection('sectorPE').doc('sec_src').get()).exists, false);
    assert.equal((await ctx.db.collection('companies').doc('a0').get()).data()?.sectorId, 'sec_dst');

    // Re-running toggle/disable on another sector after moving does NOT re-move companies with old rawSector
    await ctx.db.collection('sectorPE').doc('sec_replay').set({
      sectorId: 'sec_replay',
      nameAr: 'قطاع إعادة',
      aliases: [],
      classification: 'non_financial',
      multiple: 9,
      status: 'active',
      isDeleted: false,
    });
    await ctx.db.collection('companies').doc('r_co').set({
      id: 'r_co',
      ticker: 'RCO',
      sectorId: 'sec_replay',
      sector: 'قطاع إعادة',
      rawSector: 'قطاع إعادة',
      isDeleted: false,
    });
    const t1 = (
      await executeToggleSectorStatusGovernance(buildPort(), {
        rawPayload: {
          sectorId: 'sec_replay',
          status: 'disabled',
          reassignToSectorId: 'sec_dst',
        },
        stamp: STAMP,
      })
    ).report;
    assert.equal(t1.completed, true);
    assert.equal(t1.reassignedCount, 1);

    // Re-run disable on sec_replay -> idempotent (0 moved, rawSector still 'قطاع إعادة')
    const t2 = (
      await executeToggleSectorStatusGovernance(buildPort(), {
        rawPayload: {
          sectorId: 'sec_replay',
          status: 'disabled',
          reassignToSectorId: 'sec_dst',
        },
        stamp: STAMP,
      })
    ).report;
    assert.equal(t2.completed, true);
    assert.equal(t2.reassignedCount, 0);
    assert.equal((await ctx.db.collection('companies').doc('r_co').get()).data()?.sectorId, 'sec_dst');
    assert.equal((await ctx.db.collection('companies').doc('r_co').get()).data()?.rawSector, 'قطاع إعادة');
  });
});
