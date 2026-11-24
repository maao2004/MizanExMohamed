/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

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
  BetaAssumptionRecord,
  Company,
  CompanyParameterOverride,
  DecisionItem,
  InvestmentStory,
  SectorDefinition,
  SectorPeLoadStatus,
  TombstoneRecord,
  TradeLog,
} from '../../types/financial';
import {
  buildDividendDocId,
  buildDividendYearStatusDocId,
  buildSectorDefinitionsFromMap,
  deriveSectorPEMapFromDefinitions,
  mergeMacroParametersByKey,
  REAL_ESTATE_DISCLOSURES_COLLECTION,
  reconcileIncomingMacroParameterVersion,
  tryNormalizedTicker,
} from '../contracts';
import {
  canUserReadRealEstateDisclosures,
  mergeRealEstateDisclosureDeltas,
  type RealEstateDisclosureDeletionMarker,
  type RealEstateDisclosureReadRecord,
  type RealEstateDisclosuresErrorCode,
  type RealEstateDisclosuresLoadStatus,
} from './realEstateDisclosureRead';
import { ConnectionErrorState } from './stockDerived';

export interface SnapshotMetadataInfo {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface SessionToken {
  sessionId: number;
  uid: string | null;
}

export interface SyncCollectionState {
  companiesMeta: Company[];
  stories: Record<string, InvestmentStory>;
  decisions: Record<string, DecisionItem>;
  trades: TradeLog[];
  macroParams: MacroParameter[];
  sectorDefinitions: SectorDefinition[];
  sectorPEMap: Record<string, number>;
  dailyRecords: DailyTradingRecord[];
  dailySchemas: Record<string, DailyTradingSchemaRecord>;
  quarterlyRecords: QuarterlyFinancialRecord[];
  betaAssumptions: BetaAssumptionRecord[];
  companyOverrides: CompanyParameterOverride[];
  dividendRecords: DividendRecord[];
  dividendYearStatuses: DividendYearStatusRecord[];
  realEstateDisclosures: RealEstateDisclosureReadRecord[];
  users: AppUser[];
  companiesConfirmed: boolean;
  companiesError: string | null;
  quarterlyConfirmed: boolean;
  hasServerConfirmedQuarterly: boolean;
  betaConfirmed: boolean;
  betaError: boolean;
  sectorPeConfirmed: boolean;
  sectorPeStatus: SectorPeLoadStatus;
  sectorPeError: string | null;
  companyOverridesConfirmed: boolean;
  macroParamsConfirmed: boolean;
  dividendConfirmed: boolean;
  dividendYearStatusesConfirmed: boolean;
  realEstateDisclosuresAuthorized: boolean;
  realEstateDisclosuresStatus: RealEstateDisclosuresLoadStatus;
  realEstateDisclosuresConfirmed: boolean;
  realEstateDisclosuresFromCache: boolean;
  realEstateDisclosuresHasPendingWrites: boolean;
  realEstateDisclosuresError: string | null;
  realEstateDisclosuresErrorCode: RealEstateDisclosuresErrorCode | null;
  realEstateDisclosuresLastSyncedAt: string | null;
  fromCache: boolean;
  hasPendingWrites: boolean;
  connectionError: ConnectionErrorState | null;
}

export interface RealEstateDisclosuresSyncOutcome {
  attempted: boolean;
  status: 'unauthorized' | 'ok' | 'error';
  isDelta?: boolean;
  error?: unknown;
}

export interface SyncAllCollectionsPayload {
  quarterly: QuarterlyFinancialRecord[];
  companies: Company[];
  daily: DailyTradingRecord[];
  dailySchemas?: Record<string, DailyTradingSchemaRecord>;
  stories: Record<string, InvestmentStory>;
  decisions: Record<string, DecisionItem>;
  trades: TradeLog[];
  macro: MacroParameter[];
  sectorDefinitions?: SectorDefinition[];
  sectorPE?: Record<string, number>;
  betaAssumptions?: BetaAssumptionRecord[];
  companyOverrides?: CompanyParameterOverride[];
  dividendRecords?: DividendRecord[];
  dividendYearStatuses?: DividendYearStatusRecord[];
  realEstateDisclosures?: RealEstateDisclosureReadRecord[];
  realEstateDisclosuresIncomingAll?: RealEstateDisclosureReadRecord[];
  realEstateDisclosuresDeletedMarkers?: RealEstateDisclosureDeletionMarker[];
  realEstateDisclosuresDeletedDocIds?: string[];
  realEstateDisclosuresIsDelta?: boolean;
  realEstateDisclosuresSyncOutcome?: RealEstateDisclosuresSyncOutcome;
  tombstones?: TombstoneRecord[];
  isIncrementalDelta?: boolean;
}

export function createEmptySyncState(options?: {
  uid?: string | null;
  canReadRealEstateDisclosures?: boolean;
}): SyncCollectionState {
  const hasUid = Boolean(options?.uid);
  const authorized = hasUid && Boolean(options?.canReadRealEstateDisclosures);
  const initialReStatus: RealEstateDisclosuresLoadStatus = !hasUid
    ? 'idle'
    : authorized
    ? 'loading'
    : 'unauthorized';

  return {
    companiesMeta: [],
    stories: {},
    decisions: {},
    trades: [],
    macroParams: [],
    sectorDefinitions: [],
    sectorPEMap: {},
    dailyRecords: [],
    dailySchemas: {},
    quarterlyRecords: [],
    betaAssumptions: [],
    companyOverrides: [],
    dividendRecords: [],
    dividendYearStatuses: [],
    realEstateDisclosures: [],
    users: [],
    companiesConfirmed: false,
    companiesError: null,
    quarterlyConfirmed: false,
    hasServerConfirmedQuarterly: false,
    betaConfirmed: false,
    betaError: false,
    sectorPeConfirmed: false,
    sectorPeStatus: 'loading',
    sectorPeError: null,
    companyOverridesConfirmed: false,
    macroParamsConfirmed: false,
    dividendConfirmed: false,
    dividendYearStatusesConfirmed: false,
    realEstateDisclosuresAuthorized: authorized,
    realEstateDisclosuresStatus: initialReStatus,
    realEstateDisclosuresConfirmed: false,
    realEstateDisclosuresFromCache: false,
    realEstateDisclosuresHasPendingWrites: false,
    realEstateDisclosuresError: null,
    realEstateDisclosuresErrorCode: null,
    realEstateDisclosuresLastSyncedAt: null,
    fromCache: false,
    hasPendingWrites: false,
    connectionError: null,
  };
}

export function isFirestorePermissionDeniedError(err: unknown): boolean {
  const code = String((err as { code?: unknown } | null)?.code || '').toLowerCase();
  return code === 'permission-denied' || code.endsWith('/permission-denied');
}

export function classifyFirestoreError(
  collectionName: string,
  err: any,
  isNavigatorOnline = true
): ConnectionErrorState {
  const code = String(err?.code || '').toLowerCase();
  const message = String(err?.message || '');

  if (isFirestorePermissionDeniedError(err)) {
    return {
      type: 'permission_denied',
      message: `لا توجد صلاحية لقراءة المجموعة (${collectionName}).`,
    };
  }

  if (
    !isNavigatorOnline ||
    code === 'unavailable' ||
    code.endsWith('/unavailable') ||
    /offline|failed to get document because the client is offline/i.test(message)
  ) {
    return {
      type: 'offline',
      message: 'الاتصال بالإنترنت أو خادم Firestore غير متاح حالياً؛ لا تُعرض بيانات كاش قديمة كحالة حالية لقاعدة البيانات.',
    };
  }

  return {
    type: 'error',
    message: message || `تعذر قراءة البيانات من Firestore (${collectionName}).`,
  };
}

export function extractServerEpochMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') {
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  }
  if (ts instanceof Date) {
    const ms = ts.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof ts === 'object') {
    const obj = ts as Record<string, unknown>;
    if (typeof obj.toMillis === 'function') {
      try {
        const ms = Number((obj.toMillis as () => number)());
        return Number.isFinite(ms) && ms > 0 ? ms : 0;
      } catch {
        return 0;
      }
    }
    const sec =
      typeof obj.seconds === 'number'
        ? obj.seconds
        : typeof obj._seconds === 'number'
        ? obj._seconds
        : null;
    if (sec !== null && Number.isFinite(sec)) {
      const nano =
        typeof obj.nanoseconds === 'number'
          ? obj.nanoseconds
          : typeof obj._nanoseconds === 'number'
          ? obj._nanoseconds
          : 0;
      return Math.floor(sec * 1000 + nano / 1_000_000);
    }
  }
  return 0;
}

