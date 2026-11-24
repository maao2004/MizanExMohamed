/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SyncCollectionKey =
  | 'quarterly'
  | 'companies'
  | 'daily'
  | 'dailySchemas'
  | 'stories'
  | 'decisions'
  | 'trades'
  | 'macro'
  | 'sectorPE'
  | 'betaAssumptions'
  | 'companyOverrides'
  | 'dividendRecords'
  | 'dividendYearStatuses'
  | 'realEstateDisclosures'
  | 'tombstones';

export const ALL_SYNC_COLLECTION_KEYS: SyncCollectionKey[] = [
  'quarterly',
  'companies',
  'daily',
  'dailySchemas',
  'stories',
  'decisions',
  'trades',
  'macro',
  'sectorPE',
  'betaAssumptions',
  'companyOverrides',
  'dividendRecords',
  'dividendYearStatuses',
  'realEstateDisclosures',
  'tombstones',
];

export interface ScopedIndexedDbState {
  scopeKey: string;
  collections: Partial<Record<SyncCollectionKey, unknown>>;
  deltaCursors: Partial<Record<SyncCollectionKey, number>>;
  baselineConfirmed: Partial<Record<SyncCollectionKey, boolean>>;
  cachedAtMs: number;
}

export interface AtomicDeltaPersistenceDriver {
  runReadWrite: (
    scopeKey: string,
    mutator: (current: ScopedIndexedDbState) => ScopedIndexedDbState
  ) => Promise<ScopedIndexedDbState>;
  read: (scopeKey: string) => Promise<ScopedIndexedDbState | null>;
  remove: (scopeKey: string) => Promise<void>;
}

const DB_NAME = 'mizanex_sync_store';
const DB_VERSION = 1;
const STORE_NAME = 'scoped_sync_state';

function createEmptyScopedRecord(scopeKey: string, nowMs = Date.now()): ScopedIndexedDbState {
  return {
    scopeKey,
    collections: {},
    deltaCursors: {},
    baselineConfirmed: {},
    cachedAtMs: nowMs,
  };
}

function cloneState(state: ScopedIndexedDbState): ScopedIndexedDbState {
  return {
    scopeKey: state.scopeKey,
    collections: { ...state.collections },
    deltaCursors: { ...state.deltaCursors },
    baselineConfirmed: { ...state.baselineConfirmed },
    cachedAtMs: state.cachedAtMs,
  };
}

function openBrowserDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB غير متاح في هذه البيئة.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'scopeKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('تعذر فتح قاعدة IndexedDB المحلية.'));
  });
}

export const browserIndexedDbDriver: AtomicDeltaPersistenceDriver = {
  async read(scopeKey: string): Promise<ScopedIndexedDbState | null> {
    if (typeof indexedDB === 'undefined') return null;
    const db = await openBrowserDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(scopeKey);
      req.onsuccess = () => resolve((req.result as ScopedIndexedDbState | undefined) ?? null);
      req.onerror = () => reject(req.error || new Error('فشل قراءة حالة المزامنة من IndexedDB.'));
    });
  },

  async runReadWrite(
    scopeKey: string,
    mutator: (current: ScopedIndexedDbState) => ScopedIndexedDbState
  ): Promise<ScopedIndexedDbState> {
    const db = await openBrowserDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let committedState: ScopedIndexedDbState | null = null;
      let abortedOrFailed = false;

      tx.onabort = () => {
        abortedOrFailed = true;
        reject(tx.error || new Error('تم إجهاض معاملة IndexedDB وتراجع التغيير بالكامل.'));
      };
      tx.onerror = () => {
        abortedOrFailed = true;
        reject(tx.error || new Error('فشلت معاملة IndexedDB المحلية.'));
      };
      tx.oncomplete = () => {
        if (!abortedOrFailed && committedState) {
          resolve(cloneState(committedState));
        }
      };

      const getReq = store.get(scopeKey);
      getReq.onerror = () => {
        try {
          tx.abort();
        } catch {
          // ignore abort error
        }
      };
      getReq.onsuccess = () => {
        try {
          const existing =
            (getReq.result as ScopedIndexedDbState | undefined) ??
            createEmptyScopedRecord(scopeKey);
          const next = mutator(cloneState(existing));
          committedState = next;
          store.put(next);
        } catch (err) {
          try {
            tx.abort();
          } catch {
            // ignore
          }
          reject(err);
        }
      };
    });
  },

  async remove(scopeKey: string): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    const db = await openBrowserDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(scopeKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('تعذر حذف حالة النطاق من IndexedDB.'));
      tx.onabort = () => reject(tx.error || new Error('تم إجهاض حذف حالة النطاق من IndexedDB.'));
    });
  },
};

