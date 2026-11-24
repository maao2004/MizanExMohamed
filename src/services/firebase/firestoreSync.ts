/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  collection,
  collectionGroup,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import {
  BetaAssumptionRecord,
  Company,
  CompanyParameterOverride,
  DecisionItem,
  InvestmentStory,
  QuarterlyFinancial,
  SectorDefinition,
  TombstoneRecord,
  TradeLog,
} from '../../types/financial';
import {
  AppUser,
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  DividendRecord,
  DividendYearStatusRecord,
  MacroParameter,
  QuarterlyFinancialRecord,
} from '../../types';
import {
  ALL_SYNC_COLLECTION_KEYS,
  AtomicDeltaPersistenceDriver,
  CacheOperationGuard,
  CacheService,
  SyncCollectionKey,
} from '../storage/cacheService';
import {
  isFirestorePermissionDeniedError,
  SnapshotMetadataInfo,
  SyncAllCollectionsPayload,
} from '../../core/domain/firestoreSessionManager';
import {
  mergeRealEstateDisclosureDeltas,
  type RealEstateDisclosureDeletionMarker,
  type RealEstateDisclosureReadRecord,
} from '../../core/domain/realEstateDisclosureRead';
import { FirestoreRepositories } from './firestoreRepositories';
import {
  buildOverlapSinceMs,
  COLLECTIONS,
  commitCollectionCursorAfterConfirmedMerge,
  commitCursorAfterConfirmedMerge,
  computeCandidateDeltaCursor,
  computeMaxServerEpochMs,
  CURSOR_OVERLAP_MS,
  mapBetaSnapshot,
  mapCompaniesSnapshot,
  mapCompanyOverridesSnapshot,
  mapDailySchemasSnapshot,
  mapDailySnapshot,
  mapDecisionsSnapshot,
  mapDividendsSnapshot,
  mapDividendYearStatusesSnapshot,
  mapFinancialsSnapshot,
  mapMacroSnapshot,
  mapQuarterlySnapshot,
  mapRealEstateDisclosuresSnapshot,
  mapSectorPESnapshot,
  mapStoriesSnapshot,
  mapTombstonesSnapshot,
  mapTradesSnapshot,
  metaFromSnapshot,
  type RealEstateDisclosuresSnapshotMapped,
} from './firestoreTransforms';

export {
  COLLECTIONS,
  CURSOR_OVERLAP_MS,
  buildOverlapSinceMs,
  commitCollectionCursorAfterConfirmedMerge,
  commitCursorAfterConfirmedMerge,
  computeCandidateDeltaCursor,
  computeMaxServerEpochMs,
};

export interface RealEstateDisclosuresFetchPort {
  fetchFull: () => Promise<RealEstateDisclosuresSnapshotMapped>;
  fetchDelta: (sinceMs: number) => Promise<RealEstateDisclosuresSnapshotMapped>;
}

export interface SyncRealEstateDisclosuresResult {
  attempted: boolean;
  status: 'unauthorized' | 'synced' | 'merge_rejected' | 'stale_scope' | 'error';
  isDelta: boolean;
  sinceMs: number | null;
  records: RealEstateDisclosureReadRecord[];
  mergedRecords: RealEstateDisclosureReadRecord[];
  deletedDocIds: string[];
  deletedMarkers: RealEstateDisclosureDeletionMarker[];
  previousCursorMs: number;
  candidateCursorMs: number;
  committedCursorMs: number;
  error?: unknown;
}

export interface SyncStats {
  lastSyncAt: string;
  lastCheckedAt: string;
  lastUserWriteAt: string;
  deltaCursorMs: number;
  collectionCursors: Partial<Record<SyncCollectionKey, number>>;
  updatedEntitiesCount: number;
  collectionsChecked: number;
  status: 'idle' | 'syncing' | 'synced' | 'error' | 'offline';
  messageAr: string;
}

export interface SyncAllResult {
  stats: SyncStats;
  data: SyncAllCollectionsPayload;
  candidateDeltaCursorMs: number;
  candidateCursorsByCollection: Partial<Record<SyncCollectionKey, number>>;
  abortedReason?: 'stale_scope' | 'merge_rejected';
}

export class FirestoreSyncManager {
  private static activeListeners: Unsubscribe[] = [];
  private static lastSyncStats: SyncStats = {
    lastSyncAt: CacheService.getLastCheckedAt(),
    lastCheckedAt: CacheService.getLastCheckedAt(),
    lastUserWriteAt: CacheService.getLastUserWriteAt(),
    deltaCursorMs: CacheService.getDeltaCursorMs(),
    collectionCursors: CacheService.getAllCollectionDeltaCursors(),
    updatedEntitiesCount: 0,
    collectionsChecked: 0,
    status: 'idle',
    messageAr: 'جاهز للمزامنة مع Firestore',
  };

  public static getLastSyncTimestamp(): string {
    return CacheService.getLastCheckedAt();
  }

  public static getLastCheckedAt(): string {
    return CacheService.getLastCheckedAt();
  }

  public static getLastUserWriteAt(): string {
    return CacheService.getLastUserWriteAt();
  }

  public static getDeltaCursorMs(): number {
    return CacheService.getDeltaCursorMs();
  }

  public static getCollectionDeltaCursorMs(collectionKey: SyncCollectionKey): number {
    return CacheService.getCollectionDeltaCursorMs(collectionKey);
  }

  public static getSyncStats(): SyncStats {
    return {
      ...this.lastSyncStats,
      lastCheckedAt: CacheService.getLastCheckedAt() || this.lastSyncStats.lastCheckedAt,
      lastUserWriteAt: CacheService.getLastUserWriteAt() || this.lastSyncStats.lastUserWriteAt,
      deltaCursorMs: CacheService.getDeltaCursorMs(),
      collectionCursors: CacheService.getAllCollectionDeltaCursors(),
    };
  }

  public static recordUserWriteNow(): void {
    const nowIso = new Date().toISOString();
    CacheService.setLastUserWriteAt(nowIso);
    this.lastSyncStats.lastUserWriteAt = nowIso;
  }

  private static defaultRealEstatePort(): RealEstateDisclosuresFetchPort {
    return {
      fetchFull: () => FirestoreRepositories.getAllRealEstateDisclosuresWithMeta(true),
      fetchDelta: (sinceMs: number) =>
        FirestoreRepositories.fetchRealEstateDisclosureDeltasFromServer(sinceMs),
    };
  }

