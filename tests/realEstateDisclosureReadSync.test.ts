/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Acceptance & Governance Tests for Batch 44:
 * Centralized Read, Transform, Scoped Cache, Incremental Delta Sync,
 * Session Exposure, Permission Gating, and Honest Read-Side Linkage for
 * `real_estate_disclosures`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { DocumentData, QuerySnapshot } from 'firebase/firestore';

import {
  REAL_ESTATE_DISCLOSURES_COLLECTION,
  type RealEstateDisclosureInput,
} from '../src/core/contracts';
import { evaluateRealEstateFairValueGap } from '../src/core/domain/realEstateDisclosureAnalysis';
import {
  canUserReadRealEstateDisclosures,
  computeRealEstateLinkageSourcesVersion,
  createDeletionMarkerFromReadRecord,
  evaluateRealEstateDisclosureReadLinkage,
  evaluateRealEstateDisclosuresReadLinkage,
  isRealEstateLinkageSnapshotFresh,
  mergeRealEstateDisclosureDeltas,
  normalizeRealEstateDisclosureFromFirestore,
  resolveRealEstateDisclosureMerge,
  toRealEstateDisclosureInspectableInput,
  type RealEstateDisclosureDeletionMarker,
  type RealEstateDisclosureReadRecord,
} from '../src/core/domain/realEstateDisclosureRead';
import { FirestoreSessionManager } from '../src/core/domain/firestoreSessionManager';
import {
  CURSOR_OVERLAP_MS,
  FirestoreSyncManager,
  type RealEstateDisclosuresFetchPort,
} from '../src/services/firebase/firestoreSync';
import type { FirestoreRepositories } from '../src/services/firebase/firestoreRepositories';
import { mapRealEstateDisclosuresSnapshot } from '../src/services/firebase/firestoreTransforms';
import { CacheService } from '../src/services/storage/cacheService';
import {
  createMemoryAtomicPersistenceDriver,
  type AtomicDeltaPersistenceDriver,
  type ScopedIndexedDbState,
} from '../src/services/storage/indexedDbStore';
import type { QuarterlyFinancialRecord } from '../src/types';
import type { Company } from '../src/types/financial';

// --- LocalStorage Test Harness ---

function installMockLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  return store;
}

function makeFakeSnapshot(
  docs: Array<{ id: string; data: Record<string, unknown> }>
): QuerySnapshot<DocumentData> {
  return {
    forEach(cb: (d: { id: string; data: () => Record<string, unknown> }) => void) {
      for (const doc of docs) {
        cb({
          id: doc.id,
          data: () => doc.data,
        });
      }
    },
  } as unknown as QuerySnapshot<DocumentData>;
}

function makeStoredCompleteDoc(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    docId: 'COMI__2025_FY__inv_prop_total',
    disclosureId: 'inv_prop_total',
    ticker: 'COMI',
    fiscalYear: 2025,
    fiscalQuarter: 'FY',
    linkedQuarterlyDocId: 'COMI_2025_FY',
    balanceSheetDate: '2025-12-31',
    statementScope: 'consolidated',
    assetCategory: 'investment_property',
    assetUsageDescription: 'محفظة عقارات استثمارية مؤجرة بعقود طويلة الأجل',
    accountingPolicy: 'cost_model',
    aggregationLevel: 'total_summary',
    parentDisclosureId: null,
    carryingValue: 1_250_000_000,
    disclosedFairValue: 1_890_000_000,
    fairValueDate: '2025-12-31',
    fairValueStatementScope: 'consolidated',
    fairValueAssetScopeMatchesCarrying: true,
    fairValueSource: 'تقرير خبير تقييم عقاري معتمد لدى الهيئة العامة للرقابة المالية',
    fairValueSourceType: 'independent_valuer',
    footnoteReference: 'إيضاح رقم (14) — الاستثمارات العقارية',
    explanatoryNote: 'القيمة العادلة تشمل الأراضي والمباني الاستثمارية بالكامل وفق نموذج التكلفة.',
    completenessStatus: 'complete_comparable',
    revision: 3,
    contentHash: 'sha256:abc123def456',
    schemaVersion: 1,
    createdAt: '2026-03-01T10:00:00.000Z',
    createdBy: 'uid_data_entry_1',
    updatedAt: '2026-03-10T12:30:00.000Z',
    updatedBy: 'uid_admin_1',
    serverUpdatedAt: { toMillis: () => 1_773_145_800_000 },
    isDeleted: false,
    ...overrides,
  };
}

function makeCompany(ticker: string, id?: string, updatedAt = '2026-03-01T00:00:00.000Z'): Company {
  return {
    id: id ?? ticker.toLowerCase(),
    ticker,
    nameAr: `${ticker} العقارية`,
    nameEn: `${ticker} Corp`,
    sector: 'Real Estate',
    marketPrice: 10,
    sharesOutstanding: 1_000_000,
    beta: null,
    riskFreeRate: null,
    equityRiskPremium: null,
    costOfDebt: null,
    taxRate: null,
    targetDebtRatio: null,
    sustainableGrowthRate: null,
    shortTermGrowthRate: null,
    targetPE: null,
    targetPB: null,
    currency: 'EGP',
    updatedAt,
  };
}

function makeQuarterly(
  ticker: string,
  year: number,
  quarter: 'Q1' | 'Q2' | 'Q3' | 'FY',
  periodEndDate?: string,
  updatedAt = '2026-03-01T00:00:00.000Z'
): QuarterlyFinancialRecord {
  return {
    ticker,
    stockName: `${ticker} Corp`,
    yearQuarter: `${year}${quarter}`,
    year,
    quarter,
    periodEndDate,
    shares: 1_000_000,
    intangibleAssets: null,
    totalAssets: 500,
    equity: 200,
    totalDebtWithoutTX: 50,
    totalLiabilities: 300,
    revenueYTD: 100,
    ebitYTD: 30,
    netIncomeYTD: 20,
    cfoYTD: 25,
    capexYTD: 5,
    cash: 40,
    updatedAt,
  } as unknown as QuarterlyFinancialRecord;
}

// =============================================================================
// 1) Initial Load Contract, Non-Mutating Read, Complete & Partial Records
// =============================================================================

test('Batch 44.1: normalizes complete & partial records without mutating input and preserves concurrency/audit metadata', () => {
  const completeRaw = Object.freeze(makeStoredCompleteDoc());
  const completeRecord = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_prop_total',
    completeRaw
  );

  // Strict read contract metadata preserved for future concurrent editing
  assert.equal(completeRecord.docId, 'COMI__2025_FY__inv_prop_total');
  assert.equal(
    completeRecord.docPath,
    `${REAL_ESTATE_DISCLOSURES_COLLECTION}/COMI__2025_FY__inv_prop_total`
  );
  assert.equal(completeRecord.storedDocId, 'COMI__2025_FY__inv_prop_total');
  assert.equal(completeRecord.revision, 3);
  assert.equal(completeRecord.contentHash, 'sha256:abc123def456');
  assert.equal(completeRecord.createdAt, '2026-03-01T10:00:00.000Z');
  assert.equal(completeRecord.createdBy, 'uid_data_entry_1');
  assert.equal(completeRecord.updatedAt, '2026-03-10T12:30:00.000Z');
  assert.equal(completeRecord.updatedBy, 'uid_admin_1');
  assert.equal(completeRecord.serverUpdatedAtMs, 1_773_145_800_000);
  assert.equal(completeRecord.isDeleted, false);
  assert.equal(completeRecord.readIntegrityStatus, 'clean');
  assert.equal(completeRecord.readIssues.length, 0);
  assert.equal(completeRecord.unrecognizedFields.length, 0);
  assert.equal(completeRecord.derivedStatus.completenessStatus, 'complete_comparable');
  assert.equal(completeRecord.derivedStatus.structuralValidityStatus, 'valid');
  assert.equal(completeRecord.derivedStatus.comparabilityStatus, 'comparable');

  // Verify read record is strictly distinct from write input shape (has docId/docPath/revision/contentHash/derivedStatus)
  const writePayloadShapeCheck: RealEstateDisclosureInput = {
    disclosureId: completeRecord.disclosureId!,
    ticker: completeRecord.ticker!,
    fiscalYear: completeRecord.fiscalYear,
    fiscalQuarter: completeRecord.fiscalQuarter,
    balanceSheetDate: completeRecord.balanceSheetDate,
    statementScope: completeRecord.statementScope!,
    assetCategory: completeRecord.assetCategory!,
    accountingPolicy: completeRecord.accountingPolicy!,
    aggregationLevel: completeRecord.aggregationLevel!,
    carryingValue: completeRecord.carryingValue,
    disclosedFairValue: completeRecord.disclosedFairValue,
  };
  assert.equal('revision' in writePayloadShapeCheck, false);
  assert.equal('docPath' in writePayloadShapeCheck, false);
  assert.equal('derivedStatus' in writePayloadShapeCheck, false);

  // Partial record (date-only without fiscalYear/fiscalQuarter, missing disclosedFairValue)
  const partialRaw = Object.freeze({
    docId: 'TMGH__2025-09-30__land_bank_note',
    disclosureId: 'land_bank_note',
    ticker: 'TMGH',
    fiscalYear: null,
    fiscalQuarter: null,
    linkedQuarterlyDocId: null,
    balanceSheetDate: '2025-09-30',
    statementScope: 'standalone',
    assetCategory: 'land_bank_unspecified_use',
    accountingPolicy: 'cost_model',
    aggregationLevel: 'standalone_item',
    carryingValue: 450_000_000,
    disclosedFairValue: null,
    fairValueDate: null,
    fairValueStatementScope: null,
    fairValueAssetScopeMatchesCarrying: null,
    fairValueSource: null,
    fairValueSourceType: 'unspecified',
    footnoteReference: null,
    explanatoryNote: null,
    revision: 1,
    contentHash: 'sha256:partial001',
    createdAt: '2026-03-02T09:00:00.000Z',
    createdBy: 'uid_data_entry_2',
    updatedAt: '2026-03-02T09:00:00.000Z',
    updatedBy: 'uid_data_entry_2',
    serverUpdatedAt: { seconds: 1_773_000_000, nanoseconds: 0 },
  });

  const partialRecord = normalizeRealEstateDisclosureFromFirestore(
    'TMGH__2025-09-30__land_bank_note',
    partialRaw
  );
  assert.equal(partialRecord.readIntegrityStatus, 'clean');
  assert.equal(partialRecord.fiscalYear, null);
  assert.equal(partialRecord.fiscalQuarter, null);
  assert.equal(partialRecord.linkedQuarterlyDocId, null);
  assert.equal(partialRecord.balanceSheetDate, '2025-09-30');
  assert.equal(partialRecord.carryingValue, 450_000_000);
  assert.equal(partialRecord.disclosedFairValue, null);
  assert.equal(partialRecord.derivedStatus.completenessStatus, 'partial_missing_fair_value');
  assert.equal(partialRecord.serverUpdatedAtMs, 1_773_000_000_000);
});

// =============================================================================
// 2) Preservation of 0, null, false, and Full Original Arabic Multiline Text
// =============================================================================

