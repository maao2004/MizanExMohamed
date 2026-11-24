/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production Firestore Admin SDK adapter for sector governance mutations and
 * transactional company/sector referential integrity writes.
 *
 * Uses structural Firestore Admin interfaces so this module stays pure/portable
 * across `functions/src/shared` (Cloud Functions) and emulator integration tests
 * without bundling `firebase-admin` into client builds.
 */

import {
  buildCompanyDocWritePayload,
  sanitizeCompanyMetadataPatch,
  type AtomicWriteTarget,
  type BulkQuarterlyTransactionPort,
  type BulkQuarterlyWriteTarget,
} from './records';
import { validateAndCanonicalizeCompanySectorWrite } from './sectorLinkage';
import { sanitizeSectorId } from './sectorRegistry';
import type { SectorMutationPort, SectorMutationTxContext } from './sectorMutations';

export interface AdminDocSnapLike {
  id: string;
  exists: boolean;
  data(): Record<string, any> | undefined;
}

export interface AdminQuerySnapLike {
  docs: AdminDocSnapLike[];
}

export interface AdminDocRefLike {
  id: string;
  path: string;
  get(): Promise<AdminDocSnapLike>;
}

export interface AdminQueryLike {
  where(fieldPath: string, opStr: '==', value: unknown): AdminQueryLike;
  limit(limit: number): AdminQueryLike;
  select(...fields: string[]): AdminQueryLike;
  get(): Promise<AdminQuerySnapLike>;
}

export interface AdminCollectionRefLike extends AdminQueryLike {
  doc(docId: string): AdminDocRefLike;
}

export interface AdminTransactionLike {
  get(ref: AdminDocRefLike): Promise<AdminDocSnapLike>;
  get(query: AdminQueryLike): Promise<AdminQuerySnapLike>;
  getAll?(...refs: AdminDocRefLike[]): Promise<AdminDocSnapLike[]>;
  set(ref: AdminDocRefLike, data: Record<string, any>, options?: { merge?: boolean }): unknown;
  delete(ref: AdminDocRefLike): unknown;
}

export interface AdminWriteBatchLike {
  set(ref: AdminDocRefLike, data: Record<string, any>, options?: { merge?: boolean }): unknown;
  delete(ref: AdminDocRefLike): unknown;
  commit(): Promise<unknown>;
}

export interface AdminFirestoreLike {
  collection(collectionPath: string): AdminCollectionRefLike;
  runTransaction<T>(updateFunction: (tx: AdminTransactionLike) => Promise<T>): Promise<T>;
  batch(): AdminWriteBatchLike;
}

export interface AdminTombstoneDoc {
  ref: AdminDocRefLike;
  data: Record<string, any>;
}

