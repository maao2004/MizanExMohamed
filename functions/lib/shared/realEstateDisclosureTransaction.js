"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production transactional executor for single-record server save/update of
 * Documented Real Estate Disclosures (`real_estate_disclosures`).
 *
 * Architecture & Security Guarantees:
 * - Shared between Cloud Functions (`updateFinancialData` with `operationType: 'real_estate_disclosure'`)
 *   and real Firestore Emulator / unit tests via a clean `RealEstateDisclosureTransactionPort`.
 * - Strictly allow-lists only raw input fields from `RealEstateDisclosureInput`; NEVER trusts
 *   client-supplied derived values (`linkedQuarterlyDocId`, `completenessStatus`, `revision`,
 *   `contentHash`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `serverUpdatedAt`, `isDeleted`).
 * - Executes existence check, optimistic concurrency check (`create` vs `update`, `expectedDocId`,
 *   `expectedRevision`, `expectedContentHash`), read-only linkage verification against `companies`
 *   and `quarterly_financial_records`, and canonical document write INSIDE a single Firestore transaction.
 * - NEVER auto-creates missing `companies` or `quarterly_financial_records` documents.
 * - NEVER assumes an undocumented fiscal year start or statement scope on `quarterly_financial_records`.
 * - Performs ZERO Firestore writes (`wroteToDatabase: false`, `status: 'unchanged'`) when the canonical
 *   business hash matches the existing active record after preconditions succeed.
 * - Rejects identity mutation during `update` (`IDENTITY_MISMATCH`) rather than silently creating a new doc.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealEstateDisclosureConcurrencyConflictError = exports.RealEstateDisclosureValidationError = exports.COMPANIES_COLLECTION = void 0;
exports.createFirestoreAdminRealEstateDisclosureTransactionPort = createFirestoreAdminRealEstateDisclosureTransactionPort;
exports.getRealEstateDisclosureDocPath = getRealEstateDisclosureDocPath;
exports.extractRealEstateDisclosureRevision = extractRealEstateDisclosureRevision;
exports.computeExistingRealEstateDisclosureHash = computeExistingRealEstateDisclosureHash;
exports.extractAllowListedRealEstateDisclosureInput = extractAllowListedRealEstateDisclosureInput;
exports.parseRealEstateDisclosureSaveRequest = parseRealEstateDisclosureSaveRequest;
exports.evaluateRealEstateDisclosureLinkage = evaluateRealEstateDisclosureLinkage;
exports.executeSaveRealEstateDisclosure = executeSaveRealEstateDisclosure;
const hashing_1 = require("./hashing");
const normalization_1 = require("./normalization");
const realEstateDisclosures_1 = require("./realEstateDisclosures");
exports.COMPANIES_COLLECTION = 'companies';
class RealEstateDisclosureValidationError extends Error {
    code = 'invalid-argument';
    constructor(message) {
        super(message);
        this.name = 'RealEstateDisclosureValidationError';
    }
}
exports.RealEstateDisclosureValidationError = RealEstateDisclosureValidationError;
class RealEstateDisclosureConcurrencyConflictError extends Error {
    code = 'failed-precondition';
    conflict;
    constructor(conflict) {
        super(conflict.messageAr);
        this.name = 'RealEstateDisclosureConcurrencyConflictError';
        this.conflict = conflict;
    }
}
exports.RealEstateDisclosureConcurrencyConflictError = RealEstateDisclosureConcurrencyConflictError;
function createFirestoreAdminRealEstateDisclosureTransactionPort(db) {
    return {
        runTransaction: async (fn) => db.runTransaction(async (tx) => {
            const txCtx = {
                getDocumentByPath: async (docPath) => {
                    const snap = await tx.get(db.doc(docPath));
                    return snap.exists ? snap.data() : undefined;
                },
                setDocumentByPath: (docPath, data, merge) => {
                    if (merge) {
                        tx.set(db.doc(docPath), data, { merge: true });
                    }
                    else {
                        tx.set(db.doc(docPath), data, { merge: false });
                    }
                },
            };
            return fn(txCtx);
        }),
    };
}
function getRealEstateDisclosureDocPath(docId) {
    return `${realEstateDisclosures_1.REAL_ESTATE_DISCLOSURES_COLLECTION}/${docId}`;
}
function extractRealEstateDisclosureRevision(doc) {
    if (!doc)
        return 0;
    const rev = doc.revision;
    return typeof rev === 'number' && Number.isInteger(rev) && rev >= 0 ? rev : 0;
}
function computeExistingRealEstateDisclosureHash(existingData) {
    if (!existingData || existingData.isDeleted === true)
        return null;
    if (typeof existingData.contentHash === 'string' && existingData.contentHash.startsWith('mzh1_')) {
        return existingData.contentHash;
    }
    return (0, hashing_1.computeRecordBusinessHash)('real_estate_disclosure', existingData);
}
/**
 * Strictly picks ONLY the 20 raw client-inputtable fields of `RealEstateDisclosureInput`.
 * Guarantees that client-forged derived fields (`linkedQuarterlyDocId`, `completenessStatus`,
 * `revision`, `contentHash`, `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `serverUpdatedAt`,
 * `isDeleted`, `schemaVersion`, etc.) are NEVER trusted or passed through.
 */