test('Batch 44.2: preserves 0 vs null, false vs null, and full verbatim Arabic multiline text without truncation', () => {
  const longArabicUsage =
    'السطر الأول: أراضٍ استثمارية مملوكة بالكامل في القاهرة الجديدة.\n' +
    'السطر الثاني:   تحتفظ بمسافات داخلية وفواصل، ' +
    'تفاصيل إضافية طويلة تتجاوز الحد المعتاد للتأكد من عدم حدوث أي قص صامت عند القراءة. '.repeat(6);
  const longSource = 'تقييم عقاري مفصل — السطر الأول\nالسطر الثاني: ' + 'تفاصيل جهة التقييم '.repeat(12);
  const longFootnote = 'إيضاح (19-أ) الفقرة الثالثة — ' + 'مرجع نصي كامل '.repeat(10);
  const longNote = 'ملاحظة تحليلية غير مقصوصة:\n1) القيمة الدفترية صفر بعد الإهلاك الكامل.\n2) ' + 'شرح مفصل '.repeat(25);

  const raw = Object.freeze(
    makeStoredCompleteDoc({
      carryingValue: 0,
      disclosedFairValue: null,
      fairValueAssetScopeMatchesCarrying: false,
      assetUsageDescription: longArabicUsage,
      fairValueSource: longSource,
      footnoteReference: longFootnote,
      explanatoryNote: longNote,
      revision: 7,
      contentHash: 'sha256:preserve_exact_0_null_false_text',
    })
  );

  const record = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_prop_total',
    raw
  );

  assert.strictEqual(record.carryingValue, 0);
  assert.strictEqual(record.disclosedFairValue, null);
  assert.strictEqual(record.fairValueAssetScopeMatchesCarrying, false);
  assert.strictEqual(record.assetUsageDescription, longArabicUsage);
  assert.strictEqual(record.fairValueSource, longSource);
  assert.strictEqual(record.footnoteReference, longFootnote);
  assert.strictEqual(record.explanatoryNote, longNote);
  assert.strictEqual(record.revision, 7);
  assert.strictEqual(record.contentHash, 'sha256:preserve_exact_0_null_false_text');

  // Verify null vs false distinction on fairValueAssetScopeMatchesCarrying
  const nullFlagRecord = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_prop_total',
    makeStoredCompleteDoc({ fairValueAssetScopeMatchesCarrying: null })
  );
  assert.strictEqual(nullFlagRecord.fairValueAssetScopeMatchesCarrying, null);
});

// =============================================================================
// 3) Unrecognized Stored Values & Structural Anomalies Stay Visible (Never Dropped)
// =============================================================================

test('Batch 44.3: retains records with unrecognized enum codes or invalid fields for transparent review without silent coercion', () => {
  const malformedRaw = Object.freeze({
    docId: 'DIFFERENT_STORED_ID',
    disclosureId: 'legacy_record_1',
    ticker: 'PHDC',
    fiscalYear: 2025,
    fiscalQuarter: 'Q4', // unrecognized (MizanEX uses Q1/Q2/Q3/FY)
    balanceSheetDate: '2026-02-30', // invalid calendar date
    statementScope: 'custom_group_scope',
    assetCategory: 'legacy_mall_v0',
    accountingPolicy: 'revaluation_legacy',
    aggregationLevel: 'partial_group',
    carryingValue: -100, // negative
    disclosedFairValue: 500,
    fairValueDate: '2025-12-31',
    fairValueStatementScope: 'unknown_fv_scope',
    fairValueAssetScopeMatchesCarrying: 'yes_string',
    fairValueSourceType: 'broker_quote',
    revision: 2,
    contentHash: 'sha256:legacy_bad',
    serverUpdatedAt: { toMillis: () => 1_773_200_000_000 },
  });

  const snap = makeFakeSnapshot([
    { id: 'PHDC__2025_Q4__legacy_record_1', data: malformedRaw },
    { id: 'COMI__2025_FY__inv_prop_total', data: makeStoredCompleteDoc() },
  ]);

  const mapped = mapRealEstateDisclosuresSnapshot(snap);
  // MUST NOT drop the malformed record
  assert.equal(mapped.records.length, 2);
  assert.equal(mapped.allRecords.length, 2);
  assert.equal(mapped.deletedDocIds.length, 0);

  const bad = mapped.records.find((r) => r.docId === 'PHDC__2025_Q4__legacy_record_1')!;
  assert.ok(bad);
  assert.equal(bad.readIntegrityStatus, 'needs_review');
  assert.equal(bad.storedDocId, 'DIFFERENT_STORED_ID');

  // Unrecognized enums remain null in typed code and verbatim in raw* fields
  assert.equal(bad.statementScope, null);
  assert.equal(bad.rawStatementScope, 'custom_group_scope');
  assert.equal(bad.statementScopeStatus, 'unrecognized');

  assert.equal(bad.assetCategory, null);
  assert.equal(bad.rawAssetCategory, 'legacy_mall_v0');
  assert.equal(bad.assetCategoryStatus, 'unrecognized');

  assert.equal(bad.accountingPolicy, null);
  assert.equal(bad.rawAccountingPolicy, 'revaluation_legacy');
  assert.equal(bad.accountingPolicyStatus, 'unrecognized');

  assert.equal(bad.aggregationLevel, null);
  assert.equal(bad.rawAggregationLevel, 'partial_group');
  assert.equal(bad.aggregationLevelStatus, 'unrecognized');

  assert.equal(bad.fairValueStatementScope, null);
  assert.equal(bad.rawFairValueStatementScope, 'unknown_fv_scope');
  assert.equal(bad.fairValueStatementScopeStatus, 'unrecognized');

  assert.equal(bad.fairValueSourceType, null);
  assert.equal(bad.rawFairValueSourceType, 'broker_quote');
  assert.equal(bad.fairValueSourceTypeStatus, 'unrecognized');

  assert.equal(bad.fiscalQuarter, null);
  assert.equal(bad.rawFiscalQuarter, 'Q4');

  assert.equal(bad.carryingValue, null);
  assert.equal(bad.rawCarryingValue, -100);

  assert.equal(bad.balanceSheetDate, null);
  assert.equal(bad.rawBalanceSheetDate, '2026-02-30');

  assert.ok(bad.unrecognizedFields.length >= 6);
  assert.ok(bad.readIssues.some((i) => i.code === 'doc_id_mismatch'));
  assert.ok(bad.readIssues.some((i) => i.code === 'invalid_numeric_value'));
  assert.ok(bad.readIssues.some((i) => i.code === 'invalid_calendar_date'));
  assert.ok(bad.readIssues.some((i) => i.code === 'invalid_boolean_flag'));

  assert.equal(bad.derivedStatus.structuralValidityStatus, 'invalid');
  assert.equal(bad.derivedStatus.completenessStatus, 'unrecognized_classification');

  // Adapting to pure analysis engine does not crash and surfaces invalid structural status cleanly
  const inspectable = toRealEstateDisclosureInspectableInput(bad);
  const gapEval = evaluateRealEstateFairValueGap(inspectable);
  assert.equal(gapEval.structuralValidityStatus, 'invalid');
  assert.equal(gapEval.comparable, false);
  assert.equal(gapEval.difference, null);
});

// =============================================================================
// 4) State Distinctions & Error Isolation in FirestoreSessionManager
// =============================================================================

test('Batch 44.4: distinguishes loading, cached_unconfirmed, confirmed_empty, confirmed, offline/network error, permission_denied and isolates errors', () => {
  const manager = new FirestoreSessionManager();
  const token = manager.beginSession('uid_admin_1', { canReadRealEstateDisclosures: true });

  // Confirm other core collections first to test isolation later
  manager.applyNonQuarterlySnapshot(token, 'companiesMeta', [makeCompany('COMI')], {
    fromCache: false,
    hasPendingWrites: false,
  });
  manager.applyQuarterlySnapshot(token, [makeQuarterly('COMI', 2025, 'FY', '2025-12-31')], {
    fromCache: false,
    hasPendingWrites: false,
  });

  // 1) Initial authorized state -> loading, NOT confirmed
  let state = manager.getState();
  assert.equal(state.realEstateDisclosuresAuthorized, true);
  assert.equal(state.realEstateDisclosuresStatus, 'loading');
  assert.equal(state.realEstateDisclosuresConfirmed, false);

  // 2) Cached empty snapshot while online -> cached_unconfirmed (NEVER confirmed_empty!)
  const cacheEmptyRes = manager.applyRealEstateDisclosuresSnapshot(
    token,
    [],
    { fromCache: true, hasPendingWrites: false },
    true
  );
  assert.equal(cacheEmptyRes.accepted, true);
  assert.equal(cacheEmptyRes.reason, 'cached_unconfirmed');
  state = cacheEmptyRes.state;
  assert.equal(state.realEstateDisclosuresStatus, 'cached_unconfirmed');
  assert.equal(state.realEstateDisclosuresConfirmed, false);
  assert.equal(state.realEstateDisclosuresFromCache, true);

  // 3) Cached snapshot while offline -> error (offline), NEVER confirmed_empty
  const cacheOfflineRes = manager.applyRealEstateDisclosuresSnapshot(
    token,
    [],
    { fromCache: true, hasPendingWrites: false },
    false
  );
  assert.equal(cacheOfflineRes.accepted, true);
  assert.equal(cacheOfflineRes.reason, 'cached_offline');
  state = cacheOfflineRes.state;
  assert.equal(state.realEstateDisclosuresStatus, 'error');
  assert.equal(state.realEstateDisclosuresErrorCode, 'offline');
  assert.equal(state.realEstateDisclosuresConfirmed, false);
  assert.equal(state.connectionError, null); // isolated from global connectionError!

  // 4) Server-confirmed empty -> confirmed_empty
  const confirmedEmptyRes = manager.applyRealEstateDisclosuresSnapshot(
    token,
    [],
    { fromCache: false, hasPendingWrites: false },
    true,
    '2026-03-10T12:00:00.000Z'
  );
  assert.equal(confirmedEmptyRes.accepted, true);
  state = confirmedEmptyRes.state;
  assert.equal(state.realEstateDisclosuresStatus, 'confirmed_empty');
  assert.equal(state.realEstateDisclosuresConfirmed, true);
  assert.equal(state.realEstateDisclosuresFromCache, false);
  assert.equal(state.realEstateDisclosuresLastSyncedAt, '2026-03-10T12:00:00.000Z');

  // 5) Server-confirmed non-empty -> confirmed
  const rec = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_prop_total',
    makeStoredCompleteDoc()
  );
  const confirmedRes = manager.applyRealEstateDisclosuresSnapshot(
    token,
    [rec],
    { fromCache: false, hasPendingWrites: false },
    true
  );
  state = confirmedRes.state;
  assert.equal(state.realEstateDisclosuresStatus, 'confirmed');
  assert.equal(state.realEstateDisclosuresConfirmed, true);
  assert.equal(state.realEstateDisclosures.length, 1);

  // 6) Network error on real_estate_disclosures -> status 'error', confirmed=false, global state untouched
  const netErrRes = manager.applyConnectionError(
    token,
    REAL_ESTATE_DISCLOSURES_COLLECTION,
    { code: 'unavailable', message: 'Backend temporarily unreachable' },
    true,
    true
  );
  assert.equal(netErrRes.accepted, true);
  state = netErrRes.state;
  assert.equal(state.realEstateDisclosuresStatus, 'error');
  assert.equal(state.realEstateDisclosuresErrorCode, 'offline');
  assert.equal(state.realEstateDisclosuresConfirmed, false);
  assert.equal(state.connectionError, null);
  assert.equal(state.companiesConfirmed, true);
  assert.equal(state.quarterlyConfirmed, true);

  // 7) Permission denied on real_estate_disclosures -> status 'permission_denied', global state untouched
  const permErrRes = manager.applyConnectionError(
    token,
    REAL_ESTATE_DISCLOSURES_COLLECTION,
    { code: 'permission-denied', message: 'Missing or insufficient permissions.' },
    true,
    true
  );
  assert.equal(permErrRes.accepted, true);
  state = permErrRes.state;
  assert.equal(state.realEstateDisclosuresStatus, 'permission_denied');
  assert.equal(state.realEstateDisclosuresErrorCode, 'permission_denied');
  assert.equal(state.realEstateDisclosuresConfirmed, false);
  assert.equal(state.connectionError, null);
  assert.equal(state.companiesMeta.length, 1);
  assert.equal(state.quarterlyRecords.length, 1);

  // 8) Manual sync with isolated real_estate_disclosures failure still commits all other collections
  const manualRes = manager.applyManualSyncResult(token, {
    quarterly: [makeQuarterly('COMI', 2025, 'FY', '2025-12-31')],
    companies: [makeCompany('COMI')],
    daily: [],
    stories: {},
    decisions: {},
    trades: [],
    macro: [],
    realEstateDisclosuresSyncOutcome: {
      attempted: true,
      status: 'error',
      isDelta: false,
      error: { code: 'permission-denied', message: 'Denied' },
    },
  });
  assert.equal(manualRes.accepted, true);
  assert.equal(manualRes.state.companiesConfirmed, true);
  assert.equal(manualRes.state.quarterlyConfirmed, true);
  assert.equal(manualRes.state.connectionError, null);
  assert.equal(manualRes.state.realEstateDisclosuresStatus, 'permission_denied');
  assert.equal(manualRes.state.realEstateDisclosuresConfirmed, false);
});

