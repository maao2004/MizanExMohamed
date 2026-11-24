/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real Firestore Emulator Transactional Persistence & Concurrency Suite for
 * `real_estate_disclosures`.
 *
 * Executes the EXACT production transactional executor (`executeSaveRealEstateDisclosure` +
 * `createFirestoreAdminRealEstateDisclosureTransactionPort`) used by `updateFinancialData`
 * (`operationType: 'real_estate_disclosure'`) directly against a real local Firestore Emulator.
 *
 * Scope transparency:
 * - Uses the existing `emulatorHarness.ts` safety API (`createEmulatorAdminContext`,
 *   `EmulatorAdminContext`, `resetDatabase`, `cleanup`) — strictly isolated to `demo-*`
 *   emulator projects, NEVER connects to production, NEVER silently skips.
 * - Verifies real Firestore `db.runTransaction` atomicity, mandatory `expectedDocId` on update,
 *   A->B same-revision identity-mutation rejection, optimistic concurrency (`ALREADY_EXISTS`,
 *   `REVISION_MISMATCH`, `IDENTITY_MISMATCH`, `INCOMPLETE_PRECONDITION`), zero-write idempotency,
 *   and honest read-only linkage verification against real `companies` and `quarterly_financial_records`.
 * - Does NOT invoke the Cloud Functions `onCall` transport/auth wrapper directly.
 */

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createFirestoreAdminRealEstateDisclosureTransactionPort,
  executeSaveRealEstateDisclosure,
  QUARTERLY_FINANCIAL_RECORDS_COLLECTION,
  REAL_ESTATE_DISCLOSURES_COLLECTION,
  RealEstateDisclosureConcurrencyConflictError,
  type RealEstateDisclosureAdminFirestoreLike,
  type RealEstateDisclosureDocumentProvenance,
} from '../../src/core/contracts';
import { createEmulatorAdminContext, type EmulatorAdminContext } from './emulatorHarness';

function makeProvenance(
  overrides: Partial<RealEstateDisclosureDocumentProvenance> = {}
): RealEstateDisclosureDocumentProvenance {
  return {
    importId: 'emu_re_1',
    sourceFile: 'emulator_test',
    sourceSheet: 'real_estate_disclosure',
    schemaVersion: 3,
    updatedBy: 'entry-uid-emu',
    updatedAt: '2026-06-05T10:00:00.000Z',
    serverUpdatedAt: '2026-06-05T10:00:00.000Z',
    isDeleted: false,
    ...overrides,
  };
}

function sampleDisclosure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    disclosureId: 'inv_prop_total',
    ticker: 'TMGH',
    fiscalYear: 2025,
    fiscalQuarter: 'FY',
    balanceSheetDate: '2025-12-31',
    statementScope: 'consolidated',
    assetCategory: 'investment_property',
    assetUsageDescription: 'مراكز تجارية مؤجرة للغير',
    accountingPolicy: 'cost_model',
    aggregationLevel: 'total_summary',
    parentDisclosureId: null,
    carryingValue: 12_500_000_000,
    disclosedFairValue: 28_000_000_000,
    fairValueDate: '2025-12-31',
    fairValueStatementScope: 'consolidated',
    fairValueAssetScopeMatchesCarrying: true,
    fairValueSource: 'مثمن عقاري مستقل معتمد',
    fairValueSourceType: 'independent_valuer',
    footnoteReference: 'إيضاح 11 — الاستثمارات العقارية',
    explanatoryNote: 'مراجعة القوائم الموحدة المدققة لعام 2025.',
    ...overrides,
  };
}