function extractAllowListedRealEstateDisclosureInput(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new RealEstateDisclosureValidationError('بيانات سجل الإفصاح العقاري (record) مطلوبة ككائن صالح.');
    }
    const src = raw;
    return {
        disclosureId: src.disclosureId,
        ticker: src.ticker,
        fiscalYear: src.fiscalYear,
        fiscalQuarter: src.fiscalQuarter,
        balanceSheetDate: src.balanceSheetDate,
        statementScope: src.statementScope,
        assetCategory: src.assetCategory,
        assetUsageDescription: src.assetUsageDescription,
        accountingPolicy: src.accountingPolicy,
        aggregationLevel: src.aggregationLevel,
        parentDisclosureId: src.parentDisclosureId,
        carryingValue: src.carryingValue,
        disclosedFairValue: src.disclosedFairValue,
        fairValueDate: src.fairValueDate,
        fairValueStatementScope: src.fairValueStatementScope,
        fairValueAssetScopeMatchesCarrying: src.fairValueAssetScopeMatchesCarrying,
        fairValueSource: src.fairValueSource,
        fairValueSourceType: src.fairValueSourceType,
        footnoteReference: src.footnoteReference,
        explanatoryNote: src.explanatoryNote,
    };
}
/**
 * Parses and validates the single-record save request envelope `{ record, precondition }`.
 * On `mode: "update"`, `expectedDocId` is MANDATORY and represents the original document ID
 * read by the client before editing — NEVER inferred from the edited record payload.
 */
function parseRealEstateDisclosureSaveRequest(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
        throw new RealEstateDisclosureValidationError('حمولة حفظ الإفصاح العقاري يجب أن تكون كائناً يحتوي على record وprecondition.');
    }
    const payload = rawPayload;
    const record = extractAllowListedRealEstateDisclosureInput(payload.record);
    const rawPre = payload.precondition;
    if (!rawPre || typeof rawPre !== 'object' || Array.isArray(rawPre)) {
        throw new RealEstateDisclosureConcurrencyConflictError({
            docId: '',
            docPath: '',
            reason: 'MISSING_PRECONDITION',
            expectedDocId: null,
            expectedRevision: null,
            serverRevision: null,
            expectedContentHash: null,
            serverContentHash: null,
            serverUpdatedAt: null,
            serverUpdatedBy: null,
            messageAr: 'مرفوض: شرط التزامن (precondition) إلزامي عند حفظ الإفصاح العقاري؛ حدّد mode="create" أو mode="update" مع expectedDocId ونسخة أساس صالحة.',
        });
    }
    const preObj = rawPre;
    const mode = preObj.mode;
    if (mode !== 'create' && mode !== 'update') {
        throw new RealEstateDisclosureConcurrencyConflictError({
            docId: '',
            docPath: '',
            reason: 'MISSING_PRECONDITION',
            expectedDocId: null,
            expectedRevision: null,
            serverRevision: null,
            expectedContentHash: null,
            serverContentHash: null,
            serverUpdatedAt: null,
            serverUpdatedBy: null,
            messageAr: 'مرفوض: قيمة precondition.mode غير صالحة؛ القيم المعتمدة هي "create" أو "update" فقط.',
        });
    }
    let expectedDocId = null;
    if (preObj.expectedDocId !== undefined && preObj.expectedDocId !== null) {
        if (typeof preObj.expectedDocId !== 'string') {
            throw new RealEstateDisclosureValidationError('قيمة precondition.expectedDocId غير صالحة؛ يجب أن تكون نصاً صريحاً لمعرّف السجل الأصلي.');
        }
        const trimmedDocId = preObj.expectedDocId.trim();
        if (trimmedDocId !== '') {
            if (/\s/.test(trimmedDocId) ||
                trimmedDocId.includes('/') ||
                trimmedDocId.includes('\\') ||
                trimmedDocId.includes('..')) {
                throw new RealEstateDisclosureValidationError('قيمة precondition.expectedDocId غير صالحة؛ لا يُسمح بمسافات أو / أو \\ أو ..');
            }
            expectedDocId = trimmedDocId;
        }
    }
    let expectedRevision = null;
    if (preObj.expectedRevision !== undefined && preObj.expectedRevision !== null) {
        if (typeof preObj.expectedRevision !== 'number' ||
            !Number.isInteger(preObj.expectedRevision) ||
            preObj.expectedRevision < 1) {
            throw new RealEstateDisclosureValidationError('قيمة precondition.expectedRevision يجب أن تكون عدداً صحيحاً موجباً (>= 1).');
        }
        expectedRevision = preObj.expectedRevision;
    }
    let expectedContentHash = null;
    if (preObj.expectedContentHash !== undefined && preObj.expectedContentHash !== null) {
        if (typeof preObj.expectedContentHash !== 'string' ||
            preObj.expectedContentHash.trim() === '') {
            throw new RealEstateDisclosureValidationError('قيمة precondition.expectedContentHash غير صالحة.');
        }
        expectedContentHash = preObj.expectedContentHash.trim();
    }
    if (mode === 'update') {
        if (!expectedDocId) {
            throw new RealEstateDisclosureConcurrencyConflictError({
                docId: '',
                docPath: '',
                reason: 'INCOMPLETE_PRECONDITION',
                expectedDocId: null,
                expectedRevision,
                serverRevision: null,
                expectedContentHash,
                serverContentHash: null,
                serverUpdatedAt: null,
                serverUpdatedBy: null,
                messageAr: 'مرفوض: معرّف السجل الأصلي precondition.expectedDocId إلزامي عند التحديث (mode="update") ولا يُستنتج من البيانات المعدّلة، لمنع تحويل تعديل سجل إلى سجل آخر.',
            });
        }
        return {
            record,
            precondition: {
                mode: 'update',
                expectedDocId,
                expectedRevision,
                expectedContentHash,
            },
        };
    }
    return {
        record,
        precondition: {
            mode: 'create',
            expectedDocId,
            expectedRevision: null,
            expectedContentHash: null,
        },
    };
}
const ALLOWED_LINKED_QUARTERS = new Set(['Q1', 'Q2', 'Q3', 'FY']);
/**
 * Pure read-only linkage evaluator separating document existence from identity validity
 * and match across `companies` and `quarterly_financial_records`.
 *
 * Guarantees:
 * - Missing or invalid identity fields NEVER produce `verified`.
 * - Explicit mismatches in ticker, fiscalYear, fiscalQuarter, or calendar date produce clear `conflict` states.
 * - Supports documented non-calendar fiscal years without assuming any fiscal year start or period end.
 * - NEVER auto-creates or mutates `companies` or `quarterly_financial_records`.
 */