// =============================================================================
// 5) Incremental Delta Sync, Overlap Window, Deduplication, Soft-Delete & Cursor Guards
// =============================================================================

test('Batch 44.5: incremental delta sync uses serverUpdatedAt cursor + 15s overlap, deduplicates, handles soft-deletes, and blocks cursor advance on failed merge/persistence', async () => {
  installMockLocalStorage();
  const driver = createMemoryAtomicPersistenceDriver();
  CacheService.setPersistenceDriver(driver);
  CacheService.setScope({
    projectId: 'mizan-test',
    databaseId: 'default',
    uid: 'uid_editor_1',
  });
  CacheService.clearScopedCache();

  const t1 = 1_773_100_000_000;
  const t2 = 1_773_100_060_000; // +60s
  const t3 = 1_773_100_120_000; // +120s
  const t4 = 1_773_100_180_000; // +180s

  const docA_v1 = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_a',
    makeStoredCompleteDoc({
      docId: 'COMI__2025_FY__inv_a',
      disclosureId: 'inv_a',
      carryingValue: 100,
      revision: 1,
      serverUpdatedAt: { toMillis: () => t1 },
    })
  );
  const docA_v2 = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_a',
    makeStoredCompleteDoc({
      docId: 'COMI__2025_FY__inv_a',
      disclosureId: 'inv_a',
      carryingValue: 150,
      revision: 2,
      serverUpdatedAt: { toMillis: () => t2 },
    })
  );
  const docB_v1 = normalizeRealEstateDisclosureFromFirestore(
    'TMGH__2025_FY__inv_b',
    makeStoredCompleteDoc({
      docId: 'TMGH__2025_FY__inv_b',
      disclosureId: 'inv_b',
      ticker: 'TMGH',
      carryingValue: 300,
      revision: 1,
      serverUpdatedAt: { toMillis: () => t2 },
    })
  );
  const docB_deleted = normalizeRealEstateDisclosureFromFirestore(
    'TMGH__2025_FY__inv_b',
    makeStoredCompleteDoc({
      docId: 'TMGH__2025_FY__inv_b',
      disclosureId: 'inv_b',
      ticker: 'TMGH',
      carryingValue: 300,
      revision: 2,
      isDeleted: true,
      serverUpdatedAt: { toMillis: () => t3 },
    })
  );
  const docC_v1 = normalizeRealEstateDisclosureFromFirestore(
    'ORHD__2025_FY__inv_c',
    makeStoredCompleteDoc({
      docId: 'ORHD__2025_FY__inv_c',
      disclosureId: 'inv_c',
      ticker: 'ORHD',
      carryingValue: 500,
      revision: 1,
      serverUpdatedAt: { toMillis: () => t4 },
    })
  );

  let fullFetchCalls = 0;
  const deltaSinceMsCalls: number[] = [];
  let nextDeltaResponse: {
    records: RealEstateDisclosureReadRecord[];
    allRecords: RealEstateDisclosureReadRecord[];
    deletedDocIds: string[];
    deletedMarkers: RealEstateDisclosureDeletionMarker[];
    stamped: Array<{ serverUpdatedAt?: unknown }>;
  } = {
    records: [docA_v2, docB_v1],
    allRecords: [docA_v2, docB_v1],
    deletedDocIds: [],
    deletedMarkers: [],
    stamped: [docA_v2, docB_v1],
  };

  const port: RealEstateDisclosuresFetchPort = {
    async fetchFull() {
      fullFetchCalls += 1;
      return {
        records: [docA_v1],
        allRecords: [docA_v1],
        deletedDocIds: [],
        deletedMarkers: [],
        stamped: [docA_v1],
      };
    },
    async fetchDelta(sinceMs: number) {
      deltaSinceMsCalls.push(sinceMs);
      return nextDeltaResponse;
    },
  };

  const manager = new FirestoreSessionManager();
  const token = manager.beginSession('uid_editor_1', { canReadRealEstateDisclosures: true });

  // Step 1: Initial full baseline sync
  const res1 = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    persistenceDriver: driver,
    fetchPort: port,
    onConfirmedMerge: (payload) =>
      manager.applyRealEstateDisclosuresSyncDelta(token, {
        records: payload.records,
        incomingAll: payload.allRecords,
        deletedDocIds: payload.deletedDocIds,
        deletedMarkers: payload.deletedMarkers,
        isDelta: payload.isDelta,
      }).accepted,
  });

  assert.equal(res1.status, 'synced');
  assert.equal(res1.isDelta, false);
  assert.equal(fullFetchCalls, 1);
  assert.equal(deltaSinceMsCalls.length, 0);
  assert.equal(res1.committedCursorMs, t1);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), t1);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), true);
  assert.equal(manager.getState().realEstateDisclosures.length, 1);
  assert.equal(manager.getState().realEstateDisclosures[0].carryingValue, 100);

  // Step 2: Incremental delta sync -> uses fetchDelta(t1 - CURSOR_OVERLAP_MS), NO full re-fetch
  const res2 = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    existingRecords: manager.getState().realEstateDisclosures,
    persistenceDriver: driver,
    fetchPort: port,
    onConfirmedMerge: (payload) =>
      manager.applyRealEstateDisclosuresSyncDelta(token, {
        records: payload.records,
        incomingAll: payload.allRecords,
        deletedDocIds: payload.deletedDocIds,
        deletedMarkers: payload.deletedMarkers,
        isDelta: payload.isDelta,
      }).accepted,
  });

  assert.equal(res2.status, 'synced');
  assert.equal(res2.isDelta, true);
  assert.equal(fullFetchCalls, 1); // MUST NOT re-download full collection!
  assert.equal(deltaSinceMsCalls.length, 1);
  assert.equal(deltaSinceMsCalls[0], t1 - CURSOR_OVERLAP_MS);
  assert.equal(res2.committedCursorMs, t2);
  assert.equal(manager.getState().realEstateDisclosures.length, 2);
  assert.equal(
    manager.getState().realEstateDisclosures.find((r) => r.docId === 'COMI__2025_FY__inv_a')?.carryingValue,
    150
  );

  // Step 3: Empty delta preserves all previously loaded records & cursor
  nextDeltaResponse = {
    records: [],
    allRecords: [],
    deletedDocIds: [],
    deletedMarkers: [],
    stamped: [],
  };
  const res3 = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    existingRecords: manager.getState().realEstateDisclosures,
    persistenceDriver: driver,
    fetchPort: port,
    onConfirmedMerge: (payload) =>
      manager.applyRealEstateDisclosuresSyncDelta(token, {
        records: payload.records,
        incomingAll: payload.allRecords,
        deletedDocIds: payload.deletedDocIds,
        deletedMarkers: payload.deletedMarkers,
        isDelta: payload.isDelta,
      }).accepted,
  });

  assert.equal(res3.status, 'synced');
  assert.equal(res3.isDelta, true);
  assert.equal(res3.committedCursorMs, t2);
  assert.equal(manager.getState().realEstateDisclosures.length, 2);
  assert.equal(CacheService.getRealEstateDisclosures().length, 2);

  // Step 4: Overlap re-delivery of same doc + older version never duplicates or reverts newer version
  nextDeltaResponse = {
    records: [docA_v2, docA_v1],
    allRecords: [docA_v2, docA_v1],
    deletedDocIds: [],
    deletedMarkers: [],
    stamped: [docA_v2, docA_v1],
  };
  const res4 = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    existingRecords: manager.getState().realEstateDisclosures,
    persistenceDriver: driver,
    fetchPort: port,
    onConfirmedMerge: (payload) =>
      manager.applyRealEstateDisclosuresSyncDelta(token, {
        records: payload.records,
        incomingAll: payload.allRecords,
        deletedDocIds: payload.deletedDocIds,
        deletedMarkers: payload.deletedMarkers,
        isDelta: payload.isDelta,
      }).accepted,
  });

  assert.equal(res4.status, 'synced');
  assert.equal(manager.getState().realEstateDisclosures.length, 2);
  assert.equal(
    manager.getState().realEstateDisclosures.find((r) => r.docId === 'COMI__2025_FY__inv_a')?.revision,
    2
  );

  // Step 5: Soft-deleted record (`isDeleted: true`) removes docB from active state & cache
  nextDeltaResponse = {
    records: [],
    allRecords: [docB_deleted],
    deletedDocIds: ['TMGH__2025_FY__inv_b'],
    deletedMarkers: [createDeletionMarkerFromReadRecord(docB_deleted)],
    stamped: [docB_deleted],
  };
  const res5 = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    existingRecords: manager.getState().realEstateDisclosures,
    persistenceDriver: driver,
    fetchPort: port,
    onConfirmedMerge: (payload) =>
      manager.applyRealEstateDisclosuresSyncDelta(token, {
        records: payload.records,
        incomingAll: payload.allRecords,
        deletedDocIds: payload.deletedDocIds,
        deletedMarkers: payload.deletedMarkers,
        isDelta: payload.isDelta,
      }).accepted,
  });

  assert.equal(res5.status, 'synced');
  assert.equal(res5.committedCursorMs, t3);
  assert.equal(manager.getState().realEstateDisclosures.length, 1);
  assert.equal(manager.getState().realEstateDisclosures[0].docId, 'COMI__2025_FY__inv_a');
  assert.equal(CacheService.getRealEstateDisclosures().length, 1);

  // Step 6: Rejected merge (`onConfirmedMerge` returns false) MUST NOT advance cursor or overwrite cache
  nextDeltaResponse = {
    records: [docC_v1],
    allRecords: [docC_v1],
    deletedDocIds: [],
    deletedMarkers: [],
    stamped: [docC_v1],
  };
  const res6 = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    existingRecords: manager.getState().realEstateDisclosures,
    persistenceDriver: driver,
    fetchPort: port,
    onConfirmedMerge: () => false,
  });

  assert.equal(res6.status, 'merge_rejected');
  assert.equal(res6.candidateCursorMs, t4);
  assert.equal(res6.committedCursorMs, t3); // MUST remain t3!
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), t3);
  assert.equal(CacheService.getRealEstateDisclosures().length, 1);

  // Step 7: Atomic IndexedDB persistence failure MUST NOT advance cursor
  driver.setFailOnWrite(true);
  const res7 = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    existingRecords: manager.getState().realEstateDisclosures,
    persistenceDriver: driver,
    fetchPort: port,
    onConfirmedMerge: () => true,
  });
  driver.setFailOnWrite(false);

  assert.equal(res7.status, 'error');
  assert.equal(res7.committedCursorMs, t3);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), t3);
  assert.equal(driver.snapshot(CacheService.getScopeKey())?.deltaCursors.realEstateDisclosures, t3);
});

