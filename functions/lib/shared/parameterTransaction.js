"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production transactional executor for `macro_params` and `company_assumptions/{ticker}/parameters`
 * shared between Cloud Functions (`bulk_parameters` & `macro_parameter`) and real Firestore Emulator tests.
 *
 * Guarantees:
 * - Reads all target parameter documents INSIDE `db.runTransaction` BEFORE any write.
 * - Verifies optimistic concurrency preconditions (`create` non-existence, `update` existence +
 *   `expectedRevision` + `expectedContentHash`) INSIDE the transaction so Firestore contention retries
 *   never apply a stale payload on top of a newer committed revision.
 * - Atomically commits all parameter writes, company parent touches, and optional import batch log
 *   within one Firestore transaction (up to `IMPORT_SAFE_CHUNK_SIZES.parameters` = 240 items -> <= 481 writes).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFirestoreAdminParameterTransactionPort = createFirestoreAdminParameterTransactionPort;
exports.executeAtomicParameterWrites = executeAtomicParameterWrites;
const batchLimits_1 = require("./batchLimits");
const parameterPersistence_1 = require("./parameterPersistence");
const records_1 = require("./records");
function createFirestoreAdminParameterTransactionPort(db) {
    return {
        runTransaction: async (fn) => db.runTransaction(async (tx) => {
            const txCtx = {
                getDocumentByPath: async (docPath) => {
                    const snap = await tx.get(db.doc(docPath));
                    return snap.exists ? snap.data() : undefined;
                },
                setDocumentByPath: (docPath, data, merge) => {
                    tx.set(db.doc(docPath), data, { merge });
                },
            };
            return fn(txCtx);
        }),
    };
}
/**
 * Executes validated parameter writes atomically inside a Firestore transaction.
 * Used identically by `bulk_parameters` and `macro_parameter` in Cloud Functions
 * and verified directly against real Firestore Emulator in integration tests.
 */
async function executeAtomicParameterWrites(port, params) {
    const maxBatch = params.maxBatch ?? batchLimits_1.IMPORT_SAFE_CHUNK_SIZES.parameters;
    // Validate input structure & bounds upfront (fast fail before opening transaction)
    const preValidated = (0, records_1.validateParameterRecords)(params.rawInputs, maxBatch);
    const targetPaths = preValidated.map((p) => (0, parameterPersistence_1.getParameterDocumentPath)(p));
    return port.runTransaction(async (txCtx) => {
        // Phase 1: Read EVERY target document inside the transaction BEFORE any write.
        const existingDocs = await Promise.all(targetPaths.map((docPath) => txCtx.getDocumentByPath(docPath)));
        const existingDocsByPath = new Map();
        targetPaths.forEach((docPath, idx) => {
            existingDocsByPath.set(docPath, existingDocs[idx]);
        });
        // Phase 2: Verify optimistic concurrency preconditions + compute next revisions & documents.
        const plan = (0, parameterPersistence_1.planParameterPersistenceWrites)({
            rawInputs: params.rawInputs,
            existingDocsByPath,
            provenance: params.provenance,
            maxBatch,
        });
        // Phase 3: Apply writes inside the same atomic transaction.
        for (const write of plan.writes) {
            if (write.status === 'skip' || !write.document)
                continue;
            txCtx.setDocumentByPath(write.docPath, write.document, true);
        }
        for (const tk of plan.touchedCompanyTickers) {
            txCtx.setDocumentByPath(`company_assumptions/${tk}`, {
                ticker: tk,
                updatedAt: params.provenance.updatedAt,
                serverUpdatedAt: params.provenance.serverUpdatedAt,
                updatedBy: params.provenance.updatedBy,
                isDeleted: false,
            }, true);
        }
        if (params.importBatchLog) {
            txCtx.setDocumentByPath(`import_batches/${params.importBatchLog.logId}`, {
                ...params.importBatchLog.data,
                processedCount: plan.validatedParams.length,
                insertedCount: plan.insertedCount,
                updatedCount: plan.updatedCount,
                skippedUnchangedCount: plan.skippedUnchangedCount,
            }, true);
        }
        const savedParameters = plan.writes.map((write) => ({
            key: write.key,
            scope: write.scope,
            ticker: write.ticker,
            docPath: write.docPath,
            status: write.status,
            revision: write.revision,
            contentHash: write.contentHash,
            updatedAt: params.provenance.updatedAt,
        }));
        return {
            count: plan.validatedParams.length,
            insertedCount: plan.insertedCount,
            updatedCount: plan.updatedCount,
            skippedUnchangedCount: plan.skippedUnchangedCount,
            savedParameters,
        };
    });
}
//# sourceMappingURL=parameterTransaction.js.map