export function createFirestoreAdminSectorMutationPort(
  db: AdminFirestoreLike,
  options: {
    buildSectorTombstone: (sectorId: string) => AdminTombstoneDoc;
  }
): SectorMutationPort {
  const { buildSectorTombstone } = options;

  return {
    listAllSectors: async () => {
      const snap = await db.collection('sectorPE').get();
      return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, any> }));
    },
    listAllCompanies: async () => {
      const snap = await db.collection('companies').get();
      return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, any> }));
    },
    queryCompaniesBySectorId: async (sectorId: string, limit?: number) => {
      let q: AdminQueryLike = db.collection('companies').where('sectorId', '==', sectorId);
      if (typeof limit === 'number' && limit > 0) {
        q = q.limit(limit);
      }
      const snap = await q.get();
      return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, any> }));
    },
    listLegacyCompaniesWithoutSectorId: async () => {
      const snap = await db
        .collection('companies')
        .select('sectorId', 'sector', 'rawSector', 'isDeleted', 'ticker')
        .get();
      return snap.docs
        .filter((d) => !sanitizeSectorId((d.data() as Record<string, any> | undefined)?.sectorId ?? ''))
        .map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, any> }));
    },
    runTransaction: async <T,>(fn: (txCtx: SectorMutationTxContext) => Promise<T>): Promise<T> =>
      db.runTransaction(async (tx) => {
        const txCtx: SectorMutationTxContext = {
          getAllSectors: async () => {
            const snap = await tx.get(db.collection('sectorPE'));
            return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, any> }));
          },
          getAllCompanies: async () => {
            const snap = await tx.get(db.collection('companies'));
            return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, any> }));
          },
          getSectorDoc: async (sectorId: string) => {
            const snap = await tx.get(db.collection('sectorPE').doc(sectorId));
            return snap.exists ? (snap.data() as Record<string, any>) : undefined;
          },
          getCompanyDoc: async (companyDocId: string) => {
            const snap = await tx.get(db.collection('companies').doc(companyDocId));
            return snap.exists ? (snap.data() as Record<string, any>) : undefined;
          },
          queryCompaniesBySectorId: async (sectorId: string, limit?: number) => {
            let q: AdminQueryLike = db.collection('companies').where('sectorId', '==', sectorId);
            if (typeof limit === 'number' && limit > 0) {
              q = q.limit(limit);
            }
            const snap = await tx.get(q);
            return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, any> }));
          },
          listLegacyCompaniesWithoutSectorId: async () => {
            const snap = await tx.get(
              db
                .collection('companies')
                .select('sectorId', 'sector', 'rawSector', 'isDeleted', 'ticker')
            );
            return snap.docs
              .filter((d) => !sanitizeSectorId((d.data() as Record<string, any> | undefined)?.sectorId ?? ''))
              .map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, any> }));
          },
          setSectorDoc: (sectorId: string, payload: Record<string, any>, merge: boolean) => {
            tx.set(db.collection('sectorPE').doc(sectorId), payload, { merge });
          },
          deleteSectorDoc: (sectorId: string) => {
            tx.delete(db.collection('sectorPE').doc(sectorId));
          },
          setCompanyDoc: (companyDocId: string, payload: Record<string, any>, merge: boolean) => {
            tx.set(db.collection('companies').doc(companyDocId), payload, { merge });
          },
          writeSectorTombstone: (sectorId: string) => {
            const tombSec = buildSectorTombstone(sectorId);
            tx.set(tombSec.ref, tombSec.data, { merge: true });
          },
        };
        return fn(txCtx);
      }),
    commitBatch: async (fn) => {
      const chunkBatch = db.batch();
      fn({
        setSectorDoc: (sectorId, payload, merge) => {
          chunkBatch.set(db.collection('sectorPE').doc(sectorId), payload, { merge });
        },
        deleteSectorDoc: (sectorId) => {
          chunkBatch.delete(db.collection('sectorPE').doc(sectorId));
        },
        setCompanyDoc: (companyDocId, payload, merge) => {
          chunkBatch.set(db.collection('companies').doc(companyDocId), payload, { merge });
        },
        writeSectorTombstone: (sectorId) => {
          const tombSec = buildSectorTombstone(sectorId);
          chunkBatch.set(tombSec.ref, tombSec.data, { merge: true });
        },
      });
      await chunkBatch.commit();
    },
  };
}

/**
 * Production transactional company metadata write (`operationType === 'company_metadata'`).
 * Shared between Cloud Functions and real Firestore Emulator integration tests.
 */
export async function applyAdminCompanyMetadataTx(
  db: AdminFirestoreLike,
  params: {
    rawPayload: unknown;
    stamp: Record<string, any>;
  }
): Promise<{ companyId: string; ticker: string; payload: Record<string, any> }> {
  const sanitized = sanitizeCompanyMetadataPatch(params.rawPayload);
  if (!sanitized) {
    throw new Error('بيانات الشركة الوصفية غير صالحة.');
  }
  const docRef = db.collection('companies').doc(sanitized.companyId);
  let writtenPayload: Record<string, any> = {};

  await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(docRef);
    const existingData = existingSnap.exists ? (existingSnap.data() as Record<string, any>) : undefined;
    const validatedSector = await validateAndCanonicalizeCompanySectorWrite({
      existingCompanyData: existingData,
      incomingPatch: sanitized.patch,
      getSectorDoc: async (sectorId: string) => {
        const secSnap = await tx.get(db.collection('sectorPE').doc(sectorId));
        return secSnap.exists ? (secSnap.data() as Record<string, any>) : undefined;
      },
      isCreate: !existingData || existingData.isDeleted === true,
    });
    writtenPayload = buildCompanyDocWritePayload(
      existingData,
      sanitized.companyId,
      sanitized.ticker,
      validatedSector.canonicalPatch,
      params.stamp
    );
    tx.set(docRef, writtenPayload, { merge: true });
  });

  return {
    companyId: sanitized.companyId,
    ticker: sanitized.ticker,
    payload: writtenPayload,
  };
}