// =============================================================================
// 6) Permissions, Session Isolation, Logout, Account Switch, Role Revocation & Scoped Cache
// =============================================================================

test('Batch 44.6: enforces active admin/data_entry permissions, never fetches for unauthorized users, and prevents stale leaks on logout/switch/revocation', async () => {
  installMockLocalStorage();
  const driver = createMemoryAtomicPersistenceDriver();
  CacheService.setPersistenceDriver(driver);

  // Role authorization matrix matching firestore.rules (`isDataEntry()`)
  assert.equal(canUserReadRealEstateDisclosures({ role: 'admin', isActive: true }), true);
  assert.equal(canUserReadRealEstateDisclosures({ role: 'data_entry', isActive: true }), true);
  assert.equal(canUserReadRealEstateDisclosures({ role: 'subscriber', isActive: true }), false);
  assert.equal(canUserReadRealEstateDisclosures({ role: 'assistant', isActive: true }), false);
  assert.equal(canUserReadRealEstateDisclosures({ role: 'admin', isActive: false }), false);
  assert.equal(canUserReadRealEstateDisclosures({ role: 'data_entry', isActive: false }), false);
  assert.equal(canUserReadRealEstateDisclosures(null), false);
  assert.equal(canUserReadRealEstateDisclosures(undefined), false);

  // Unauthorized user MUST trigger ZERO Firestore reads
  let fetchCalled = 0;
  const guardedPort: RealEstateDisclosuresFetchPort = {
    async fetchFull() {
      fetchCalled += 1;
      return { records: [], allRecords: [], deletedDocIds: [], deletedMarkers: [], stamped: [] };
    },
    async fetchDelta() {
      fetchCalled += 1;
      return { records: [], allRecords: [], deletedDocIds: [], deletedMarkers: [], stamped: [] };
    },
  };

  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_sub_1' });
  const unauthSync = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: false,
    persistenceDriver: driver,
    fetchPort: guardedPort,
  });
  assert.equal(unauthSync.attempted, false);
  assert.equal(unauthSync.status, 'unauthorized');
  assert.equal(fetchCalled, 0);

  // Session manager unauthorized gating, role revocation, account switch, and logout
  const manager = new FirestoreSessionManager();
  const subToken = manager.beginSession('uid_sub_1', { canReadRealEstateDisclosures: false });
  assert.equal(manager.getState().realEstateDisclosuresStatus, 'unauthorized');
  const recA = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_a',
    makeStoredCompleteDoc({ docId: 'COMI__2025_FY__inv_a', disclosureId: 'inv_a' })
  );
  assert.equal(
    manager.applyRealEstateDisclosuresSnapshot(subToken, [recA], {
      fromCache: false,
      hasPendingWrites: false,
    }).reason,
    'unauthorized'
  );
  assert.equal(manager.getState().realEstateDisclosures.length, 0);

  // Authorized user A loads data
  const tokenA = manager.beginSession('uid_admin_a', { canReadRealEstateDisclosures: true });
  manager.applyRealEstateDisclosuresSnapshot(tokenA, [recA], {
    fromCache: false,
    hasPendingWrites: false,
  });
  assert.equal(manager.getState().realEstateDisclosures.length, 1);

  // In-session role revocation wipes memory immediately & rejects late responses
  const revokeRes = manager.revokeRealEstateDisclosuresAccess(tokenA);
  assert.equal(revokeRes.accepted, true);
  assert.equal(revokeRes.state.realEstateDisclosures.length, 0);
  assert.equal(revokeRes.state.realEstateDisclosuresAuthorized, false);
  assert.equal(revokeRes.state.realEstateDisclosuresStatus, 'unauthorized');
  assert.equal(
    manager.applyRealEstateDisclosuresSyncDelta(tokenA, {
      records: [recA],
      isDelta: true,
    }).reason,
    'unauthorized'
  );

  // Switch to user B -> old tokenA rejected as stale_session
  const tokenB = manager.beginSession('uid_editor_b', { canReadRealEstateDisclosures: true });
  assert.equal(manager.getState().realEstateDisclosures.length, 0);
  assert.equal(
    manager.applyRealEstateDisclosuresSnapshot(tokenA, [recA], {
      fromCache: false,
      hasPendingWrites: false,
    }).reason,
    'stale_session'
  );
  assert.equal(manager.getState().realEstateDisclosures.length, 0);

  // Logout wipes memory & rejects tokenB
  manager.applyRealEstateDisclosuresSnapshot(tokenB, [recA], {
    fromCache: false,
    hasPendingWrites: false,
  });
  assert.equal(manager.getState().realEstateDisclosures.length, 1);
  manager.beginSession(null);
  assert.equal(manager.getState().realEstateDisclosures.length, 0);
  assert.equal(manager.getState().realEstateDisclosuresStatus, 'idle');
  assert.equal(
    manager.applyRealEstateDisclosuresSnapshot(tokenB, [recA], {
      fromCache: false,
      hasPendingWrites: false,
    }).reason,
    'stale_session'
  );

  // Late async fetch resolving AFTER scope switches user_a -> user_b MUST NOT pollute user_b cache
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_admin_a' });
  CacheService.clearScopedCache();
  const slowPort: RealEstateDisclosuresFetchPort = {
    async fetchFull() {
      // Simulate user switching account mid-flight
      CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_editor_b' });
      return {
        records: [recA],
        allRecords: [recA],
        deletedDocIds: [],
        deletedMarkers: [],
        stamped: [recA],
      };
    },
    async fetchDelta() {
      return { records: [], allRecords: [], deletedDocIds: [], deletedMarkers: [], stamped: [] };
    },
  };

  const staleRes = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    persistenceDriver: driver,
    fetchPort: slowPort,
  });
  assert.equal(staleRes.status, 'stale_scope');
  assert.equal(CacheService.getScope().uid, 'uid_editor_b');
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);

  // Targeted clearRealEstateDisclosuresCache removes ONLY realEstateDisclosures, preserving companies
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_editor_b' });
  const scopeB = CacheService.getScopeKey();
  CacheService.saveCompanies([makeCompany('COMI')]);
  CacheService.saveRealEstateDisclosures([recA]);
  await CacheService.persistBatchDeltaAtomically({
    driver,
    entries: [
      { collection: 'companies', records: [makeCompany('COMI')], cursorMs: 1_773_000_000_000, confirmed: true },
      { collection: 'realEstateDisclosures', records: [recA], cursorMs: 1_773_100_000_000, confirmed: true },
    ],
  });
  assert.equal(CacheService.getRealEstateDisclosures().length, 1);

  CacheService.clearRealEstateDisclosuresCache();
  // Wait a microtask for async IndexedDB targeted removal
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);
  // Companies in same scope MUST remain intact!
  assert.equal(CacheService.getCompanies().length, 1);
  const idbB = driver.snapshot(scopeB);
  assert.ok(idbB);
  assert.equal(idbB.collections.realEstateDisclosures, undefined);
  assert.equal(idbB.deltaCursors.realEstateDisclosures, undefined);
  assert.ok(Array.isArray(idbB.collections.companies));
});

// =============================================================================
// 7) Honest Read-Side Linkage (Source Confirmation Gating, Conflicts & Freshness)
// =============================================================================