  /**
   * مزامنة تزايدية مستقلة لمجموعة `real_estate_disclosures`:
   * - لا تبدأ أي قراءة لغير المصرح لهم (`canReadRealEstateDisclosures !== true`).
   * - تعيد استخدام `serverUpdatedAt` ونافذة التداخل (`CURSOR_OVERLAP_MS = 15_000`) ومؤشر المجموعة المستقل.
   * - تتحقق من صلاحية النطاق والجلسة قبل وبعد كل حد غير متزامن (الجلب والتخزين)، ولا تعيد `synced` لجلسة منتهية.
   */
  public static async syncRealEstateDisclosuresIncremental(options: {
    canReadRealEstateDisclosures: boolean;
    hasConfirmedBaseline?: boolean;
    forceFull?: boolean;
    existingRecords?: readonly RealEstateDisclosureReadRecord[];
    isOperationValid?: () => boolean;
    onConfirmedMerge?: (payload: {
      records: RealEstateDisclosureReadRecord[];
      allRecords: RealEstateDisclosureReadRecord[];
      deletedDocIds: string[];
      deletedMarkers: RealEstateDisclosureDeletionMarker[];
      mergedRecords: RealEstateDisclosureReadRecord[];
      isDelta: boolean;
    }) => boolean;
    persistenceDriver?: AtomicDeltaPersistenceDriver;
    fetchPort?: RealEstateDisclosuresFetchPort;
  }): Promise<SyncRealEstateDisclosuresResult> {
    const prevCursor = CacheService.getCollectionDeltaCursorMs('realEstateDisclosures');
    if (!options.canReadRealEstateDisclosures) {
      return {
        attempted: false,
        status: 'unauthorized',
        isDelta: false,
        sinceMs: null,
        records: [],
        mergedRecords: [],
        deletedDocIds: [],
        deletedMarkers: [],
        previousCursorMs: prevCursor,
        candidateCursorMs: prevCursor,
        committedCursorMs: prevCursor,
      };
    }

    const opGuard = CacheService.captureOperationGuard(['realEstateDisclosures']);
    const startScopeKey = opGuard.scopeKey;
    const isStillValid = (): boolean =>
      CacheService.getScopeKey() === startScopeKey &&
      CacheService.isOperationGuardValid(opGuard, ['realEstateDisclosures']) &&
      (options.isOperationValid ? options.isOperationValid() : true);

    const forceFull = Boolean(options.forceFull);
    const hasBaseline =
      !forceFull &&
      prevCursor > 0 &&
      (options.hasConfirmedBaseline !== undefined
        ? Boolean(options.hasConfirmedBaseline)
        : CacheService.getCollectionBaselineConfirmed('realEstateDisclosures'));

    const port = options.fetchPort ?? this.defaultRealEstatePort();
    const sinceMs = hasBaseline ? buildOverlapSinceMs(prevCursor) : null;

    let fetched: RealEstateDisclosuresSnapshotMapped;
    try {
      fetched =
        hasBaseline && sinceMs !== null
          ? await port.fetchDelta(sinceMs)
          : await port.fetchFull();
    } catch (error) {
      if (isFirestorePermissionDeniedError(error) && CacheService.getScopeKey() === startScopeKey) {
        CacheService.clearRealEstateDisclosuresCache(undefined, startScopeKey);
      }
      return {
        attempted: true,
        status: 'error',
        isDelta: hasBaseline,
        sinceMs,
        records: [],
        mergedRecords: [],
        deletedDocIds: [],
        deletedMarkers: [],
        previousCursorMs: prevCursor,
        candidateCursorMs: prevCursor,
        committedCursorMs:
          CacheService.getScopeKey() === startScopeKey
            ? CacheService.getCollectionDeltaCursorMs('realEstateDisclosures')
            : prevCursor,
        error,
      };
    }

    const deletedMarkers = fetched.deletedMarkers ?? [];

    // Scope & session isolation guard after fetch boundary
    if (!isStillValid()) {
      return {
        attempted: true,
        status: 'stale_scope',
        isDelta: hasBaseline,
        sinceMs,
        records: fetched.records,
        mergedRecords: [],
        deletedDocIds: fetched.deletedDocIds,
        deletedMarkers,
        previousCursorMs: prevCursor,
        candidateCursorMs: prevCursor,
        committedCursorMs: prevCursor,
      };
    }

    const candidateCursorMs = computeCandidateDeltaCursor(
      hasBaseline ? prevCursor : 0,
      fetched.stamped
    );
    const baseRecords = hasBaseline
      ? options.existingRecords ?? CacheService.getRealEstateDisclosures()
      : [];
    const mergedRecords = mergeRealEstateDisclosureDeltas(
      baseRecords,
      fetched.allRecords,
      {
        deletedDocIds: fetched.deletedDocIds,
        deletedMarkers,
      }
    );

    const mergeSucceeded = options.onConfirmedMerge
      ? options.onConfirmedMerge({
          records: fetched.records,
          allRecords: fetched.allRecords,
          deletedDocIds: fetched.deletedDocIds,
          deletedMarkers,
          mergedRecords,
          isDelta: hasBaseline,
        })
      : true;

    if (!mergeSucceeded || !isStillValid()) {
      const stillValid = isStillValid();
      return {
        attempted: true,
        status: stillValid ? 'merge_rejected' : 'stale_scope',
        isDelta: hasBaseline,
        sinceMs,
        records: fetched.records,
        mergedRecords,
        deletedDocIds: fetched.deletedDocIds,
        deletedMarkers,
        previousCursorMs: prevCursor,
        candidateCursorMs,
        committedCursorMs: stillValid
          ? CacheService.getCollectionDeltaCursorMs('realEstateDisclosures')
          : prevCursor,
      };
    }

    try {
      if (typeof indexedDB !== 'undefined' || options.persistenceDriver) {
        const persisted = await CacheService.persistCollectionDeltaAtomically({
          collection: 'realEstateDisclosures',
          records: mergedRecords,
          cursorMs: candidateCursorMs > 0 ? candidateCursorMs : undefined,
          confirmed: true,
          driver: options.persistenceDriver,
          expectedScopeKey: startScopeKey,
          operationGuard: opGuard,
          isStillValid,
        });
        if (!persisted || !isStillValid()) {
          return {
            attempted: true,
            status: 'stale_scope',
            isDelta: hasBaseline,
            sinceMs,
            records: fetched.records,
            mergedRecords,
            deletedDocIds: fetched.deletedDocIds,
            deletedMarkers,
            previousCursorMs: prevCursor,
            candidateCursorMs,
            committedCursorMs: prevCursor,
          };
        }
      } else {
        if (!isStillValid()) {
          return {
            attempted: true,
            status: 'stale_scope',
            isDelta: hasBaseline,
            sinceMs,
            records: fetched.records,
            mergedRecords,
            deletedDocIds: fetched.deletedDocIds,
            deletedMarkers,
            previousCursorMs: prevCursor,
            candidateCursorMs,
            committedCursorMs: prevCursor,
          };
        }
        commitCollectionCursorAfterConfirmedMerge({
          collection: 'realEstateDisclosures',
          previousCursorMs: hasBaseline ? prevCursor : 0,
          candidateCursorMs,
          mergeSucceeded: true,
          expectedScopeKey: startScopeKey,
          operationGuard: opGuard,
        });
        CacheService.setCollectionBaselineConfirmed(
          'realEstateDisclosures',
          true,
          startScopeKey,
          opGuard
        );
      }

      const savedLocal = CacheService.saveRealEstateDisclosures(
        mergedRecords,
        startScopeKey,
        opGuard
      );
      if (!savedLocal || !isStillValid()) {
        return {
          attempted: true,
          status: 'stale_scope',
          isDelta: hasBaseline,
          sinceMs,
          records: fetched.records,
          mergedRecords,
          deletedDocIds: fetched.deletedDocIds,
          deletedMarkers,
          previousCursorMs: prevCursor,
          candidateCursorMs,
          committedCursorMs: prevCursor,
        };
      }
    } catch (error) {
      return {
        attempted: true,
        status: 'error',
        isDelta: hasBaseline,
        sinceMs,
        records: fetched.records,
        mergedRecords,
        deletedDocIds: fetched.deletedDocIds,
        deletedMarkers,
        previousCursorMs: prevCursor,
        candidateCursorMs,
        committedCursorMs:
          CacheService.getScopeKey() === startScopeKey
            ? CacheService.getCollectionDeltaCursorMs('realEstateDisclosures')
            : prevCursor,
        error,
      };
    }

    if (!isStillValid()) {
      return {
        attempted: true,
        status: 'stale_scope',
        isDelta: hasBaseline,
        sinceMs,
        records: fetched.records,
        mergedRecords,
        deletedDocIds: fetched.deletedDocIds,
        deletedMarkers,
        previousCursorMs: prevCursor,
        candidateCursorMs,
        committedCursorMs: prevCursor,
      };
    }

    const committedCursorMs = CacheService.getCollectionDeltaCursorMs('realEstateDisclosures');
    this.lastSyncStats.collectionCursors = CacheService.getAllCollectionDeltaCursors();

    return {
      attempted: true,
      status: 'synced',
      isDelta: hasBaseline,
      sinceMs,
      records: fetched.records,
      mergedRecords,
      deletedDocIds: fetched.deletedDocIds,
      deletedMarkers,
      previousCursorMs: prevCursor,
      candidateCursorMs,
      committedCursorMs,
    };
  }