function evaluateRealEstateDisclosureLinkage(params) {
    const { record, companyDoc, quarterlyDoc } = params;
    const companyDocId = record.ticker.toLowerCase();
    const companyDocPath = `${exports.COMPANIES_COLLECTION}/${companyDocId}`;
    const companyExists = Boolean(companyDoc && companyDoc.isDeleted !== true);
    const warningsAr = [];
    // 1) Company document existence vs identity validity & match
    let companyTicker = null;
    let companyLinkStatus;
    if (!companyExists) {
        companyLinkStatus = 'missing_company';
        warningsAr.push(`الشركة (${record.ticker}) غير موجودة في مجموعة ${exports.COMPANIES_COLLECTION} (${companyDocPath})؛ لم يتم إنشاؤها تلقائياً.`);
    }
    else {
        const rawCompanyTicker = companyDoc?.ticker;
        const cleanedCompanyTicker = (0, normalization_1.parseCleanText)(rawCompanyTicker);
        if (cleanedCompanyTicker === null) {
            companyLinkStatus = 'unverified_company_identity';
            warningsAr.push(`وثيقة الشركة (${companyDocPath}) موجودة، لكنها تفتقد حقل رمز السهم (ticker)؛ تعذر تأكيد تطابق هوية الشركة.`);
        }
        else {
            const normalizedCompanyTk = (0, normalization_1.tryNormalizedTicker)(cleanedCompanyTicker);
            if (normalizedCompanyTk === null) {
                companyLinkStatus = 'unverified_company_identity';
                warningsAr.push(`وثيقة الشركة (${companyDocPath}) موجودة، لكن رمز السهم المخزن بها (${cleanedCompanyTicker}) غير صالح؛ تعذر تأكيد تطابق هوية الشركة.`);
            }
            else {
                companyTicker = normalizedCompanyTk;
                const rawCompanyDocIdField = (0, normalization_1.parseCleanText)(companyDoc?.id);
                const docIdFieldMismatch = rawCompanyDocIdField !== null && rawCompanyDocIdField.toLowerCase() !== companyDocId;
                if (normalizedCompanyTk !== record.ticker || docIdFieldMismatch) {
                    companyLinkStatus = 'company_ticker_conflict';
                    if (normalizedCompanyTk !== record.ticker) {
                        warningsAr.push(`تعارض رمز السهم في وثيقة الشركة (${companyDocPath}): الوثيقة تحمل (${normalizedCompanyTk}) بينما الإفصاح يحمل (${record.ticker}).`);
                    }
                    if (docIdFieldMismatch) {
                        warningsAr.push(`تعارض معرّف الشركة في (${companyDocPath}): حقل id (${rawCompanyDocIdField}) لا يطابق المعرّف المتوقع (${companyDocId}).`);
                    }
                }
                else {
                    companyLinkStatus = 'verified';
                }
            }
        }
    }
    // 2) Quarterly record existence vs identity (ticker/year/quarter) validity & date match
    const logicalQuarterlyDocId = record.linkedQuarterlyDocId;
    const hasLogicalQuarterlyReference = logicalQuarterlyDocId !== null;
    const quarterlyDocPath = hasLogicalQuarterlyReference
        ? `${realEstateDisclosures_1.QUARTERLY_FINANCIAL_RECORDS_COLLECTION}/${logicalQuarterlyDocId}`
        : null;
    const quarterlyRecordExists = Boolean(hasLogicalQuarterlyReference && quarterlyDoc && quarterlyDoc.isDeleted !== true);
    let quarterlyTicker = null;
    let quarterlyYear = null;
    let quarterlyQuarter = null;
    let quarterlyPeriodEndDate = null;
    let quarterlyLinkStatus;
    if (!hasLogicalQuarterlyReference) {
        quarterlyLinkStatus = 'not_linked_period';
        warningsAr.push(`لا يوجد مرجع فصلي منطقي (fiscalYear + fiscalQuarter) لهذا الإفصاح؛ تم حفظه استناداً إلى تاريخ المركز المالي (${record.balanceSheetDate}) فقط دون افتراض بداية سنة مالية.`);
    }
    else if (!quarterlyRecordExists) {
        quarterlyLinkStatus = 'missing_quarterly_record';
        warningsAr.push(`السجل المالي المرتبط (${logicalQuarterlyDocId}) غير موجود في مجموعة ${realEstateDisclosures_1.QUARTERLY_FINANCIAL_RECORDS_COLLECTION}؛ لم يتم إنشاؤه تلقائياً.`);
    }
    else {
        let hasTickerConflict = false;
        let hasPeriodConflict = false;
        const identityUnverifiedReasons = [];
        // 2a) Check ticker on quarterly record
        const rawQtrTicker = quarterlyDoc?.ticker;
        const cleanedQtrTicker = (0, normalization_1.parseCleanText)(rawQtrTicker);
        if (cleanedQtrTicker === null) {
            identityUnverifiedReasons.push(`السجل المالي المرجعي (${logicalQuarterlyDocId}) يفتقد حقل رمز السهم (ticker)؛ تعذر تأكيد تطابق هويته.`);
        }
        else {
            const normalizedQtrTk = (0, normalization_1.tryNormalizedTicker)(cleanedQtrTicker);
            if (normalizedQtrTk === null) {
                identityUnverifiedReasons.push(`رمز السهم المخزن في السجل المالي المرجعي (${logicalQuarterlyDocId}) غير صالح (${cleanedQtrTicker})؛ تعذر تأكيد تطابق هويته.`);
            }
            else {
                quarterlyTicker = normalizedQtrTk;
                if (normalizedQtrTk !== record.ticker) {
                    hasTickerConflict = true;
                    warningsAr.push(`تعارض رمز السهم في السجل المالي المرجعي (${logicalQuarterlyDocId}): السجل الفصلي يحمل (${normalizedQtrTk}) بينما الإفصاح يحمل (${record.ticker}).`);
                }
            }
        }
        // 2b) Check year on quarterly record
        const rawQtrYear = quarterlyDoc?.year;
        if (rawQtrYear === undefined || rawQtrYear === null || rawQtrYear === '') {
            identityUnverifiedReasons.push(`السجل المالي المرجعي (${logicalQuarterlyDocId}) يفتقد حقل السنة المالية (year)؛ تعذر تأكيد تطابق الفترة.`);
        }
        else {
            const parsedQtrYear = typeof rawQtrYear === 'number' ? rawQtrYear : Number(String(rawQtrYear).trim());
            if (!Number.isFinite(parsedQtrYear) ||
                !Number.isInteger(parsedQtrYear) ||
                parsedQtrYear < 1900 ||
                parsedQtrYear > 2200) {
                identityUnverifiedReasons.push(`قيمة السنة المالية (year) في السجل المالي المرجعي (${logicalQuarterlyDocId}) غير صالحة (${String(rawQtrYear)})؛ تعذر تأكيد تطابق الفترة.`);
            }
            else {
                quarterlyYear = parsedQtrYear;
                if (record.fiscalYear !== null && parsedQtrYear !== record.fiscalYear) {
                    hasPeriodConflict = true;
                    warningsAr.push(`تعارض السنة المالية في السجل المالي المرجعي (${logicalQuarterlyDocId}): السجل الفصلي يحمل السنة (${parsedQtrYear}) بينما الإفصاح يحمل السنة (${record.fiscalYear}).`);
                }
            }
        }
        // 2c) Check quarter on quarterly record
        const cleanedQtrQuarter = (0, normalization_1.parseCleanText)(quarterlyDoc?.quarter);
        if (cleanedQtrQuarter === null) {
            identityUnverifiedReasons.push(`السجل المالي المرجعي (${logicalQuarterlyDocId}) يفتقد حقل الربع المالي (quarter)؛ تعذر تأكيد تطابق الفترة.`);
        }
        else {
            const upperQtr = cleanedQtrQuarter.toUpperCase();
            if (!ALLOWED_LINKED_QUARTERS.has(upperQtr)) {
                identityUnverifiedReasons.push(`قيمة الربع المالي (quarter) في السجل المالي المرجعي (${logicalQuarterlyDocId}) غير صالحة (${cleanedQtrQuarter})؛ تعذر تأكيد تطابق الفترة.`);
            }
            else {
                quarterlyQuarter = upperQtr;
                if (record.fiscalQuarter !== null && upperQtr !== record.fiscalQuarter) {
                    hasPeriodConflict = true;
                    warningsAr.push(`تعارض الربع المالي في السجل المالي المرجعي (${logicalQuarterlyDocId}): السجل الفصلي يحمل الربع (${upperQtr}) بينما الإفصاح يحمل الربع (${record.fiscalQuarter}).`);
                }
            }
        }
        // 2d) Check periodEndDate on quarterly record (calendar validity + comparison without assuming FY start)
        const rawPeriodEnd = (0, normalization_1.parseCleanText)(quarterlyDoc?.periodEndDate);
        const hasMalformedPeriodEndDate = rawPeriodEnd !== null && !(0, normalization_1.isValidCalendarDate)(rawPeriodEnd);
        if (rawPeriodEnd !== null && (0, normalization_1.isValidCalendarDate)(rawPeriodEnd)) {
            quarterlyPeriodEndDate = rawPeriodEnd;
        }
        for (const reason of identityUnverifiedReasons) {
            warningsAr.push(reason);
        }
        if (hasTickerConflict) {
            quarterlyLinkStatus = 'ticker_conflict';
        }
        else if (hasPeriodConflict) {
            quarterlyLinkStatus = 'period_conflict';
        }
        else if (identityUnverifiedReasons.length > 0) {
            quarterlyLinkStatus = 'unverified_quarterly_identity';
        }
        else if (hasMalformedPeriodEndDate) {
            quarterlyLinkStatus = 'unverified_quarterly_period_end_date';
            warningsAr.push(`تاريخ نهاية الفترة (periodEndDate) المخزن في السجل المالي المرجعي (${logicalQuarterlyDocId}) غير صالح تقويمياً (${rawPeriodEnd})؛ تعذر التحقق من تطابق التاريخ.`);
        }
        else if (record.balanceSheetDate && quarterlyPeriodEndDate) {
            if (record.balanceSheetDate === quarterlyPeriodEndDate) {
                quarterlyLinkStatus = 'verified';
            }
            else {
                quarterlyLinkStatus = 'date_conflict';
                warningsAr.push(`تعارض تاريخ المركز المالي مع السجل الفصلي (${logicalQuarterlyDocId}): تاريخ الإفصاح (${record.balanceSheetDate}) يختلف عن periodEndDate في ${realEstateDisclosures_1.QUARTERLY_FINANCIAL_RECORDS_COLLECTION} (${quarterlyPeriodEndDate}).`);
            }
        }
        else if (!record.balanceSheetDate) {
            quarterlyLinkStatus = 'verified_without_balance_sheet_date';
            warningsAr.push(`تم التحقق من هوية السجل المالي المرجعي (${logicalQuarterlyDocId}) في ${realEstateDisclosures_1.QUARTERLY_FINANCIAL_RECORDS_COLLECTION}، لكن الإفصاح لا يحتوي على balanceSheetDate للتحقق من تطابق التاريخ.`);
        }
        else {
            quarterlyLinkStatus = 'verified_without_period_end_date';
            warningsAr.push(`تم التحقق من هوية السجل المالي المرجعي (${logicalQuarterlyDocId}) في ${realEstateDisclosures_1.QUARTERLY_FINANCIAL_RECORDS_COLLECTION}، لكنه لا يحتوي على periodEndDate موثق لمطابقة تاريخ المركز المالي (${record.balanceSheetDate})؛ لم تُفترض نهاية فترة ضمنية.`);
        }
    }
    let overallLinkageStatus;
    if (companyLinkStatus === 'company_ticker_conflict' ||
        quarterlyLinkStatus === 'ticker_conflict' ||
        quarterlyLinkStatus === 'period_conflict' ||
        quarterlyLinkStatus === 'date_conflict') {
        overallLinkageStatus = 'conflict';
    }
    else if (companyLinkStatus === 'missing_company' ||
        quarterlyLinkStatus === 'missing_quarterly_record') {
        overallLinkageStatus = 'missing_reference';
    }
    else if (companyLinkStatus === 'verified' && quarterlyLinkStatus === 'verified') {
        overallLinkageStatus = 'verified';
    }
    else {
        overallLinkageStatus = 'partial_unverified';
    }
    return {
        hasLogicalQuarterlyReference,
        logicalQuarterlyDocId,
        companyDocId,
        companyDocPath,
        companyExists,
        companyTicker,
        companyLinkStatus,
        quarterlyDocPath,
        quarterlyRecordExists,
        quarterlyTicker,
        quarterlyYear,
        quarterlyQuarter,
        quarterlyLinkStatus,
        quarterlyPeriodEndDate,
        disclosureBalanceSheetDate: record.balanceSheetDate,
        overallLinkageStatus,
        warningsAr,
    };
}
/**
 * Executes a single-record authoritative transactional save/update for `real_estate_disclosures`.
 *
 * Used identically by Cloud Functions (`updateFinancialData` with `operationType: 'real_estate_disclosure'`)
 * and tested directly against both real Firestore Emulator and deterministic unit ports.
 */