test('Batch 44.7: honest read-side linkage never reports missing_company/missing_quarterly_record before server confirmation and tracks freshness', () => {
  const verifiedRec = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_1',
    makeStoredCompleteDoc({
      docId: 'COMI__2025_FY__inv_1',
      disclosureId: 'inv_1',
      ticker: 'COMI',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
    })
  );
  const dateConflictRec = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_date_conflict',
    makeStoredCompleteDoc({
      docId: 'COMI__2025_FY__inv_date_conflict',
      disclosureId: 'inv_date_conflict',
      ticker: 'COMI',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-09-30', // conflicts with quarterly periodEndDate 2025-12-31
    })
  );
  const missingQuarterlyRec = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2024_Q3__inv_missing_q',
    makeStoredCompleteDoc({
      docId: 'COMI__2024_Q3__inv_missing_q',
      disclosureId: 'inv_missing_q',
      ticker: 'COMI',
      fiscalYear: 2024,
      fiscalQuarter: 'Q3',
      balanceSheetDate: '2024-09-30',
    })
  );
  const missingCompanyRec = normalizeRealEstateDisclosureFromFirestore(
    'GHOST__2025_FY__inv_missing_c',
    makeStoredCompleteDoc({
      docId: 'GHOST__2025_FY__inv_missing_c',
      disclosureId: 'inv_missing_c',
      ticker: 'GHOST',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
    })
  );
  const dateOnlyRec = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025-06-30__inv_date_only',
    makeStoredCompleteDoc({
      docId: 'COMI__2025-06-30__inv_date_only',
      disclosureId: 'inv_date_only',
      ticker: 'COMI',
      fiscalYear: null,
      fiscalQuarter: null,
      linkedQuarterlyDocId: null,
      balanceSheetDate: '2025-06-30',
    })
  );

  // A) Unconfirmed empty sources -> MUST be pending_source_confirmation (NEVER missing_company/missing_quarterly_record!)
  const unconfirmedEmpty = evaluateRealEstateDisclosuresReadLinkage(
    [verifiedRec, missingCompanyRec, missingQuarterlyRec],
    {
      companies: [],
      companiesConfirmed: false,
      quarterlyRecords: [],
      quarterlyConfirmed: false,
    }
  );
  for (const id of Object.keys(unconfirmedEmpty.byDocId)) {
    const res = unconfirmedEmpty.byDocId[id];
    assert.equal(res.companyLinkStatus, 'pending_source_confirmation');
    assert.equal(res.quarterlyLinkStatus, 'pending_source_confirmation');
    assert.equal(res.overallLinkageStatus, 'pending_source_confirmation');
    assert.notEqual(res.companyLinkStatus, 'missing_company');
    assert.notEqual(res.quarterlyLinkStatus, 'missing_quarterly_record');
  }

  // B) Failed sources -> source_load_failed (NEVER missing_company/missing_quarterly_record!)
  const failedSourcesRes = evaluateRealEstateDisclosureReadLinkage(verifiedRec, {
    companies: [],
    companiesConfirmed: false,
    companiesError: 'Network unavailable',
    quarterlyRecords: [],
    quarterlyConfirmed: false,
    quarterlyError: 'Network unavailable',
  });
  assert.equal(failedSourcesRes.companyLinkStatus, 'source_load_failed');
  assert.equal(failedSourcesRes.quarterlyLinkStatus, 'source_load_failed');
  assert.equal(failedSourcesRes.overallLinkageStatus, 'source_load_failed');

  // C) Cached local docs present BEFORE server confirmation -> MUST NOT report verified!
  const cachedBeforeConfirm = evaluateRealEstateDisclosureReadLinkage(verifiedRec, {
    companies: [makeCompany('COMI')],
    companiesConfirmed: false,
    companiesFromCache: true,
    quarterlyRecords: [makeQuarterly('COMI', 2025, 'FY', '2025-12-31')],
    quarterlyConfirmed: false,
    quarterlyFromCache: true,
  });
  assert.equal(cachedBeforeConfirm.companyLinkStatus, 'pending_source_confirmation');
  assert.equal(cachedBeforeConfirm.quarterlyLinkStatus, 'pending_source_confirmation');
  assert.equal(cachedBeforeConfirm.overallLinkageStatus, 'pending_source_confirmation');

  // D) Confirmed sources -> delegates cleanly to central evaluateRealEstateDisclosureLinkage
  const confirmedSources = {
    companies: [makeCompany('COMI')],
    companiesConfirmed: true,
    quarterlyRecords: [makeQuarterly('COMI', 2025, 'FY', '2025-12-31')],
    quarterlyConfirmed: true,
  };
  const confirmedSnapshot = evaluateRealEstateDisclosuresReadLinkage(
    [verifiedRec, dateConflictRec, missingQuarterlyRec, missingCompanyRec, dateOnlyRec],
    confirmedSources
  );

  assert.equal(confirmedSnapshot.byDocId['COMI__2025_FY__inv_1'].overallLinkageStatus, 'verified');
  assert.equal(confirmedSnapshot.byDocId['COMI__2025_FY__inv_1'].companyLinkStatus, 'verified');
  assert.equal(confirmedSnapshot.byDocId['COMI__2025_FY__inv_1'].quarterlyLinkStatus, 'verified');

  assert.equal(
    confirmedSnapshot.byDocId['COMI__2025_FY__inv_date_conflict'].quarterlyLinkStatus,
    'date_conflict'
  );
  assert.equal(
    confirmedSnapshot.byDocId['COMI__2025_FY__inv_date_conflict'].overallLinkageStatus,
    'conflict'
  );

  assert.equal(
    confirmedSnapshot.byDocId['COMI__2024_Q3__inv_missing_q'].companyLinkStatus,
    'verified'
  );
  assert.equal(
    confirmedSnapshot.byDocId['COMI__2024_Q3__inv_missing_q'].quarterlyLinkStatus,
    'missing_quarterly_record'
  );
  assert.equal(
    confirmedSnapshot.byDocId['COMI__2024_Q3__inv_missing_q'].overallLinkageStatus,
    'missing_reference'
  );

  assert.equal(
    confirmedSnapshot.byDocId['GHOST__2025_FY__inv_missing_c'].companyLinkStatus,
    'missing_company'
  );
  assert.equal(
    confirmedSnapshot.byDocId['GHOST__2025_FY__inv_missing_c'].overallLinkageStatus,
    'missing_reference'
  );

  assert.equal(
    confirmedSnapshot.byDocId['COMI__2025-06-30__inv_date_only'].companyLinkStatus,
    'verified'
  );
  assert.equal(
    confirmedSnapshot.byDocId['COMI__2025-06-30__inv_date_only'].quarterlyLinkStatus,
    'not_linked_period'
  );
  assert.equal(
    confirmedSnapshot.byDocId['COMI__2025-06-30__inv_date_only'].overallLinkageStatus,
    'partial_unverified'
  );

  // E) Freshness detection when source collections change
  assert.equal(isRealEstateLinkageSnapshotFresh(confirmedSnapshot, confirmedSources).isFresh, true);

  const mutatedSources = {
    ...confirmedSources,
    quarterlyRecords: [
      makeQuarterly('COMI', 2025, 'FY', '2025-12-31', '2026-03-20T00:00:00.000Z'),
      makeQuarterly('COMI', 2024, 'Q3', '2024-09-30', '2026-03-20T00:00:00.000Z'),
    ],
  };
  const freshnessAfterUpdate = isRealEstateLinkageSnapshotFresh(confirmedSnapshot, mutatedSources);
  assert.equal(freshnessAfterUpdate.isFresh, false);
  assert.ok(freshnessAfterUpdate.staleReasonsAr.length > 0);
  assert.notEqual(
    computeRealEstateLinkageSourcesVersion(confirmedSources),
    computeRealEstateLinkageSourcesVersion(mutatedSources)
  );
});

// =============================================================================
// 8) Merge Helper & Firestore Rules Guard Non-Regression
// =============================================================================

test('Batch 44.8: mergeRealEstateDisclosureDeltas is deterministic and firestore.rules keeps real_estate_disclosures locked to isDataEntry() read / server-only write', () => {
  const r1 = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__a',
    makeStoredCompleteDoc({ docId: 'COMI__2025_FY__a', disclosureId: 'a', revision: 1 })
  );
  const r2 = normalizeRealEstateDisclosureFromFirestore(
    'TMGH__2025_FY__b',
    makeStoredCompleteDoc({ docId: 'TMGH__2025_FY__b', disclosureId: 'b', ticker: 'TMGH', revision: 1 })
  );

  const merged = mergeRealEstateDisclosureDeltas([r2, r1], []);
  assert.deepEqual(
    merged.map((r) => r.docId),
    ['COMI__2025_FY__a', 'TMGH__2025_FY__b']
  );

  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesText = fs.readFileSync(rulesPath, 'utf8');
  const matchBlock = rulesText.match(/match \/real_estate_disclosures\/\{disclosureId\}\s*\{[\s\S]*?\}/);
  assert.ok(matchBlock, 'real_estate_disclosures match block must exist in firestore.rules');
  assert.match(matchBlock[0], /allow read:\s*if isDataEntry\(\);/);
  assert.match(matchBlock[0], /allow write:\s*if false;/);
});

// =============================================================================
// 9) Hardening Batch — Controllable Async Persistence Harness & Helpers
// =============================================================================

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createControllableAtomicPersistenceDriver() {
  const base = createMemoryAtomicPersistenceDriver();
  let pauseNextWrite: {
    started: ReturnType<typeof createDeferred<void>>;
    release: ReturnType<typeof createDeferred<void>>;
  } | null = null;

  const driver: AtomicDeltaPersistenceDriver & {
    armWritePause: () => {
      started: Promise<void>;
      release: () => void;
    };
    snapshot: (scopeKey: string) => ScopedIndexedDbState | null;
  } = {
    async read(scopeKey: string) {
      return base.read(scopeKey);
    },
    async runReadWrite(
      scopeKey: string,
      mutator: (current: ScopedIndexedDbState) => ScopedIndexedDbState
    ) {
      if (pauseNextWrite) {
        const currentPause = pauseNextWrite;
        pauseNextWrite = null;
        currentPause.started.resolve();
        await currentPause.release.promise;
      }
      return base.runReadWrite(scopeKey, mutator);
    },
    async remove(scopeKey: string) {
      return base.remove(scopeKey);
    },
    armWritePause() {
      const started = createDeferred<void>();
      const release = createDeferred<void>();
      pauseNextWrite = { started, release };
      return {
        started: started.promise,
        release: () => release.resolve(),
      };
    },
    snapshot(scopeKey: string) {
      return base.snapshot(scopeKey);
    },
  };

  return driver;
}

function createStubRepositoriesOverride(options?: {
  companies?: Company[];
  quarterly?: QuarterlyFinancialRecord[];
  companiesServerMs?: number;
  quarterlyServerMs?: number;
  onBeforeCompaniesReturn?: () => Promise<void> | void;
}): Partial<typeof FirestoreRepositories> {
  const companies = options?.companies ?? [makeCompany('COMI')];
  const quarterly = options?.quarterly ?? [makeQuarterly('COMI', 2025, 'FY', '2025-12-31')];
  const companiesServerMs = options?.companiesServerMs ?? 1_773_150_000_000;
  const quarterlyServerMs = options?.quarterlyServerMs ?? 1_773_150_000_000;

  return {
    async getAllQuarterlyRecordsWithMeta() {
      return {
        records: quarterly,
        stamped: quarterly.map(() => ({ serverUpdatedAt: { toMillis: () => quarterlyServerMs } })),
      };
    },
    async getAllCompaniesWithMeta() {
      if (options?.onBeforeCompaniesReturn) {
        await options.onBeforeCompaniesReturn();
      }
      return {
        records: companies,
        stamped: companies.map(() => ({ serverUpdatedAt: { toMillis: () => companiesServerMs } })),
      };
    },
    async getAllDailyTradingRecordsWithMeta() {
      return { records: [], stamped: [] };
    },
    async getAllDailyTradingSchemasWithMeta() {
      return { values: {}, stamped: [] };
    },
    async getAllBetaAssumptionsWithMeta() {
      return { records: [], stamped: [] };
    },
    async getAllMacroParametersWithMeta() {
      return { records: [], stamped: [] };
    },
    async getAllCompanyOverridesWithMeta() {
      return { records: [], stamped: [] };
    },
    async getAllStoriesWithMeta() {
      return { values: {}, stamped: [] };
    },
    async getAllDecisionsWithMeta() {
      return { values: {}, stamped: [] };
    },
    async getAllTradesWithMeta() {
      return { records: [], stamped: [] };
    },
    async getAllSectorPEWithMeta() {
      return { definitions: [], values: {}, stamped: [] };
    },
    async getAllDividendRecordsWithMeta() {
      return { records: [], stamped: [] };
    },
    async getAllDividendYearStatusesWithMeta() {
      return { records: [], stamped: [] };
    },
    async getAllTombstones() {
      return [];
    },
  };
}

// =============================================================================
// 10) Fix #1 — Async Persistence Scope Isolation (Single, Batch & Subscription)
// =============================================================================

test('Batch 44.9 (Fix #1 Single Path): isolates A->B switch during fetch & persistence await, logout mid-persist, and revocation mid-persist', async () => {
  installMockLocalStorage();
  const driver = createControllableAtomicPersistenceDriver();
  CacheService.setPersistenceDriver(driver);

  const tA = 1_773_200_000_000;
  const recA = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_a',
    makeStoredCompleteDoc({
      docId: 'COMI__2025_FY__inv_a',
      disclosureId: 'inv_a',
      revision: 2,
      serverUpdatedAt: { toMillis: () => tA },
    })
  );

  // --- Scenario 1: Switch A -> B DURING slow persistence await ---
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_user_a' });
  CacheService.clearScopedCache();
  const scopeA = CacheService.getScopeKey();

  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_user_b' });
  CacheService.clearScopedCache();
  const scopeB = CacheService.getScopeKey();

  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_user_a' });
  const pauseSwitch = driver.armWritePause();
  const portA: RealEstateDisclosuresFetchPort = {
    async fetchFull() {
      return {
        records: [recA],
        allRecords: [recA],
        deletedDocIds: [],
        deletedMarkers: [],
        stamped: [recA],
      };
    },
    async fetchDelta() {
      return { records: [], allRecords: [], deletedDocIds: [], deletedMarkers: [], stamped: [] };
    },
  };

  const syncPromiseSwitch = FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    persistenceDriver: driver,
    fetchPort: portA,
  });

  await pauseSwitch.started;
  // Switch active account from A -> B right inside persistence await!
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_user_b' });
  pauseSwitch.release();

  const resSwitch = await syncPromiseSwitch;
  // MUST NOT return 'synced' for ended session
  assert.equal(resSwitch.status, 'stale_scope');
  assert.notEqual(resSwitch.status, 'synced');
  // User B MUST receive ZERO records, ZERO cursor, baseline === false in localStorage AND IndexedDB
  assert.equal(CacheService.getScopeKey(), scopeB);
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);
  assert.equal(driver.snapshot(scopeB), null);

  // --- Scenario 2: Logout mid-persistence MUST NOT refill cleared cache/IndexedDB ---
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_user_a' });
  CacheService.clearScopedCache();
  const pauseLogout = driver.armWritePause();
  const syncPromiseLogout = FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    persistenceDriver: driver,
    fetchPort: portA,
  });

  await pauseLogout.started;
  CacheService.clearScopedCache(); // logout clears scope A
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: null });
  pauseLogout.release();

  const resLogout = await syncPromiseLogout;
  assert.equal(resLogout.status, 'stale_scope');
  assert.equal(driver.snapshot(scopeA), null);
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_user_a' });
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);

  // --- Scenario 3: Permission revocation mid-persistence scrubs ONLY realEstateDisclosures, keeping companies intact ---
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_user_a' });
  CacheService.clearScopedCache();
  CacheService.saveCompanies([makeCompany('COMI')]);
  await CacheService.persistCollectionDeltaAtomically({
    collection: 'companies',
    records: [makeCompany('COMI')],
    cursorMs: 1_773_100_000_000,
    confirmed: true,
    driver,
  });

  let stillAuthorized = true;
  const pauseRevoke = driver.armWritePause();
  const syncPromiseRevoke = FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    persistenceDriver: driver,
    fetchPort: portA,
    isOperationValid: () => stillAuthorized,
  });

  await pauseRevoke.started;
  stillAuthorized = false;
  CacheService.clearRealEstateDisclosuresCache();
  pauseRevoke.release();

  const resRevoke = await syncPromiseRevoke;
  assert.equal(resRevoke.status, 'stale_scope');
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);
  const idbAfterRevoke = driver.snapshot(scopeA);
  assert.ok(idbAfterRevoke);
  assert.equal(idbAfterRevoke.collections.realEstateDisclosures, undefined);
  assert.equal(idbAfterRevoke.deltaCursors.realEstateDisclosures, undefined);
  // Regression check: companies in same scope MUST stay intact!
  assert.equal(CacheService.getCompanies().length, 1);
  assert.ok(Array.isArray(idbAfterRevoke.collections.companies));
});