  /**
   * مزامنة بمؤشرات مستقلة لكل مجموعة (Per-Collection Cursors):
   * - لا تستخدم مؤشراً موحداً يمكنه القفز بمجموعة لم تتحدث أو لم تؤكَّد.
   * - تلتزم بالتخزين الذري في IndexedDB (البيانات + المؤشر في نفس المعاملة).
   */
  public static async syncAllIncrementalDeltas(options?: {
    hasFullBaseline?: boolean;
    confirmedBaselines?: Partial<Record<SyncCollectionKey, boolean>>;
    forceFull?: boolean;
    canReadRealEstateDisclosures?: boolean;
    existingRealEstateDisclosures?: readonly RealEstateDisclosureReadRecord[];
    realEstatePort?: RealEstateDisclosuresFetchPort;
    isOperationValid?: () => boolean;
    isRealEstateStillAuthorized?: () => boolean;
    repositoriesOverride?: Partial<typeof FirestoreRepositories>;
    onConfirmedMerge?: (payload: SyncAllCollectionsPayload) => boolean;
    persistenceDriver?: AtomicDeltaPersistenceDriver;
  }): Promise<SyncAllResult> {
    this.lastSyncStats.status = 'syncing';
    this.lastSyncStats.messageAr = 'جارٍ مزامنة البيانات المؤكدة من خادم Firestore...';
    const checkedIso = new Date().toISOString();
    const forceFull = Boolean(options?.forceFull);
    const batchGuard = CacheService.captureOperationGuard(ALL_SYNC_COLLECTION_KEYS);
    const startScopeKey = batchGuard.scopeKey;
    const repoOverride = options?.repositoriesOverride;

    const isSessionStillValid = (): boolean =>
      CacheService.getScopeKey() === startScopeKey &&
      CacheService.isOperationGuardValid(batchGuard, []) &&
      (options?.isOperationValid ? options.isOperationValid() : true);

    const isRealEstateStillValid = (): boolean =>
      isSessionStillValid() &&
      CacheService.isOperationGuardValid(batchGuard, ['realEstateDisclosures']) &&
      (options?.isRealEstateStillAuthorized ? options.isRealEstateStillAuthorized() : true);

    const fetchDeltaDocs = (collectionName: string, sinceMs: number) =>
      repoOverride?.fetchDeltaDocsFromServer
        ? repoOverride.fetchDeltaDocsFromServer(collectionName, sinceMs)
        : FirestoreRepositories.fetchDeltaDocsFromServer(collectionName, sinceMs);

    const hasBaselineFor = (col: SyncCollectionKey): boolean => {
      if (forceFull) return false;
      const prevCursor = CacheService.getCollectionDeltaCursorMs(col);
      if (prevCursor <= 0) return false;
      if (options?.confirmedBaselines && col in options.confirmedBaselines) {
        return Boolean(options.confirmedBaselines[col]);
      }
      return Boolean(options?.hasFullBaseline) || CacheService.getCollectionBaselineConfirmed(col);
    };

    try {
      const fetchQuarterly = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('quarterly');
        if (hasBaselineFor('quarterly')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.QUARTERLY_RECORDS,
              buildOverlapSinceMs(prev)
            );
            const records = mapQuarterlySnapshot(snap);
            return {
              records,
              stamped: records as unknown as Array<{ serverUpdatedAt?: unknown }>,
              isDelta: true,
              prev,
            };
          } catch {
            // fallback for this collection only
          }
        }
        const full = repoOverride?.getAllQuarterlyRecordsWithMeta
          ? await repoOverride.getAllQuarterlyRecordsWithMeta(true)
          : await FirestoreRepositories.getAllQuarterlyRecordsWithMeta(true);
        return { records: full.records, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchCompanies = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('companies');
        if (hasBaselineFor('companies')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.COMPANIES,
              buildOverlapSinceMs(prev)
            );
            const records = mapCompaniesSnapshot(snap);
            return {
              records,
              stamped: records as unknown as Array<{ serverUpdatedAt?: unknown }>,
              isDelta: true,
              prev,
            };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllCompaniesWithMeta
          ? await repoOverride.getAllCompaniesWithMeta(true)
          : await FirestoreRepositories.getAllCompaniesWithMeta(true);
        return { records: full.records, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchDaily = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('daily');
        if (hasBaselineFor('daily')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.DAILY_TRADING,
              buildOverlapSinceMs(prev)
            );
            const records = mapDailySnapshot(snap);
            return {
              records,
              stamped: records as unknown as Array<{ serverUpdatedAt?: unknown }>,
              isDelta: true,
              prev,
            };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllDailyTradingRecordsWithMeta
          ? await repoOverride.getAllDailyTradingRecordsWithMeta(true)
          : await FirestoreRepositories.getAllDailyTradingRecordsWithMeta(true);
        return { records: full.records, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchDailySchemas = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('dailySchemas');
        if (hasBaselineFor('dailySchemas')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.DAILY_SCHEMAS,
              buildOverlapSinceMs(prev)
            );
            const { map, stamped } = mapDailySchemasSnapshot(snap);
            return { values: map, stamped, isDelta: true, prev };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllDailyTradingSchemasWithMeta
          ? await repoOverride.getAllDailyTradingSchemasWithMeta(true)
          : await FirestoreRepositories.getAllDailyTradingSchemasWithMeta(true);
        return { values: full.values, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchBeta = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('betaAssumptions');
        if (hasBaselineFor('betaAssumptions')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.BETA_ASSUMPTIONS,
              buildOverlapSinceMs(prev)
            );
            const { records, stamped } = mapBetaSnapshot(snap);
            return { records, stamped, isDelta: true, prev };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllBetaAssumptionsWithMeta
          ? await repoOverride.getAllBetaAssumptionsWithMeta(true)
          : await FirestoreRepositories.getAllBetaAssumptionsWithMeta(true);
        return { records: full.records, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchMacro = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('macro');
        if (hasBaselineFor('macro')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.MACRO_PARAMS,
              buildOverlapSinceMs(prev)
            );
            const records = mapMacroSnapshot(snap);
            return { records, stamped: records, isDelta: true, prev };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllMacroParametersWithMeta
          ? await repoOverride.getAllMacroParametersWithMeta(true)
          : await FirestoreRepositories.getAllMacroParametersWithMeta(true);
        return { records: full.records, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchOverrides = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('companyOverrides');
        if (hasBaselineFor('companyOverrides')) {
          try {
            const snap = repoOverride?.fetchCompanyOverrideDeltasFromServer
              ? await repoOverride.fetchCompanyOverrideDeltasFromServer(buildOverlapSinceMs(prev))
              : await FirestoreRepositories.fetchCompanyOverrideDeltasFromServer(
                  buildOverlapSinceMs(prev)
                );
            const { records, stamped } = mapCompanyOverridesSnapshot(snap);
            return { records, stamped, isDelta: true, prev };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllCompanyOverridesWithMeta
          ? await repoOverride.getAllCompanyOverridesWithMeta(true)
          : await FirestoreRepositories.getAllCompanyOverridesWithMeta(true);
        return { records: full.records, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchStories = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('stories');
        if (hasBaselineFor('stories')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.STORIES,
              buildOverlapSinceMs(prev)
            );
            const { map, stamped } = mapStoriesSnapshot(snap);
            return { values: map, stamped, isDelta: true, prev };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllStoriesWithMeta
          ? await repoOverride.getAllStoriesWithMeta(true)
          : await FirestoreRepositories.getAllStoriesWithMeta(true);
        return { values: full.values, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchDecisions = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('decisions');
        if (hasBaselineFor('decisions')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.DECISIONS,
              buildOverlapSinceMs(prev)
            );
            const { map, stamped } = mapDecisionsSnapshot(snap);
            return { values: map, stamped, isDelta: true, prev };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllDecisionsWithMeta
          ? await repoOverride.getAllDecisionsWithMeta(true)
          : await FirestoreRepositories.getAllDecisionsWithMeta(true);
        return { values: full.values, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchTrades = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('trades');
        if (hasBaselineFor('trades')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.TRADES,
              buildOverlapSinceMs(prev)
            );
            const records = mapTradesSnapshot(snap);
            return {
              records,
              stamped: records as unknown as Array<{ serverUpdatedAt?: unknown }>,
              isDelta: true,
              prev,
            };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllTradesWithMeta
          ? await repoOverride.getAllTradesWithMeta(true)
          : await FirestoreRepositories.getAllTradesWithMeta(true);
        return { records: full.records, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchSectorPE = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('sectorPE');
        if (hasBaselineFor('sectorPE')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.SECTOR_PE,
              buildOverlapSinceMs(prev)
            );
            const { definitions, values, stamped } = mapSectorPESnapshot(snap);
            return { definitions, values, stamped, isDelta: true, prev };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllSectorPEWithMeta
          ? await repoOverride.getAllSectorPEWithMeta(true)
          : await FirestoreRepositories.getAllSectorPEWithMeta(true);
        return {
          definitions: full.definitions,
          values: full.values,
          stamped: full.stamped,
          isDelta: false,
          prev: 0,
        };
      };

      const fetchDividends = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('dividendRecords');
        if (hasBaselineFor('dividendRecords')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.DIVIDEND_RECORDS,
              buildOverlapSinceMs(prev)
            );
            const { records, stamped } = mapDividendsSnapshot(snap);
            return { records, stamped, isDelta: true, prev };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllDividendRecordsWithMeta
          ? await repoOverride.getAllDividendRecordsWithMeta(true)
          : await FirestoreRepositories.getAllDividendRecordsWithMeta(true);
        return { records: full.records, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchDividendYearStatuses = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('dividendYearStatuses');
        if (hasBaselineFor('dividendYearStatuses')) {
          try {
            const snap = await fetchDeltaDocs(
              COLLECTIONS.DIVIDEND_YEAR_STATUSES,
              buildOverlapSinceMs(prev)
            );
            const { records, stamped } = mapDividendYearStatusesSnapshot(snap);
            return { records, stamped, isDelta: true, prev };
          } catch {
            // fallback
          }
        }
        const full = repoOverride?.getAllDividendYearStatusesWithMeta
          ? await repoOverride.getAllDividendYearStatusesWithMeta(true)
          : await FirestoreRepositories.getAllDividendYearStatusesWithMeta(true);
        return { records: full.records, stamped: full.stamped, isDelta: false, prev: 0 };
      };

      const fetchTombstones = async () => {
        const prev = CacheService.getCollectionDeltaCursorMs('tombstones');
        if (prev > 0 && !forceFull) {
          const snap = await fetchDeltaDocs(
            COLLECTIONS.TOMBSTONES,
            buildOverlapSinceMs(prev)
          );
          const records = mapTombstonesSnapshot(snap);
          return { records, prev };
        }
        const records = repoOverride?.getAllTombstones
          ? await repoOverride.getAllTombstones(true)
          : await FirestoreRepositories.getAllTombstones(true);
        return { records, prev: 0 };
      };

      const fetchRealEstateDisclosures = async (): Promise<
        | { attempted: false }
        | {
            attempted: true;
            ok: true;
            records: RealEstateDisclosureReadRecord[];
            allRecords: RealEstateDisclosureReadRecord[];
            deletedDocIds: string[];
            deletedMarkers: RealEstateDisclosureDeletionMarker[];
            stamped: Array<{ serverUpdatedAt?: unknown }>;
            isDelta: boolean;
            prev: number;
          }
        | {
            attempted: true;
            ok: false;
            error: unknown;
            isDelta: boolean;
            prev: number;
          }
      > => {
        if (options?.canReadRealEstateDisclosures !== true) {
          return { attempted: false };
        }
        const prev = CacheService.getCollectionDeltaCursorMs('realEstateDisclosures');
        const useDelta = hasBaselineFor('realEstateDisclosures');
        const port = options?.realEstatePort ?? this.defaultRealEstatePort();
        try {
          const mapped = useDelta
            ? await port.fetchDelta(buildOverlapSinceMs(prev))
            : await port.fetchFull();
          return {
            attempted: true,
            ok: true,
            records: mapped.records,
            allRecords: mapped.allRecords,
            deletedDocIds: mapped.deletedDocIds,
            deletedMarkers: mapped.deletedMarkers ?? [],
            stamped: mapped.stamped,
            isDelta: useDelta,
            prev: useDelta ? prev : 0,
          };
        } catch (error) {
          // Isolated: error/permission-denied on real_estate_disclosures MUST NOT break other collections.
          if (isFirestorePermissionDeniedError(error) && CacheService.getScopeKey() === startScopeKey) {
            CacheService.clearRealEstateDisclosuresCache(undefined, startScopeKey);
          }
          return {
            attempted: true,
            ok: false,
            error,
            isDelta: useDelta,
            prev,
          };
        }
      };

      const [
        qRes,
        cRes,
        dRes,
        dsRes,
        bRes,
        mRes,
        oRes,
        sRes,
        decRes,
        trRes,
        secRes,
        divRes,
        divStatusRes,
        tombRes,
        reRes,
      ] = await Promise.all([
        fetchQuarterly(),
        fetchCompanies(),
        fetchDaily(),
        fetchDailySchemas(),
        fetchBeta(),
        fetchMacro(),
        fetchOverrides(),
        fetchStories(),
        fetchDecisions(),
        fetchTrades(),
        fetchSectorPE(),
        fetchDividends(),
        fetchDividendYearStatuses(),
        fetchTombstones(),
        fetchRealEstateDisclosures(),
      ]);

      // Post-fetch scope/session validity check: drop stale results before merging or persisting
      if (!isSessionStillValid()) {
        return {
          stats: {
            ...this.getSyncStats(),
            status: 'idle',
            deltaCursorMs: CacheService.getDeltaCursorMs(),
          },
          data: {
            quarterly: [],
            companies: [],
            daily: [],
            stories: {},
            decisions: {},
            trades: [],
            macro: [],
            isIncrementalDelta: false,
          },
          candidateDeltaCursorMs: 0,
          candidateCursorsByCollection: {},
          abortedReason: 'stale_scope',
        };
      }

      const realEstateAllowedForMerge =
        reRes.attempted && reRes.ok && isRealEstateStillValid();

      const anyDelta =
        qRes.isDelta ||
        cRes.isDelta ||
        dRes.isDelta ||
        dsRes.isDelta ||
        bRes.isDelta ||
        mRes.isDelta ||
        oRes.isDelta ||
        sRes.isDelta ||
        decRes.isDelta ||
        trRes.isDelta ||
        secRes.isDelta ||
        divRes.isDelta ||
        divStatusRes.isDelta ||
        (realEstateAllowedForMerge && reRes.isDelta);

      const data: SyncAllCollectionsPayload = {
        quarterly: qRes.records,
        companies: cRes.records,
        daily: dRes.records,
        dailySchemas: dsRes.values,
        stories: sRes.values,
        decisions: decRes.values,
        trades: trRes.records,
        macro: mRes.records,
        sectorDefinitions:
          secRes.definitions.length > 0 || !secRes.isDelta ? secRes.definitions : undefined,
        sectorPE: Object.keys(secRes.values).length > 0 || !secRes.isDelta ? secRes.values : undefined,
        betaAssumptions: bRes.records,
        companyOverrides: oRes.records,
        dividendRecords: divRes.records,
        dividendYearStatuses: divStatusRes.records,
        ...(reRes.attempted
          ? reRes.ok
            ? realEstateAllowedForMerge
              ? {
                  realEstateDisclosures: reRes.records,
                  realEstateDisclosuresIncomingAll: reRes.allRecords,
                  realEstateDisclosuresDeletedDocIds: reRes.deletedDocIds,
                  realEstateDisclosuresDeletedMarkers: reRes.deletedMarkers,
                  realEstateDisclosuresIsDelta: reRes.isDelta,
                  realEstateDisclosuresSyncOutcome: {
                    attempted: true,
                    status: 'ok' as const,
                    isDelta: reRes.isDelta,
                  },
                }
              : {
                  realEstateDisclosuresSyncOutcome: {
                    attempted: false,
                    status: 'unauthorized' as const,
                  },
                }
            : {
                realEstateDisclosuresSyncOutcome: {
                  attempted: true,
                  status: 'error' as const,
                  isDelta: reRes.isDelta,
                  error: reRes.error,
                },
              }
          : {
              realEstateDisclosuresSyncOutcome: {
                attempted: false,
                status: 'unauthorized' as const,
              },
            }),
        tombstones: tombRes.records,
        isIncrementalDelta: anyDelta,
      };

      const candidateCursorsByCollection: Partial<Record<SyncCollectionKey, number>> = {
        quarterly: computeCandidateDeltaCursor(qRes.prev, qRes.stamped),
        companies: computeCandidateDeltaCursor(cRes.prev, cRes.stamped),
        daily: computeCandidateDeltaCursor(dRes.prev, dRes.stamped),
        dailySchemas: computeCandidateDeltaCursor(dsRes.prev, dsRes.stamped),
        betaAssumptions: computeCandidateDeltaCursor(bRes.prev, bRes.stamped),
        macro: computeCandidateDeltaCursor(mRes.prev, mRes.stamped),
        companyOverrides: computeCandidateDeltaCursor(oRes.prev, oRes.stamped),
        stories: computeCandidateDeltaCursor(sRes.prev, sRes.stamped),
        decisions: computeCandidateDeltaCursor(decRes.prev, decRes.stamped),
        trades: computeCandidateDeltaCursor(trRes.prev, trRes.stamped),
        sectorPE: computeCandidateDeltaCursor(secRes.prev, secRes.stamped),
        dividendRecords: computeCandidateDeltaCursor(divRes.prev, divRes.stamped),
        dividendYearStatuses: computeCandidateDeltaCursor(divStatusRes.prev, divStatusRes.stamped),
        tombstones: computeCandidateDeltaCursor(
          tombRes.prev,
          tombRes.records as unknown as Array<{ serverUpdatedAt?: unknown }>
        ),
        ...(realEstateAllowedForMerge
          ? {
              realEstateDisclosures: computeCandidateDeltaCursor(reRes.prev, reRes.stamped),
            }
          : {}),
      };

      const positiveCandidates = Object.values(candidateCursorsByCollection).filter(
        (v): v is number => typeof v === 'number' && v > 0
      );
      const candidateDeltaCursorMs =
        positiveCandidates.length > 0 ? Math.min(...positiveCandidates) : 0;

      const mergeSucceeded = options?.onConfirmedMerge ? options.onConfirmedMerge(data) : true;
      if (!mergeSucceeded || !isSessionStillValid()) {
        const stillValid = isSessionStillValid();
        if (stillValid) {
          this.lastSyncStats.status = 'idle';
        }
        return {
          stats: {
            ...this.getSyncStats(),
            status: 'idle',
            deltaCursorMs: CacheService.getDeltaCursorMs(),
          },
          data,
          candidateDeltaCursorMs,
          candidateCursorsByCollection,
          abortedReason: stillValid ? 'merge_rejected' : 'stale_scope',
        };
      }

      const mergedRealEstateToPersist =
        realEstateAllowedForMerge && isRealEstateStillValid()
          ? mergeRealEstateDisclosureDeltas(
              reRes.isDelta
                ? options?.existingRealEstateDisclosures ?? CacheService.getRealEstateDisclosures()
                : [],
              reRes.allRecords,
              {
                deletedDocIds: reRes.deletedDocIds,
                deletedMarkers: reRes.deletedMarkers,
              }
            )
          : null;

      // Atomic IndexedDB batch persistence for all collections & their independent cursors.
      // Scope & session validity are verified both before and after the async persistence boundary.
      if (typeof indexedDB !== 'undefined' || options?.persistenceDriver) {
        const atomicEntries: Array<{
          collection: SyncCollectionKey;
          records: unknown;
          cursorMs?: number;
          confirmed?: boolean;
        }> = [
          { collection: 'quarterly', records: qRes.records, cursorMs: candidateCursorsByCollection.quarterly, confirmed: true },
          { collection: 'companies', records: cRes.records, cursorMs: candidateCursorsByCollection.companies, confirmed: true },
          { collection: 'daily', records: dRes.records, cursorMs: candidateCursorsByCollection.daily, confirmed: true },
          { collection: 'dailySchemas', records: dsRes.values, cursorMs: candidateCursorsByCollection.dailySchemas, confirmed: true },
          { collection: 'betaAssumptions', records: bRes.records, cursorMs: candidateCursorsByCollection.betaAssumptions, confirmed: true },
          { collection: 'macro', records: mRes.records, cursorMs: candidateCursorsByCollection.macro, confirmed: true },
          { collection: 'companyOverrides', records: oRes.records, cursorMs: candidateCursorsByCollection.companyOverrides, confirmed: true },
          { collection: 'stories', records: sRes.values, cursorMs: candidateCursorsByCollection.stories, confirmed: true },
          { collection: 'decisions', records: decRes.values, cursorMs: candidateCursorsByCollection.decisions, confirmed: true },
          { collection: 'trades', records: trRes.records, cursorMs: candidateCursorsByCollection.trades, confirmed: true },
          { collection: 'sectorPE', records: secRes.values, cursorMs: candidateCursorsByCollection.sectorPE, confirmed: true },
          { collection: 'dividendRecords', records: divRes.records, cursorMs: candidateCursorsByCollection.dividendRecords, confirmed: true },
          { collection: 'dividendYearStatuses', records: divStatusRes.records, cursorMs: candidateCursorsByCollection.dividendYearStatuses, confirmed: true },
          { collection: 'tombstones', records: tombRes.records, cursorMs: candidateCursorsByCollection.tombstones, confirmed: true },
        ];
        if (realEstateAllowedForMerge && mergedRealEstateToPersist && isRealEstateStillValid()) {
          atomicEntries.push({
            collection: 'realEstateDisclosures',
            records: mergedRealEstateToPersist,
            cursorMs: candidateCursorsByCollection.realEstateDisclosures,
            confirmed: true,
          });
        }
        const persisted = await CacheService.persistBatchDeltaAtomically({
          driver: options?.persistenceDriver,
          entries: atomicEntries,
          expectedScopeKey: startScopeKey,
          operationGuard: batchGuard,
          isStillValid: isSessionStillValid,
          isCollectionValid: (col) =>
            col === 'realEstateDisclosures' ? isRealEstateStillValid() : true,
        });
        if (!persisted || !isSessionStillValid()) {
          return {
            stats: {
              ...this.getSyncStats(),
              status: 'idle',
              deltaCursorMs: CacheService.getDeltaCursorMs(),
            },
            data,
            candidateDeltaCursorMs,
            candidateCursorsByCollection,
            abortedReason: 'stale_scope',
          };
        }
      } else {
        if (!isSessionStillValid()) {
          return {
            stats: {
              ...this.getSyncStats(),
              status: 'idle',
              deltaCursorMs: CacheService.getDeltaCursorMs(),
            },
            data,
            candidateDeltaCursorMs,
            candidateCursorsByCollection,
            abortedReason: 'stale_scope',
          };
        }
        const nonRealEstateCommits: Array<[SyncCollectionKey, number]> = [
          ['quarterly', qRes.prev],
          ['companies', cRes.prev],
          ['daily', dRes.prev],
          ['dailySchemas', dsRes.prev],
          ['betaAssumptions', bRes.prev],
          ['macro', mRes.prev],
          ['companyOverrides', oRes.prev],
          ['stories', sRes.prev],
          ['decisions', decRes.prev],
          ['trades', trRes.prev],
          ['sectorPE', secRes.prev],
          ['dividendRecords', divRes.prev],
          ['dividendYearStatuses', divStatusRes.prev],
          ['tombstones', tombRes.prev],
        ];
        for (const [col, prev] of nonRealEstateCommits) {
          commitCollectionCursorAfterConfirmedMerge({
            collection: col,
            previousCursorMs: prev,
            candidateCursorMs: candidateCursorsByCollection[col] ?? 0,
            mergeSucceeded: true,
            expectedScopeKey: startScopeKey,
            operationGuard: batchGuard,
          });
          CacheService.setCollectionBaselineConfirmed(col, true, startScopeKey, batchGuard);
        }
        if (realEstateAllowedForMerge && isRealEstateStillValid()) {
          commitCollectionCursorAfterConfirmedMerge({
            collection: 'realEstateDisclosures',
            previousCursorMs: reRes.prev,
            candidateCursorMs: candidateCursorsByCollection.realEstateDisclosures ?? 0,
            mergeSucceeded: true,
            expectedScopeKey: startScopeKey,
            operationGuard: batchGuard,
          });
          CacheService.setCollectionBaselineConfirmed(
            'realEstateDisclosures',
            true,
            startScopeKey,
            batchGuard
          );
        }
      }

      if (!isSessionStillValid()) {
        return {
          stats: {
            ...this.getSyncStats(),
            status: 'idle',
            deltaCursorMs: CacheService.getDeltaCursorMs(),
          },
          data,
          candidateDeltaCursorMs,
          candidateCursorsByCollection,
          abortedReason: 'stale_scope',
        };
      }

      if (realEstateAllowedForMerge && mergedRealEstateToPersist && isRealEstateStillValid()) {
        CacheService.saveRealEstateDisclosures(mergedRealEstateToPersist, startScopeKey, batchGuard);
      }

      const committedSummaryCursor = commitCursorAfterConfirmedMerge({
        previousCursorMs: CacheService.getDeltaCursorMs(),
        candidateCursorMs: candidateDeltaCursorMs,
        mergeSucceeded: true,
        expectedScopeKey: startScopeKey,
        operationGuard: batchGuard,
      });

      CacheService.setLastCheckedAt(checkedIso, startScopeKey, batchGuard);

      if (!isSessionStillValid()) {
        return {
          stats: {
            ...this.getSyncStats(),
            status: 'idle',
            deltaCursorMs: CacheService.getDeltaCursorMs(),
          },
          data,
          candidateDeltaCursorMs,
          candidateCursorsByCollection,
          abortedReason: 'stale_scope',
        };
      }

      const realEstatePersisted = realEstateAllowedForMerge && isRealEstateStillValid();
      const realEstateCount = realEstatePersisted ? reRes.records.length : 0;
      const totalCount =
        qRes.records.length +
        cRes.records.length +
        dRes.records.length +
        Object.keys(dsRes.values).length +
        bRes.records.length +
        mRes.records.length +
        oRes.records.length +
        divRes.records.length +
        divStatusRes.records.length +
        tombRes.records.length +
        Object.keys(sRes.values).length +
        Object.keys(decRes.values).length +
        Object.keys(secRes.values).length +
        trRes.records.length +
        realEstateCount;

      this.lastSyncStats = {
        lastSyncAt: checkedIso,
        lastCheckedAt: checkedIso,
        lastUserWriteAt: CacheService.getLastUserWriteAt(),
        deltaCursorMs: committedSummaryCursor,
        collectionCursors: CacheService.getAllCollectionDeltaCursors(),
        updatedEntitiesCount: totalCount,
        collectionsChecked: realEstatePersisted ? 15 : 14,
        status: 'synced',
        messageAr: anyDelta
          ? `مزامنة تزايدية من الخادم بمؤشرات مستقلة (${totalCount} تحديث / ${tombRes.records.length} حذف)`
          : `تمت المزامنة الكاملة من الخادم (${qRes.records.length} سجل مالي فصلي)`,
      };

      return {
        stats: { ...this.lastSyncStats },
        data,
        candidateDeltaCursorMs,
        candidateCursorsByCollection,
      };
    } catch (e: any) {
      console.error('Error syncing Firestore collections from server:', e);
      if (isSessionStillValid()) {
        this.lastSyncStats.status = 'error';
        this.lastSyncStats.messageAr = e?.message || 'تعذر الاتصال بخادم Firestore أثناء المزامنة';
      }
      throw e;
    }
  }

  /**
   * مساعد مركزي لحفظ لقطات الاشتراكات الحية مع ربط صارم بنطاق الاشتراك وحارس العملية.
   * يتحقق من الصلاحية قبل وبعد الحد غير المتزامن لمنع تسرّب المؤشرات أو إعادة ملء الكاش لحساب آخر.
   */
  public static async persistSubscriptionCollectionSnapshot(params: {
    colKey: SyncCollectionKey;
    meta: SnapshotMetadataInfo;
    records: unknown;
    stamped: Array<{ serverUpdatedAt?: unknown }>;
    subscriptionScopeKey: string;
    operationGuard: CacheOperationGuard;
    isSubscriptionActive: () => boolean;
    driver?: AtomicDeltaPersistenceDriver;
    onLocalStorageSave?: () => void;
  }): Promise<boolean> {
    if (params.meta.fromCache) return false;

    const isStillValid = (): boolean =>
      params.isSubscriptionActive() &&
      CacheService.getScopeKey() === params.subscriptionScopeKey &&
      CacheService.isOperationGuardValid(params.operationGuard, [params.colKey]);

    if (!isStillValid()) return false;

    const candidate = computeMaxServerEpochMs(params.stamped);
    const prev = CacheService.getCollectionDeltaCursorMs(params.colKey);
    const nextCursor = candidate > prev ? candidate : prev;

    if (typeof indexedDB !== 'undefined' || params.driver) {
      const persisted = await CacheService.persistCollectionDeltaAtomically({
        collection: params.colKey,
        records: params.records,
        cursorMs: nextCursor > 0 ? nextCursor : undefined,
        confirmed: true,
        driver: params.driver,
        expectedScopeKey: params.subscriptionScopeKey,
        operationGuard: params.operationGuard,
        isStillValid,
      });
      if (!persisted || !isStillValid()) {
        return false;
      }
    } else {
      if (!isStillValid()) return false;
      if (nextCursor > 0) {
        CacheService.setCollectionDeltaCursorMs(
          params.colKey,
          nextCursor,
          params.subscriptionScopeKey,
          params.operationGuard
        );
      }
      CacheService.setCollectionBaselineConfirmed(
        params.colKey,
        true,
        params.subscriptionScopeKey,
        params.operationGuard
      );
    }

    if (!isStillValid()) return false;
    params.onLocalStorageSave?.();

    if (isStillValid()) {
      this.lastSyncStats.collectionCursors = CacheService.getAllCollectionDeltaCursors();
    }
    return true;
  }

  public static subscribeToAll(handlers: {
    onCompanies?: (companies: Company[], meta: SnapshotMetadataInfo) => void;
    onFinancials?: (financials: QuarterlyFinancial[], meta: SnapshotMetadataInfo) => void;
    onStories?: (stories: Record<string, InvestmentStory>, meta: SnapshotMetadataInfo) => void;
    onDecisions?: (decisions: Record<string, DecisionItem>, meta: SnapshotMetadataInfo) => void;
    onTrades?: (trades: TradeLog[], meta: SnapshotMetadataInfo) => void;
    onMacroParams?: (params: MacroParameter[], meta: SnapshotMetadataInfo) => void;
    onSectorPE?: (
      values: Record<string, number>,
      meta: SnapshotMetadataInfo,
      definitions?: SectorDefinition[]
    ) => void;
    onDailyTrading?: (records: DailyTradingRecord[], meta: SnapshotMetadataInfo) => void;
    onDailySchemas?: (schemas: Record<string, DailyTradingSchemaRecord>, meta: SnapshotMetadataInfo) => void;
    onQuarterlyRecords?: (records: QuarterlyFinancialRecord[], meta: SnapshotMetadataInfo) => void;
    onBetaAssumptions?: (records: BetaAssumptionRecord[], meta: SnapshotMetadataInfo) => void;
    onCompanyOverrides?: (records: CompanyParameterOverride[], meta: SnapshotMetadataInfo) => void;
    onDividendRecords?: (records: DividendRecord[], meta: SnapshotMetadataInfo) => void;
    onDividendYearStatuses?: (records: DividendYearStatusRecord[], meta: SnapshotMetadataInfo) => void;
    canReadRealEstateDisclosures?: boolean;
    onRealEstateDisclosures?: (
      records: RealEstateDisclosureReadRecord[],
      meta: SnapshotMetadataInfo,
      details: {
        allRecords: RealEstateDisclosureReadRecord[];
        deletedDocIds: string[];
        deletedMarkers: RealEstateDisclosureDeletionMarker[];
      }
    ) => boolean | void;
    onUsers?: (users: AppUser[], meta: SnapshotMetadataInfo) => void;
    onError?: (collectionName: string, error: any) => void;
  }): () => void {
    this.unsubscribeAll();
    CacheService.invalidateLegacyCachesIfNeeded();

    const subscriptionGuard = CacheService.captureOperationGuard(ALL_SYNC_COLLECTION_KEYS);
    const subscriptionScopeKey = subscriptionGuard.scopeKey;
    let isSubscriptionActive = true;
    this.activeListeners.push(() => {
      isSubscriptionActive = false;
    });

    const isActiveForScope = (colKey?: SyncCollectionKey): boolean =>
      isSubscriptionActive &&
      CacheService.getScopeKey() === subscriptionScopeKey &&
      CacheService.isOperationGuardValid(subscriptionGuard, colKey ? [colKey] : []);

    const notifyError = (col: string, err: any) => {
      if (!isSubscriptionActive || CacheService.getScopeKey() !== subscriptionScopeKey) return;
      console.warn(`${col} snapshot error:`, err?.code || err?.message);
      handlers.onError?.(col, err);
    };

    const persistCollectionSnapshot = (
      colKey: SyncCollectionKey,
      meta: SnapshotMetadataInfo,
      records: unknown,
      stamped: Array<{ serverUpdatedAt?: unknown }>,
      onLocalStorageSave?: () => void,
      extraValid?: () => boolean
    ) => {
      if (meta.fromCache) return;
      void this.persistSubscriptionCollectionSnapshot({
        colKey,
        meta,
        records,
        stamped,
        subscriptionScopeKey,
        operationGuard: subscriptionGuard,
        isSubscriptionActive: () => isSubscriptionActive && (extraValid ? extraValid() : true),
        onLocalStorageSave,
      }).catch((err) => {
        console.warn(`Atomic IndexedDB commit failed for ${colKey}:`, err);
      });
    };

    if (handlers.onSectorPE) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.SECTOR_PE),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('sectorPE')) return;
          const meta = metaFromSnapshot(snapshot);
          const { definitions, values, stamped } = mapSectorPESnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot('sectorPE', meta, values, stamped, () => {
              CacheService.saveSectorDefinitions(definitions);
              CacheService.saveSectorPE(values);
            });
          }
          handlers.onSectorPE?.(values, meta, definitions);
        },
        (err) => notifyError(COLLECTIONS.SECTOR_PE, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onCompanies) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.COMPANIES),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('companies')) return;
          const meta = metaFromSnapshot(snapshot);
          const list = mapCompaniesSnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot(
              'companies',
              meta,
              list,
              list as unknown as Array<{ serverUpdatedAt?: unknown }>,
              () => CacheService.saveCompanies(list)
            );
          }
          handlers.onCompanies?.(list, meta);
        },
        (err) => notifyError(COLLECTIONS.COMPANIES, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onFinancials) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.FINANCIALS),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope()) return;
          const meta = metaFromSnapshot(snapshot);
          const list = mapFinancialsSnapshot(snapshot);
          if (!meta.fromCache && isActiveForScope()) {
            CacheService.saveFinancials(list);
          }
          handlers.onFinancials?.(list, meta);
        },
        (err) => notifyError(COLLECTIONS.FINANCIALS, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onStories) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.STORIES),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('stories')) return;
          const meta = metaFromSnapshot(snapshot);
          const { map, stamped } = mapStoriesSnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot('stories', meta, map, stamped, () =>
              CacheService.saveStories(map)
            );
          }
          handlers.onStories?.(map, meta);
        },
        (err) => notifyError(COLLECTIONS.STORIES, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onDecisions) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.DECISIONS),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('decisions')) return;
          const meta = metaFromSnapshot(snapshot);
          const { map, stamped } = mapDecisionsSnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot('decisions', meta, map, stamped, () =>
              CacheService.saveDecisions(map)
            );
          }
          handlers.onDecisions?.(map, meta);
        },
        (err) => notifyError(COLLECTIONS.DECISIONS, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onTrades) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.TRADES),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('trades')) return;
          const meta = metaFromSnapshot(snapshot);
          const list = mapTradesSnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot(
              'trades',
              meta,
              list,
              list as unknown as Array<{ serverUpdatedAt?: unknown }>,
              () => CacheService.saveTrades(list)
            );
          }
          handlers.onTrades?.(list, meta);
        },
        (err) => notifyError(COLLECTIONS.TRADES, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onMacroParams) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.MACRO_PARAMS),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('macro')) return;
          const meta = metaFromSnapshot(snapshot);
          const list = mapMacroSnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot('macro', meta, list, list, () =>
              CacheService.saveMacroParameters(list, subscriptionScopeKey)
            );
          }
          handlers.onMacroParams?.(list, meta);
        },
        (err) => notifyError(COLLECTIONS.MACRO_PARAMS, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onQuarterlyRecords) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.QUARTERLY_RECORDS),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('quarterly')) return;
          const meta = metaFromSnapshot(snapshot);
          const list = mapQuarterlySnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot(
              'quarterly',
              meta,
              list,
              list as unknown as Array<{ serverUpdatedAt?: unknown }>,
              () => CacheService.saveQuarterlyFinancialRecords(list)
            );
          }
          handlers.onQuarterlyRecords?.(list, meta);
        },
        (err) => notifyError(COLLECTIONS.QUARTERLY_RECORDS, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onDailyTrading) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.DAILY_TRADING),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('daily')) return;
          const meta = metaFromSnapshot(snapshot);
          const list = mapDailySnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot(
              'daily',
              meta,
              list,
              list as unknown as Array<{ serverUpdatedAt?: unknown }>,
              () => CacheService.saveDailyTradingRecords(list)
            );
          }
          handlers.onDailyTrading?.(list, meta);
        },
        (err) => notifyError(COLLECTIONS.DAILY_TRADING, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onDailySchemas) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.DAILY_SCHEMAS),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('dailySchemas')) return;
          const meta = metaFromSnapshot(snapshot);
          const { map, stamped } = mapDailySchemasSnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot('dailySchemas', meta, map, stamped, () =>
              CacheService.saveDailyTradingSchemas(map)
            );
          }
          handlers.onDailySchemas?.(map, meta);
        },
        (err) => notifyError(COLLECTIONS.DAILY_SCHEMAS, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onBetaAssumptions) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.BETA_ASSUMPTIONS),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('betaAssumptions')) return;
          const meta = metaFromSnapshot(snapshot);
          const { records, stamped } = mapBetaSnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot('betaAssumptions', meta, records, stamped);
          }
          handlers.onBetaAssumptions?.(records, meta);
        },
        (err) => notifyError(COLLECTIONS.BETA_ASSUMPTIONS, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onCompanyOverrides) {
      const unsub = onSnapshot(
        collectionGroup(db, 'parameters'),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('companyOverrides')) return;
          const meta = metaFromSnapshot(snapshot);
          const { records, stamped } = mapCompanyOverridesSnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot('companyOverrides', meta, records, stamped);
          }
          handlers.onCompanyOverrides?.(records, meta);
        },
        (err) => notifyError(COLLECTIONS.COMPANY_ASSUMPTIONS, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onDividendRecords) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.DIVIDEND_RECORDS),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('dividendRecords')) return;
          const meta = metaFromSnapshot(snapshot);
          const { records, stamped } = mapDividendsSnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot('dividendRecords', meta, records, stamped, () =>
              CacheService.saveDividendRecords(records)
            );
          }
          handlers.onDividendRecords?.(records, meta);
        },
        (err) => notifyError(COLLECTIONS.DIVIDEND_RECORDS, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onDividendYearStatuses) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.DIVIDEND_YEAR_STATUSES),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope('dividendYearStatuses')) return;
          const meta = metaFromSnapshot(snapshot);
          const { records, stamped } = mapDividendYearStatusesSnapshot(snapshot);
          if (!meta.fromCache) {
            persistCollectionSnapshot('dividendYearStatuses', meta, records, stamped, () =>
              CacheService.saveDividendYearStatuses(records)
            );
          }
          handlers.onDividendYearStatuses?.(records, meta);
        },
        (err) => notifyError(COLLECTIONS.DIVIDEND_YEAR_STATUSES, err)
      );
      this.activeListeners.push(unsub);
    }

    if (handlers.onRealEstateDisclosures && handlers.canReadRealEstateDisclosures === true) {
      let isRealEstateListenerActive = true;
      let reUnsub: Unsubscribe | null = null;
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.REAL_ESTATE_DISCLOSURES),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isRealEstateListenerActive || !isActiveForScope('realEstateDisclosures')) return;
          const meta = metaFromSnapshot(snapshot);
          const { records, allRecords, deletedDocIds, deletedMarkers, stamped } =
            mapRealEstateDisclosuresSnapshot(snapshot);
          const accepted = handlers.onRealEstateDisclosures?.(records, meta, {
            allRecords,
            deletedDocIds,
            deletedMarkers,
          });
          if (
            !meta.fromCache &&
            accepted !== false &&
            isRealEstateListenerActive &&
            isActiveForScope('realEstateDisclosures')
          ) {
            persistCollectionSnapshot(
              'realEstateDisclosures',
              meta,
              records,
              stamped,
              () =>
                CacheService.saveRealEstateDisclosures(
                  records,
                  subscriptionScopeKey,
                  subscriptionGuard
                ),
              () => isRealEstateListenerActive
            );
          }
        },
        (err) => {
          if (!isSubscriptionActive || CacheService.getScopeKey() !== subscriptionScopeKey) return;
          if (isFirestorePermissionDeniedError(err)) {
            isRealEstateListenerActive = false;
            if (reUnsub) {
              try {
                reUnsub();
              } catch {
                // ignore
              }
              reUnsub = null;
            }
            CacheService.clearRealEstateDisclosuresCache(undefined, subscriptionScopeKey);
          }
          notifyError(COLLECTIONS.REAL_ESTATE_DISCLOSURES, err);
        }
      );
      reUnsub = unsub;
      this.activeListeners.push(() => {
        isRealEstateListenerActive = false;
        if (reUnsub) {
          try {
            reUnsub();
          } catch {
            // ignore
          }
          reUnsub = null;
        }
      });
    }

    if (handlers.onUsers) {
      const unsub = onSnapshot(
        collection(db, COLLECTIONS.USERS),
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isActiveForScope()) return;
          const meta = metaFromSnapshot(snapshot);
          const list: AppUser[] = [];
          snapshot.forEach((d) => list.push({ ...d.data(), id: d.id } as AppUser));
          if (!meta.fromCache && isActiveForScope()) CacheService.saveUsersList(list);
          handlers.onUsers?.(list, meta);
        },
        (err) => notifyError(COLLECTIONS.USERS, err)
      );
      this.activeListeners.push(unsub);
    }

    return () => this.unsubscribeAll();
  }

  public static unsubscribeAll(): void {
    for (const unsub of this.activeListeners) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    this.activeListeners = [];
  }

  public static getCompany = FirestoreRepositories.getCompany.bind(FirestoreRepositories);
  public static getAllCompanies = FirestoreRepositories.getAllCompanies.bind(FirestoreRepositories);
  public static getAllQuarterlyRecords = FirestoreRepositories.getAllQuarterlyRecords.bind(FirestoreRepositories);
  public static getAllDailyTradingRecords = FirestoreRepositories.getAllDailyTradingRecords.bind(FirestoreRepositories);
  public static getAllDailyTradingSchemas = FirestoreRepositories.getAllDailyTradingSchemas.bind(FirestoreRepositories);
  public static getAllFinancials = FirestoreRepositories.getAllFinancials.bind(FirestoreRepositories);
  public static getStory = FirestoreRepositories.getStory.bind(FirestoreRepositories);
  public static getAllStories = FirestoreRepositories.getAllStories.bind(FirestoreRepositories);
  public static getDecision = FirestoreRepositories.getDecision.bind(FirestoreRepositories);
  public static getAllDecisions = FirestoreRepositories.getAllDecisions.bind(FirestoreRepositories);
  public static getAllTrades = FirestoreRepositories.getAllTrades.bind(FirestoreRepositories);
  public static getAllBetaAssumptions = FirestoreRepositories.getAllBetaAssumptions.bind(FirestoreRepositories);
  public static getAllDividendRecords = FirestoreRepositories.getAllDividendRecords.bind(FirestoreRepositories);
  public static getAllDividendYearStatuses = FirestoreRepositories.getAllDividendYearStatuses.bind(FirestoreRepositories);
  public static getAllRealEstateDisclosures = FirestoreRepositories.getAllRealEstateDisclosures.bind(FirestoreRepositories);
  public static getAllRealEstateDisclosuresWithMeta =
    FirestoreRepositories.getAllRealEstateDisclosuresWithMeta.bind(FirestoreRepositories);
  public static getAllCompanyOverrides = FirestoreRepositories.getAllCompanyOverrides.bind(FirestoreRepositories);
  public static fetchExistingDocsForPreview = FirestoreRepositories.fetchExistingDocsForPreview.bind(FirestoreRepositories);
  public static getAllMacroParameters = FirestoreRepositories.getAllMacroParameters.bind(FirestoreRepositories);
  public static getAllSectorPE = FirestoreRepositories.getAllSectorPE.bind(FirestoreRepositories);
  public static getAllSectorDefinitions = FirestoreRepositories.getAllSectorDefinitions.bind(FirestoreRepositories);
  public static getAllUsers = FirestoreRepositories.getAllUsers.bind(FirestoreRepositories);
}