function parseIsoEpochMs(iso: unknown): number {
  if (typeof iso !== 'string' || !iso.trim()) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function extractEntityEpochMs(item: unknown): number {
  if (!item || typeof item !== 'object') return 0;
  const rec = item as Record<string, unknown>;
  const serverMs = extractServerEpochMs(rec.serverUpdatedAt);
  if (serverMs > 0) return serverMs;
  return parseIsoEpochMs(rec.updatedAt);
}

function extractTombstoneEpochMs(tomb: TombstoneRecord): number {
  const serverMs = extractServerEpochMs(tomb.serverUpdatedAt);
  if (serverMs > 0) return serverMs;
  return parseIsoEpochMs(tomb.deletedAt);
}

function shouldDeleteEntity(entity: unknown, tombEpochMs: number): boolean {
  const entityEpochMs = extractEntityEpochMs(entity);
  if (tombEpochMs <= 0 || entityEpochMs <= 0) return true;
  return tombEpochMs >= entityEpochMs;
}

function mergeByKey<T>(
  base: T[],
  deltas: T[],
  keyFn: (item: T) => string,
  deletedMap: Map<string, number>
): T[] {
  const map = new Map<string, T>();
  for (const item of base) {
    map.set(keyFn(item), item);
  }
  for (const item of deltas) {
    const k = keyFn(item);
    const existing = map.get(k);
    if (existing) {
      const existingMs = extractEntityEpochMs(existing);
      const deltaMs = extractEntityEpochMs(item);
      if (existingMs > 0 && deltaMs > 0 && existingMs > deltaMs) {
        continue;
      }
    }
    map.set(k, item);
  }
  for (const [deletedKey, tombEpochMs] of deletedMap.entries()) {
    if (!map.has(deletedKey)) continue;
    const target = map.get(deletedKey);
    if (shouldDeleteEntity(target, tombEpochMs)) {
      map.delete(deletedKey);
    }
  }
  return Array.from(map.values());
}

function mergeObjectMapWithTombstones<T>(
  baseMap: Record<string, T>,
  deltaMap: Record<string, T> | undefined,
  deletedMap: Map<string, number>
): Record<string, T> {
  const next: Record<string, T> = { ...baseMap };
  if (deltaMap) {
    for (const [k, item] of Object.entries(deltaMap)) {
      const existing = next[k];
      if (existing && typeof existing === 'object' && typeof item === 'object') {
        const existingMs = extractEntityEpochMs(existing);
        const deltaMs = extractEntityEpochMs(item);
        if (existingMs > 0 && deltaMs > 0 && existingMs > deltaMs) {
          continue;
        }
      }
      next[k] = item;
    }
  }
  for (const [deletedKey, tombEpochMs] of deletedMap.entries()) {
    if (!(deletedKey in next)) continue;
    if (shouldDeleteEntity(next[deletedKey], tombEpochMs)) {
      delete next[deletedKey];
    }
  }
  return next;
}

/**
 * مدير الجلسات ولقطات Firestore:
 * - يمنع الاستجابات المتأخرة من جلسة سابقة من تلويث الجلسة الجديدة.
 * - يمنع اعتبار لقطات الكاش المحلي تأكيداً من الخادم لخلو المجموعة أو حالتها.
 * - يدير تأكيد beta_assumptions وcompany_assumptions بشكل منفصل لمنع افتراض Beta=1 عند الخطأ.
 * - يدعم دمج التحديثات التزايدية ومقارنة الطابع الزمني للـ tombstones لمنع حذف السجلات المعاد إنشاؤها.
 */
export class FirestoreSessionManager {
  private activeSessionId = 0;
  private activeUid: string | null = null;
  private state: SyncCollectionState = createEmptySyncState();
  private deletedMacroKeys = new Set<string>();

  public beginSession(
    uid: string | null,
    options?: { canReadRealEstateDisclosures?: boolean }
  ): SessionToken {
    this.activeSessionId += 1;
    this.activeUid = uid;
    this.state = createEmptySyncState({
      uid,
      canReadRealEstateDisclosures: Boolean(uid && options?.canReadRealEstateDisclosures),
    });
    this.deletedMacroKeys = new Set<string>();
    return {
      sessionId: this.activeSessionId,
      uid: this.activeUid,
    };
  }

  /**
   * Revokes access to `real_estate_disclosures` within the current session
   * (e.g. role downgraded from `data_entry`/`admin` to `subscriber`), immediately
   * wiping in-memory records and rejecting any late async responses.
   */
  public revokeRealEstateDisclosuresAccess(
    token: SessionToken,
    options?: {
      status?: 'unauthorized' | 'permission_denied';
      errorMessage?: string | null;
    }
  ): { accepted: boolean; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, state: this.state };
    }
    const nextStatus: RealEstateDisclosuresLoadStatus = !this.activeUid
      ? 'idle'
      : options?.status ?? 'unauthorized';
    this.state = {
      ...this.state,
      realEstateDisclosures: [],
      realEstateDisclosuresAuthorized: false,
      realEstateDisclosuresStatus: nextStatus,
      realEstateDisclosuresConfirmed: false,
      realEstateDisclosuresFromCache: false,
      realEstateDisclosuresHasPendingWrites: false,
      realEstateDisclosuresError:
        nextStatus === 'permission_denied' ? options?.errorMessage ?? null : null,
      realEstateDisclosuresErrorCode:
        nextStatus === 'permission_denied' ? 'permission_denied' : null,
      realEstateDisclosuresLastSyncedAt: null,
    };
    return { accepted: true, state: this.state };
  }

  /**
   * Restores `real_estate_disclosures` read authorization within the active session ONLY after
   * explicit re-verification confirms an active `admin` or `data_entry` user.
   * Always resets to `status: 'loading'` with `records: []` and `confirmed: false` so stale data
   * is never exposed prior to fresh server confirmation.
   */
  public restoreRealEstateDisclosuresAccess(
    token: SessionToken,
    reverification: {
      user: Pick<AppUser, 'role' | 'isActive'> | null | undefined;
    }
  ): { accepted: boolean; reason?: string; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, reason: 'stale_session', state: this.state };
    }
    if (!this.activeUid || !canUserReadRealEstateDisclosures(reverification.user)) {
      return { accepted: false, reason: 'unauthorized', state: this.state };
    }
    this.state = {
      ...this.state,
      realEstateDisclosures: [],
      realEstateDisclosuresAuthorized: true,
      realEstateDisclosuresStatus: 'loading',
      realEstateDisclosuresConfirmed: false,
      realEstateDisclosuresFromCache: false,
      realEstateDisclosuresHasPendingWrites: false,
      realEstateDisclosuresError: null,
      realEstateDisclosuresErrorCode: null,
      realEstateDisclosuresLastSyncedAt: null,
    };
    return { accepted: true, state: this.state };
  }

  public getDeletedMacroKeys(): ReadonlySet<string> {
    return this.deletedMacroKeys;
  }

  private reconcileMacroFullSnapshot(
    prevList: readonly MacroParameter[],
    incomingList: readonly MacroParameter[]
  ): MacroParameter[] {
    const prevByKey = new Map<string, MacroParameter>();
    for (const item of prevList) prevByKey.set(item.key, item);

    const incomingKeys = new Set<string>();
    const reconciledList: MacroParameter[] = [];
    for (const incoming of incomingList) {
      incomingKeys.add(incoming.key);
      this.deletedMacroKeys.delete(incoming.key);
      const prev = prevByKey.get(incoming.key);
      if (!prev) {
        reconciledList.push(incoming);
      } else {
        const res = reconcileIncomingMacroParameterVersion(prev, incoming, {
          source: 'server_snapshot',
        });
        reconciledList.push(res.record ?? incoming);
      }
    }

    for (const prev of prevList) {
      if (!incomingKeys.has(prev.key)) {
        this.deletedMacroKeys.add(prev.key);
      }
    }

    return reconciledList;
  }

  public isTokenActive(token: SessionToken): boolean {
    return token.sessionId === this.activeSessionId && token.uid === this.activeUid;
  }

  public getState(): SyncCollectionState {
    return this.state;
  }

  public applyQuarterlySnapshot(
    token: SessionToken,
    records: QuarterlyFinancialRecord[],
    metadata: SnapshotMetadataInfo,
    isNavigatorOnline = true
  ): { accepted: boolean; reason?: string; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, reason: 'stale_session', state: this.state };
    }

    if (metadata.fromCache) {
      if (!isNavigatorOnline) {
        this.state = {
          ...this.state,
          fromCache: true,
          hasPendingWrites: metadata.hasPendingWrites,
          connectionError: {
            type: 'offline',
            message: 'أنت غير متصل بخادم Firestore حالياً؛ لا تُعرض بيانات كاش محلية قديمة كحالة قاعدة البيانات الحالية.',
          },
        };
        return { accepted: true, reason: 'cached_offline', state: this.state };
      }

      this.state = {
        ...this.state,
        fromCache: true,
        hasPendingWrites: metadata.hasPendingWrites,
      };
      return { accepted: true, reason: 'awaiting_server_confirmation', state: this.state };
    }

    this.state = {
      ...this.state,
      quarterlyRecords: records,
      quarterlyConfirmed: true,
      hasServerConfirmedQuarterly: true,
      fromCache: false,
      hasPendingWrites: metadata.hasPendingWrites,
      connectionError: null,
    };
    return { accepted: true, state: this.state };
  }

  public applyBetaSnapshot(
    token: SessionToken,
    records: BetaAssumptionRecord[],
    metadata: SnapshotMetadataInfo
  ): { accepted: boolean; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, state: this.state };
    }
    if (metadata.fromCache) {
      return { accepted: false, state: this.state };
    }
    this.state = {
      ...this.state,
      betaAssumptions: records.filter((r) => r.isDeleted !== true),
      betaConfirmed: true,
      betaError: false,
      hasPendingWrites: this.state.hasPendingWrites || metadata.hasPendingWrites,
    };
    return { accepted: true, state: this.state };
  }

  public applyCompanyOverridesSnapshot(
    token: SessionToken,
    records: CompanyParameterOverride[],
    metadata: SnapshotMetadataInfo
  ): { accepted: boolean; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, state: this.state };
    }
    if (metadata.fromCache) {
      return { accepted: false, state: this.state };
    }
    this.state = {
      ...this.state,
      companyOverrides: records.filter((r) => r.isDeleted !== true),
      companyOverridesConfirmed: true,
      hasPendingWrites: this.state.hasPendingWrites || metadata.hasPendingWrites,
    };
    return { accepted: true, state: this.state };
  }

  public applySectorPESnapshot(
    token: SessionToken,
    definitions: SectorDefinition[],
    values: Record<string, number>,
    metadata: SnapshotMetadataInfo
  ): { accepted: boolean; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, state: this.state };
    }
    if (metadata.fromCache) {
      return { accepted: false, state: this.state };
    }
    const cleanDefs = definitions.filter((d) => d.isDeleted !== true);
    const derivedValues =
      Object.keys(values).length > 0 || cleanDefs.length === 0
        ? values
        : deriveSectorPEMapFromDefinitions(cleanDefs);
    this.state = {
      ...this.state,
      sectorDefinitions: cleanDefs,
      sectorPEMap: derivedValues,
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
      sectorPeError: null,
      hasPendingWrites: this.state.hasPendingWrites || metadata.hasPendingWrites,
    };
    return { accepted: true, state: this.state };
  }

  public applyNonQuarterlySnapshot<
    K extends keyof Pick<
      SyncCollectionState,
      | 'companiesMeta'
      | 'stories'
      | 'decisions'
      | 'trades'
      | 'macroParams'
      | 'sectorPEMap'
      | 'dailyRecords'
      | 'dailySchemas'
      | 'dividendRecords'
      | 'dividendYearStatuses'
      | 'users'
    >,
  >(
    token: SessionToken,
    key: K,
    data: SyncCollectionState[K],
    metadata: SnapshotMetadataInfo
  ): { accepted: boolean; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, state: this.state };
    }
    if (metadata.fromCache) {
      return { accepted: false, state: this.state };
    }
    const effectiveData =
      key === 'macroParams'
        ? (this.reconcileMacroFullSnapshot(
            this.state.macroParams,
            data as MacroParameter[]
          ) as SyncCollectionState[K])
        : data;
    this.state = {
      ...this.state,
      [key]: effectiveData,
      ...(key === 'companiesMeta'
        ? {
            companiesConfirmed: true,
            companiesError: null,
          }
        : {}),
      ...(key === 'sectorPEMap'
        ? {
            sectorDefinitions: buildSectorDefinitionsFromMap(data as Record<string, number>),
            sectorPeConfirmed: true,
            sectorPeStatus: 'ready' as SectorPeLoadStatus,
            sectorPeError: null,
          }
        : {}),
      ...(key === 'macroParams' ? { macroParamsConfirmed: true } : {}),
      ...(key === 'dividendRecords' ? { dividendConfirmed: true } : {}),
      ...(key === 'dividendYearStatuses' ? { dividendYearStatusesConfirmed: true } : {}),
      hasPendingWrites: this.state.hasPendingWrites || metadata.hasPendingWrites,
    };
    return { accepted: true, state: this.state };
  }

  /**
   * Applies a snapshot for `real_estate_disclosures`:
   * - Strictly gated on active session token AND active `admin`/`data_entry` authorization.
   * - Never marks cached snapshots (`fromCache: true`) as confirmed or `confirmed_empty`.
   * - Clearly distinguishes `cached_unconfirmed`, `confirmed`, `confirmed_empty`, and offline `error`.
   * - Deduplicates by Firestore `docId` and excludes `isDeleted === true` without dropping unrecognized codes.
   */
  public applyRealEstateDisclosuresSnapshot(
    token: SessionToken,
    records: readonly RealEstateDisclosureReadRecord[],
    metadata: SnapshotMetadataInfo,
    isNavigatorOnline = true,
    syncedAtIso?: string
  ): { accepted: boolean; reason?: string; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, reason: 'stale_session', state: this.state };
    }
    if (!this.state.realEstateDisclosuresAuthorized) {
      return { accepted: false, reason: 'unauthorized', state: this.state };
    }

    const activeRecords = mergeRealEstateDisclosureDeltas([], records);

    if (metadata.fromCache) {
      if (!isNavigatorOnline) {
        this.state = {
          ...this.state,
          realEstateDisclosuresConfirmed: false,
          realEstateDisclosuresFromCache: true,
          realEstateDisclosuresHasPendingWrites: metadata.hasPendingWrites,
          realEstateDisclosuresStatus: 'error',
          realEstateDisclosuresErrorCode: 'offline',
          realEstateDisclosuresError:
            'أنت غير متصل بخادم Firestore حالياً؛ لا تُعتمد لقطات الكاش المحلي للإفصاحات العقارية كحالة مؤكدة من الخادم.',
        };
        return { accepted: true, reason: 'cached_offline', state: this.state };
      }

      this.state = {
        ...this.state,
        realEstateDisclosures: activeRecords,
        realEstateDisclosuresConfirmed: false,
        realEstateDisclosuresFromCache: true,
        realEstateDisclosuresHasPendingWrites: metadata.hasPendingWrites,
        realEstateDisclosuresStatus: 'cached_unconfirmed',
        realEstateDisclosuresError: null,
        realEstateDisclosuresErrorCode: null,
      };
      return { accepted: true, reason: 'cached_unconfirmed', state: this.state };
    }

    this.state = {
      ...this.state,
      realEstateDisclosures: activeRecords,
      realEstateDisclosuresConfirmed: true,
      realEstateDisclosuresFromCache: false,
      realEstateDisclosuresHasPendingWrites: metadata.hasPendingWrites,
      realEstateDisclosuresStatus: activeRecords.length === 0 ? 'confirmed_empty' : 'confirmed',
      realEstateDisclosuresError: null,
      realEstateDisclosuresErrorCode: null,
      realEstateDisclosuresLastSyncedAt: syncedAtIso ?? new Date().toISOString(),
    };
    return { accepted: true, state: this.state };
  }

  /**
   * Applies an incremental delta or full server sync result specifically for `real_estate_disclosures`.
   * - Preserves prior records when an empty delta arrives.
   * - Deduplicates re-delivered records by Firestore `docId`.
   * - Removes records marked `isDeleted === true` or deleted via tombstones.
   */
  public applyRealEstateDisclosuresSyncDelta(
    token: SessionToken,
    params: {
      records: readonly RealEstateDisclosureReadRecord[];
      incomingAll?: readonly RealEstateDisclosureReadRecord[];
      deletedMarkers?: readonly RealEstateDisclosureDeletionMarker[];
      deletedDocIds?: readonly string[];
      tombstones?: readonly TombstoneRecord[];
      isDelta: boolean;
      syncedAtIso?: string;
    }
  ): { accepted: boolean; reason?: string; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, reason: 'stale_session', state: this.state };
    }
    if (!this.state.realEstateDisclosuresAuthorized) {
      return { accepted: false, reason: 'unauthorized', state: this.state };
    }

    const tombEpochMap = new Map<string, number>();
    for (const tomb of params.tombstones ?? []) {
      if (tomb.collection !== REAL_ESTATE_DISCLOSURES_COLLECTION) continue;
      const prev = tombEpochMap.get(tomb.docId) ?? 0;
      tombEpochMap.set(tomb.docId, Math.max(prev, extractTombstoneEpochMs(tomb)));
    }

    const base =
      params.isDelta && this.state.realEstateDisclosuresConfirmed
        ? this.state.realEstateDisclosures
        : [];
    const incoming = params.incomingAll ?? params.records;
    const nextRecords = mergeRealEstateDisclosureDeltas(base, incoming, {
      deletedMarkers: params.deletedMarkers,
      deletedDocIds: params.deletedDocIds,
      deletedEpochsByDocId: tombEpochMap,
    });

    this.state = {
      ...this.state,
      realEstateDisclosures: nextRecords,
      realEstateDisclosuresConfirmed: true,
      realEstateDisclosuresFromCache: false,
      realEstateDisclosuresHasPendingWrites: false,
      realEstateDisclosuresStatus: nextRecords.length === 0 ? 'confirmed_empty' : 'confirmed',
      realEstateDisclosuresError: null,
      realEstateDisclosuresErrorCode: null,
      realEstateDisclosuresLastSyncedAt: params.syncedAtIso ?? new Date().toISOString(),
    };
    return { accepted: true, state: this.state };
  }

  /**
   * Applies a confirmed `macro_params` save response ONLY if `token` is still the active session,
   * using the central monotonic reconciliation & deletion-tombstone guard.
   */
  public applyMacroParamSaveConfirmation(
    token: SessionToken,
    savedParams: readonly MacroParameter[],
    options?: { createdKeys?: ReadonlySet<string> }
  ): { accepted: boolean; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, state: this.state };
    }
    if (savedParams.length === 0) {
      return { accepted: true, state: this.state };
    }
    const nextMacroParams = mergeMacroParametersByKey(this.state.macroParams, savedParams, {
      deletedKeys: this.deletedMacroKeys,
      createdKeys: options?.createdKeys,
      source: 'save_confirmation',
    });
    if (options?.createdKeys && options.createdKeys.size > 0) {
      for (const key of options.createdKeys) {
        if (nextMacroParams.some((p) => p.key === key)) {
          this.deletedMacroKeys.delete(key);
        }
      }
    }
    this.state = {
      ...this.state,
      macroParams: nextMacroParams,
    };
    return { accepted: true, state: this.state };
  }

  /**
   * Records a confirmed global `macro_params` deletion for the active session so any late
   * update confirmation for that key cannot revive it as a live confirmed document.
   */
  public applyMacroParamDeletion(
    token: SessionToken,
    key: string
  ): { accepted: boolean; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, state: this.state };
    }
    this.deletedMacroKeys.add(key);
    this.state = {
      ...this.state,
      macroParams: this.state.macroParams.filter((p) => p.key !== key),
    };
    return { accepted: true, state: this.state };
  }

  public applyManualSyncResult(
    token: SessionToken,
    payload: SyncAllCollectionsPayload
  ): { accepted: boolean; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, state: this.state };
    }

    if (payload.isIncrementalDelta && this.state.hasServerConfirmedQuarterly) {
      const tombByCol = new Map<string, Map<string, number>>();
      for (const tomb of payload.tombstones ?? []) {
        const colMap = tombByCol.get(tomb.collection) ?? new Map<string, number>();
        const prevEpoch = colMap.get(tomb.docId) ?? 0;
        const tombEpoch = extractTombstoneEpochMs(tomb);
        colMap.set(tomb.docId, Math.max(prevEpoch, tombEpoch));
        tombByCol.set(tomb.collection, colMap);
      }

      const emptyMap = new Map<string, number>();
      const nextQuarterly = mergeByKey(
        this.state.quarterlyRecords,
        payload.quarterly,
        (q) => `${tryNormalizedTicker(q.ticker) ?? q.ticker}_${q.year}_${q.quarter}`,
        tombByCol.get('quarterly_financial_records') ?? emptyMap
      );
      const nextDaily = mergeByKey(
        this.state.dailyRecords,
        payload.daily,
        (d) => `${tryNormalizedTicker(d.ticker) ?? d.ticker}_${d.tradeDate}`,
        tombByCol.get('daily_trading_records') ?? emptyMap
      );
      const nextBeta = mergeByKey(
        this.state.betaAssumptions,
        payload.betaAssumptions ?? [],
        (b) => tryNormalizedTicker(b.ticker) ?? b.ticker,
        tombByCol.get('beta_assumptions') ?? emptyMap
      );
      const macroTombMap = tombByCol.get('macro_params') ?? emptyMap;
      const mergedDeltaMacro = mergeMacroParametersByKey(this.state.macroParams, payload.macro, {
        source: 'server_snapshot',
      });
      const nextMacro = mergeByKey(mergedDeltaMacro, [], (m) => m.key, macroTombMap);
      const nextMacroKeys = new Set(nextMacro.map((m) => m.key));
      for (const m of nextMacro) {
        this.deletedMacroKeys.delete(m.key);
      }
      for (const deletedKey of macroTombMap.keys()) {
        if (!nextMacroKeys.has(deletedKey)) {
          this.deletedMacroKeys.add(deletedKey);
        }
      }
      const nextOverrides = mergeByKey(
        this.state.companyOverrides,
        payload.companyOverrides ?? [],
        (o) => `${tryNormalizedTicker(o.ticker) ?? o.ticker}__${o.key}`,
        tombByCol.get('company_assumptions') ?? emptyMap
      );
      const safeDividendDocId = (d: DividendRecord): string => {
        const tk = tryNormalizedTicker(d.ticker) ?? d.ticker;
        try {
          return buildDividendDocId({
            ticker: tk,
            fiscalYear: d.fiscalYear,
            recordType: d.recordType,
            distributionId: d.distributionId,
          });
        } catch {
          return `${tk}_${d.fiscalYear}_${d.recordType}_${d.distributionId}`;
        }
      };
      const nextDividends = mergeByKey(
        this.state.dividendRecords,
        payload.dividendRecords ?? [],
        safeDividendDocId,
        tombByCol.get('dividend_records') ?? emptyMap
      );
      const safeDividendYearStatusId = (s: DividendYearStatusRecord): string => {
        const tk = tryNormalizedTicker(s.ticker) ?? s.ticker;
        try {
          return buildDividendYearStatusDocId(tk, s.fiscalYear);
        } catch {
          return `${tk}_${s.fiscalYear}`;
        }
      };
      const nextDividendYearStatuses = mergeByKey(
        this.state.dividendYearStatuses,
        payload.dividendYearStatuses ?? [],
        safeDividendYearStatusId,
        tombByCol.get('dividend_year_statuses') ?? emptyMap
      );
      const nextCompanies = mergeByKey(
        this.state.companiesMeta,
        payload.companies,
        (c) => c.id,
        tombByCol.get('companies') ?? emptyMap
      );
      const nextTrades = mergeByKey(
        this.state.trades,
        payload.trades,
        (t) => t.id,
        tombByCol.get('trades') ?? emptyMap
      );
      const nextDailySchemas = mergeObjectMapWithTombstones(
        this.state.dailySchemas,
        payload.dailySchemas,
        tombByCol.get('daily_trading_schemas') ?? emptyMap
      );
      const nextStories = mergeObjectMapWithTombstones(
        this.state.stories,
        payload.stories,
        tombByCol.get('stories') ?? emptyMap
      );
      const nextDecisions = mergeObjectMapWithTombstones(
        this.state.decisions,
        payload.decisions,
        tombByCol.get('decisions') ?? emptyMap
      );
      const sectorTombMap = tombByCol.get('sectorPE') ?? emptyMap;
      const incomingDefs =
        payload.sectorDefinitions ??
        (payload.sectorPE ? buildSectorDefinitionsFromMap(payload.sectorPE) : []);
      const nextSectorDefs = mergeByKey(
        this.state.sectorDefinitions,
        incomingDefs,
        (d) => d.sectorId,
        sectorTombMap
      ).filter((d) => {
        if (d.legacyDocId && sectorTombMap.has(d.legacyDocId)) {
          return !shouldDeleteEntity(d, sectorTombMap.get(d.legacyDocId)!);
        }
        return true;
      });
      const nextSectorPE =
        payload.sectorDefinitions !== undefined
          ? deriveSectorPEMapFromDefinitions(nextSectorDefs)
          : mergeObjectMapWithTombstones(
              this.state.sectorPEMap,
              payload.sectorPE,
              sectorTombMap
            );

      const nextRealEstatePatch = this.computeRealEstateManualSyncPatch(payload, tombByCol);

      this.state = {
        ...this.state,
        quarterlyRecords: nextQuarterly,
        companiesMeta: nextCompanies,
        companiesConfirmed: true,
        companiesError: null,
        dailyRecords: nextDaily,
        dailySchemas: nextDailySchemas,
        stories: nextStories,
        decisions: nextDecisions,
        trades: nextTrades,
        macroParams: nextMacro,
        sectorDefinitions: nextSectorDefs,
        sectorPEMap: nextSectorPE,
        betaAssumptions: nextBeta,
        companyOverrides: nextOverrides,
        dividendRecords: nextDividends,
        dividendYearStatuses: nextDividendYearStatuses,
        ...nextRealEstatePatch,
        quarterlyConfirmed: true,
        hasServerConfirmedQuarterly: true,
        betaConfirmed: true,
        betaError: false,
        sectorPeConfirmed: true,
        sectorPeStatus: 'ready',
        sectorPeError: null,
        companyOverridesConfirmed: true,
        macroParamsConfirmed: true,
        dividendConfirmed:
          payload.dividendRecords !== undefined ? true : this.state.dividendConfirmed,
        dividendYearStatusesConfirmed:
          payload.dividendYearStatuses !== undefined ? true : this.state.dividendYearStatusesConfirmed,
        fromCache: false,
        hasPendingWrites: false,
        connectionError: null,
      };
      return { accepted: true, state: this.state };
    }

    const nextFullDividends = payload.dividendRecords ?? this.state.dividendRecords;
    const nextFullDividendYearStatuses = payload.dividendYearStatuses ?? this.state.dividendYearStatuses;
    const nextFullSectorDefs =
      payload.sectorDefinitions !== undefined
        ? payload.sectorDefinitions.filter((d) => d.isDeleted !== true)
        : payload.sectorPE !== undefined
        ? buildSectorDefinitionsFromMap(payload.sectorPE)
        : this.state.sectorDefinitions;
    const nextFullSectorPE =
      payload.sectorPE !== undefined
        ? payload.sectorPE
        : payload.sectorDefinitions !== undefined
        ? deriveSectorPEMapFromDefinitions(nextFullSectorDefs)
        : this.state.sectorPEMap;

    const nextFullMacro = this.reconcileMacroFullSnapshot(this.state.macroParams, payload.macro);
    const nextFullRealEstatePatch = this.computeRealEstateManualSyncPatch(payload);

    this.state = {
      ...this.state,
      quarterlyRecords: payload.quarterly,
      companiesMeta: payload.companies,
      companiesConfirmed: true,
      companiesError: null,
      dailyRecords: payload.daily,
      dailySchemas: payload.dailySchemas ?? this.state.dailySchemas,
      stories: payload.stories,
      decisions: payload.decisions,
      trades: payload.trades,
      macroParams: nextFullMacro,
      sectorDefinitions: nextFullSectorDefs,
      sectorPEMap: nextFullSectorPE,
      betaAssumptions: payload.betaAssumptions ?? this.state.betaAssumptions,
      companyOverrides: payload.companyOverrides ?? this.state.companyOverrides,
      dividendRecords: nextFullDividends,
      dividendYearStatuses: nextFullDividendYearStatuses,
      ...nextFullRealEstatePatch,
      quarterlyConfirmed: true,
      hasServerConfirmedQuarterly: true,
      betaConfirmed: payload.betaAssumptions !== undefined ? true : this.state.betaConfirmed,
      betaError: false,
      sectorPeConfirmed:
        payload.sectorDefinitions !== undefined || payload.sectorPE !== undefined
          ? true
          : this.state.sectorPeConfirmed,
      sectorPeStatus:
        payload.sectorDefinitions !== undefined || payload.sectorPE !== undefined
          ? 'ready'
          : this.state.sectorPeStatus,
      sectorPeError:
        payload.sectorDefinitions !== undefined || payload.sectorPE !== undefined
          ? null
          : this.state.sectorPeError,
      companyOverridesConfirmed:
        payload.companyOverrides !== undefined ? true : this.state.companyOverridesConfirmed,
      macroParamsConfirmed:
        payload.macro !== undefined ? true : this.state.macroParamsConfirmed,
      dividendConfirmed:
        payload.dividendRecords !== undefined ? true : this.state.dividendConfirmed,
      dividendYearStatusesConfirmed:
        payload.dividendYearStatuses !== undefined ? true : this.state.dividendYearStatusesConfirmed,
      fromCache: false,
      hasPendingWrites: false,
      connectionError: null,
    };
    return { accepted: true, state: this.state };
  }

  private computeRealEstateManualSyncPatch(
    payload: SyncAllCollectionsPayload,
    tombByCol?: Map<string, Map<string, number>>
  ): Partial<SyncCollectionState> {
    if (!this.state.realEstateDisclosuresAuthorized) {
      return {};
    }

    const outcome = payload.realEstateDisclosuresSyncOutcome;
    if (outcome?.attempted && outcome.status === 'error') {
      const classified = classifyFirestoreError(
        REAL_ESTATE_DISCLOSURES_COLLECTION,
        outcome.error
      );
      if (classified.type === 'permission_denied') {
        // Revoke authorization & wipe in-memory records immediately so pending responses cannot restore them
        return {
          realEstateDisclosures: [],
          realEstateDisclosuresAuthorized: false,
          realEstateDisclosuresConfirmed: false,
          realEstateDisclosuresFromCache: false,
          realEstateDisclosuresHasPendingWrites: false,
          realEstateDisclosuresStatus: 'permission_denied',
          realEstateDisclosuresError: classified.message,
          realEstateDisclosuresErrorCode: 'permission_denied',
          realEstateDisclosuresLastSyncedAt: null,
        };
      }
      // Network/offline error: keep authorization intact, mark unconfirmed error separately from permission_denied
      return {
        realEstateDisclosuresConfirmed: false,
        realEstateDisclosuresFromCache: false,
        realEstateDisclosuresStatus: 'error',
        realEstateDisclosuresError: classified.message,
        realEstateDisclosuresErrorCode: classified.type,
      };
    }

    const hasIncoming =
      outcome?.attempted && outcome.status === 'ok'
        ? true
        : payload.realEstateDisclosures !== undefined ||
          payload.realEstateDisclosuresIncomingAll !== undefined;
    if (!hasIncoming) {
      return {};
    }

    const isDelta = Boolean(payload.realEstateDisclosuresIsDelta ?? outcome?.isDelta);
    const base =
      isDelta && this.state.realEstateDisclosuresConfirmed
        ? this.state.realEstateDisclosures
        : [];
    const incoming = payload.realEstateDisclosuresIncomingAll ?? payload.realEstateDisclosures ?? [];
    const nextRecords = mergeRealEstateDisclosureDeltas(base, incoming, {
      deletedMarkers: payload.realEstateDisclosuresDeletedMarkers,
      deletedDocIds: payload.realEstateDisclosuresDeletedDocIds,
      deletedEpochsByDocId: tombByCol?.get(REAL_ESTATE_DISCLOSURES_COLLECTION),
    });

    return {
      realEstateDisclosures: nextRecords,
      realEstateDisclosuresConfirmed: true,
      realEstateDisclosuresFromCache: false,
      realEstateDisclosuresHasPendingWrites: false,
      realEstateDisclosuresStatus: nextRecords.length === 0 ? 'confirmed_empty' : 'confirmed',
      realEstateDisclosuresError: null,
      realEstateDisclosuresErrorCode: null,
      realEstateDisclosuresLastSyncedAt: new Date().toISOString(),
    };
  }

  public applyConnectionError(
    token: SessionToken,
    collectionName: string,
    err: any,
    canAccessUsersCollection: boolean,
    isNavigatorOnline = true
  ): { accepted: boolean; state: SyncCollectionState } {
    if (!this.isTokenActive(token)) {
      return { accepted: false, state: this.state };
    }
    const classified = classifyFirestoreError(collectionName, err, isNavigatorOnline);
    if (collectionName === 'users' && !canAccessUsersCollection && classified.type === 'permission_denied') {
      return { accepted: true, state: this.state };
    }
    if (collectionName === REAL_ESTATE_DISCLOSURES_COLLECTION) {
      // Strictly isolated: failure or permission denial on `real_estate_disclosures`
      // NEVER breaks or overwrites global `connectionError` for other collections.
      if (classified.type === 'permission_denied') {
        if (!this.state.realEstateDisclosuresAuthorized && this.state.realEstateDisclosuresStatus === 'unauthorized') {
          this.state = {
            ...this.state,
            realEstateDisclosures: [],
            realEstateDisclosuresAuthorized: false,
            realEstateDisclosuresConfirmed: false,
            realEstateDisclosuresFromCache: false,
            realEstateDisclosuresHasPendingWrites: false,
            realEstateDisclosuresStatus: this.activeUid ? 'unauthorized' : 'idle',
            realEstateDisclosuresError: null,
            realEstateDisclosuresErrorCode: null,
            realEstateDisclosuresLastSyncedAt: null,
          };
          return { accepted: true, state: this.state };
        }
        // Revoke authorization in session and wipe in-memory records immediately
        this.state = {
          ...this.state,
          realEstateDisclosures: [],
          realEstateDisclosuresAuthorized: false,
          realEstateDisclosuresConfirmed: false,
          realEstateDisclosuresFromCache: false,
          realEstateDisclosuresHasPendingWrites: false,
          realEstateDisclosuresStatus: 'permission_denied',
          realEstateDisclosuresError: classified.message,
          realEstateDisclosuresErrorCode: 'permission_denied',
          realEstateDisclosuresLastSyncedAt: null,
        };
        return { accepted: true, state: this.state };
      }
      // Network/offline error stays separate from permission_denied (does NOT revoke authorization)
      this.state = {
        ...this.state,
        realEstateDisclosuresConfirmed: false,
        realEstateDisclosuresFromCache: false,
        realEstateDisclosuresStatus: 'error',
        realEstateDisclosuresError: classified.message,
        realEstateDisclosuresErrorCode: classified.type,
      };
      return { accepted: true, state: this.state };
    }
    if (collectionName === 'companies') {
      this.state = {
        ...this.state,
        companiesConfirmed: false,
        companiesError: classified.message,
        ...(classified.type !== 'permission_denied' ? { connectionError: classified } : {}),
      };
      return { accepted: true, state: this.state };
    }
    if (collectionName === 'beta_assumptions') {
      this.state = {
        ...this.state,
        betaConfirmed: false,
        betaError: true,
        ...(classified.type !== 'permission_denied' ? { connectionError: classified } : {}),
      };
      return { accepted: true, state: this.state };
    }
    if (collectionName === 'sectorPE') {
      this.state = {
        ...this.state,
        sectorPeConfirmed: false,
        sectorPeStatus: classified.type === 'permission_denied' ? 'permission_denied' : 'error',
        sectorPeError: classified.message,
        ...(classified.type !== 'permission_denied' ? { connectionError: classified } : {}),
      };
      return { accepted: true, state: this.state };
    }
    if (collectionName === 'quarterly_financial_records' || classified.type !== 'permission_denied') {
      this.state = {
        ...this.state,
        connectionError: classified,
      };
    }
    return { accepted: true, state: this.state };
  }
}