test('Batch 44.10 (Fix #1 Batch Path & Regression): syncAllIncrementalDeltas isolates A->B switch during fetch/persistence and mid-flight real-estate revocation', async () => {
  installMockLocalStorage();
  const driver = createControllableAtomicPersistenceDriver();
  CacheService.setPersistenceDriver(driver);

  const tA = 1_773_250_000_000;
  const recA = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_batch_a',
    makeStoredCompleteDoc({
      docId: 'COMI__2025_FY__inv_batch_a',
      disclosureId: 'inv_batch_a',
      serverUpdatedAt: { toMillis: () => tA },
    })
  );
  const rePort: RealEstateDisclosuresFetchPort = {
    async fetchFull() {
      return {
        records: [recA],
        allRecords: [recA],
        deletedDocIds: [],
        deletedMarkers: [],
        stamped: [recA],
      };
    },
    async fetchDelta() {
      return { records: [], allRecords: [], deletedDocIds: [], deletedMarkers: [], stamped: [] };
    },
  };

  // --- Scenario A: Normal batch sync commits all collections cleanly (regression) ---
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_batch_a' });
  CacheService.clearScopedCache();
  const scopeA = CacheService.getScopeKey();

  const okBatch = await FirestoreSyncManager.syncAllIncrementalDeltas({
    canReadRealEstateDisclosures: true,
    realEstatePort: rePort,
    repositoriesOverride: createStubRepositoriesOverride({
      companiesServerMs: tA,
      quarterlyServerMs: tA,
    }),
    persistenceDriver: driver,
  });
  assert.equal(okBatch.abortedReason, undefined);
  assert.equal(okBatch.stats.status, 'synced');
  assert.equal(CacheService.getCollectionDeltaCursorMs('companies'), tA);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), tA);
  assert.equal(CacheService.getCollectionBaselineConfirmed('companies'), true);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), true);
  assert.equal(CacheService.getRealEstateDisclosures().length, 1);

  // --- Scenario B: Switch A -> B DURING batch fetch ---
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_batch_b' });
  CacheService.clearScopedCache();
  const scopeB = CacheService.getScopeKey();

  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_batch_a' });
  CacheService.clearScopedCache();

  let mergeCalledDuringFetchSwitch = false;
  const fetchSwitchRes = await FirestoreSyncManager.syncAllIncrementalDeltas({
    canReadRealEstateDisclosures: true,
    realEstatePort: rePort,
    repositoriesOverride: createStubRepositoriesOverride({
      companiesServerMs: tA,
      quarterlyServerMs: tA,
      onBeforeCompaniesReturn: () => {
        CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_batch_b' });
      },
    }),
    persistenceDriver: driver,
    onConfirmedMerge: () => {
      mergeCalledDuringFetchSwitch = true;
      return true;
    },
  });
  assert.equal(fetchSwitchRes.abortedReason, 'stale_scope');
  assert.notEqual(fetchSwitchRes.stats.status, 'synced');
  assert.equal(mergeCalledDuringFetchSwitch, false);
  assert.equal(CacheService.getScopeKey(), scopeB);
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('companies'), 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('companies'), false);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);
  assert.equal(driver.snapshot(scopeB), null);

  // --- Scenario C: Switch A -> B DURING slow batch persistence await ---
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_batch_a' });
  CacheService.clearScopedCache();

  const pauseBatch = driver.armWritePause();
  const batchSwitchPromise = FirestoreSyncManager.syncAllIncrementalDeltas({
    canReadRealEstateDisclosures: true,
    realEstatePort: rePort,
    repositoriesOverride: createStubRepositoriesOverride({
      companiesServerMs: tA,
      quarterlyServerMs: tA,
    }),
    persistenceDriver: driver,
  });
  await pauseBatch.started;
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_batch_b' });
  pauseBatch.release();

  const batchSwitchRes = await batchSwitchPromise;
  assert.equal(batchSwitchRes.abortedReason, 'stale_scope');
  assert.notEqual(batchSwitchRes.stats.status, 'synced');
  // B gets ZERO records, cursors, or baseline for ANY collection!
  assert.equal(CacheService.getScopeKey(), scopeB);
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('companies'), 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('quarterly'), 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('companies'), false);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);
  assert.equal(driver.snapshot(scopeB), null);

  // --- Scenario D: Mid-flight revocation of ONLY real_estate_disclosures during batch persistence ---
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_batch_a' });
  CacheService.clearScopedCache();
  let reAuthorized = true;
  const pauseRevokeBatch = driver.armWritePause();
  const revokeBatchPromise = FirestoreSyncManager.syncAllIncrementalDeltas({
    canReadRealEstateDisclosures: true,
    realEstatePort: rePort,
    isRealEstateStillAuthorized: () => reAuthorized,
    repositoriesOverride: createStubRepositoriesOverride({
      companiesServerMs: tA,
      quarterlyServerMs: tA,
    }),
    persistenceDriver: driver,
  });
  await pauseRevokeBatch.started;
  reAuthorized = false;
  CacheService.clearRealEstateDisclosuresCache();
  pauseRevokeBatch.release();

  const revokeBatchRes = await revokeBatchPromise;
  assert.equal(revokeBatchRes.stats.status, 'synced');
  // Other authorized collections commit cleanly!
  assert.equal(CacheService.getCollectionDeltaCursorMs('companies'), tA);
  assert.equal(CacheService.getCollectionBaselineConfirmed('companies'), true);
  // Revoked realEstateDisclosures MUST NOT be refilled in localStorage OR IndexedDB!
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);
  const idbBatchA = driver.snapshot(scopeA);
  assert.ok(idbBatchA);
  assert.equal(idbBatchA.collections.realEstateDisclosures, undefined);
  assert.equal(idbBatchA.deltaCursors.realEstateDisclosures, undefined);
  assert.ok(Array.isArray(idbBatchA.collections.companies));
});

test('Batch 44.11 (Fix #1 Subscription Path & Regression): persistSubscriptionCollectionSnapshot isolates A->B switch & revocation during await', async () => {
  installMockLocalStorage();
  const driver = createControllableAtomicPersistenceDriver();
  CacheService.setPersistenceDriver(driver);

  const tSub = 1_773_300_000_000;
  const recSub = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_sub',
    makeStoredCompleteDoc({
      docId: 'COMI__2025_FY__inv_sub',
      disclosureId: 'inv_sub',
      serverUpdatedAt: { toMillis: () => tSub },
    })
  );

  // Prepare scopes A and B
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_sub_b' });
  CacheService.clearScopedCache();
  const scopeB = CacheService.getScopeKey();

  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_sub_a' });
  CacheService.clearScopedCache();
  const scopeA = CacheService.getScopeKey();

  // --- Scenario A: Normal subscription persistence works for both companies and realEstateDisclosures ---
  const guardNormal = CacheService.captureOperationGuard(['companies', 'realEstateDisclosures']);
  let savedCompaniesLocal = false;
  const okCompanies = await FirestoreSyncManager.persistSubscriptionCollectionSnapshot({
    colKey: 'companies',
    meta: { fromCache: false, hasPendingWrites: false },
    records: [makeCompany('COMI')],
    stamped: [{ serverUpdatedAt: { toMillis: () => tSub } }],
    subscriptionScopeKey: scopeA,
    operationGuard: guardNormal,
    isSubscriptionActive: () => true,
    driver,
    onLocalStorageSave: () => {
      savedCompaniesLocal = true;
      CacheService.saveCompanies([makeCompany('COMI')]);
    },
  });
  assert.equal(okCompanies, true);
  assert.equal(savedCompaniesLocal, true);
  assert.equal(CacheService.getCollectionDeltaCursorMs('companies'), tSub);
  assert.equal(CacheService.getCollectionBaselineConfirmed('companies'), true);

  // --- Scenario B: Switch A -> B DURING slow subscription persistence await ---
  const guardSwitch = CacheService.captureOperationGuard(['realEstateDisclosures']);
  let savedLocalOnSwitch = false;
  const pauseSubSwitch = driver.armWritePause();
  const subSwitchPromise = FirestoreSyncManager.persistSubscriptionCollectionSnapshot({
    colKey: 'realEstateDisclosures',
    meta: { fromCache: false, hasPendingWrites: false },
    records: [recSub],
    stamped: [recSub],
    subscriptionScopeKey: scopeA,
    operationGuard: guardSwitch,
    isSubscriptionActive: () => true,
    driver,
    onLocalStorageSave: () => {
      savedLocalOnSwitch = true;
      CacheService.saveRealEstateDisclosures([recSub], scopeA, guardSwitch);
    },
  });

  await pauseSubSwitch.started;
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_sub_b' });
  pauseSubSwitch.release();

  const subSwitchRes = await subSwitchPromise;
  assert.equal(subSwitchRes, false);
  assert.equal(savedLocalOnSwitch, false);
  assert.equal(CacheService.getScopeKey(), scopeB);
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);
  assert.equal(driver.snapshot(scopeB), null);

  // --- Scenario C: Permission revocation / invalidation DURING slow subscription persistence await ---
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_sub_a' });
  const guardRevoke = CacheService.captureOperationGuard(['realEstateDisclosures']);
  let activeFlag = true;
  let savedLocalOnRevoke = false;
  const pauseSubRevoke = driver.armWritePause();
  const subRevokePromise = FirestoreSyncManager.persistSubscriptionCollectionSnapshot({
    colKey: 'realEstateDisclosures',
    meta: { fromCache: false, hasPendingWrites: false },
    records: [recSub],
    stamped: [recSub],
    subscriptionScopeKey: scopeA,
    operationGuard: guardRevoke,
    isSubscriptionActive: () => activeFlag,
    driver,
    onLocalStorageSave: () => {
      savedLocalOnRevoke = true;
      CacheService.saveRealEstateDisclosures([recSub], scopeA, guardRevoke);
    },
  });

  await pauseSubRevoke.started;
  activeFlag = false;
  CacheService.clearRealEstateDisclosuresCache();
  pauseSubRevoke.release();

  const subRevokeRes = await subRevokePromise;
  assert.equal(subRevokeRes, false);
  assert.equal(savedLocalOnRevoke, false);
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);
  const idbSubA = driver.snapshot(scopeA);
  assert.ok(idbSubA);
  assert.equal(idbSubA.collections.realEstateDisclosures, undefined);
  assert.ok(Array.isArray(idbSubA.collections.companies));
});

