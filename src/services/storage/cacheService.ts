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
  Company,
  DecisionItem,
  InvestmentStory,
  QuarterlyFinancial,
  SectorDefinition,
  TradeLog,
} from '../../types/financial';
import { mergeMacroParametersByKey } from '../../core/contracts';
import {
  ALL_SYNC_COLLECTION_KEYS,
  AtomicDeltaPersistenceDriver,
  browserIndexedDbDriver,
  persistAtomicBatchCommit,
  persistAtomicDeltaCommit,
  readScopedIndexedDbState,
  removeCollectionFromScopedIndexedDbState,
  removeScopedIndexedDbState,
  ScopedIndexedDbState,
  SyncCollectionKey,
} from './indexedDbStore';

import { stripLegacyQuarterlyDpsFromRecord } from '../../core/contracts';
import type { RealEstateDisclosureReadRecord } from '../../core/domain/realEstateDisclosureRead';

export type { SyncCollectionKey, AtomicDeltaPersistenceDriver, ScopedIndexedDbState };
export { ALL_SYNC_COLLECTION_KEYS };

const CACHE_VERSION_KEY = 'mizan_cache_version';
const CURRENT_CACHE_VERSION = 'v4';
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CacheScopeContext {
  projectId: string;
  databaseId: string;
  uid: string | null;
  schemaVersion?: string;
}

const LEGACY_MIZAN_KEYS = [
  'mizan_companies_v1',
  'mizan_financials_v1',
  'mizan_stories_v1',
  'mizan_decisions_v1',
  'mizan_trades_v1',
  'mizan_companies_cache',
  'mizan_financials_cache',
  'mizan_stories_cache',
  'mizan_decisions_cache',
  'mizan_trades_cache',
  'mizan_macro_params_v2',
  'mizan_macro_params_cache',
  'mizan_sector_pe_v2',
  'mizan_sector_pe_cache',
  'mizan_daily_trading_v2',
  'mizan_daily_trading_cache',
  'mizan_quarterly_financials_v2',
  'mizan_quarterly_records_cache',
  'mizan_current_user_v2',
  'mizan_users_list_v2',
  'mizan_users_cache',
  'mizan_last_sync_timestamp',
  'mizan_firestore_last_sync',
  'mizan_companies_cache_v3',
  'mizan_financials_cache_v3',
  'mizan_stories_cache_v3',
  'mizan_decisions_cache_v3',
  'mizan_trades_cache_v3',
  'mizan_macro_params_cache_v3',
  'mizan_sector_pe_cache_v3',
  'mizan_daily_trading_cache_v3',
  'mizan_quarterly_records_cache_v3',
  'mizan_users_cache_v3',
  'mizan_firestore_last_sync_v3',
  'mizan_firestore_last_sync_epoch_ms_v3',
  'mizan_macro_params_v3',
  'mizan_sector_pe_v3',
  'mizan_daily_trading_v3',
  'mizan_quarterly_financials_v3',
  'mizan_current_user_v3',
  'mizan_users_list_v3',
  'mizan_last_sync_timestamp_v3',
];

const DEFAULT_SCOPE: Required<CacheScopeContext> = {
  projectId: 'mizanex',
  databaseId: 'default',
  uid: null,
  schemaVersion: CURRENT_CACHE_VERSION,
};

