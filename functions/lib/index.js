"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Firebase Cloud Functions for Mizan Platform
 * Authoritative validated financial & governance writes with hash idempotency & tombstones.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateFinancialData = void 0;
const v2_1 = require("firebase-functions/v2");
const https_1 = require("firebase-functions/v2/https");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const shared_1 = require("./shared");
if (!(0, app_1.getApps)().length) {
    (0, app_1.initializeApp)();
}
(0, v2_1.setGlobalOptions)({
    region: process.env.FUNCTION_REGION || 'us-central1',
    maxInstances: 10,
});
const db = (0, firestore_1.getFirestore)();
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function buildTombstoneDoc(collection, docId, uid, ticker) {
    const id = `${collection}__${docId}`;
    return {
        ref: db.collection('tombstones').doc(id),
        data: {
            id,
            collection,
            docId,
            ticker: ticker ?? null,
            deletedAt: new Date().toISOString(),
            serverUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
            deletedBy: uid,
            expiresAtMs: Date.now() + TOMBSTONE_TTL_MS,
        },
    };
}
async function fetchExistingMap(refs) {
    const result = new Map();
    if (refs.length === 0)
        return result;
    for (let i = 0; i < refs.length; i += 250) {
        const slice = refs.slice(i, i + 250);
        const snaps = await db.getAll(...slice);
        snaps.forEach((snap) => {
            if (snap.exists) {
                result.set(snap.ref.path, snap.data());
            }
        });
    }
    return result;
}
function computeExistingHash(sourceType, existingData) {
    if (!existingData || existingData.isDeleted === true)
        return null;
    if (typeof existingData.contentHash === 'string' && existingData.contentHash.startsWith('mzh1_')) {
        return existingData.contentHash;
    }
    return (0, shared_1.computeRecordBusinessHash)(sourceType, existingData);
}
exports.updateFinancialData = (0, https_1.onCall)({ region: 'us-central1', cors: true, timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'يجب تسجيل الدخول.');
    }
    const { uid, token } = request.auth;
    const user = await db.collection('users').doc(uid).get();
    if (user.data()?.isActive === false) {
        throw new https_1.HttpsError('permission-denied', 'الحساب معطل.');
    }
    const owner = token.email_verified === true && token.email === 'maao2004@gmail.com';
    const admin = owner ||
        token.admin === true ||
        token.role === 'admin' ||
        (await db.collection('admins').doc(uid).get()).exists;
    const entry = admin ||
        token.role === 'data_entry' ||
        ['admin', 'data_entry'].includes(String(user.data()?.role || ''));
    if (!entry) {
        throw new https_1.HttpsError('permission-denied', 'مطلوب مدير أو مدخل بيانات.');
    }
    const { operationType, data, companyMetadata, ticker, year, quarter, tradeDate, key, scope, id, companyId, importMeta, } = (request.data || {});
    const now = new Date().toISOString();
    const baseProvenance = {
        importId: typeof importMeta?.importId === 'string' ? importMeta.importId.slice(0, 120) : `manual_${Date.now()}`,
        sourceFile: typeof importMeta?.sourceFile === 'string' ? importMeta.sourceFile.slice(0, 200) : 'manual_ui',
        sourceSheet: typeof importMeta?.sourceSheet === 'string' ? importMeta.sourceSheet.slice(0, 120) : operationType || 'manual',
        schemaVersion: shared_1.RECORD_SCHEMA_VERSION,
        updatedBy: uid,
        updatedAt: now,
        serverUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
        isDeleted: false,
    };
    const batch = db.batch();
    let batchWriteOps = 0;
    let count = 0;
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedUnchangedCount = 0;
    let useTransactionForSingleQuarter = false;
    let validatedSingleQuarter = null;
    let atomicBulkQuarterlyTx = null;
    let atomicDividendTx = null;
    let atomicParameterTx = null;
    let atomicRealEstateDisclosureTx = null;
    let savedParameters = null;
    let sectorReport = null;
    let realEstateDisclosureReceipt = null;
    const buildSectorMutationPort = () => (0, shared_1.createFirestoreAdminSectorMutationPort)(db, {
        buildSectorTombstone: (sectorId) => buildTombstoneDoc('sectorPE', sectorId, uid, null),
    });
    try {
        if (operationType === 'quarterly_record') {
            (0, shared_1.extractQuarterlyDocIdentity)(data);
            useTransactionForSingleQuarter = true;
            validatedSingleQuarter = data;
            count = 1;
        }
        else if (operationType === 'bulk_quarterly') {
            const rawArr = Array.isArray(data) ? data : [data];
            if (rawArr.length > shared_1.IMPORT_SAFE_CHUNK_SIZES.quarterly) {
                throw new Error(`أرسل ${shared_1.IMPORT_SAFE_CHUNK_SIZES.quarterly} سجلاً ربع سنوي بحد أقصى في الدفعة الواحدة.`);
            }
            (0, shared_1.validateBulkQuarterlyRequestEnvelope)(rawArr, shared_1.IMPORT_SAFE_CHUNK_SIZES.quarterly);
            atomicBulkQuarterlyTx = {
                rawRecords: rawArr,
                maxBatch: shared_1.IMPORT_SAFE_CHUNK_SIZES.quarterly,
            };
            count = rawArr.length;
        }
        else if (operationType === 'daily_record' || operationType === 'bulk_daily') {
            const rawArr = operationType === 'bulk_daily' ? (Array.isArray(data) ? data : []) : [data];
            if (rawArr.length > shared_1.IMPORT_SAFE_CHUNK_SIZES.daily) {
                throw new Error(`أرسل ${shared_1.IMPORT_SAFE_CHUNK_SIZES.daily} سجلاً يومياً بحد أقصى في الدفعة الواحدة.`);
            }
            const validatedSchema = importMeta?.dailySchema !== undefined && importMeta?.dailySchema !== null
                ? (0, shared_1.validateDailySchemaPayload)(importMeta.dailySchema)
                : null;
            const records = (0, shared_1.validateRecords)(rawArr, false, shared_1.IMPORT_SAFE_CHUNK_SIZES.daily);
            const refs = records.map((r) => db.collection('daily_trading_records').doc(`${r.ticker}_${r.tradeDate}`));
            const existingMap = await fetchExistingMap(refs);
            if (validatedSchema) {
                const schemaRef = db.collection('daily_trading_schemas').doc(validatedSchema.schemaId);
                const schemaSnap = await schemaRef.get();
                const schemaHash = (0, shared_1.computeCanonicalHash)(validatedSchema.columns);
                const existingSchemaData = schemaSnap.exists ? schemaSnap.data() : undefined;
                if (!existingSchemaData || existingSchemaData.isDeleted === true || existingSchemaData.contentHash !== schemaHash) {
                    batch.set(schemaRef, {
                        ...validatedSchema,
                        ...baseProvenance,
                        contentHash: schemaHash,
                    }, { merge: true });
                    batchWriteOps += 1;
                }
            }
            for (let idx = 0; idx < records.length; idx++) {
                const record = records[idx];
                const sourceRow = typeof rawArr[idx]?.sourceRow === 'number' ? rawArr[idx].sourceRow : idx + 1;
                const tk = (0, shared_1.normalizedTicker)(record.ticker);
                const docRef = db.collection('daily_trading_records').doc(`${tk}_${record.tradeDate}`);
                const contentHash = (0, shared_1.computeRecordBusinessHash)('daily', record);
                const existing = existingMap.get(docRef.path);
                const existingHash = computeExistingHash('daily', existing);
                if (existing && existingHash === contentHash) {
                    skippedUnchangedCount += 1;
                    continue;
                }
                if (!existing || existing.isDeleted === true)
                    insertedCount += 1;
                else
                    updatedCount += 1;
                if (batchWriteOps + 2 > shared_1.FIRESTORE_BATCH_WRITE_LIMIT) {
                    throw new Error(`تجاوزت الدفعة حد عمليات Firestore (${shared_1.FIRESTORE_BATCH_WRITE_LIMIT} عملية).`);
                }
                batch.set(docRef, { ...record, ticker: tk, ...baseProvenance, sourceRow, contentHash }, { merge: true });
                batchWriteOps += 1;
            }
            count = records.length;
        }
        else if (operationType === 'bulk_beta') {
            const rawArr = Array.isArray(data) ? data : [data];
            const records = (0, shared_1.validateBetaRecords)(rawArr, shared_1.IMPORT_SAFE_CHUNK_SIZES.beta);
            const refs = records.map((r) => db.collection('beta_assumptions').doc(r.ticker));
            const existingMap = await fetchExistingMap(refs);
            for (let idx = 0; idx < records.length; idx++) {
                const rec = records[idx];
                const sourceRow = typeof rawArr[idx]?.sourceRow === 'number' ? rawArr[idx].sourceRow : idx + 1;
                const docRef = db.collection('beta_assumptions').doc(rec.ticker);
                const contentHash = (0, shared_1.computeRecordBusinessHash)('beta', rec);
                const existing = existingMap.get(docRef.path);
                const existingHash = computeExistingHash('beta', existing);
                if (existing && existingHash === contentHash) {
                    skippedUnchangedCount += 1;
                    continue;
                }
                if (!existing || existing.isDeleted === true)
                    insertedCount += 1;
                else
                    updatedCount += 1;
                batch.set(docRef, { ...rec, ...baseProvenance, sourceRow, contentHash }, { merge: true });
                batchWriteOps += 1;
            }
            count = records.length;
        }
        else if (operationType === 'bulk_dividend' || operationType === 'dividend_record') {
            const rawArr = operationType === 'bulk_dividend' ? (Array.isArray(data) ? data : [data]) : [data];
            const maxLen = operationType === 'bulk_dividend' ? shared_1.IMPORT_SAFE_CHUNK_SIZES.dividend : 1;
            if (rawArr.length > maxLen) {
                throw new Error(`أرسل ${maxLen} سجل توزيعات بحد أقصى في الدفعة الواحدة.`);
            }
            const records = (0, shared_1.validateDividendRecords)(rawArr, maxLen);
            const sourceRows = rawArr.map((item, idx) => typeof item?.sourceRow === 'number' ? item.sourceRow : idx + 1);
            atomicDividendTx = {
                kind: 'dividends',
                operationType,
                records,
                sourceRows,
            };
            count = records.length;
        }
        else if (operationType === 'save_dividend_year_status') {
            const validated = (0, shared_1.validateDividendYearStatusPayload)(data);
            atomicDividendTx = {
                kind: 'year_status',
                validated,
            };
            count = 1;
        }
        else if (operationType === 'delete_dividend_year_status') {
            let statusDocId = '';
            let tk = null;
            if (typeof id === 'string' && id.trim()) {
                if (id.includes('/') || id.includes('..')) {
                    throw new Error('معرّف حالة توزيعات السنة غير صالح.');
                }
                statusDocId = id.trim();
                tk = statusDocId.split('_')[0] || null;
            }
            else {
                const rawTicker = data?.ticker ?? ticker;
                const rawYear = Number(data?.fiscalYear ?? year);
                statusDocId = (0, shared_1.buildDividendYearStatusDocId)(rawTicker, rawYear);
                tk = (0, shared_1.normalizedTicker)(rawTicker);
            }
            batch.delete(db.collection('dividend_year_statuses').doc(statusDocId));
            const tombStatus = buildTombstoneDoc('dividend_year_statuses', statusDocId, uid, tk);
            batch.set(tombStatus.ref, tombStatus.data, { merge: true });
            batchWriteOps += 2;
            count = 1;
        }
        else if (operationType === 'bulk_parameters') {
            const rawArr = Array.isArray(data) ? data : [data];
            const preValidated = (0, shared_1.validateParameterRecords)(rawArr, shared_1.IMPORT_SAFE_CHUNK_SIZES.parameters);
            if (preValidated.some((p) => p.scope === 'global') && !admin) {
                throw new https_1.HttpsError('permission-denied', 'تعديل المعاملات العامة (macro_params) للمدير فقط.');
            }
            atomicParameterTx = {
                rawInputs: rawArr,
                maxBatch: shared_1.IMPORT_SAFE_CHUNK_SIZES.parameters,
            };
        }
        else if (operationType === 'macro_parameter') {
            if (!admin) {
                throw new https_1.HttpsError('permission-denied', 'المعاملات للمدير فقط.');
            }
            const singleRaw = {
                key: data?.key,
                nameAr: data?.nameAr,
                value: data?.value,
                description: data?.descriptionAr ?? data?.description ?? '',
                scope: 'global',
                ticker: null,
                unit: data?.unit,
                category: data?.category,
                valueType: data?.valueType,
                isPercentage: data?.isPercentage,
                asOfDate: data?.asOfDate || '',
                source: data?.source || 'لوحة الإدارة',
                rfMethodology: data?.rfMethodology ?? data?.RfMethodology,
                currency: data?.currency ?? data?.Currency,
                forecastHorizonYears: data?.forecastHorizonYears ?? data?.ForecastHorizonYears,
                ...(data?.precondition !== undefined ? { precondition: data.precondition } : {}),
            };
            (0, shared_1.validateParameterRecords)([singleRaw], 1);
            atomicParameterTx = {
                rawInputs: [singleRaw],
                maxBatch: 1,
            };
        }
        else if (operationType === 'delete_quarterly') {
            const [rec] = (0, shared_1.validateRecords)([{ ticker, year, quarter }], true);
            const tk = (0, shared_1.normalizedTicker)(rec.ticker);
            const qStr = String(rec.quarter);
            const qDocId = `${tk}_${rec.year}_${qStr}`;
            const fDocId = `${tk.toLowerCase()}_${rec.year}_${qStr.toLowerCase()}`;
            batch.delete(db.collection('quarterly_financial_records').doc(qDocId));
            batch.delete(db.collection('financials').doc(fDocId));
            const tombQ = buildTombstoneDoc('quarterly_financial_records', qDocId, uid, tk);
            const tombF = buildTombstoneDoc('financials', fDocId, uid, tk);
            batch.set(tombQ.ref, tombQ.data, { merge: true });
            batch.set(tombF.ref, tombF.data, { merge: true });
            batchWriteOps += 4;
            count = 1;
        }
        else if (operationType === 'delete_daily') {
            const [rec] = (0, shared_1.validateRecords)([{ ticker, tradeDate }], false);
            const tk = (0, shared_1.normalizedTicker)(rec.ticker);
            const dDocId = `${tk}_${rec.tradeDate}`;
            batch.delete(db.collection('daily_trading_records').doc(dDocId));
            const tombD = buildTombstoneDoc('daily_trading_records', dDocId, uid, tk);
            batch.set(tombD.ref, tombD.data, { merge: true });
            batchWriteOps += 2;
            count = 1;
        }
        else if (operationType === 'delete_beta') {
            const tk = (0, shared_1.normalizedTicker)(ticker);
            batch.delete(db.collection('beta_assumptions').doc(tk));
            const tombB = buildTombstoneDoc('beta_assumptions', tk, uid, tk);
            batch.set(tombB.ref, tombB.data, { merge: true });
            batchWriteOps += 2;
            count = 1;
        }
        else if (operationType === 'delete_dividend') {
            let divDocId = '';
            let tk = null;
            if (typeof id === 'string' && id.trim()) {
                if (id.includes('/') || id.includes('..')) {
                    throw new Error('معرّف سجل التوزيعات غير صالح.');
                }
                divDocId = id.trim();
                tk = divDocId.split('_')[0] || null;
            }
            else if (data && typeof data === 'object') {
                divDocId = (0, shared_1.buildDividendDocId)({
                    ticker: data.ticker,
                    fiscalYear: Number(data.fiscalYear),
                    recordType: data.recordType === 'special' ? 'special' : 'regular',
                    distributionId: data.distributionId,
                });
                tk = (0, shared_1.normalizedTicker)(data.ticker);
            }
            else {
                throw new Error('معرّف سجل التوزيعات المطلوب حذفه غير صالح.');
            }
            batch.delete(db.collection('dividend_records').doc(divDocId));
            const tombDiv = buildTombstoneDoc('dividend_records', divDocId, uid, tk);
            batch.set(tombDiv.ref, tombDiv.data, { merge: true });
            batchWriteOps += 2;
            count = 1;
        }
        else if (operationType === 'delete_parameter') {
            if (!key || typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(key)) {
                throw new Error('اسم المعامل غير صالح.');
            }
            const effectiveScope = scope === 'company' ? 'company' : 'global';
            if (effectiveScope === 'global') {
                if (!admin)
                    throw new https_1.HttpsError('permission-denied', 'حذف المعاملات العامة للمدير فقط.');
                batch.delete(db.collection('macro_params').doc(key));
                const tombM = buildTombstoneDoc('macro_params', key, uid, null);
                batch.set(tombM.ref, tombM.data, { merge: true });
                batchWriteOps += 2;
            }
            else {
                const tk = (0, shared_1.normalizedTicker)(ticker);
                batch.delete(db.collection('company_assumptions').doc(tk).collection('parameters').doc(key));
                const tombC = buildTombstoneDoc('company_assumptions', `${tk}__${key}`, uid, tk);
                batch.set(tombC.ref, tombC.data, { merge: true });
                batchWriteOps += 2;
            }
            count = 1;
        }
        else if (operationType === 'migrate_legacy_beta') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'الترحيل للمدير فقط.');
            const companiesSnap = await db.collection('companies').get();
            const betaSnap = await db.collection('beta_assumptions').get();
            const existingBeta = new Set(betaSnap.docs.map((d) => d.id));
            for (const cDoc of companiesSnap.docs) {
                const cData = cDoc.data();
                const rawBeta = cData?.beta;
                if (typeof rawBeta !== 'number' || !Number.isFinite(rawBeta))
                    continue;
                let tk;
                try {
                    tk = (0, shared_1.normalizedTicker)(cData.ticker || cDoc.id);
                }
                catch {
                    continue;
                }
                if (existingBeta.has(tk)) {
                    skippedUnchangedCount += 1;
                    continue;
                }
                if (batchWriteOps >= 400)
                    break;
                const payload = {
                    ticker: tk,
                    beta: rawBeta,
                    asOfDate: (typeof cData.updatedAt === 'string' ? cData.updatedAt.slice(0, 10) : now.slice(0, 10)),
                    source: 'ترحيل من companies.beta القديم',
                };
                const contentHash = (0, shared_1.computeRecordBusinessHash)('beta', payload);
                batch.set(db.collection('beta_assumptions').doc(tk), { ...payload, ...baseProvenance, contentHash }, { merge: true });
                existingBeta.add(tk);
                insertedCount += 1;
                batchWriteOps += 1;
                count += 1;
            }
        }
        else if (operationType === 'migrate_legacy_company_overrides') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'الترحيل للمدير فقط.');
            const fieldMap = [
                { field: 'riskFreeRate', key: 'Rf_Egypt_10Y', unit: 'decimal' },
                { field: 'equityRiskPremium', key: 'ERP_Developed', unit: 'decimal' },
                { field: 'costOfDebt', key: 'Cost_of_Debt', unit: 'decimal' },
                { field: 'taxRate', key: 'TaxRate', unit: 'decimal' },
                { field: 'sustainableGrowthRate', key: 'Terminal_Growth', unit: 'decimal' },
                { field: 'targetPE', key: 'Target_PE', unit: 'multiple' },
                { field: 'targetPB', key: 'Target_PB', unit: 'multiple' },
            ];
            const companiesSnap = await db.collection('companies').get();
            for (const cDoc of companiesSnap.docs) {
                const cData = cDoc.data();
                let tk;
                try {
                    tk = (0, shared_1.normalizedTicker)(cData.ticker || cDoc.id);
                }
                catch {
                    continue;
                }
                const existingOverrides = await db
                    .collection('company_assumptions')
                    .doc(tk)
                    .collection('parameters')
                    .get();
                const existingKeys = new Set(existingOverrides.docs.map((d) => d.id));
                for (const mapping of fieldMap) {
                    const val = cData?.[mapping.field];
                    if (typeof val !== 'number' || !Number.isFinite(val))
                        continue;
                    if (existingKeys.has(mapping.key)) {
                        skippedUnchangedCount += 1;
                        continue;
                    }
                    if (batchWriteOps >= 390)
                        break;
                    const payload = {
                        key: mapping.key,
                        value: val,
                        description: (0, shared_1.getParameterDefinition)(mapping.key)?.descriptionAr || mapping.key,
                        scope: 'company',
                        ticker: tk,
                        unit: mapping.unit,
                        asOfDate: typeof cData.updatedAt === 'string' ? cData.updatedAt.slice(0, 10) : now.slice(0, 10),
                        source: 'ترحيل من حقول companies القديمة',
                    };
                    const contentHash = (0, shared_1.computeRecordBusinessHash)('parameter', payload);
                    batch.set(db.collection('company_assumptions').doc(tk).collection('parameters').doc(mapping.key), { ...payload, ...baseProvenance, contentHash }, { merge: true });
                    insertedCount += 1;
                    batchWriteOps += 1;
                    count += 1;
                }
            }
        }
        else if (operationType === 'backfill_server_timestamps') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'الصيانة للمدير فقط.');
            const collectionsToCheck = [
                'quarterly_financial_records',
                'daily_trading_records',
                'daily_trading_schemas',
                'beta_assumptions',
                'dividend_records',
                'dividend_year_statuses',
                'macro_params',
                'companies',
                'financials',
                'stories',
                'decisions',
                'trades',
                'sectorPE',
            ];
            for (const col of collectionsToCheck) {
                if (batchWriteOps >= 400)
                    break;
                const snap = await db.collection(col).get();
                for (const d of snap.docs) {
                    if (batchWriteOps >= 400)
                        break;
                    if (!d.data()?.serverUpdatedAt) {
                        batch.set(d.ref, { serverUpdatedAt: firestore_1.FieldValue.serverTimestamp(), updatedAt: d.data()?.updatedAt || now }, { merge: true });
                        batchWriteOps += 1;
                        updatedCount += 1;
                        count += 1;
                    }
                }
            }
        }
        else if (operationType === 'cleanup_expired_tombstones') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'الصيانة للمدير فقط.');
            const nowMs = Date.now();
            const expiredSnap = await db
                .collection('tombstones')
                .where('expiresAtMs', '<=', nowMs)
                .limit(350)
                .get();
            for (const d of expiredSnap.docs) {
                batch.delete(d.ref);
                batchWriteOps += 1;
                count += 1;
            }
        }
        else if (operationType === 'company_metadata') {
            await (0, shared_1.applyAdminCompanyMetadataTx)(db, {
                rawPayload: data,
                stamp: baseProvenance,
            });
            count = 1;
            updatedCount = 1;
        }
        else if (operationType === 'create_company') {
            await (0, shared_1.applyAdminCreateCompanyTx)(db, {
                rawPayload: data,
                stamp: baseProvenance,
            });
            count = 1;
            insertedCount = 1;
        }
        else if (operationType === 'delete_company') {
            const rawId = typeof id === 'string' && id.trim() && !id.includes('/') ? id.trim() : '';
            if (!rawId)
                throw new Error('معرف الشركة المطلوب حذفها غير صالح.');
            batch.delete(db.collection('companies').doc(rawId));
            const tombComp = buildTombstoneDoc('companies', rawId, uid, rawId.toUpperCase());
            batch.set(tombComp.ref, tombComp.data, { merge: true });
            batchWriteOps += 2;
            count = 1;
        }
        else if (operationType === 'sector_pe') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'تعديل مضاعفات القطاعات للمدير فقط.');
            const validated = (0, shared_1.validateSectorPEPayload)(data);
            const entries = Object.entries(validated);
            for (const [sectorKey] of entries) {
                if (!(0, shared_1.sanitizeSectorId)(sectorKey)) {
                    throw new shared_1.SectorGovernanceConflictError(`معرّف القطاع (${sectorKey}) غير صالح.`);
                }
            }
            await db.runTransaction(async (tx) => {
                const refs = entries.map(([sectorKey]) => db.collection('sectorPE').doc(sectorKey));
                const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
                for (let i = 0; i < entries.length; i++) {
                    const [sectorKey, val] = entries[i];
                    const existing = snaps[i].exists ? snaps[i].data() : undefined;
                    if (existing?.pendingDelete === true) {
                        throw new shared_1.SectorGovernanceConflictError(`القطاع (${sectorKey}) قيد الحذف حالياً؛ لا يمكن تعديل مضاعفه عبر المسار القديم.`);
                    }
                    tx.set(refs[i], {
                        value: val,
                        multiple: val,
                        ...(existing?.sectorId ? {} : { sectorId: sectorKey }),
                        ...(existing?.nameAr ? {} : { nameAr: sectorKey }),
                        ...(existing?.status ? {} : { status: 'active' }),
                        ...(existing?.classification ? {} : { classification: 'unknown' }),
                        ...baseProvenance,
                    }, { merge: true });
                }
            });
            count = entries.length;
            updatedCount = count;
        }
        else if (operationType === 'upsert_sector') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'إدارة تعريفات القطاعات (sectorPE) للمدير فقط.');
            const res = await (0, shared_1.executeUpsertSectorGovernance)(buildSectorMutationPort(), {
                rawPayload: data,
                stamp: baseProvenance,
            });
            insertedCount = res.insertedCount;
            updatedCount = res.updatedCount;
            count = res.processedCount;
            sectorReport = res.report;
        }
        else if (operationType === 'toggle_sector_status') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'تغيير حالة القطاع للمدير فقط.');
            const res = await (0, shared_1.executeToggleSectorStatusGovernance)(buildSectorMutationPort(), {
                rawPayload: data,
                stamp: baseProvenance,
            });
            insertedCount = res.insertedCount;
            updatedCount = res.updatedCount;
            count = res.processedCount;
            sectorReport = res.report;
        }
        else if (operationType === 'delete_sector') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'حذف القطاعات للمدير فقط.');
            const res = await (0, shared_1.executeDeleteSectorGovernance)(buildSectorMutationPort(), {
                rawPayload: data,
                stamp: baseProvenance,
            });
            insertedCount = res.insertedCount;
            updatedCount = res.updatedCount;
            count = res.processedCount;
            sectorReport = res.report;
        }
        else if (operationType === 'save_story') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'حفظ القصة الاستثمارية للمدير فقط.');
            const validated = (0, shared_1.validateStoryPayload)(data);
            batch.set(db.collection('stories').doc(validated.companyId), { ...validated, ...baseProvenance }, { merge: true });
            batchWriteOps += 1;
            count = 1;
            updatedCount = 1;
        }
        else if (operationType === 'delete_story') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'حذف القصة الاستثمارية للمدير فقط.');
            const rawCid = typeof companyId === 'string' && companyId.trim() && !companyId.includes('/')
                ? companyId.trim()
                : '';
            if (!rawCid)
                throw new Error('معرف الشركة غير صالح.');
            batch.delete(db.collection('stories').doc(rawCid));
            const tombS = buildTombstoneDoc('stories', rawCid, uid, rawCid.toUpperCase());
            batch.set(tombS.ref, tombS.data, { merge: true });
            batchWriteOps += 2;
            count = 1;
        }
        else if (operationType === 'save_decision') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'حفظ قرار الاستثمار للمدير فقط.');
            const validated = (0, shared_1.validateDecisionPayload)(data);
            batch.set(db.collection('decisions').doc(validated.companyId), { ...validated, ...baseProvenance }, { merge: true });
            batchWriteOps += 1;
            count = 1;
            updatedCount = 1;
        }
        else if (operationType === 'delete_decision') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'حذف قرار الاستثمار للمدير فقط.');
            const rawCid = typeof companyId === 'string' && companyId.trim() && !companyId.includes('/')
                ? companyId.trim()
                : '';
            if (!rawCid)
                throw new Error('معرف الشركة غير صالح.');
            batch.delete(db.collection('decisions').doc(rawCid));
            const tombDec = buildTombstoneDoc('decisions', rawCid, uid, rawCid.toUpperCase());
            batch.set(tombDec.ref, tombDec.data, { merge: true });
            batchWriteOps += 2;
            count = 1;
        }
        else if (operationType === 'save_trade') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'تعديل سجل الصفقات للمدير فقط.');
            const validated = (0, shared_1.validateTradePayload)(data);
            batch.set(db.collection('trades').doc(validated.id), { ...validated, ...baseProvenance }, { merge: true });
            batchWriteOps += 1;
            count = 1;
            updatedCount = 1;
        }
        else if (operationType === 'bulk_trades') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'تعديل سجل الصفقات للمدير فقط.');
            const rawArr = Array.isArray(data) ? data : [];
            if (rawArr.length > 300)
                throw new Error('أرسل 300 صفقة بحد أقصى في الطلب الواحد.');
            for (const item of rawArr) {
                const validated = (0, shared_1.validateTradePayload)(item);
                batch.set(db.collection('trades').doc(validated.id), { ...validated, ...baseProvenance }, { merge: true });
                batchWriteOps += 1;
            }
            count = rawArr.length;
            updatedCount = count;
        }
        else if (operationType === 'delete_trade') {
            if (!admin)
                throw new https_1.HttpsError('permission-denied', 'حذف الصفقة للمدير فقط.');
            const rawId = typeof id === 'string' && id.trim() && !id.includes('/') ? id.trim() : '';
            if (!rawId)
                throw new Error('معرف الصفقة غير صالح.');
            batch.delete(db.collection('trades').doc(rawId));
            const tombTr = buildTombstoneDoc('trades', rawId, uid, null);
            batch.set(tombTr.ref, tombTr.data, { merge: true });
            batchWriteOps += 2;
            count = 1;
        }
        else if (operationType === 'real_estate_disclosure') {
            (0, shared_1.parseRealEstateDisclosureSaveRequest)(data);
            atomicRealEstateDisclosureTx = { rawPayload: data };
            count = 1;
        }
        else {
            throw new Error('نوع العملية غير صالح.');
        }
        if (importMeta?.importId &&
            !useTransactionForSingleQuarter &&
            !atomicBulkQuarterlyTx &&
            !atomicDividendTx &&
            !atomicParameterTx &&
            !atomicRealEstateDisclosureTx) {
            const logId = `${importMeta.importId}_c${importMeta.chunkIndex ?? 0}`.slice(0, 120);
            batch.set(db.collection('import_batches').doc(logId), {
                importId: importMeta.importId,
                chunkIndex: importMeta.chunkIndex ?? 0,
                operationType,
                sourceFile: baseProvenance.sourceFile,
                sourceSheet: baseProvenance.sourceSheet,
                processedCount: count,
                insertedCount,
                updatedCount,
                skippedUnchangedCount,
                updatedBy: uid,
                createdAt: now,
                serverUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            batchWriteOps += 1;
        }
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        if (err instanceof shared_1.RealEstateDisclosureValidationError) {
            throw new https_1.HttpsError('invalid-argument', err.message);
        }
        if (err instanceof shared_1.RealEstateDisclosureConcurrencyConflictError) {
            throw new https_1.HttpsError('failed-precondition', err.message, {
                code: 'real-estate-disclosure-conflict',
                conflict: err.conflict,
            });
        }
        if (err instanceof shared_1.ParameterConcurrencyConflictError) {
            throw new https_1.HttpsError('failed-precondition', err.message, {
                code: 'parameter-concurrency-conflict',
                conflicts: err.conflicts,
            });
        }
        if (err instanceof shared_1.SectorGovernanceConflictError) {
            throw new https_1.HttpsError('failed-precondition', err.message);
        }
        if (err instanceof shared_1.SectorGovernanceNotFoundError) {
            throw new https_1.HttpsError('not-found', err.message);
        }
        throw new https_1.HttpsError('invalid-argument', err instanceof Error ? err.message : 'بيانات غير صالحة.');
    }
    try {
        if (useTransactionForSingleQuarter && validatedSingleQuarter) {
            const txResult = await db.runTransaction(async (tx) => (0, shared_1.applyStockAndQuarterAtomicWrite)((0, shared_1.createAdminStockQuarterTxTarget)(db, tx), {
                record: validatedSingleQuarter,
                companyMetadata,
                stamp: baseProvenance,
            }));
            insertedCount = txResult.insertedCount;
            updatedCount = txResult.updatedCount;
            skippedUnchangedCount = txResult.skippedUnchangedCount;
        }
        else if (atomicBulkQuarterlyTx) {
            const txResult = await (0, shared_1.executeBulkQuarterlyTransaction)((0, shared_1.createFirestoreAdminBulkQuarterlyTransactionPort)(db), {
                rawRecords: atomicBulkQuarterlyTx.rawRecords,
                maxBatch: atomicBulkQuarterlyTx.maxBatch,
                stamp: baseProvenance,
                importBatchLog: importMeta?.importId
                    ? {
                        logId: `${importMeta.importId}_c${importMeta.chunkIndex ?? 0}`.slice(0, 120),
                        data: {
                            importId: importMeta.importId,
                            chunkIndex: importMeta.chunkIndex ?? 0,
                            operationType,
                            sourceFile: baseProvenance.sourceFile,
                            sourceSheet: baseProvenance.sourceSheet,
                            updatedBy: uid,
                            createdAt: now,
                            serverUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
                        },
                    }
                    : null,
            });
            count = txResult.count;
            insertedCount = txResult.insertedCount;
            updatedCount = txResult.updatedCount;
            skippedUnchangedCount = txResult.skippedUnchangedCount;
        }
        else if (atomicDividendTx) {
            const buildTxTarget = (tx) => ({
                getDoc: async (col, docId) => {
                    const snap = await tx.get(db.collection(col).doc(docId));
                    return snap.exists ? snap.data() : undefined;
                },
                getActiveDividendsForYear: async (tk, fy) => {
                    const divSnap = await tx.get(db
                        .collection('dividend_records')
                        .where('ticker', '==', tk)
                        .where('fiscalYear', '==', fy));
                    return divSnap.docs.map((d) => d.data());
                },
                setDoc: (col, docId, payload, merge) => {
                    tx.set(db.collection(col).doc(docId), payload, { merge });
                },
            });
            const txResult = await db.runTransaction(async (tx) => {
                const target = buildTxTarget(tx);
                if (atomicDividendTx.kind === 'dividends') {
                    const draftSummary = await (0, shared_1.applyDividendRecordsAtomicTx)(target, {
                        records: atomicDividendTx.records,
                        sourceRows: atomicDividendTx.sourceRows,
                        stamp: baseProvenance,
                        operationType: atomicDividendTx.operationType,
                        importBatchLog: importMeta?.importId
                            ? {
                                logId: `${importMeta.importId}_c${importMeta.chunkIndex ?? 0}`.slice(0, 120),
                                data: {
                                    importId: importMeta.importId,
                                    chunkIndex: importMeta.chunkIndex ?? 0,
                                    operationType,
                                    sourceFile: baseProvenance.sourceFile,
                                    sourceSheet: baseProvenance.sourceSheet,
                                    processedCount: atomicDividendTx.records.length,
                                    updatedBy: uid,
                                    createdAt: now,
                                    serverUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
                                },
                            }
                            : null,
                    });
                    return draftSummary;
                }
                return (0, shared_1.applyDividendYearStatusAtomicTx)(target, {
                    validated: atomicDividendTx.validated,
                    stamp: baseProvenance,
                    importBatchLog: importMeta?.importId
                        ? {
                            logId: `${importMeta.importId}_c${importMeta.chunkIndex ?? 0}`.slice(0, 120),
                            data: {
                                importId: importMeta.importId,
                                chunkIndex: importMeta.chunkIndex ?? 0,
                                operationType,
                                sourceFile: baseProvenance.sourceFile,
                                sourceSheet: baseProvenance.sourceSheet,
                                processedCount: 1,
                                updatedBy: uid,
                                createdAt: now,
                                serverUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
                            },
                        }
                        : null,
                });
            });
            count = txResult.count;
            insertedCount = txResult.insertedCount;
            updatedCount = txResult.updatedCount;
            skippedUnchangedCount = txResult.skippedUnchangedCount;
        }
        else if (atomicParameterTx) {
            const txResult = await (0, shared_1.executeAtomicParameterWrites)((0, shared_1.createFirestoreAdminParameterTransactionPort)(db), {
                rawInputs: atomicParameterTx.rawInputs,
                provenance: baseProvenance,
                maxBatch: atomicParameterTx.maxBatch,
                importBatchLog: importMeta?.importId
                    ? {
                        logId: `${importMeta.importId}_c${importMeta.chunkIndex ?? 0}`.slice(0, 120),
                        data: {
                            importId: importMeta.importId,
                            chunkIndex: importMeta.chunkIndex ?? 0,
                            operationType,
                            sourceFile: baseProvenance.sourceFile,
                            sourceSheet: baseProvenance.sourceSheet,
                            updatedBy: uid,
                            createdAt: now,
                            serverUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
                        },
                    }
                    : null,
            });
            count = txResult.count;
            insertedCount = txResult.insertedCount;
            updatedCount = txResult.updatedCount;
            skippedUnchangedCount = txResult.skippedUnchangedCount;
            savedParameters = txResult.savedParameters;
        }
        else if (atomicRealEstateDisclosureTx) {
            const receipt = await (0, shared_1.executeSaveRealEstateDisclosure)((0, shared_1.createFirestoreAdminRealEstateDisclosureTransactionPort)(db), {
                rawPayload: atomicRealEstateDisclosureTx.rawPayload,
                provenance: baseProvenance,
            });
            count = 1;
            insertedCount = receipt.status === 'created' ? 1 : 0;
            updatedCount = receipt.status === 'updated' ? 1 : 0;
            skippedUnchangedCount = receipt.status === 'unchanged' ? 1 : 0;
            realEstateDisclosureReceipt = receipt;
        }
        else if (batchWriteOps > 0) {
            await batch.commit();
        }
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        if (err instanceof shared_1.QuarterlyValidationError || err instanceof shared_1.RealEstateDisclosureValidationError) {
            throw new https_1.HttpsError('invalid-argument', err.message);
        }
        if (err instanceof shared_1.RealEstateDisclosureConcurrencyConflictError) {
            throw new https_1.HttpsError('failed-precondition', err.message, {
                code: 'real-estate-disclosure-conflict',
                conflict: err.conflict,
            });
        }
        if (err instanceof shared_1.ParameterConcurrencyConflictError) {
            throw new https_1.HttpsError('failed-precondition', err.message, {
                code: 'parameter-concurrency-conflict',
                conflicts: err.conflicts,
            });
        }
        if (err instanceof shared_1.DividendGovernanceConflictError || err instanceof shared_1.SectorGovernanceConflictError) {
            throw new https_1.HttpsError('failed-precondition', err.message);
        }
        if (err instanceof shared_1.SectorGovernanceNotFoundError) {
            throw new https_1.HttpsError('not-found', err.message);
        }
        const errMsg = err instanceof Error ? err.message : '';
        console.error('Financial write failed', err);
        throw new https_1.HttpsError('internal', errMsg ? `تعذر الحفظ؛ لم يتم تأكيد العملية: ${errMsg}` : 'تعذر الحفظ؛ لم يتم تأكيد العملية.');
    }
    return {
        success: true,
        processedCount: count,
        insertedCount,
        updatedCount,
        skippedUnchangedCount,
        ...(savedParameters ? { savedParameters } : {}),
        ...(sectorReport ? { sectorReport } : {}),
        ...(realEstateDisclosureReceipt ? { realEstateDisclosureReceipt } : {}),
        updatedAt: now,
        serverEpochMs: firestore_1.Timestamp.now().toMillis(),
    };
});
//# sourceMappingURL=index.js.map