export function createMemoryAtomicPersistenceDriver(options?: {
  failOnWrite?: boolean;
  failReason?: string;
}): AtomicDeltaPersistenceDriver & {
  snapshot: (scopeKey: string) => ScopedIndexedDbState | null;
  setFailOnWrite: (fail: boolean) => void;
} {
  const backing = new Map<string, ScopedIndexedDbState>();
  let shouldFail = Boolean(options?.failOnWrite);

  return {
    async read(scopeKey: string): Promise<ScopedIndexedDbState | null> {
      const hit = backing.get(scopeKey);
      return hit ? cloneState(hit) : null;
    },
    async runReadWrite(
      scopeKey: string,
      mutator: (current: ScopedIndexedDbState) => ScopedIndexedDbState
    ): Promise<ScopedIndexedDbState> {
      const current = backing.get(scopeKey)
        ? cloneState(backing.get(scopeKey)!)
        : createEmptyScopedRecord(scopeKey);
      const next = mutator(cloneState(current));
      if (shouldFail) {
        throw new Error(options?.failReason || 'Simulated IndexedDB transaction abort');
      }
      backing.set(scopeKey, cloneState(next));
      return cloneState(next);
    },
    async remove(scopeKey: string): Promise<void> {
      backing.delete(scopeKey);
    },
    snapshot(scopeKey: string): ScopedIndexedDbState | null {
      const hit = backing.get(scopeKey);
      return hit ? cloneState(hit) : null;
    },
    setFailOnWrite(fail: boolean): void {
      shouldFail = fail;
    },
  };
}

export async function persistAtomicDeltaCommit(params: {
  scopeKey: string;
  collection: SyncCollectionKey;
  records: unknown;
  cursorMs?: number;
  confirmed?: boolean;
  nowMs?: number;
  driver?: AtomicDeltaPersistenceDriver;
}): Promise<ScopedIndexedDbState> {
  const driver = params.driver ?? browserIndexedDbDriver;
  const nowMs = params.nowMs ?? Date.now();
  return driver.runReadWrite(params.scopeKey, (current) => {
    const next = cloneState(current);
    next.collections[params.collection] = params.records;
    if (typeof params.cursorMs === 'number' && Number.isFinite(params.cursorMs) && params.cursorMs > 0) {
      const prevCursor = next.deltaCursors[params.collection] ?? 0;
      next.deltaCursors[params.collection] = Math.max(prevCursor, Math.floor(params.cursorMs));
    }
    if (typeof params.confirmed === 'boolean') {
      next.baselineConfirmed[params.collection] = params.confirmed;
    }
    if (!next.cachedAtMs || next.cachedAtMs <= 0) {
      next.cachedAtMs = Math.floor(nowMs);
    }
    return next;
  });
}

export async function persistAtomicBatchCommit(params: {
  scopeKey: string;
  entries: Array<{
    collection: SyncCollectionKey;
    records: unknown;
    cursorMs?: number;
    confirmed?: boolean;
  }>;
  nowMs?: number;
  driver?: AtomicDeltaPersistenceDriver;
}): Promise<ScopedIndexedDbState> {
  const driver = params.driver ?? browserIndexedDbDriver;
  const nowMs = params.nowMs ?? Date.now();
  return driver.runReadWrite(params.scopeKey, (current) => {
    const next = cloneState(current);
    for (const entry of params.entries) {
      next.collections[entry.collection] = entry.records;
      if (typeof entry.cursorMs === 'number' && Number.isFinite(entry.cursorMs) && entry.cursorMs > 0) {
        const prevCursor = next.deltaCursors[entry.collection] ?? 0;
        next.deltaCursors[entry.collection] = Math.max(prevCursor, Math.floor(entry.cursorMs));
      }
      if (typeof entry.confirmed === 'boolean') {
        next.baselineConfirmed[entry.collection] = entry.confirmed;
      }
    }
    if (!next.cachedAtMs || next.cachedAtMs <= 0) {
      next.cachedAtMs = Math.floor(nowMs);
    }
    return next;
  });
}

export async function readScopedIndexedDbState(
  scopeKey: string,
  driver: AtomicDeltaPersistenceDriver = browserIndexedDbDriver
): Promise<ScopedIndexedDbState | null> {
  return driver.read(scopeKey);
}

export async function removeScopedIndexedDbState(
  scopeKey: string,
  driver: AtomicDeltaPersistenceDriver = browserIndexedDbDriver
): Promise<void> {
  return driver.remove(scopeKey);
}

/**
 * Removes a single collection's records, delta cursor, and baseline flag from
 * a scoped IndexedDB record without disturbing other collections in the same scope
 * (e.g. when a user's role is revoked for `real_estate_disclosures` only).
 */
export async function removeCollectionFromScopedIndexedDbState(
  scopeKey: string,
  collection: SyncCollectionKey,
  driver: AtomicDeltaPersistenceDriver = browserIndexedDbDriver
): Promise<ScopedIndexedDbState | null> {
  const existing = await driver.read(scopeKey);
  if (!existing) return null;
  return driver.runReadWrite(scopeKey, (current) => {
    const next = cloneState(current);
    delete next.collections[collection];
    delete next.deltaCursors[collection];
    delete next.baselineConfirmed[collection];
    return next;
  });
}