// =============================================================================
// 11) Fix #2 — Deterministic Deletion Precedence (Full Pipeline Transformer -> Merger -> Sync)
// =============================================================================

test('Batch 44.12 (Fix #2 Deletion Precedence): transformer -> merger -> session/sync prevents older delete + deletedDocIds from deleting newer active record', async () => {
  installMockLocalStorage();
  const driver = createMemoryAtomicPersistenceDriver();
  CacheService.setPersistenceDriver(driver);
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_prec_1' });
  CacheService.clearScopedCache();

  const docId = 'COMI__2025_FY__inv_prec';
  const activeV3Raw = makeStoredCompleteDoc({
    docId,
    disclosureId: 'inv_prec',
    carryingValue: 333_000_000,
    revision: 3,
    isDeleted: false,
    serverUpdatedAt: { toMillis: () => 300_000 },
  });
  const olderDeleteV2Raw = makeStoredCompleteDoc({
    docId,
    disclosureId: 'inv_prec',
    carryingValue: 222_000_000,
    revision: 2,
    isDeleted: true,
    serverUpdatedAt: { toMillis: () => 200_000 },
  });
  const newerDeleteV4Raw = makeStoredCompleteDoc({
    docId,
    disclosureId: 'inv_prec',
    carryingValue: 333_000_000,
    revision: 4,
    isDeleted: true,
    serverUpdatedAt: { toMillis: () => 400_000 },
  });
  const recreatedV5Raw = makeStoredCompleteDoc({
    docId,
    disclosureId: 'inv_prec',
    carryingValue: 555_000_000,
    revision: 5,
    isDeleted: false,
    serverUpdatedAt: { toMillis: () => 500_000 },
  });

  // 1) Full pipeline: Transformer produces BOTH deletedDocIds AND deletedMarkers!
  const snapActiveV3 = mapRealEstateDisclosuresSnapshot(
    makeFakeSnapshot([{ id: docId, data: activeV3Raw }])
  );
  const snapOlderDeleteV2 = mapRealEstateDisclosuresSnapshot(
    makeFakeSnapshot([{ id: docId, data: olderDeleteV2Raw }])
  );
  assert.deepEqual(snapOlderDeleteV2.deletedDocIds, [docId]);
  assert.equal(snapOlderDeleteV2.deletedMarkers.length, 1);
  assert.equal(snapOlderDeleteV2.deletedMarkers[0].revision, 2);
  assert.equal(snapOlderDeleteV2.deletedMarkers[0].serverUpdatedAtMs, 200_000);

  // Merge active (rev=3, t=300000) with older delete (rev=2, t=200000) WITH deletedDocIds from transformer
  const mergedAfterOldDelete = mergeRealEstateDisclosureDeltas(
    snapActiveV3.records,
    snapOlderDeleteV2.allRecords,
    {
      deletedDocIds: snapOlderDeleteV2.deletedDocIds,
      deletedMarkers: snapOlderDeleteV2.deletedMarkers,
    }
  );
  assert.equal(mergedAfterOldDelete.length, 1);
  assert.equal(mergedAfterOldDelete[0].docId, docId);
  assert.equal(mergedAfterOldDelete[0].revision, 3);
  assert.equal(mergedAfterOldDelete[0].carryingValue, 333_000_000);

  // Even if caller passes ONLY allRecords + deletedDocIds (without explicit deletedMarkers),
  // the merger extracts the soft-delete metadata from allRecords so bare deletedDocIds CANNOT override it!
  const mergedWithoutExplicitMarkers = mergeRealEstateDisclosureDeltas(
    snapActiveV3.records,
    snapOlderDeleteV2.allRecords,
    { deletedDocIds: snapOlderDeleteV2.deletedDocIds }
  );
  assert.equal(mergedWithoutExplicitMarkers.length, 1);
  assert.equal(mergedWithoutExplicitMarkers[0].revision, 3);

  // 2) Full pipeline through FirestoreSyncManager + FirestoreSessionManager
  const manager = new FirestoreSessionManager();
  const token = manager.beginSession('uid_prec_1', { canReadRealEstateDisclosures: true });
  let nextSnap = snapActiveV3;
  const pipelinePort: RealEstateDisclosuresFetchPort = {
    async fetchFull() {
      return nextSnap;
    },
    async fetchDelta() {
      return nextSnap;
    },
  };

  // Baseline load: active v3 (t=300000)
  const step1 = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    persistenceDriver: driver,
    fetchPort: pipelinePort,
    onConfirmedMerge: (payload) =>
      manager.applyRealEstateDisclosuresSyncDelta(token, {
        records: payload.records,
        incomingAll: payload.allRecords,
        deletedDocIds: payload.deletedDocIds,
        deletedMarkers: payload.deletedMarkers,
        isDelta: payload.isDelta,
      }).accepted,
  });
  assert.equal(step1.status, 'synced');
  assert.equal(manager.getState().realEstateDisclosures.length, 1);
  assert.equal(manager.getState().realEstateDisclosures[0].revision, 3);

  // Delta with older delete (rev=2, t=200000) -> active v3 MUST remain in session & cache!
  nextSnap = snapOlderDeleteV2;
  const step2 = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    existingRecords: manager.getState().realEstateDisclosures,
    persistenceDriver: driver,
    fetchPort: pipelinePort,
    onConfirmedMerge: (payload) =>
      manager.applyRealEstateDisclosuresSyncDelta(token, {
        records: payload.records,
        incomingAll: payload.allRecords,
        deletedDocIds: payload.deletedDocIds,
        deletedMarkers: payload.deletedMarkers,
        isDelta: payload.isDelta,
      }).accepted,
  });
  assert.equal(step2.status, 'synced');
  assert.equal(step2.mergedRecords.length, 1);
  assert.equal(step2.mergedRecords[0].revision, 3);
  assert.equal(manager.getState().realEstateDisclosures.length, 1);
  assert.equal(manager.getState().realEstateDisclosures[0].revision, 3);
  assert.equal(CacheService.getRealEstateDisclosures().length, 1);

  // 3) Newer delete (rev=4, t=400000) through transformer removes record locally!
  const snapNewerDeleteV4 = mapRealEstateDisclosuresSnapshot(
    makeFakeSnapshot([{ id: docId, data: newerDeleteV4Raw }])
  );
  nextSnap = snapNewerDeleteV4;
  const step3 = await FirestoreSyncManager.syncRealEstateDisclosuresIncremental({
    canReadRealEstateDisclosures: true,
    existingRecords: manager.getState().realEstateDisclosures,
    persistenceDriver: driver,
    fetchPort: pipelinePort,
    onConfirmedMerge: (payload) =>
      manager.applyRealEstateDisclosuresSyncDelta(token, {
        records: payload.records,
        incomingAll: payload.allRecords,
        deletedDocIds: payload.deletedDocIds,
        deletedMarkers: payload.deletedMarkers,
        isDelta: payload.isDelta,
      }).accepted,
  });
  assert.equal(step3.status, 'synced');
  assert.equal(step3.mergedRecords.length, 0);
  assert.equal(manager.getState().realEstateDisclosures.length, 0);
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);

  // 4) Newer re-creation (rev=5, t=500000) survives older delete (rev=4, t=400000) regardless of arrival order!
  const snapOutOfOrderDeleteFirst = mapRealEstateDisclosuresSnapshot(
    makeFakeSnapshot([
      { id: docId, data: newerDeleteV4Raw },
      { id: docId, data: recreatedV5Raw },
    ])
  );
  const snapOutOfOrderActiveFirst = mapRealEstateDisclosuresSnapshot(
    makeFakeSnapshot([
      { id: docId, data: recreatedV5Raw },
      { id: docId, data: newerDeleteV4Raw },
    ])
  );
  const resDeleteFirst = mergeRealEstateDisclosureDeltas(
    [],
    snapOutOfOrderDeleteFirst.allRecords,
    {
      deletedDocIds: snapOutOfOrderDeleteFirst.deletedDocIds,
      deletedMarkers: snapOutOfOrderDeleteFirst.deletedMarkers,
    }
  );
  const resActiveFirst = mergeRealEstateDisclosureDeltas(
    [],
    snapOutOfOrderActiveFirst.allRecords,
    {
      deletedDocIds: snapOutOfOrderActiveFirst.deletedDocIds,
      deletedMarkers: snapOutOfOrderActiveFirst.deletedMarkers,
    }
  );
  assert.equal(resDeleteFirst.length, 1);
  assert.equal(resDeleteFirst[0].revision, 5);
  assert.equal(resDeleteFirst[0].carryingValue, 555_000_000);
  assert.equal(resActiveFirst.length, 1);
  assert.equal(resActiveFirst[0].revision, 5);

  // 5) Out-of-order older active (v3, t=300k) delivered alongside newer delete (v4, t=400k) NEVER restores older data!
  const snapNewerDeleteThenOldActive = mapRealEstateDisclosuresSnapshot(
    makeFakeSnapshot([
      { id: docId, data: newerDeleteV4Raw },
      { id: docId, data: activeV3Raw },
    ])
  );
  const mergedNoResurrection = mergeRealEstateDisclosureDeltas(
    [],
    snapNewerDeleteThenOldActive.allRecords,
    {
      deletedDocIds: snapNewerDeleteThenOldActive.deletedDocIds,
      deletedMarkers: snapNewerDeleteThenOldActive.deletedMarkers,
    }
  );
  assert.equal(mergedNoResurrection.length, 0);

  // 6) Explicit handling of missing or incomparable deletion ordering metadata
  const missingMetaDeleteSnap = mapRealEstateDisclosuresSnapshot(
    makeFakeSnapshot([
      {
        id: docId,
        data: makeStoredCompleteDoc({
          docId,
          disclosureId: 'inv_prec',
          isDeleted: true,
          revision: null,
          updatedAt: null,
          serverUpdatedAt: null,
        }),
      },
    ])
  );
  const resolutionMissing = resolveRealEstateDisclosureMerge(
    snapActiveV3.records,
    missingMetaDeleteSnap.allRecords,
    {
      deletedDocIds: missingMetaDeleteSnap.deletedDocIds,
      deletedMarkers: missingMetaDeleteSnap.deletedMarkers,
    }
  );
  assert.equal(resolutionMissing.records.length, 1);
  assert.equal(
    resolutionMissing.decisionsByDocId[docId].reason,
    'kept_active_missing_delete_ordering'
  );
  assert.deepEqual(
    resolutionMissing.unresolvedDeletions.map((d) => d.docId),
    [docId]
  );

  // Bare deletedDocIds alone without any timestamp/revision metadata also does not blindly delete versioned active record
  const resolutionBareId = resolveRealEstateDisclosureMerge(snapActiveV3.records, [], {
    deletedDocIds: [docId],
  });
  assert.equal(resolutionBareId.records.length, 1);
  assert.equal(
    resolutionBareId.decisionsByDocId[docId].reason,
    'kept_active_missing_delete_ordering'
  );

  // Incomparable axes: active has timestamp only (no revision), delete has revision only (no timestamp)
  const activeTimeOnly = normalizeRealEstateDisclosureFromFirestore(
    docId,
    makeStoredCompleteDoc({
      docId,
      disclosureId: 'inv_prec',
      revision: null,
      serverUpdatedAt: { toMillis: () => 300_000 },
    })
  );
  const resolutionIncomparable = resolveRealEstateDisclosureMerge([activeTimeOnly], [], {
    deletedMarkers: [
      {
        docId,
        revision: 4,
        serverUpdatedAtMs: 0,
        updatedAtMs: 0,
        source: 'soft_delete_doc',
      },
    ],
  });
  assert.equal(resolutionIncomparable.records.length, 1);
  assert.equal(
    resolutionIncomparable.decisionsByDocId[docId].reason,
    'kept_active_incomparable_delete_ordering'
  );
  assert.deepEqual(
    resolutionIncomparable.unresolvedDeletions.map((d) => d.docId),
    [docId]
  );
});