async function executeSaveRealEstateDisclosure(port, params) {
    const { record: rawInput, precondition } = parseRealEstateDisclosureSaveRequest(params.rawPayload);
    let normalizedRecord;
    let docId;
    try {
        normalizedRecord = (0, realEstateDisclosures_1.validateAndNormalizeRealEstateDisclosure)(rawInput);
        docId = (0, realEstateDisclosures_1.buildRealEstateDisclosureDocId)({
            ticker: normalizedRecord.ticker,
            fiscalYear: normalizedRecord.fiscalYear,
            fiscalQuarter: normalizedRecord.fiscalQuarter,
            balanceSheetDate: normalizedRecord.balanceSheetDate,
            statementScope: normalizedRecord.statementScope,
            disclosureId: normalizedRecord.disclosureId,
        });
    }
    catch (err) {
        if (err instanceof RealEstateDisclosureValidationError)
            throw err;
        throw new RealEstateDisclosureValidationError(err instanceof Error ? err.message : 'فشل التحقق من صحة سجل الإفصاح العقاري.');
    }
    const docPath = getRealEstateDisclosureDocPath(docId);
    const contentHash = (0, hashing_1.computeRecordBusinessHash)('real_estate_disclosure', normalizedRecord);
    const statusBreakdown = (0, realEstateDisclosures_1.deriveRealEstateDisclosureStatusBreakdown)(normalizedRecord);
    // Guard 1: Enforce mandatory expectedDocId on update + match expectedDocId against derived docId BEFORE any write
    if (precondition.mode === 'update' && !precondition.expectedDocId) {
        throw new RealEstateDisclosureConcurrencyConflictError({
            docId,
            docPath,
            reason: 'INCOMPLETE_PRECONDITION',
            expectedDocId: null,
            expectedRevision: precondition.expectedRevision ?? null,
            serverRevision: null,
            expectedContentHash: precondition.expectedContentHash ?? null,
            serverContentHash: null,
            serverUpdatedAt: null,
            serverUpdatedBy: null,
            messageAr: 'مرفوض: معرّف السجل الأصلي precondition.expectedDocId إلزامي عند التحديث (mode="update") ولا يُستنتج من البيانات المعدّلة.',
        });
    }
    if (precondition.expectedDocId && precondition.expectedDocId !== docId) {
        throw new RealEstateDisclosureConcurrencyConflictError({
            docId,
            docPath,
            reason: 'IDENTITY_MISMATCH',
            expectedDocId: precondition.expectedDocId,
            expectedRevision: precondition.expectedRevision ?? null,
            serverRevision: null,
            expectedContentHash: precondition.expectedContentHash ?? null,
            serverContentHash: null,
            serverUpdatedAt: null,
            serverUpdatedBy: null,
            messageAr: `تعارض هوية المستند عند التحديث: معرّف السجل الأصلي (${precondition.expectedDocId}) لا يطابق المعرّف المشتق من البيانات المدخلة (${docId})؛ لا يُسمح بتغيير هوية السجل (السهم/الفترة/النطاق/معرّف الإفصاح) أثناء التحديث.`,
        });
    }
    // Guard 2: Update MUST carry at least expectedRevision or expectedContentHash alongside mandatory expectedDocId
    if (precondition.mode === 'update' &&
        precondition.expectedRevision === null &&
        precondition.expectedContentHash === null) {
        throw new RealEstateDisclosureConcurrencyConflictError({
            docId,
            docPath,
            reason: 'INCOMPLETE_PRECONDITION',
            expectedDocId: precondition.expectedDocId,
            expectedRevision: null,
            serverRevision: null,
            expectedContentHash: null,
            serverContentHash: null,
            serverUpdatedAt: null,
            serverUpdatedBy: null,
            messageAr: `مرفوض: شرط التحديث المتزامن للإفصاح (${docId}) ناقص؛ يتطلب expectedRevision أو expectedContentHash صالحاً إلى جانب expectedDocId ولا يُستنتج من الخادم.`,
        });
    }
    const companyDocPath = `${exports.COMPANIES_COLLECTION}/${normalizedRecord.ticker.toLowerCase()}`;
    const quarterlyDocPath = normalizedRecord.linkedQuarterlyDocId
        ? `${realEstateDisclosures_1.QUARTERLY_FINANCIAL_RECORDS_COLLECTION}/${normalizedRecord.linkedQuarterlyDocId}`
        : null;
    return port.runTransaction(async (txCtx) => {
        // Phase 1: Read target disclosure + linked company + optional linked quarterly record INSIDE the transaction
        const [existingDoc, companyDoc, quarterlyDoc] = await Promise.all([
            txCtx.getDocumentByPath(docPath),
            txCtx.getDocumentByPath(companyDocPath),
            quarterlyDocPath ? txCtx.getDocumentByPath(quarterlyDocPath) : Promise.resolve(undefined),
        ]);
        const linkage = evaluateRealEstateDisclosureLinkage({
            record: normalizedRecord,
            companyDoc,
            quarterlyDoc,
        });
        const isPresent = Boolean(existingDoc && existingDoc.isDeleted !== true);
        const serverRevision = isPresent ? extractRealEstateDisclosureRevision(existingDoc) : null;
        const serverContentHash = isPresent ? computeExistingRealEstateDisclosureHash(existingDoc) : null;
        const serverUpdatedAt = isPresent && typeof existingDoc?.updatedAt === 'string' ? existingDoc.updatedAt : null;
        const serverUpdatedBy = isPresent && typeof existingDoc?.updatedBy === 'string' ? existingDoc.updatedBy : null;
        // Phase 2: Enforce optimistic concurrency & idempotency strictly BEFORE any write
        if (precondition.mode === 'create') {
            if (isPresent) {
                if (serverContentHash === contentHash) {
                    // Safe idempotent retry of create with identical canonical content -> ZERO writes
                    const existingCreatedAt = typeof existingDoc?.createdAt === 'string' && existingDoc.createdAt
                        ? existingDoc.createdAt
                        : serverUpdatedAt ?? params.provenance.updatedAt;
                    const existingCreatedBy = typeof existingDoc?.createdBy === 'string' && existingDoc.createdBy
                        ? existingDoc.createdBy
                        : serverUpdatedBy ?? params.provenance.updatedBy;
                    return {
                        status: 'unchanged',
                        collection: realEstateDisclosures_1.REAL_ESTATE_DISCLOSURES_COLLECTION,
                        docId,
                        docPath,
                        revision: serverRevision ?? 1,
                        contentHash,
                        wroteToDatabase: false,
                        record: normalizedRecord,
                        statusBreakdown,
                        linkage,
                        createdAt: existingCreatedAt,
                        createdBy: existingCreatedBy,
                        updatedAt: serverUpdatedAt ?? existingCreatedAt,
                        updatedBy: serverUpdatedBy ?? existingCreatedBy,
                    };
                }
                throw new RealEstateDisclosureConcurrencyConflictError({
                    docId,
                    docPath,
                    reason: 'ALREADY_EXISTS',
                    expectedDocId: precondition.expectedDocId ?? null,
                    expectedRevision: null,
                    serverRevision,
                    expectedContentHash: null,
                    serverContentHash,
                    serverUpdatedAt,
                    serverUpdatedBy,
                    messageAr: `تعارض إنشاء: الإفصاح العقاري (${docId}) موجود بالفعل على الخادم (إصدار ${serverRevision ?? 0}) بمحتوى مختلف؛ لا يمكن استبداله عبر عملية إنشاء جديدة دون تحديث بشروط تزامن صالحة.`,
                });
            }
            // Fresh creation (or re-creation after prior soft-delete with monotonic revision)
            const priorDeletedRevision = existingDoc ? extractRealEstateDisclosureRevision(existingDoc) : 0;
            const nextRevision = priorDeletedRevision + 1;
            const createdAt = params.provenance.updatedAt;
            const createdBy = params.provenance.updatedBy;
            const persistedDoc = {
                ...normalizedRecord,
                docId,
                revision: nextRevision,
                contentHash,
                createdAt,
                createdBy,
                importId: params.provenance.importId,
                sourceFile: params.provenance.sourceFile,
                sourceSheet: params.provenance.sourceSheet,
                schemaVersion: params.provenance.schemaVersion,
                updatedBy: params.provenance.updatedBy,
                updatedAt: params.provenance.updatedAt,
                serverUpdatedAt: params.provenance.serverUpdatedAt,
                isDeleted: false,
            };
            txCtx.setDocumentByPath(docPath, persistedDoc, false);
            return {
                status: 'created',
                collection: realEstateDisclosures_1.REAL_ESTATE_DISCLOSURES_COLLECTION,
                docId,
                docPath,
                revision: nextRevision,
                contentHash,
                wroteToDatabase: true,
                record: normalizedRecord,
                statusBreakdown,
                linkage,
                createdAt,
                createdBy,
                updatedAt: params.provenance.updatedAt,
                updatedBy: params.provenance.updatedBy,
            };
        }
        // mode === 'update'
        if (!isPresent) {
            throw new RealEstateDisclosureConcurrencyConflictError({
                docId,
                docPath,
                reason: 'DELETED_ON_SERVER',
                expectedDocId: precondition.expectedDocId ?? null,
                expectedRevision: precondition.expectedRevision ?? null,
                serverRevision: null,
                expectedContentHash: precondition.expectedContentHash ?? null,
                serverContentHash: null,
                serverUpdatedAt: null,
                serverUpdatedBy: null,
                messageAr: `تعارض تحديث: الإفصاح العقاري (${docId}) غير موجود على الخادم أو تم حذفه؛ لا يُعاد إنشاؤه تلقائياً عبر عملية تحديث.`,
            });
        }
        if (precondition.expectedRevision !== null &&
            precondition.expectedRevision !== undefined &&
            serverRevision !== precondition.expectedRevision) {
            throw new RealEstateDisclosureConcurrencyConflictError({
                docId,
                docPath,
                reason: 'REVISION_MISMATCH',
                expectedDocId: precondition.expectedDocId ?? null,
                expectedRevision: precondition.expectedRevision,
                serverRevision,
                expectedContentHash: precondition.expectedContentHash ?? null,
                serverContentHash,
                serverUpdatedAt,
                serverUpdatedBy,
                messageAr: `تعارض إصدار للإفصاح العقاري (${docId}): الإصدار الأساسي المتوقع (${precondition.expectedRevision}) يختلف عن الإصدار الحالي على الخادم (${serverRevision})؛ تم تعديل السجل من جلسة أخرى.`,
            });
        }
        if (precondition.expectedContentHash !== null &&
            precondition.expectedContentHash !== undefined &&
            serverContentHash !== precondition.expectedContentHash) {
            throw new RealEstateDisclosureConcurrencyConflictError({
                docId,
                docPath,
                reason: 'HASH_MISMATCH',
                expectedDocId: precondition.expectedDocId ?? null,
                expectedRevision: precondition.expectedRevision ?? null,
                serverRevision,
                expectedContentHash: precondition.expectedContentHash,
                serverContentHash,
                serverUpdatedAt,
                serverUpdatedBy,
                messageAr: `تعارض محتوى للإفصاح العقاري (${docId}): تغيّرت النسخة المحفوظة على الخادم بعد آخر قراءة؛ أعد قراءة السجل وراجع الفروق قبل التحديث.`,
            });
        }
        const existingCreatedAt = typeof existingDoc?.createdAt === 'string' && existingDoc.createdAt
            ? existingDoc.createdAt
            : serverUpdatedAt ?? params.provenance.updatedAt;
        const existingCreatedBy = typeof existingDoc?.createdBy === 'string' && existingDoc.createdBy
            ? existingDoc.createdBy
            : serverUpdatedBy ?? params.provenance.updatedBy;
        // Preconditions verified -> check for no-op (unchanged business content -> ZERO writes)
        if (serverContentHash === contentHash) {
            return {
                status: 'unchanged',
                collection: realEstateDisclosures_1.REAL_ESTATE_DISCLOSURES_COLLECTION,
                docId,
                docPath,
                revision: serverRevision ?? 1,
                contentHash,
                wroteToDatabase: false,
                record: normalizedRecord,
                statusBreakdown,
                linkage,
                createdAt: existingCreatedAt,
                createdBy: existingCreatedBy,
                updatedAt: serverUpdatedAt ?? existingCreatedAt,
                updatedBy: serverUpdatedBy ?? existingCreatedBy,
            };
        }
        const nextRevision = (serverRevision ?? 0) + 1;
        const persistedDoc = {
            ...normalizedRecord,
            docId,
            revision: nextRevision,
            contentHash,
            createdAt: existingCreatedAt,
            createdBy: existingCreatedBy,
            importId: params.provenance.importId,
            sourceFile: params.provenance.sourceFile,
            sourceSheet: params.provenance.sourceSheet,
            schemaVersion: params.provenance.schemaVersion,
            updatedBy: params.provenance.updatedBy,
            updatedAt: params.provenance.updatedAt,
            serverUpdatedAt: params.provenance.serverUpdatedAt,
            isDeleted: false,
        };
        txCtx.setDocumentByPath(docPath, persistedDoc, false);
        return {
            status: 'updated',
            collection: realEstateDisclosures_1.REAL_ESTATE_DISCLOSURES_COLLECTION,
            docId,
            docPath,
            revision: nextRevision,
            contentHash,
            wroteToDatabase: true,
            record: normalizedRecord,
            statusBreakdown,
            linkage,
            createdAt: existingCreatedAt,
            createdBy: existingCreatedBy,
            updatedAt: params.provenance.updatedAt,
            updatedBy: params.provenance.updatedBy,
        };
    });
}
//# sourceMappingURL=realEstateDisclosureTransaction.js.map