"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFirestoreAdminSectorMutationPort = createFirestoreAdminSectorMutationPort;
exports.applyAdminCompanyMetadataTx = applyAdminCompanyMetadataTx;
exports.applyAdminCreateCompanyTx = applyAdminCreateCompanyTx;
exports.createAdminStockQuarterTxTarget = createAdminStockQuarterTxTarget;
exports.createFirestoreAdminBulkQuarterlyTransactionPort = createFirestoreAdminBulkQuarterlyTransactionPort;
const records_1 = require("./records");
const sectorLinkage_1 = require("./sectorLinkage");
const sectorRegistry_1 = require("./sectorRegistry");
function createFirestoreAdminSectorMutationPort(db, options) {
    const { buildSectorTombstone } = options;
    return {
        listAllSectors: async () => {
            const snap = await db.collection('sectorPE').get();
            return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) }));
        },
        listAllCompanies: async () => {
            const snap = await db.collection('companies').get();
            return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) }));
        },
        queryCompaniesBySectorId: async (sectorId, limit) => {
            let q = db.collection('companies').where('sectorId', '==', sectorId);
            if (typeof limit === 'number' && limit > 0) {
                q = q.limit(limit);
            }
            const snap = await q.get();
            return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) }));
        },
        listLegacyCompaniesWithoutSectorId: async () => {
            const snap = await db
                .collection('companies')
                .select('sectorId', 'sector', 'rawSector', 'isDeleted', 'ticker')
                .get();
            return snap.docs
                .filter((d) => !(0, sectorRegistry_1.sanitizeSectorId)(d.data()?.sectorId ?? ''))
                .map((d) => ({ id: d.id, data: (d.data() ?? {}) }));
        },
        runTransaction: async (fn) => db.runTransaction(async (tx) => {
            const txCtx = {
                getAllSectors: async () => {
                    const snap = await tx.get(db.collection('sectorPE'));
                    return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) }));
                },
                getAllCompanies: async () => {
                    const snap = await tx.get(db.collection('companies'));
                    return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) }));
                },
                getSectorDoc: async (sectorId) => {
                    const snap = await tx.get(db.collection('sectorPE').doc(sectorId));
                    return snap.exists ? snap.data() : undefined;
                },
                getCompanyDoc: async (companyDocId) => {
                    const snap = await tx.get(db.collection('companies').doc(companyDocId));
                    return snap.exists ? snap.data() : undefined;
                },
                queryCompaniesBySectorId: async (sectorId, limit) => {
                    let q = db.collection('companies').where('sectorId', '==', sectorId);
                    if (typeof limit === 'number' && limit > 0) {
                        q = q.limit(limit);
                    }
                    const snap = await tx.get(q);
                    return snap.docs.map((d) => ({ id: d.id, data: (d.data() ?? {}) }));
                },
                listLegacyCompaniesWithoutSectorId: async () => {
                    const snap = await tx.get(db
                        .collection('companies')
                        .select('sectorId', 'sector', 'rawSector', 'isDeleted', 'ticker'));
                    return snap.docs
                        .filter((d) => !(0, sectorRegistry_1.sanitizeSectorId)(d.data()?.sectorId ?? ''))
                        .map((d) => ({ id: d.id, data: (d.data() ?? {}) }));
                },
                setSectorDoc: (sectorId, payload, merge) => {
                    tx.set(db.collection('sectorPE').doc(sectorId), payload, { merge });
                },
                deleteSectorDoc: (sectorId) => {
                    tx.delete(db.collection('sectorPE').doc(sectorId));
                },
                setCompanyDoc: (companyDocId, payload, merge) => {
                    tx.set(db.collection('companies').doc(companyDocId), payload, { merge });
                },
                writeSectorTombstone: (sectorId) => {
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
async function applyAdminCompanyMetadataTx(db, params) {
    const sanitized = (0, records_1.sanitizeCompanyMetadataPatch)(params.rawPayload);
    if (!sanitized) {
        throw new Error('بيانات الشركة الوصفية غير صالحة.');
    }
    const docRef = db.collection('companies').doc(sanitized.companyId);
    let writtenPayload = {};
    await db.runTransaction(async (tx) => {
        const existingSnap = await tx.get(docRef);
        const existingData = existingSnap.exists ? existingSnap.data() : undefined;
        const validatedSector = await (0, sectorLinkage_1.validateAndCanonicalizeCompanySectorWrite)({
            existingCompanyData: existingData,
            incomingPatch: sanitized.patch,
            getSectorDoc: async (sectorId) => {
                const secSnap = await tx.get(db.collection('sectorPE').doc(sectorId));
                return secSnap.exists ? secSnap.data() : undefined;
            },
            isCreate: !existingData || existingData.isDeleted === true,
        });
        writtenPayload = (0, records_1.buildCompanyDocWritePayload)(existingData, sanitized.companyId, sanitized.ticker, validatedSector.canonicalPatch, params.stamp);
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
async function applyAdminCreateCompanyTx(db, params) {
    const sanitized = (0, records_1.sanitizeCompanyMetadataPatch)(params.rawPayload);
    if (!sanitized) {
        throw new Error('بيانات الشركة غير صالحة.');
    }
    const docRef = db.collection('companies').doc(sanitized.companyId);
    let writtenPayload = {};
    await db.runTransaction(async (tx) => {
        const existingSnap = await tx.get(docRef);
        if (existingSnap.exists && existingSnap.data()?.isDeleted !== true) {
            throw new Error('الشركة مسجلة مسبقاً في Firestore؛ استخدم التحديث الجزئي بدلاً من الإنشاء الفوقي.');
        }
        const validatedSector = await (0, sectorLinkage_1.validateAndCanonicalizeCompanySectorWrite)({
            existingCompanyData: undefined,
            incomingPatch: sanitized.patch,
            getSectorDoc: async (sectorId) => {
                const secSnap = await tx.get(db.collection('sectorPE').doc(sectorId));
                return secSnap.exists ? secSnap.data() : undefined;
            },
            isCreate: true,
        });
        writtenPayload = (0, records_1.buildCompanyDocWritePayload)(undefined, sanitized.companyId, sanitized.ticker, validatedSector.canonicalPatch, params.stamp);
        tx.set(docRef, writtenPayload);
    });
    return {
        companyId: sanitized.companyId,
        ticker: sanitized.ticker,
        payload: writtenPayload,
    };
}
function createAdminStockQuarterTxTarget(db, tx) {
    return {
        getDoc: async (col, docId) => {
            const snap = await tx.get(db.collection(col).doc(docId));
            return snap.exists ? snap.data() : undefined;
        },
        setDoc: (col, docId, payload, merge) => {
            const ref = db.collection(col).doc(docId);
            if (merge) {
                tx.set(ref, payload, { merge: true });
            }
            else {
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
function createFirestoreAdminBulkQuarterlyTransactionPort(db, options) {
    let attempt = 0;
    return {
        runTransaction: async (fn) => db.runTransaction(async (tx) => {
            attempt += 1;
            const currentAttempt = attempt;
            const txTarget = {
                getDocs: async (refSpecs) => {
                    const out = new Map();
                    if (refSpecs.length === 0)
                        return out;
                    const refs = refSpecs.map((spec) => db.collection(spec.collection).doc(spec.docId));
                    const snaps = typeof tx.getAll === 'function'
                        ? await tx.getAll(...refs)
                        : await Promise.all(refs.map((ref) => tx.get(ref)));
                    snaps.forEach((snap, idx) => {
                        if (snap.exists) {
                            const spec = refSpecs[idx];
                            out.set(`${spec.collection}/${spec.docId}`, snap.data());
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
                    }
                    else {
                        tx.set(ref, payload);
                    }
                },
            };
            return fn(txTarget);
        }),
    };
}
//# sourceMappingURL=sectorAdminPort.js.map