function sanitizePart(val: string | null | undefined, fallback: string): string {
  const cleaned = (val ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned || fallback;
}

export function buildScopedCachePrefix(scope: CacheScopeContext): string {
  const schema = sanitizePart(scope.schemaVersion || CURRENT_CACHE_VERSION, CURRENT_CACHE_VERSION);
  const project = sanitizePart(scope.projectId, 'mizanex');
  const database = sanitizePart(scope.databaseId, 'default');
  const uid = sanitizePart(scope.uid, 'anon');
  return `mizan_scope_${schema}_${project}_${database}_${uid}_`;
}

export interface CacheOperationGuard {
  scopeKey: string;
  scopeEpoch: number;
  scopeClearEpoch: number;
  collectionEpochs: Partial<Record<SyncCollectionKey, number>>;
}

export class CacheService {
  private static activeScope: CacheScopeContext = { ...DEFAULT_SCOPE };
  private static activeDriver: AtomicDeltaPersistenceDriver | null = null;
  private static scopeEpoch = 0;
  private static scopeClearEpochs = new Map<string, number>();
  private static collectionInvalidationEpochs = new Map<
    string,
    Partial<Record<SyncCollectionKey, number>>
  >();

  public static setPersistenceDriver(driver: AtomicDeltaPersistenceDriver | null): void {
    this.activeDriver = driver;
  }

  private static resolveDriver(): AtomicDeltaPersistenceDriver {
    return this.activeDriver ?? browserIndexedDbDriver;
  }

  private static getScopeClearEpoch(scopeKey: string): number {
    return this.scopeClearEpochs.get(scopeKey) ?? 0;
  }

  private static bumpScopeClearEpoch(scopeKey: string): void {
    this.scopeClearEpochs.set(scopeKey, this.getScopeClearEpoch(scopeKey) + 1);
  }

  private static getCollectionInvalidationEpoch(
    scopeKey: string,
    collection: SyncCollectionKey
  ): number {
    return this.collectionInvalidationEpochs.get(scopeKey)?.[collection] ?? 0;
  }

  private static bumpCollectionInvalidationEpoch(
    scopeKey: string,
    collection: SyncCollectionKey
  ): void {
    const existing = this.collectionInvalidationEpochs.get(scopeKey) ?? {};
    existing[collection] = (existing[collection] ?? 0) + 1;
    this.collectionInvalidationEpochs.set(scopeKey, existing);
  }

  public static captureOperationGuard(
    collections?: readonly SyncCollectionKey[]
  ): CacheOperationGuard {
    const scopeKey = this.getScopeKey();
    const cols = collections ?? ALL_SYNC_COLLECTION_KEYS;
    const collectionEpochs: Partial<Record<SyncCollectionKey, number>> = {};
    for (const col of cols) {
      collectionEpochs[col] = this.getCollectionInvalidationEpoch(scopeKey, col);
    }
    return {
      scopeKey,
      scopeEpoch: this.scopeEpoch,
      scopeClearEpoch: this.getScopeClearEpoch(scopeKey),
      collectionEpochs,
    };
  }

  public static isOperationGuardValid(
    guard: CacheOperationGuard,
    collections?: readonly SyncCollectionKey[]
  ): boolean {
    if (this.getScopeKey() !== guard.scopeKey) return false;
    if (this.scopeEpoch !== guard.scopeEpoch) return false;
    if (this.getScopeClearEpoch(guard.scopeKey) !== guard.scopeClearEpoch) return false;
    const cols =
      collections ?? (Object.keys(guard.collectionEpochs) as SyncCollectionKey[]);
    for (const col of cols) {
      const expected = guard.collectionEpochs[col] ?? 0;
      if (this.getCollectionInvalidationEpoch(guard.scopeKey, col) !== expected) {
        return false;
      }
    }
    return true;
  }

  private static isCollectionInvalidatedSinceGuard(
    guard: CacheOperationGuard,
    collection: SyncCollectionKey
  ): boolean {
    const expected = guard.collectionEpochs[collection] ?? 0;
    return this.getCollectionInvalidationEpoch(guard.scopeKey, collection) !== expected;
  }

  public static setScope(scope: Partial<CacheScopeContext>): void {
    const prevKey = this.getScopeKey();
    this.activeScope = {
      projectId: scope.projectId ?? this.activeScope.projectId,
      databaseId: scope.databaseId ?? this.activeScope.databaseId,
      uid: scope.uid !== undefined ? scope.uid : this.activeScope.uid,
      schemaVersion: scope.schemaVersion ?? CURRENT_CACHE_VERSION,
    };
    const nextKey = this.getScopeKey();
    if (prevKey !== nextKey) {
      this.scopeEpoch += 1;
    }
  }

  public static getScope(): CacheScopeContext {
    return { ...this.activeScope };
  }

  public static getScopeKey(overrideScope?: CacheScopeContext): string {
    return buildScopedCachePrefix(overrideScope ?? this.activeScope);
  }

  private static prefix(overrideScope?: CacheScopeContext): string {
    return buildScopedCachePrefix(overrideScope ?? this.activeScope);
  }

  private static scopedKey(suffix: string, overrideScope?: CacheScopeContext): string {
    return `${this.prefix(overrideScope)}${suffix}`;
  }

  public static evictExpiredScopeIfNeeded(
    nowMs = Date.now(),
    overrideScope?: CacheScopeContext
  ): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      const pfx = this.prefix(overrideScope);
      const cachedAtRaw = Number(localStorage.getItem(`${pfx}cached_at_ms`) || 0);
      if (!Number.isFinite(cachedAtRaw) || cachedAtRaw <= 0) return false;
      if (nowMs - cachedAtRaw <= TOMBSTONE_TTL_MS) return false;

      const toDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(pfx)) {
          toDelete.push(k);
        }
      }
      for (const k of toDelete) {
        localStorage.removeItem(k);
      }
      if (typeof indexedDB !== 'undefined' || this.activeDriver) {
        void removeScopedIndexedDbState(pfx, this.resolveDriver()).catch(() => undefined);
      }
      return true;
    } catch (e) {
      console.error('Failed evicting expired scope cache', e);
      return false;
    }
  }

  private static touchScopeCachedAt(nowMs = Date.now()): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const key = this.scopedKey('cached_at_ms');
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, String(Math.floor(nowMs)));
      }
    } catch {
      // ignore storage quota errors
    }
  }

  private static readJson<T>(suffix: string, fallback: T): T {
    this.invalidateLegacyCachesIfNeeded();
    this.evictExpiredScopeIfNeeded();
    try {
      if (typeof localStorage === 'undefined') return fallback;
      const stored = localStorage.getItem(this.scopedKey(suffix));
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch (e) {
      console.error(`Failed reading cache key ${suffix}`, e);
    }
    return fallback;
  }

  private static writeJson(suffix: string, data: unknown): void {
    try {
      if (typeof localStorage === 'undefined') return;
      this.touchScopeCachedAt();
      localStorage.setItem(this.scopedKey(suffix), JSON.stringify(data));
    } catch (e) {
      console.error(`Failed saving cache key ${suffix}`, e);
    }
  }

  /**
   * إبطال مفاتيح الكاش القديمة لمرة واحدة دون استخدام localStorage.clear()
   */
  static invalidateLegacyCachesIfNeeded(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      if (localStorage.getItem(CACHE_VERSION_KEY) === CURRENT_CACHE_VERSION) return;
      const activeScopedPrefix = `mizan_scope_${CURRENT_CACHE_VERSION}_`;
      const keysToRemove = new Set<string>(LEGACY_MIZAN_KEYS);
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (
          k &&
          k.startsWith('mizan_') &&
          k !== CACHE_VERSION_KEY &&
          !k.startsWith(activeScopedPrefix)
        ) {
          keysToRemove.add(k);
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
      localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
    } catch (e) {
      console.error('Failed invalidating legacy caches', e);
    }
  }

  static clearAllMizanCaches(): void {
    try {
      this.scopeEpoch += 1;
      this.bumpScopeClearEpoch(this.getScopeKey());
      if (typeof localStorage === 'undefined') return;
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('mizan_')) {
          keysToRemove.push(k);
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
      localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
    } catch (e) {
      console.error('Failed clearing Mizan caches', e);
    }
  }

  static clearScopedCache(overrideScope?: CacheScopeContext): void {
    try {
      const pfx = this.prefix(overrideScope);
      this.bumpScopeClearEpoch(pfx);
      if (pfx === this.getScopeKey()) {
        this.scopeEpoch += 1;
      }
      if (typeof indexedDB !== 'undefined' || this.activeDriver) {
        void removeScopedIndexedDbState(pfx, this.resolveDriver()).catch(() => undefined);
      }
      if (typeof localStorage === 'undefined') return;
      const toDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(pfx)) toDelete.push(k);
      }
      for (const k of toDelete) {
        localStorage.removeItem(k);
      }
    } catch (e) {
      console.error('Failed clearing scoped cache', e);
    }
  }

  static clearSessionUser(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(this.scopedKey('current_user'));
      localStorage.removeItem('mizan_current_user_v2');
      localStorage.removeItem('mizan_current_user_v3');
    } catch (e) {
      console.error('Failed clearing current user cache', e);
    }
  }

  // --- Separated Per-Collection Cursors & Baseline Tracking ---

  static getCollectionDeltaCursorMs(collection: SyncCollectionKey): number {
    this.invalidateLegacyCachesIfNeeded();
    if (this.evictExpiredScopeIfNeeded()) return 0;
    try {
      if (typeof localStorage === 'undefined') return 0;
      const raw = Number(localStorage.getItem(this.scopedKey(`delta_cursor_${collection}_ms`)) || 0);
      return Number.isFinite(raw) && raw > 0 ? raw : 0;
    } catch {
      return 0;
    }
  }

  static setCollectionDeltaCursorMs(
    collection: SyncCollectionKey,
    serverEpochMs: number,
    expectedScopeKey?: string,
    operationGuard?: CacheOperationGuard
  ): boolean {
    try {
      if (expectedScopeKey && this.getScopeKey() !== expectedScopeKey) {
        return false;
      }
      if (operationGuard && !this.isOperationGuardValid(operationGuard, [collection])) {
        return false;
      }
      if (typeof localStorage === 'undefined') return false;
      if (Number.isFinite(serverEpochMs) && serverEpochMs > 0) {
        const targetPrefix = expectedScopeKey ?? operationGuard?.scopeKey ?? this.getScopeKey();
        if (targetPrefix !== this.getScopeKey()) return false;
        this.touchScopeCachedAt();
        localStorage.setItem(
          `${targetPrefix}delta_cursor_${collection}_ms`,
          String(Math.floor(serverEpochMs))
        );
        return true;
      }
      return false;
    } catch (e) {
      console.error(`Failed saving delta cursor for ${collection}`, e);
      return false;
    }
  }

  static getAllCollectionDeltaCursors(): Partial<Record<SyncCollectionKey, number>> {
    const out: Partial<Record<SyncCollectionKey, number>> = {};
    for (const col of ALL_SYNC_COLLECTION_KEYS) {
      const ms = this.getCollectionDeltaCursorMs(col);
      if (ms > 0) out[col] = ms;
    }
    return out;
  }

  static getCollectionBaselineConfirmed(collection: SyncCollectionKey): boolean {
    this.invalidateLegacyCachesIfNeeded();
    if (this.evictExpiredScopeIfNeeded()) return false;
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(this.scopedKey(`baseline_${collection}`)) === 'true';
    } catch {
      return false;
    }
  }

  static setCollectionBaselineConfirmed(
    collection: SyncCollectionKey,
    confirmed: boolean,
    expectedScopeKey?: string,
    operationGuard?: CacheOperationGuard
  ): boolean {
    try {
      if (expectedScopeKey && this.getScopeKey() !== expectedScopeKey) {
        return false;
      }
      if (operationGuard && !this.isOperationGuardValid(operationGuard, [collection])) {
        return false;
      }
      if (typeof localStorage === 'undefined') return false;
      const targetPrefix = expectedScopeKey ?? operationGuard?.scopeKey ?? this.getScopeKey();
      if (targetPrefix !== this.getScopeKey()) return false;
      this.touchScopeCachedAt();
      localStorage.setItem(`${targetPrefix}baseline_${collection}`, confirmed ? 'true' : 'false');
      return true;
    } catch {
      return false;
    }
  }

  static resetAllCollectionDeltaCursors(): void {
    try {
      const pfx = this.getScopeKey();
      this.scopeEpoch += 1;
      for (const col of ALL_SYNC_COLLECTION_KEYS) {
        this.bumpCollectionInvalidationEpoch(pfx, col);
      }
      if (typeof localStorage === 'undefined') return;
      for (const col of ALL_SYNC_COLLECTION_KEYS) {
        localStorage.removeItem(`${pfx}delta_cursor_${col}_ms`);
        localStorage.removeItem(`${pfx}baseline_${col}`);
      }
      localStorage.removeItem(`${pfx}delta_cursor_ms`);
    } catch {
      // ignore
    }
  }

  /**
   * مؤشر التلخيص التوافقي: يرجع أقل مؤشر مؤكد عبر المجموعات أو القيمة المخزنة مباشرة عند التحديث اليدوي.
   */
  static getDeltaCursorMs(): number {
    this.invalidateLegacyCachesIfNeeded();
    if (this.evictExpiredScopeIfNeeded()) return 0;
    try {
      if (typeof localStorage === 'undefined') return 0;
      const direct = Number(localStorage.getItem(this.scopedKey('delta_cursor_ms')) || 0);
      const collectionCursors = Object.values(this.getAllCollectionDeltaCursors()).filter(
        (v): v is number => typeof v === 'number' && v > 0
      );
      if (collectionCursors.length > 0 && direct <= 0) {
        return Math.min(...collectionCursors);
      }
      return Number.isFinite(direct) && direct > 0 ? direct : 0;
    } catch {
      return 0;
    }
  }

  static setDeltaCursorMs(
    serverEpochMs: number,
    expectedScopeKey?: string,
    operationGuard?: CacheOperationGuard
  ): boolean {
    try {
      if (expectedScopeKey && this.getScopeKey() !== expectedScopeKey) {
        return false;
      }
      if (operationGuard && !this.isOperationGuardValid(operationGuard, [])) {
        return false;
      }
      if (typeof localStorage === 'undefined') return false;
      if (Number.isFinite(serverEpochMs) && serverEpochMs > 0) {
        const targetPrefix = expectedScopeKey ?? operationGuard?.scopeKey ?? this.getScopeKey();
        if (targetPrefix !== this.getScopeKey()) return false;
        this.touchScopeCachedAt();
        localStorage.setItem(`${targetPrefix}delta_cursor_ms`, String(Math.floor(serverEpochMs)));
        return true;
      }
      return false;
    } catch (e) {
      console.error('Failed saving delta cursor', e);
      return false;
    }
  }

  static resetDeltaCursor(): void {
    this.resetAllCollectionDeltaCursors();
  }

  /**
   * التزام ذري واحد (IndexedDB transaction) يحفظ سجلات المجموعة ومؤشرها في نفس المعاملة؛
   * - يربط البيانات والمؤشر وbaseline بالنطاق والعملية اللذين بدأت بهما العملية.
   * - يتحقق من صلاحية النطاق/الجلسة قبل التخزين وبعد اكتمال `await`؛
   * - يمنع إعادة ملء الكاش في حال تسجيل الخروج أو تبديل الحساب أو إبطال المجموعة أثناء الانتظار.
   */
  static async persistCollectionDeltaAtomically(params: {
    collection: SyncCollectionKey;
    records: unknown;
    cursorMs?: number;
    confirmed?: boolean;
    driver?: AtomicDeltaPersistenceDriver;
    expectedScopeKey?: string;
    operationGuard?: CacheOperationGuard;
    isStillValid?: () => boolean;
  }): Promise<ScopedIndexedDbState | null> {
    const guard =
      params.operationGuard ?? this.captureOperationGuard([params.collection]);
    const targetScopeKey = params.expectedScopeKey ?? guard.scopeKey;

    const checkValid = () =>
      this.getScopeKey() === targetScopeKey &&
      guard.scopeKey === targetScopeKey &&
      this.isOperationGuardValid(guard, [params.collection]) &&
      (params.isStillValid ? params.isStillValid() : true);

    if (!checkValid()) {
      return null;
    }

    const driver = params.driver ?? this.resolveDriver();
    const state = await persistAtomicDeltaCommit({
      scopeKey: targetScopeKey,
      collection: params.collection,
      records: params.records,
      cursorMs: params.cursorMs,
      confirmed: params.confirmed,
      driver,
    });

    if (!checkValid()) {
      // Prevent stale async persistence from refilling an invalidated/cleared IndexedDB entry
      if (this.getScopeClearEpoch(targetScopeKey) !== guard.scopeClearEpoch) {
        await removeScopedIndexedDbState(targetScopeKey, driver).catch(() => undefined);
      } else if (
        this.isCollectionInvalidatedSinceGuard(guard, params.collection) ||
        (params.isStillValid && !params.isStillValid())
      ) {
        await removeCollectionFromScopedIndexedDbState(
          targetScopeKey,
          params.collection,
          driver
        ).catch(() => undefined);
      }
      return null;
    }

    if (typeof params.cursorMs === 'number' && params.cursorMs > 0) {
      this.setCollectionDeltaCursorMs(params.collection, params.cursorMs, targetScopeKey, guard);
    }
    if (typeof params.confirmed === 'boolean') {
      this.setCollectionBaselineConfirmed(params.collection, params.confirmed, targetScopeKey, guard);
    }
    return state;
  }

  static async persistBatchDeltaAtomically(params: {
    entries: Array<{
      collection: SyncCollectionKey;
      records: unknown;
      cursorMs?: number;
      confirmed?: boolean;
    }>;
    driver?: AtomicDeltaPersistenceDriver;
    expectedScopeKey?: string;
    operationGuard?: CacheOperationGuard;
    isStillValid?: () => boolean;
    isCollectionValid?: (collection: SyncCollectionKey) => boolean;
  }): Promise<ScopedIndexedDbState | null> {
    const entryCollections = params.entries.map((e) => e.collection);
    const guard =
      params.operationGuard ?? this.captureOperationGuard(entryCollections);
    const targetScopeKey = params.expectedScopeKey ?? guard.scopeKey;

    const isBaseScopeValid = () =>
      this.getScopeKey() === targetScopeKey &&
      guard.scopeKey === targetScopeKey &&
      this.scopeEpoch === guard.scopeEpoch &&
      this.getScopeClearEpoch(targetScopeKey) === guard.scopeClearEpoch &&
      (params.isStillValid ? params.isStillValid() : true);

    if (!isBaseScopeValid()) {
      return null;
    }

    const initialValidEntries = params.entries.filter(
      (entry) =>
        !this.isCollectionInvalidatedSinceGuard(guard, entry.collection) &&
        (params.isCollectionValid ? params.isCollectionValid(entry.collection) : true)
    );
    if (initialValidEntries.length === 0) {
      return null;
    }

    const driver = params.driver ?? this.resolveDriver();
    const state = await persistAtomicBatchCommit({
      scopeKey: targetScopeKey,
      entries: initialValidEntries,
      driver,
    });

    if (!isBaseScopeValid()) {
      if (this.getScopeClearEpoch(targetScopeKey) !== guard.scopeClearEpoch) {
        await removeScopedIndexedDbState(targetScopeKey, driver).catch(() => undefined);
      } else {
        for (const entry of initialValidEntries) {
          if (
            this.isCollectionInvalidatedSinceGuard(guard, entry.collection) ||
            (params.isCollectionValid && !params.isCollectionValid(entry.collection))
          ) {
            await removeCollectionFromScopedIndexedDbState(
              targetScopeKey,
              entry.collection,
              driver
            ).catch(() => undefined);
          }
        }
      }
      return null;
    }

    for (const entry of initialValidEntries) {
      const colStillValid =
        !this.isCollectionInvalidatedSinceGuard(guard, entry.collection) &&
        (params.isCollectionValid ? params.isCollectionValid(entry.collection) : true);
      if (!colStillValid) {
        await removeCollectionFromScopedIndexedDbState(
          targetScopeKey,
          entry.collection,
          driver
        ).catch(() => undefined);
        continue;
      }
      if (typeof entry.cursorMs === 'number' && entry.cursorMs > 0) {
        this.setCollectionDeltaCursorMs(entry.collection, entry.cursorMs, targetScopeKey, guard);
      }
      if (typeof entry.confirmed === 'boolean') {
        this.setCollectionBaselineConfirmed(
          entry.collection,
          entry.confirmed,
          targetScopeKey,
          guard
        );
      }
    }
    return state;
  }

  static async readPersistedIndexedDbState(
    driver?: AtomicDeltaPersistenceDriver
  ): Promise<ScopedIndexedDbState | null> {
    return readScopedIndexedDbState(this.getScopeKey(), driver ?? this.resolveDriver());
  }

  static getLastCheckedAt(): string {
    this.invalidateLegacyCachesIfNeeded();
    try {
      if (typeof localStorage === 'undefined') return '';
      return localStorage.getItem(this.scopedKey('last_checked_at')) || '';
    } catch {
      return '';
    }
  }

  static setLastCheckedAt(
    isoString: string,
    expectedScopeKey?: string,
    operationGuard?: CacheOperationGuard
  ): boolean {
    try {
      if (expectedScopeKey && this.getScopeKey() !== expectedScopeKey) {
        return false;
      }
      if (operationGuard && !this.isOperationGuardValid(operationGuard, [])) {
        return false;
      }
      if (typeof localStorage === 'undefined') return false;
      const targetPrefix = expectedScopeKey ?? operationGuard?.scopeKey ?? this.getScopeKey();
      if (targetPrefix !== this.getScopeKey()) return false;
      this.touchScopeCachedAt();
      localStorage.setItem(`${targetPrefix}last_checked_at`, isoString);
      return true;
    } catch {
      return false;
    }
  }

  static getLastUserWriteAt(): string {
    this.invalidateLegacyCachesIfNeeded();
    try {
      if (typeof localStorage === 'undefined') return '';
      return localStorage.getItem(this.scopedKey('last_user_write_at')) || '';
    } catch {
      return '';
    }
  }

  static setLastUserWriteAt(isoString: string): void {
    try {
      if (typeof localStorage === 'undefined') return;
      this.touchScopeCachedAt();
      localStorage.setItem(this.scopedKey('last_user_write_at'), isoString);
    } catch {
      // ignore
    }
  }

  // --- Domain Collection Caches ---

  static getMacroParameters(): MacroParameter[] {
    const val = this.readJson<MacroParameter[]>('macro_params', []);
    return Array.isArray(val) ? val : [];
  }

  static getDeletedMacroParameterKeys(): string[] {
    const val = this.readJson<string[]>('macro_params_deleted_keys', []);
    return Array.isArray(val) ? val.filter((k): k is string => typeof k === 'string') : [];
  }

  private static setDeletedMacroParameterKeys(keys: readonly string[]): void {
    this.writeJson('macro_params_deleted_keys', Array.from(new Set(keys)));
  }

  static markMacroParameterDeleted(key: string, expectedScopeKey?: string): boolean {
    if (expectedScopeKey && this.getScopeKey() !== expectedScopeKey) {
      return false;
    }
    const current = this.getMacroParameters();
    this.writeJson(
      'macro_params',
      current.filter((p) => p.key !== key)
    );
    const deleted = new Set(this.getDeletedMacroParameterKeys());
    deleted.add(key);
    this.setDeletedMacroParameterKeys(Array.from(deleted));
    return true;
  }

  static saveMacroParameters(params: MacroParameter[], expectedScopeKey?: string): void {
    if (expectedScopeKey && this.getScopeKey() !== expectedScopeKey) {
      return;
    }
    const previous = this.getMacroParameters();
    const incomingKeys = new Set(params.map((p) => p.key));
    const deleted = new Set(this.getDeletedMacroParameterKeys());
    for (const prev of previous) {
      if (!incomingKeys.has(prev.key)) {
        deleted.add(prev.key);
      }
    }
    for (const key of incomingKeys) {
      deleted.delete(key);
    }
    this.writeJson('macro_params', params);
    this.setDeletedMacroParameterKeys(Array.from(deleted));
  }

  static mergeMacroParameters(
    savedParams: MacroParameter[],
    options?: {
      expectedScopeKey?: string;
      createdKeys?: ReadonlySet<string>;
      deletedKeys?: ReadonlySet<string>;
    }
  ): MacroParameter[] {
    // Session/user scope guard: NEVER apply a late response from another user's session!
    if (options?.expectedScopeKey && this.getScopeKey() !== options.expectedScopeKey) {
      return this.getMacroParameters();
    }
    const current = this.getMacroParameters();
    const deletedKeys = new Set<string>(this.getDeletedMacroParameterKeys());
    if (options?.deletedKeys) {
      for (const k of options.deletedKeys) deletedKeys.add(k);
    }
    const merged = mergeMacroParametersByKey(current, savedParams, {
      deletedKeys,
      createdKeys: options?.createdKeys,
      source: 'save_confirmation',
    });
    if (options?.createdKeys && options.createdKeys.size > 0) {
      for (const key of options.createdKeys) {
        if (merged.some((p) => p.key === key)) {
          deletedKeys.delete(key);
        }
      }
      this.setDeletedMacroParameterKeys(Array.from(deletedKeys));
    }
    this.writeJson('macro_params', merged);
    return merged;
  }

  static getSectorPE(): Record<string, number> {
    const val = this.readJson<Record<string, number>>('sector_pe', {});
    return val && typeof val === 'object' && !Array.isArray(val) ? val : {};
  }

  static saveSectorPE(peMap: Record<string, number>): void {
    this.writeJson('sector_pe', peMap);
  }

  static getSectorDefinitions(): SectorDefinition[] {
    const val = this.readJson<SectorDefinition[]>('sector_definitions', []);
    return Array.isArray(val) ? val : [];
  }

  static saveSectorDefinitions(defs: SectorDefinition[]): void {
    this.writeJson('sector_definitions', defs);
  }

  static getDailyTradingRecords(): DailyTradingRecord[] {
    const val = this.readJson<DailyTradingRecord[]>('daily_trading', []);
    return Array.isArray(val) ? val : [];
  }

  static saveDailyTradingRecords(records: DailyTradingRecord[]): void {
    this.writeJson('daily_trading', records);
  }

  static getDailyTradingSchemas(): Record<string, DailyTradingSchemaRecord> {
    const val = this.readJson<Record<string, DailyTradingSchemaRecord>>('daily_trading_schemas', {});
    return val && typeof val === 'object' && !Array.isArray(val) ? val : {};
  }

  static saveDailyTradingSchemas(schemas: Record<string, DailyTradingSchemaRecord>): void {
    this.writeJson('daily_trading_schemas', schemas);
  }

  static getQuarterlyFinancialRecords(): QuarterlyFinancialRecord[] {
    const val = this.readJson<QuarterlyFinancialRecord[]>('quarterly_financials', []);
    return Array.isArray(val)
      ? val.map((rec) => stripLegacyQuarterlyDpsFromRecord(rec as Record<string, any>) as QuarterlyFinancialRecord)
      : [];
  }

  static saveQuarterlyFinancialRecords(records: QuarterlyFinancialRecord[]): void {
    this.writeJson(
      'quarterly_financials',
      records.map((rec) => stripLegacyQuarterlyDpsFromRecord(rec as Record<string, any>))
    );
  }

  static getCompanies(): Company[] {
    const val = this.readJson<Company[]>('companies', []);
    return Array.isArray(val) ? val : [];
  }

  static saveCompanies(companies: Company[]): void {
    this.writeJson('companies', companies);
  }

  static getFinancials(): QuarterlyFinancial[] {
    const val = this.readJson<QuarterlyFinancial[]>('financials', []);
    return Array.isArray(val)
      ? val.map((rec) => stripLegacyQuarterlyDpsFromRecord(rec as Record<string, any>) as QuarterlyFinancial)
      : [];
  }

  static saveFinancials(financials: QuarterlyFinancial[]): void {
    this.writeJson(
      'financials',
      financials.map((rec) => stripLegacyQuarterlyDpsFromRecord(rec as Record<string, any>))
    );
  }

  static getStories(): Record<string, InvestmentStory> {
    const val = this.readJson<Record<string, InvestmentStory>>('stories', {});
    return val && typeof val === 'object' && !Array.isArray(val) ? val : {};
  }

  static saveStories(stories: Record<string, InvestmentStory>): void {
    this.writeJson('stories', stories);
  }

  static getDecisions(): Record<string, DecisionItem> {
    const val = this.readJson<Record<string, DecisionItem>>('decisions', {});
    return val && typeof val === 'object' && !Array.isArray(val) ? val : {};
  }

  static saveDecisions(decisions: Record<string, DecisionItem>): void {
    this.writeJson('decisions', decisions);
  }

  static getTrades(): TradeLog[] {
    const val = this.readJson<TradeLog[]>('trades', []);
    return Array.isArray(val) ? val : [];
  }

  static saveTrades(trades: TradeLog[]): void {
    this.writeJson('trades', trades);
  }

  static getDividendRecords(): DividendRecord[] {
    const val = this.readJson<DividendRecord[]>('dividend_records', []);
    return Array.isArray(val) ? val : [];
  }

  static saveDividendRecords(records: DividendRecord[]): void {
    this.writeJson('dividend_records', records);
  }

  static getDividendYearStatuses(): DividendYearStatusRecord[] {
    const val = this.readJson<DividendYearStatusRecord[]>('dividend_year_statuses', []);
    return Array.isArray(val) ? val : [];
  }

  static saveDividendYearStatuses(records: DividendYearStatusRecord[]): void {
    this.writeJson('dividend_year_statuses', records);
  }

  static getRealEstateDisclosures(): RealEstateDisclosureReadRecord[] {
    const val = this.readJson<RealEstateDisclosureReadRecord[]>('real_estate_disclosures', []);
    return Array.isArray(val) ? val : [];
  }

  static saveRealEstateDisclosures(
    records: RealEstateDisclosureReadRecord[],
    expectedScopeKey?: string,
    operationGuard?: CacheOperationGuard
  ): boolean {
    if (expectedScopeKey && this.getScopeKey() !== expectedScopeKey) {
      return false;
    }
    if (operationGuard && !this.isOperationGuardValid(operationGuard, ['realEstateDisclosures'])) {
      return false;
    }
    this.writeJson('real_estate_disclosures', records);
    return true;
  }

  static clearRealEstateDisclosuresCache(
    overrideScope?: CacheScopeContext,
    overrideScopeKey?: string
  ): void {
    try {
      const pfx = overrideScopeKey ?? this.prefix(overrideScope);
      this.bumpCollectionInvalidationEpoch(pfx, 'realEstateDisclosures');
      if (typeof indexedDB !== 'undefined' || this.activeDriver) {
        void removeCollectionFromScopedIndexedDbState(
          pfx,
          'realEstateDisclosures',
          this.resolveDriver()
        ).catch(() => undefined);
      }
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(`${pfx}real_estate_disclosures`);
      localStorage.removeItem(`${pfx}delta_cursor_realEstateDisclosures_ms`);
      localStorage.removeItem(`${pfx}baseline_realEstateDisclosures`);
    } catch (e) {
      console.error('Failed clearing real estate disclosures cache', e);
    }
  }

  static getCurrentUser(): AppUser | null {
    return this.readJson<AppUser | null>('current_user', null);
  }

  static setCurrentUser(user: AppUser | null): void {
    try {
      if (typeof localStorage === 'undefined') return;
      if (!user) {
        localStorage.removeItem(this.scopedKey('current_user'));
      } else {
        this.writeJson('current_user', user);
      }
    } catch (e) {
      console.error('Failed saving current user', e);
    }
  }

  static getUsersList(): AppUser[] {
    const val = this.readJson<AppUser[]>('users_list', []);
    return Array.isArray(val) ? val : [];
  }

  static saveUsersList(users: AppUser[]): void {
    this.writeJson('users_list', users);
  }
}