describe('Real Firestore Emulator — real_estate_disclosures Transactional Write & Concurrency', () => {
  let ctx: EmulatorAdminContext;

  before(() => {
    ctx = createEmulatorAdminContext('real-estate-disclosures');
  });

  beforeEach(async () => {
    await ctx.resetDatabase();
  });

  after(async () => {
    if (ctx) {
      await ctx.cleanup();
    }
  });

  it('creates, updates, skips unchanged retries with zero writes, and enforces mandatory expectedDocId + same-revision A->B identity guard inside real Firestore transactions', async () => {
    const port = createFirestoreAdminRealEstateDisclosureTransactionPort(
      ctx.db as unknown as RealEstateDisclosureAdminFirestoreLike
    );

    await ctx.db.collection('companies').doc('tmgh').set({
      id: 'tmgh',
      ticker: 'TMGH',
      nameAr: 'طلعت مصطفى',
      isDeleted: false,
    });
    await ctx.db.collection(QUARTERLY_FINANCIAL_RECORDS_COLLECTION).doc('TMGH_2025_FY').set({
      ticker: 'TMGH',
      year: 2025,
      quarter: 'FY',
      periodEndDate: '2025-12-31',
      isDeleted: false,
    });

    // Create disclosures A and B at revision 1
    const docA = await executeSaveRealEstateDisclosure(port, {
      rawPayload: {
        record: sampleDisclosure({ disclosureId: 'disclosure_A', carryingValue: 1_000 }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance({ updatedAt: '2026-06-05T10:00:00.000Z', updatedBy: 'u1' }),
    });
    const docB = await executeSaveRealEstateDisclosure(port, {
      rawPayload: {
        record: sampleDisclosure({ disclosureId: 'disclosure_B', carryingValue: 2_000 }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance({ updatedAt: '2026-06-05T10:01:00.000Z', updatedBy: 'u1' }),
    });

    assert.equal(docA.status, 'created');
    assert.equal(docA.revision, 1);
    assert.equal(docB.status, 'created');
    assert.equal(docB.revision, 1);
    assert.equal(docA.linkage.overallLinkageStatus, 'verified');

    const snapA1 = await ctx.db.collection(REAL_ESTATE_DISCLOSURES_COLLECTION).doc(docA.docId).get();
    const snapB1 = await ctx.db.collection(REAL_ESTATE_DISCLOSURES_COLLECTION).doc(docB.docId).get();
    assert.equal(snapA1.exists, true);
    assert.equal(snapB1.exists, true);

    // 1) Update WITHOUT expectedDocId MUST be rejected even with valid revision & hash
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(port, {
          rawPayload: {
            record: sampleDisclosure({ disclosureId: 'disclosure_A', carryingValue: 1_500 }),
            precondition: {
              mode: 'update',
              expectedRevision: 1,
              expectedContentHash: docA.contentHash,
            },
          },
          provenance: makeProvenance(),
        }),
      (err: unknown) =>
        err instanceof RealEstateDisclosureConcurrencyConflictError &&
        err.conflict.reason === 'INCOMPLETE_PRECONDITION'
    );

    // 2) Mutating A's edit into B's identity (while both share revision 1!) MUST be rejected
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(port, {
          rawPayload: {
            record: sampleDisclosure({ disclosureId: 'disclosure_B', carryingValue: 9_999 }),
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
        err.conflict.reason === 'IDENTITY_MISMATCH'
    );

    // Neither A nor B changed in Firestore
    const snapAAfterReject = await ctx.db
      .collection(REAL_ESTATE_DISCLOSURES_COLLECTION)
      .doc(docA.docId)
      .get();
    const snapBAfterReject = await ctx.db
      .collection(REAL_ESTATE_DISCLOSURES_COLLECTION)
      .doc(docB.docId)
      .get();
    assert.equal(snapAAfterReject.data()?.carryingValue, 1_000);
    assert.equal(snapBAfterReject.data()?.carryingValue, 2_000);
    assert.equal(snapAAfterReject.updateTime?.toMillis(), snapA1.updateTime?.toMillis());
    assert.equal(snapBAfterReject.updateTime?.toMillis(), snapB1.updateTime?.toMillis());

    // 3) Unchanged update -> no-op, updateTime on Firestore document remains identical
    const noOp = await executeSaveRealEstateDisclosure(port, {
      rawPayload: {
        record: sampleDisclosure({ disclosureId: 'disclosure_A', carryingValue: 1_000 }),
        precondition: {
          mode: 'update',
          expectedDocId: docA.docId,
          expectedRevision: 1,
          expectedContentHash: docA.contentHash,
        },
      },
      provenance: makeProvenance({ updatedAt: '2026-06-05T11:00:00.000Z', updatedBy: 'u2' }),
    });
    assert.equal(noOp.status, 'unchanged');
    assert.equal(noOp.wroteToDatabase, false);
    const snapAfterNoOp = await ctx.db
      .collection(REAL_ESTATE_DISCLOSURES_COLLECTION)
      .doc(docA.docId)
      .get();
    assert.equal(snapAfterNoOp.updateTime?.toMillis(), snapA1.updateTime?.toMillis());

    // 4) Valid update -> revision 2
    const updated = await executeSaveRealEstateDisclosure(port, {
      rawPayload: {
        record: sampleDisclosure({ disclosureId: 'disclosure_A', carryingValue: 1_750 }),
        precondition: {
          mode: 'update',
          expectedDocId: docA.docId,
          expectedRevision: 1,
          expectedContentHash: docA.contentHash,
        },
      },
      provenance: makeProvenance({ updatedAt: '2026-06-05T12:00:00.000Z', updatedBy: 'u2' }),
    });
    assert.equal(updated.status, 'updated');
    assert.equal(updated.revision, 2);

    // 5) Stale update using rev 1 -> REVISION_MISMATCH
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(port, {
          rawPayload: {
            record: sampleDisclosure({ disclosureId: 'disclosure_A', carryingValue: 1_900 }),
            precondition: {
              mode: 'update',
              expectedDocId: docA.docId,
              expectedRevision: 1,
              expectedContentHash: docA.contentHash,
            },
          },
          provenance: makeProvenance({ updatedAt: '2026-06-05T12:05:00.000Z', updatedBy: 'u1' }),
        }),
      (err: unknown) =>
        err instanceof RealEstateDisclosureConcurrencyConflictError &&
        err.conflict.reason === 'REVISION_MISMATCH'
    );

    // 6) Duplicate create with different content -> ALREADY_EXISTS
    await assert.rejects(
      () =>
        executeSaveRealEstateDisclosure(port, {
          rawPayload: {
            record: sampleDisclosure({ disclosureId: 'disclosure_A', carryingValue: 999 }),
            precondition: { mode: 'create' },
          },
          provenance: makeProvenance(),
        }),
      (err: unknown) =>
        err instanceof RealEstateDisclosureConcurrencyConflictError &&
        err.conflict.reason === 'ALREADY_EXISTS'
    );
  });

  it('honestly separates document existence from identity validity, catches ticker/period/date conflicts, supports documented non-calendar FY, and never auto-creates missing references', async () => {
    const port = createFirestoreAdminRealEstateDisclosureTransactionPort(
      ctx.db as unknown as RealEstateDisclosureAdminFirestoreLike
    );

    // 1) Missing references never auto-created
    const missingRes = await executeSaveRealEstateDisclosure(port, {
      rawPayload: {
        record: sampleDisclosure({ ticker: 'ORHD' }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(missingRes.linkage.companyLinkStatus, 'missing_company');
    assert.equal(missingRes.linkage.quarterlyLinkStatus, 'missing_quarterly_record');
    assert.equal((await ctx.db.collection('companies').doc('orhd').get()).exists, false);
    assert.equal(
      (await ctx.db.collection(QUARTERLY_FINANCIAL_RECORDS_COLLECTION).doc('ORHD_2025_FY').get()).exists,
      false
    );

    // 2) Existing docs with missing/invalid identity -> unverified (NEVER verified)
    await ctx.db.collection('companies').doc('badc').set({ id: 'badc', ticker: '###INVALID###', isDeleted: false });
    await ctx.db.collection(QUARTERLY_FINANCIAL_RECORDS_COLLECTION).doc('BADC_2025_FY').set({
      periodEndDate: '2025-12-31',
      isDeleted: false,
    });
    const unverifiedRes = await executeSaveRealEstateDisclosure(port, {
      rawPayload: {
        record: sampleDisclosure({ ticker: 'BADC' }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(unverifiedRes.linkage.companyLinkStatus, 'unverified_company_identity');
    assert.equal(unverifiedRes.linkage.quarterlyLinkStatus, 'unverified_quarterly_identity');
    assert.equal(unverifiedRes.linkage.overallLinkageStatus, 'partial_unverified');

    // 3) Conflicting year/quarter inside quarterly_financial_records -> period_conflict
    await ctx.db.collection('companies').doc('phdc').set({ id: 'phdc', ticker: 'PHDC', isDeleted: false });
    await ctx.db.collection(QUARTERLY_FINANCIAL_RECORDS_COLLECTION).doc('PHDC_2025_FY').set({
      ticker: 'PHDC',
      year: 2024,
      quarter: 'Q3',
      periodEndDate: '2025-12-31',
      isDeleted: false,
    });
    const periodConflictRes = await executeSaveRealEstateDisclosure(port, {
      rawPayload: {
        record: sampleDisclosure({ ticker: 'PHDC', fiscalYear: 2025, fiscalQuarter: 'FY' }),
        precondition: { mode: 'create' },
      },
      provenance: makeProvenance(),
    });
    assert.equal(periodConflictRes.linkage.quarterlyLinkStatus, 'period_conflict');
    assert.equal(periodConflictRes.linkage.overallLinkageStatus, 'conflict');

    // 4) Documented non-calendar fiscal year (July–June, FY ending 2025-06-30) -> verified
    await ctx.db.collection('companies').doc('east').set({ id: 'east', ticker: 'EAST', isDeleted: false });
    await ctx.db.collection(QUARTERLY_FINANCIAL_RECORDS_COLLECTION).doc('EAST_2025_FY').set({
      ticker: 'EAST',
      year: 2025,
      quarter: 'FY',
      periodStartDate: '2024-07-01',
      periodEndDate: '2025-06-30',
      isDeleted: false,
    });
    const nonCalendarRes = await executeSaveRealEstateDisclosure(port, {
      rawPayload: {
        record: sampleDisclosure({
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
    assert.equal(nonCalendarRes.linkage.companyLinkStatus, 'verified');
    assert.equal(nonCalendarRes.linkage.quarterlyLinkStatus, 'verified');
    assert.equal(nonCalendarRes.linkage.overallLinkageStatus, 'verified');
    assert.deepEqual(nonCalendarRes.linkage.warningsAr, []);
  });
});