/**
 * Production transactional company creation (`operationType === 'create_company'`).
 * Shared between Cloud Functions and real Firestore Emulator integration tests.
 */
export async function applyAdminCreateCompanyTx(
  db: AdminFirestoreLike,
  params: {
    rawPayload: unknown;
    stamp: Record<string, any>;
  }
): Promise<{ companyId: string; ticker: string; payload: Record<string, any> }> {
  const sanitized = sanitizeCompanyMetadataPatch(params.rawPayload);
  if (!sanitized) {
    throw new Error('بيانات الشركة غير صالحة.');
  }
  const docRef = db.collection('companies').doc(sanitized.companyId);
  let writtenPayload: Record<string, any> = {};

  await db.runTransaction(async (tx) => {
    const existingSnap = await tx.get(docRef);
    if (existingSnap.exists && (existingSnap.data() as Record<string, any>)?.isDeleted !== true) {
      throw new Error('الشركة مسجلة مسبقاً في Firestore؛ استخدم التحديث الجزئي بدلاً من الإنشاء الفوقي.');
    }
    const validatedSector = await validateAndCanonicalizeCompanySectorWrite({
      existingCompanyData: undefined,
      incomingPatch: sanitized.patch,
      getSectorDoc: async (sectorId: string) => {
        const secSnap = await tx.get(db.collection('sectorPE').doc(sectorId));
        return secSnap.exists ? (secSnap.data() as Record<string, any>) : undefined;
      },
      isCreate: true,
    });
    writtenPayload = buildCompanyDocWritePayload(
      undefined,
      sanitized.companyId,
      sanitized.ticker,
      validatedSector.canonicalPatch,
      params.stamp
    );
    tx.set(docRef, writtenPayload);
  });

  return {
    companyId: sanitized.companyId,
    ticker: sanitized.ticker,
    payload: writtenPayload,
  };
}

export function createAdminStockQuarterTxTarget(
  db: AdminFirestoreLike,
  tx: AdminTransactionLike
): AtomicWriteTarget {
  return {
    getDoc: async (col: string, docId: string) => {
      const snap = await tx.get(db.collection(col).doc(docId));
      return snap.exists ? (snap.data() as Record<string, any>) : undefined;
    },
    setDoc: (col: string, docId: string, payload: Record<string, any>, merge: boolean) => {
      const ref = db.collection(col).doc(docId);
      if (merge) {
        tx.set(ref, payload, { merge: true });
      } else {
        tx.set(ref, payload);
      }
    },
  };
}

/**
 * Production Firestore Admin transaction port for `bulk_quarterly`.
 * Uses `db.runTransaction` + `tx.getAll` (with `tx.get` fallback) so every read/merge/validate/write
 * cycle executes atomically against fresh Firestore versions with automatic contention retry.
 */
export function createFirestoreAdminBulkQuarterlyTransactionPort(
  db: AdminFirestoreLike,
  options?: {
    afterReadBeforeWrite?: (attempt: number) => Promise<void>;
  }
): BulkQuarterlyTransactionPort {
  let attempt = 0;
  return {
    runTransaction: async <T,>(fn: (txTarget: BulkQuarterlyWriteTarget) => Promise<T>): Promise<T> =>
      db.runTransaction(async (tx) => {
        attempt += 1;
        const currentAttempt = attempt;
        const txTarget: BulkQuarterlyWriteTarget = {
          getDocs: async (refSpecs) => {
            const out = new Map<string, Record<string, any>>();
            if (refSpecs.length === 0) return out;
            const refs = refSpecs.map((spec) => db.collection(spec.collection).doc(spec.docId));
            const snaps =
              typeof tx.getAll === 'function'
                ? await tx.getAll(...refs)
                : await Promise.all(refs.map((ref) => tx.get(ref)));
            snaps.forEach((snap, idx) => {
              if (snap.exists) {
                const spec = refSpecs[idx];
                out.set(`${spec.collection}/${spec.docId}`, snap.data() as Record<string, any>);
              }
            });
            if (options?.afterReadBeforeWrite) {
              await options.afterReadBeforeWrite(currentAttempt);
            }
            return out;
          },
          setDoc: (collection, docId, payload, merge) => {
            const ref = db.collection(collection).doc(docId);
            if (merge) {
              tx.set(ref, payload, { merge: true });
            } else {
              tx.set(ref, payload);
            }
          },
        };
        return fn(txTarget);
      }),
  };
}