// =============================================================================
// 12) Fix #3 — permission-denied Revocation, Cache/Memory Wipe, Late-Reply Block,
//              Isolation from Network Errors & Proper Re-Verification Restoration
// =============================================================================

test('Batch 44.13 (Fix #3 permission-denied): wipes memory/cache/IndexedDB on subscription & manual sync denial, blocks late replies, isolates other collections & network errors, and restores only after re-verification', async () => {
  installMockLocalStorage();
  const driver = createMemoryAtomicPersistenceDriver();
  CacheService.setPersistenceDriver(driver);
  CacheService.setScope({ projectId: 'mizan-test', databaseId: 'default', uid: 'uid_perm_1' });
  CacheService.clearScopedCache();
  const scopeKey = CacheService.getScopeKey();

  const t1 = 1_773_400_000_000;
  const rec1 = normalizeRealEstateDisclosureFromFirestore(
    'COMI__2025_FY__inv_perm',
    makeStoredCompleteDoc({
      docId: 'COMI__2025_FY__inv_perm',
      disclosureId: 'inv_perm',
      serverUpdatedAt: { toMillis: () => t1 },
    })
  );

  const manager = new FirestoreSessionManager();
  const token = manager.beginSession('uid_perm_1', { canReadRealEstateDisclosures: true });

  // 1) Load confirmed records for companies, quarterly, AND real_estate_disclosures
  manager.applyNonQuarterlySnapshot(token, 'companiesMeta', [makeCompany('COMI')], {
    fromCache: false,
    hasPendingWrites: false,
  });
  manager.applyQuarterlySnapshot(token, [makeQuarterly('COMI', 2025, 'FY', '2025-12-31')], {
    fromCache: false,
    hasPendingWrites: false,
  });
  manager.applyRealEstateDisclosuresSnapshot(token, [rec1], {
    fromCache: false,
    hasPendingWrites: false,
  });
  CacheService.saveCompanies([makeCompany('COMI')]);
  CacheService.saveRealEstateDisclosures([rec1]);
  await CacheService.persistBatchDeltaAtomically({
    driver,
    entries: [
      { collection: 'companies', records: [makeCompany('COMI')], cursorMs: t1, confirmed: true },
      { collection: 'realEstateDisclosures', records: [rec1], cursorMs: t1, confirmed: true },
    ],
  });

  assert.equal(manager.getState().realEstateDisclosures.length, 1);
  assert.equal(manager.getState().realEstateDisclosuresAuthorized, true);
  assert.equal(CacheService.getRealEstateDisclosures().length, 1);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), true);

  // 2) Network / offline error MUST remain separate from permission-denied (does NOT revoke authorization!)
  const offlineRes = manager.applyConnectionError(
    token,
    REAL_ESTATE_DISCLOSURES_COLLECTION,
    { code: 'unavailable', message: 'Network temporarily unavailable' },
    true,
    false
  );
  assert.equal(offlineRes.accepted, true);
  assert.equal(offlineRes.state.realEstateDisclosuresAuthorized, true);
  assert.equal(offlineRes.state.realEstateDisclosuresStatus, 'error');
  assert.equal(offlineRes.state.realEstateDisclosuresErrorCode, 'offline');
  assert.equal(offlineRes.state.connectionError, null);
  // Recovers immediately on next confirmed server snapshot without re-verification
  const recoverRes = manager.applyRealEstateDisclosuresSnapshot(token, [rec1], {
    fromCache: false,
    hasPendingWrites: false,
  });
  assert.equal(recoverRes.accepted, true);
  assert.equal(recoverRes.state.realEstateDisclosuresStatus, 'confirmed');
  assert.equal(recoverRes.state.realEstateDisclosures.length, 1);

  // 3) Subscription permission-denied error -> immediately revokes authorization & clears memory + cache + IndexedDB!
  CacheService.clearRealEstateDisclosuresCache();
  const permSubRes = manager.applyConnectionError(
    token,
    REAL_ESTATE_DISCLOSURES_COLLECTION,
    { code: 'permission-denied', message: 'Missing or insufficient permissions.' },
    true,
    true
  );
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(permSubRes.accepted, true);
  assert.equal(permSubRes.state.realEstateDisclosuresAuthorized, false);
  assert.equal(permSubRes.state.realEstateDisclosures.length, 0);
  assert.equal(permSubRes.state.realEstateDisclosuresConfirmed, false);
  assert.equal(permSubRes.state.realEstateDisclosuresStatus, 'permission_denied');
  assert.equal(permSubRes.state.realEstateDisclosuresErrorCode, 'permission_denied');
  assert.equal(permSubRes.state.connectionError, null);

  // Scoped localStorage & IndexedDB MUST have zero realEstateDisclosures, cursor=0, baseline=false
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);
  const idbAfterSubDeny = driver.snapshot(scopeKey);
  assert.ok(idbAfterSubDeny);
  assert.equal(idbAfterSubDeny.collections.realEstateDisclosures, undefined);
  assert.equal(idbAfterSubDeny.deltaCursors.realEstateDisclosures, undefined);

  // Other authorized collections MUST remain intact!
  assert.equal(permSubRes.state.companiesMeta.length, 1);
  assert.equal(permSubRes.state.companiesConfirmed, true);
  assert.equal(permSubRes.state.quarterlyRecords.length, 1);
  assert.equal(CacheService.getCompanies().length, 1);
  assert.ok(Array.isArray(idbAfterSubDeny.collections.companies));

  // 4) Late / pending responses arriving AFTER permission-denied MUST NOT restore data!
  const lateSnapRes = manager.applyRealEstateDisclosuresSnapshot(token, [rec1], {
    fromCache: false,
    hasPendingWrites: false,
  });
  assert.equal(lateSnapRes.accepted, false);
  assert.equal(lateSnapRes.reason, 'unauthorized');
  assert.equal(manager.getState().realEstateDisclosures.length, 0);

  const lateDeltaRes = manager.applyRealEstateDisclosuresSyncDelta(token, {
    records: [rec1],
    incomingAll: [rec1],
    isDelta: true,
  });
  assert.equal(lateDeltaRes.accepted, false);
  assert.equal(lateDeltaRes.reason, 'unauthorized');
  assert.equal(manager.getState().realEstateDisclosures.length, 0);

  // 5) Re-verification restoration: ONLY active admin/data_entry can restore access!
  const denySubscriberRestore = manager.restoreRealEstateDisclosuresAccess(token, {
    user: { role: 'subscriber', isActive: true },
  });
  assert.equal(denySubscriberRestore.accepted, false);
  assert.equal(denySubscriberRestore.reason, 'unauthorized');
  assert.equal(manager.getState().realEstateDisclosuresAuthorized, false);

  const denyInactiveAdminRestore = manager.restoreRealEstateDisclosuresAccess(token, {
    user: { role: 'admin', isActive: false },
  });
  assert.equal(denyInactiveAdminRestore.accepted, false);
  assert.equal(denyInactiveAdminRestore.reason, 'unauthorized');

  const okRestore = manager.restoreRealEstateDisclosuresAccess(token, {
    user: { role: 'data_entry', isActive: true },
  });
  assert.equal(okRestore.accepted, true);
  assert.equal(okRestore.state.realEstateDisclosuresAuthorized, true);
  assert.equal(okRestore.state.realEstateDisclosuresStatus, 'loading');
  assert.equal(okRestore.state.realEstateDisclosuresConfirmed, false);
  assert.equal(okRestore.state.realEstateDisclosures.length, 0);

  // Fresh confirmed snapshot after re-verification restores data cleanly
  const freshAfterRestore = manager.applyRealEstateDisclosuresSnapshot(token, [rec1], {
    fromCache: false,
    hasPendingWrites: false,
  });
  assert.equal(freshAfterRestore.accepted, true);
  assert.equal(freshAfterRestore.state.realEstateDisclosuresStatus, 'confirmed');
  assert.equal(freshAfterRestore.state.realEstateDisclosures.length, 1);

  // 6) Manual sync permission-denied path (syncAllIncrementalDeltas -> applyManualSyncResult)
  // Populate cache & IndexedDB again before manual sync hits permission-denied
  CacheService.saveRealEstateDisclosures([rec1]);
  await CacheService.persistCollectionDeltaAtomically({
    collection: 'realEstateDisclosures',
    records: [rec1],
    cursorMs: t1,
    confirmed: true,
    driver,
  });

  const deniedPort: RealEstateDisclosuresFetchPort = {
    async fetchFull() {
      throw { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    },
    async fetchDelta() {
      throw { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    },
  };

  const t2 = t1 + 60_000;
  const manualDenySync = await FirestoreSyncManager.syncAllIncrementalDeltas({
    canReadRealEstateDisclosures: true,
    realEstatePort: deniedPort,
    repositoriesOverride: createStubRepositoriesOverride({
      companiesServerMs: t2,
      quarterlyServerMs: t2,
    }),
    persistenceDriver: driver,
    isOperationValid: () => manager.isTokenActive(token),
    isRealEstateStillAuthorized: () =>
      manager.isTokenActive(token) && manager.getState().realEstateDisclosuresAuthorized,
    onConfirmedMerge: (payload) => manager.applyManualSyncResult(token, payload).accepted,
  });
  await new Promise((r) => setTimeout(r, 10));

  // Other collections succeeded and committed t2!
  assert.equal(manualDenySync.stats.status, 'synced');
  assert.equal(CacheService.getCollectionDeltaCursorMs('companies'), t2);
  assert.equal(manager.getState().companiesConfirmed, true);
  assert.equal(manager.getState().quarterlyConfirmed, true);
  assert.equal(manager.getState().connectionError, null);

  // real_estate_disclosures revoked & wiped in memory, localStorage, AND IndexedDB!
  assert.equal(manager.getState().realEstateDisclosuresAuthorized, false);
  assert.equal(manager.getState().realEstateDisclosures.length, 0);
  assert.equal(manager.getState().realEstateDisclosuresStatus, 'permission_denied');
  assert.equal(manager.getState().realEstateDisclosuresConfirmed, false);
  assert.equal(CacheService.getRealEstateDisclosures().length, 0);
  assert.equal(CacheService.getCollectionDeltaCursorMs('realEstateDisclosures'), 0);
  assert.equal(CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'), false);
  const idbAfterManualDeny = driver.snapshot(scopeKey);
  assert.ok(idbAfterManualDeny);
  assert.equal(idbAfterManualDeny.collections.realEstateDisclosures, undefined);
  assert.equal(idbAfterManualDeny.deltaCursors.realEstateDisclosures, undefined);
  assert.equal(idbAfterManualDeny.deltaCursors.companies, t2);
});

