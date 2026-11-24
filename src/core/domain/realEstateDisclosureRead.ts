/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Central Read Contract, Non-Mutating Firestore Normalizer, Delta Merger,
 * Authorization Gate, and Honest Read-Side Linkage for Documented Real Estate Disclosures
 * (`real_estate_disclosures`).
 *
 * Governance Invariants:
 * - Strictly separates read-side Firestore documents (`RealEstateDisclosureReadRecord`)
 *   from client write payloads (`RealEstateDisclosureInput`).
 * - Pure & non-mutating: NEVER writes to Firestore, NEVER corrects stored documents,
 *   and NEVER silently drops a record due to unrecognized enum codes or invalid fields.
 * - Preserves `0` vs `null`, `false` vs `true` vs `null`, full original Arabic/multiline text
 *   (no `.slice()`), `docId`, `revision`, `contentHash`, and audit timestamps/actors.
 * - Reuses central contracts (`realEstateDisclosures.ts`, `realEstateDisclosureTransaction.ts`)
 *   without duplicating identity, period, or linkage rules.
 * - Honest read-side linkage: NEVER reports `missing_company` or `missing_quarterly_record`
 *   before the corresponding source collection (`companies` / `quarterly_financial_records`)
 *   is confirmed loaded from the server; tracks the exact source snapshot version so stale
 *   linkage is always distinguishable from freshly verified linkage.
 */

import {
  buildLinkedQuarterlyDocId,
  COMPANIES_COLLECTION,
  deriveRealEstateDisclosureStatusBreakdown,
  evaluateRealEstateDisclosureLinkage,
  inspectFinancialStatementScope,
  inspectRealEstateAccountingPolicy,
  inspectRealEstateAggregationLevel,
  inspectRealEstateAssetCategory,
  inspectRealEstateDisclosureId,
  inspectRealEstateFairValueSourceType,
  isValidCalendarDate,
  QUARTERLY_FINANCIAL_RECORDS_COLLECTION,
  REAL_ESTATE_DISCLOSURES_COLLECTION,
  tryNormalizedTicker,
  type FinancialStatementScope,
  type QuarterlyRecordQuarter,
  type RealEstateAccountingPolicy,
  type RealEstateAssetCategory,
  type RealEstateCompanyLinkStatus,
  type RealEstateDisclosureAggregationLevel,
  type RealEstateDisclosureLinkageVerification,
  type RealEstateDisclosureRecord,
  type RealEstateDisclosureStatusBreakdown,
  type RealEstateFairValueSourceType,
  type RealEstateOverallLinkageStatus,
  type RealEstateQuarterlyLinkStatus,
} from '../contracts';
import type { AppUser, QuarterlyFinancialRecord } from '../../types';
import type { Company } from '../../types/financial';
import type { RealEstateDisclosureInspectableInput } from './realEstateDisclosureAnalysis';

const ALLOWED_QUARTERLY_QUARTERS = new Set<QuarterlyRecordQuarter>(['Q1', 'Q2', 'Q3', 'FY']);

export type RealEstateEnumFieldStatus = 'empty' | 'valid' | 'unrecognized';

export type RealEstateDisclosureReadIssueCode =
  | 'doc_id_mismatch'
  | 'missing_or_invalid_ticker'
  | 'missing_or_invalid_disclosure_id'
  | 'invalid_parent_disclosure_id'
  | 'invalid_fiscal_year'
  | 'unrecognized_fiscal_quarter'
  | 'partial_fiscal_period'
  | 'invalid_calendar_date'
  | 'unrecognized_enum_value'
  | 'invalid_numeric_value'
  | 'invalid_boolean_flag'
  | 'invalid_revision'
  | 'missing_or_invalid_period_anchor';

export interface RealEstateDisclosureReadIssue {
  code: RealEstateDisclosureReadIssueCode;
  field: string;
  rawValue: unknown;
  messageAr: string;
}

export interface RealEstateUnrecognizedFieldEntry {
  field: string;
  rawValue: unknown;
  messageAr: string;
}

/**
 * Canonical read-side record for a Firestore document in `real_estate_disclosures`.
 * Distinct from `RealEstateDisclosureInput` (write payload) and non-mutating.
 */
export interface RealEstateDisclosureReadRecord {
  /** Authoritative Firestore document ID (`snapshot.id`). */
  docId: string;
  /** Canonical Firestore document path (`real_estate_disclosures/${docId}`). */
  docPath: string;
  /** Raw `docId` field stored inside document data (if any), preserved for mismatch diagnosis. */
  storedDocId: string | null;

  // --- Concurrency & Audit Metadata (preserved for concurrent editing later) ---
  revision: number | null;
  contentHash: string | null;
  createdAt: string | null;
  createdBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  serverUpdatedAt: unknown;
  serverUpdatedAtMs: number;
  isDeleted: boolean;
  schemaVersion: number | null;
  importId: string | null;
  sourceFile: string | null;
  sourceSheet: string | null;

  // --- Business Fields (non-mutating, preserving 0 / null / full text / raw values) ---
  disclosureId: string | null;
  rawDisclosureId: unknown;
  ticker: string | null;
  rawTicker: unknown;
  fiscalYear: number | null;
  rawFiscalYear: unknown;
  fiscalQuarter: QuarterlyRecordQuarter | null;
  rawFiscalQuarter: unknown;
  /** Logical reference `${ticker}_${fiscalYear}_${fiscalQuarter}` derived from valid fields (never fabricated). */
  linkedQuarterlyDocId: string | null;
  storedLinkedQuarterlyDocId: string | null;
  balanceSheetDate: string | null;
  rawBalanceSheetDate: unknown;

  statementScope: FinancialStatementScope | null;
  rawStatementScope: string | null;
  statementScopeStatus: RealEstateEnumFieldStatus;

  assetCategory: RealEstateAssetCategory | null;
  rawAssetCategory: string | null;
  assetCategoryStatus: RealEstateEnumFieldStatus;

  assetUsageDescription: string | null;

  accountingPolicy: RealEstateAccountingPolicy | null;
  rawAccountingPolicy: string | null;
  accountingPolicyStatus: RealEstateEnumFieldStatus;

  aggregationLevel: RealEstateDisclosureAggregationLevel | null;
  rawAggregationLevel: string | null;
  aggregationLevelStatus: RealEstateEnumFieldStatus;

  parentDisclosureId: string | null;
  rawParentDisclosureId: unknown;

  carryingValue: number | null;
  rawCarryingValue: unknown;
  disclosedFairValue: number | null;
  rawDisclosedFairValue: unknown;

  fairValueDate: string | null;
  rawFairValueDate: unknown;

  fairValueStatementScope: FinancialStatementScope | null;
  rawFairValueStatementScope: string | null;
  fairValueStatementScopeStatus: RealEstateEnumFieldStatus;

  fairValueAssetScopeMatchesCarrying: boolean | null;
  rawFairValueAssetScopeMatchesCarrying: unknown;

  fairValueSource: string | null;

  fairValueSourceType: RealEstateFairValueSourceType | null;
  rawFairValueSourceType: string | null;
  fairValueSourceTypeStatus: RealEstateEnumFieldStatus;

  footnoteReference: string | null;
  explanatoryNote: string | null;

  storedCompletenessStatus: string | null;
  derivedStatus: RealEstateDisclosureStatusBreakdown;

  readIntegrityStatus: 'clean' | 'needs_review';
  unrecognizedFields: RealEstateUnrecognizedFieldEntry[];
  readIssues: RealEstateDisclosureReadIssue[];
}

export type RealEstateDisclosuresLoadStatus =
  | 'idle'
  | 'unauthorized'
  | 'loading'
  | 'cached_unconfirmed'
  | 'confirmed'
  | 'confirmed_empty'
  | 'permission_denied'
  | 'error';

export type RealEstateDisclosuresErrorCode = 'permission_denied' | 'offline' | 'error';

export interface RealEstateDisclosuresReadState {
  records: RealEstateDisclosureReadRecord[];
  status: RealEstateDisclosuresLoadStatus;
  confirmed: boolean;
  fromCache: boolean;
  hasPendingWrites: boolean;
  authorized: boolean;
  error: string | null;
  errorCode: RealEstateDisclosuresErrorCode | null;
  lastSyncedAt: string | null;
}

/**
 * Authorization gate matching `firestore.rules` (`match /real_estate_disclosures/{id}` -> `isDataEntry()`):
 * ONLY active `admin` and `data_entry` accounts are permitted to read `real_estate_disclosures`.
 */
export function canUserReadRealEstateDisclosures(
  user: Pick<AppUser, 'role' | 'isActive'> | null | undefined
): boolean {
  if (!user || user.isActive !== true) return false;
  return user.role === 'admin' || user.role === 'data_entry';
}

function extractTimestampMsLocal(ts: unknown): number {
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

function preserveStoredText(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') {
    return val.length > 0 ? val : null;
  }
  const str = String(val);
  return str.length > 0 ? str : null;
}

function preserveAuditString(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function inspectStoredNonNegativeNumber(
  raw: unknown,
  field: string,
  labelAr: string,
  issues: RealEstateDisclosureReadIssue[]
): number | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw === 'number') {
    if (Number.isFinite(raw) && raw >= 0) {
      return Object.is(raw, -0) ? 0 : raw;
    }
    issues.push({
      code: 'invalid_numeric_value',
      field,
      rawValue: raw,
      messageAr: `قيمة ${labelAr} المحفوظة (${String(raw)}) غير صالحة؛ يُشترط رقم منتهٍ >= 0 دون تصحيح تلقائي.`,
    });
    return null;
  }
  issues.push({
    code: 'invalid_numeric_value',
    field,
    rawValue: raw,
    messageAr: `قيمة ${labelAr} المحفوظة (${String(raw)}) ليست رقماً صالحاً؛ تبقى القيمة الخام للمراجعة دون تحويل ضمني.`,
  });
  return null;
}

function inspectStoredCalendarDate(
  raw: unknown,
  field: string,
  labelAr: string,
  issues: RealEstateDisclosureReadIssue[]
): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    if (isValidCalendarDate(trimmed)) {
      return trimmed;
    }
    issues.push({
      code: 'invalid_calendar_date',
      field,
      rawValue: raw,
      messageAr: `تاريخ ${labelAr} المحفوظ (${raw}) غير صالح تقويمياً (المطلوب YYYY-MM-DD)؛ يُعرض للمراجعة دون تعديل.`,
    });
    return null;
  }
  issues.push({
    code: 'invalid_calendar_date',
    field,
    rawValue: raw,
    messageAr: `قيمة ${labelAr} المحفوظة (${String(raw)}) ليست تاريخاً نصياً صالحاً.`,
  });
  return null;
}

/**
 * Pure, non-mutating Firestore document normalizer for `real_estate_disclosures`.
 * - NEVER throws on malformed or unrecognized stored values.
 * - NEVER silently drops a document or coerces an unknown enum into a default.
 * - Preserves `0`, `null`, `false`, full original texts, `revision`, `contentHash`, and audit fields.
 */
export function normalizeRealEstateDisclosureFromFirestore(
  docId: string,
  rawData: Record<string, unknown> | null | undefined
): RealEstateDisclosureReadRecord {
  const src = rawData && typeof rawData === 'object' ? rawData : {};
  const readIssues: RealEstateDisclosureReadIssue[] = [];
  const unrecognizedFields: RealEstateUnrecognizedFieldEntry[] = [];

  const storedDocId = preserveAuditString(src.docId);
  if (storedDocId !== null && storedDocId !== docId) {
    readIssues.push({
      code: 'doc_id_mismatch',
      field: 'docId',
      rawValue: src.docId,
      messageAr: `اختلاف بين معرّف مستند Firestore (${docId}) وحقل docId المخزن داخله (${storedDocId}).`,
    });
  }

  // Concurrency & audit fields
  let revision: number | null = null;
  if (src.revision !== undefined && src.revision !== null) {
    if (typeof src.revision === 'number' && Number.isInteger(src.revision) && src.revision >= 0) {
      revision = src.revision;
    } else {
      readIssues.push({
        code: 'invalid_revision',
        field: 'revision',
        rawValue: src.revision,
        messageAr: `قيمة المراجعة المخزنة (revision = ${String(src.revision)}) غير صالحة.`,
      });
    }
  }

  const contentHash = preserveAuditString(src.contentHash);
  const createdAt = preserveAuditString(src.createdAt);
  const createdBy = preserveAuditString(src.createdBy);
  const updatedAt = preserveAuditString(src.updatedAt);
  const updatedBy = preserveAuditString(src.updatedBy);
  const serverUpdatedAt = src.serverUpdatedAt ?? null;
  const serverUpdatedAtMs = extractTimestampMsLocal(src.serverUpdatedAt);
  const isDeleted = src.isDeleted === true;
  const schemaVersion =
    typeof src.schemaVersion === 'number' && Number.isFinite(src.schemaVersion)
      ? src.schemaVersion
      : null;
  const importId = preserveAuditString(src.importId);
  const sourceFile = preserveAuditString(src.sourceFile);
  const sourceSheet = preserveAuditString(src.sourceSheet);

  // Ticker
  const rawTicker = src.ticker ?? null;
  const ticker = typeof src.ticker === 'string' ? tryNormalizedTicker(src.ticker) : null;
  if (!ticker) {
    readIssues.push({
      code: 'missing_or_invalid_ticker',
      field: 'ticker',
      rawValue: rawTicker,
      messageAr: `رمز السهم (ticker) في المستند (${docId}) مفقود أو غير صالح (${String(rawTicker ?? '-')}).`,
    });
  }

  // disclosureId
  const rawDisclosureId = src.disclosureId ?? null;
  const disclosureIdInsp = inspectRealEstateDisclosureId(
    src.disclosureId,
    'معرّف الإفصاح العقاري (disclosureId)'
  );
  const disclosureId = disclosureIdInsp.status === 'valid' ? disclosureIdInsp.normalizedId : null;
  if (disclosureIdInsp.status !== 'valid') {
    readIssues.push({
      code: 'missing_or_invalid_disclosure_id',
      field: 'disclosureId',
      rawValue: rawDisclosureId,
      messageAr:
        disclosureIdInsp.errorMessageAr ??
        `معرّف الإفصاح (disclosureId) في المستند (${docId}) مفقود أو غير صالح.`,
    });
  }

  // parentDisclosureId
  const rawParentDisclosureId = src.parentDisclosureId ?? null;
  const parentIdInsp = inspectRealEstateDisclosureId(
    src.parentDisclosureId,
    'معرّف الإفصاح الأب (parentDisclosureId)'
  );
  let parentDisclosureId: string | null = null;
  if (parentIdInsp.status === 'valid') {
    parentDisclosureId = parentIdInsp.normalizedId;
    if (disclosureId && parentDisclosureId === disclosureId) {
      readIssues.push({
        code: 'invalid_parent_disclosure_id',
        field: 'parentDisclosureId',
        rawValue: rawParentDisclosureId,
        messageAr: `معرّف الإفصاح الأب (${parentDisclosureId}) يطابق معرّف الإفصاح نفسه.`,
      });
    }
  } else if (parentIdInsp.status === 'invalid') {
    readIssues.push({
      code: 'invalid_parent_disclosure_id',
      field: 'parentDisclosureId',
      rawValue: rawParentDisclosureId,
      messageAr:
        parentIdInsp.errorMessageAr ??
        `معرّف الإفصاح الأب (${String(rawParentDisclosureId)}) غير صالح.`,
    });
  }

  // Period (fiscalYear + fiscalQuarter)
  const rawFiscalYear = src.fiscalYear ?? null;
  let fiscalYear: number | null = null;
  if (src.fiscalYear !== undefined && src.fiscalYear !== null && src.fiscalYear !== '') {
    if (
      typeof src.fiscalYear === 'number' &&
      Number.isInteger(src.fiscalYear) &&
      src.fiscalYear >= 1900 &&
      src.fiscalYear <= 2200
    ) {
      fiscalYear = src.fiscalYear;
    } else {
      readIssues.push({
        code: 'invalid_fiscal_year',
        field: 'fiscalYear',
        rawValue: rawFiscalYear,
        messageAr: `السنة المالية المخزنة (${String(rawFiscalYear)}) غير صالحة.`,
      });
    }
  }

  const rawFiscalQuarter = src.fiscalQuarter ?? null;
  let fiscalQuarter: QuarterlyRecordQuarter | null = null;
  if (src.fiscalQuarter !== undefined && src.fiscalQuarter !== null && src.fiscalQuarter !== '') {
    if (typeof src.fiscalQuarter === 'string') {
      const upperQ = src.fiscalQuarter.trim().toUpperCase();
      if (ALLOWED_QUARTERLY_QUARTERS.has(upperQ as QuarterlyRecordQuarter)) {
        fiscalQuarter = upperQ as QuarterlyRecordQuarter;
      } else if (upperQ.length > 0) {
        const msg = `قيمة الربع المالي المخزنة (${src.fiscalQuarter}) غير معروفة؛ تبقى ظاهرة للمراجعة دون تحويل صامت.`;
        unrecognizedFields.push({ field: 'fiscalQuarter', rawValue: rawFiscalQuarter, messageAr: msg });
        readIssues.push({
          code: 'unrecognized_fiscal_quarter',
          field: 'fiscalQuarter',
          rawValue: rawFiscalQuarter,
          messageAr: msg,
        });
      }
    } else {
      const msg = `قيمة الربع المالي المخزنة (${String(rawFiscalQuarter)}) غير صالحة.`;
      unrecognizedFields.push({ field: 'fiscalQuarter', rawValue: rawFiscalQuarter, messageAr: msg });
      readIssues.push({
        code: 'unrecognized_fiscal_quarter',
        field: 'fiscalQuarter',
        rawValue: rawFiscalQuarter,
        messageAr: msg,
      });
    }
  }

  if ((fiscalYear !== null && fiscalQuarter === null) || (fiscalYear === null && fiscalQuarter !== null)) {
    readIssues.push({
      code: 'partial_fiscal_period',
      field: 'fiscalYear/fiscalQuarter',
      rawValue: { fiscalYear: rawFiscalYear, fiscalQuarter: rawFiscalQuarter },
      messageAr: 'الفترة المالية ناقصة: يلزم توفر السنة المالية والربع معاً للربط الفصلي.',
    });
  }

  // Dates
  const rawBalanceSheetDate = src.balanceSheetDate ?? null;
  const balanceSheetDate = inspectStoredCalendarDate(
    src.balanceSheetDate,
    'balanceSheetDate',
    'المركز المالي',
    readIssues
  );

  const rawFairValueDate = src.fairValueDate ?? null;
  const fairValueDate = inspectStoredCalendarDate(
    src.fairValueDate,
    'fairValueDate',
    'القيمة العادلة',
    readIssues
  );

  if (fiscalYear === null && balanceSheetDate === null) {
    readIssues.push({
      code: 'missing_or_invalid_period_anchor',
      field: 'balanceSheetDate',
      rawValue: { fiscalYear: rawFiscalYear, fiscalQuarter: rawFiscalQuarter, balanceSheetDate: rawBalanceSheetDate },
      messageAr: 'لا توجد فترة مالية صالحة ولا تاريخ مركز مالي صالح لتثبيت مرجعية الإفصاح.',
    });
  }

  const storedLinkedQuarterlyDocId = preserveAuditString(src.linkedQuarterlyDocId);
  const linkedQuarterlyDocId =
    ticker && fiscalYear !== null && fiscalQuarter !== null
      ? buildLinkedQuarterlyDocId(ticker, fiscalYear, fiscalQuarter)
      : null;

  // Enums (STRICT non-mutating inspection — NEVER coerce unrecognized codes)
  const scopeInsp = inspectFinancialStatementScope(src.statementScope);
  if (scopeInsp.status === 'unrecognized') {
    const msg = `نطاق القوائم المالية المحفوظ (${scopeInsp.rawValue ?? '-'}) غير معروف ولا يُفترض أنه موحد أو مستقل.`;
    unrecognizedFields.push({ field: 'statementScope', rawValue: scopeInsp.rawValue, messageAr: msg });
    readIssues.push({ code: 'unrecognized_enum_value', field: 'statementScope', rawValue: scopeInsp.rawValue, messageAr: msg });
  }

  const categoryInsp = inspectRealEstateAssetCategory(src.assetCategory);
  if (categoryInsp.status === 'unrecognized') {
    const msg = `تصنيف العقار المحفوظ (${categoryInsp.rawValue ?? '-'}) غير معروف ولا يُحوّل تلقائياً إلى استثمارات عقارية.`;
    unrecognizedFields.push({ field: 'assetCategory', rawValue: categoryInsp.rawValue, messageAr: msg });
    readIssues.push({ code: 'unrecognized_enum_value', field: 'assetCategory', rawValue: categoryInsp.rawValue, messageAr: msg });
  }

  const policyInsp = inspectRealEstateAccountingPolicy(src.accountingPolicy);
  if (policyInsp.status === 'unrecognized') {
    const msg = `السياسة المحاسبية المحفوظة (${policyInsp.rawValue ?? '-'}) غير معروفة وتبقى للمراجعة دون افتراض صامت.`;
    unrecognizedFields.push({ field: 'accountingPolicy', rawValue: policyInsp.rawValue, messageAr: msg });
    readIssues.push({ code: 'unrecognized_enum_value', field: 'accountingPolicy', rawValue: policyInsp.rawValue, messageAr: msg });
  }

  const aggInsp = inspectRealEstateAggregationLevel(src.aggregationLevel);
  if (aggInsp.status === 'unrecognized') {
    const msg = `مستوى التجميع المحفوظ (${aggInsp.rawValue ?? '-'}) غير معروف ويبقى للمراجعة دون افتراض صامت.`;
    unrecognizedFields.push({ field: 'aggregationLevel', rawValue: aggInsp.rawValue, messageAr: msg });
    readIssues.push({ code: 'unrecognized_enum_value', field: 'aggregationLevel', rawValue: aggInsp.rawValue, messageAr: msg });
  }

  const fvScopeInsp = inspectFinancialStatementScope(src.fairValueStatementScope);
  if (fvScopeInsp.status === 'unrecognized') {
    const msg = `نطاق القيمة العادلة المحفوظ (${fvScopeInsp.rawValue ?? '-'}) غير معروف ويبقى للمراجعة دون افتراض صامت.`;
    unrecognizedFields.push({ field: 'fairValueStatementScope', rawValue: fvScopeInsp.rawValue, messageAr: msg });
    readIssues.push({ code: 'unrecognized_enum_value', field: 'fairValueStatementScope', rawValue: fvScopeInsp.rawValue, messageAr: msg });
  }

  const fvSourceTypeInsp = inspectRealEstateFairValueSourceType(src.fairValueSourceType);
  if (fvSourceTypeInsp.status === 'unrecognized') {
    const msg = `تصنيف مصدر القيمة العادلة المحفوظ (${fvSourceTypeInsp.rawValue ?? '-'}) غير معروف ويبقى للمراجعة دون افتراض صامت.`;
    unrecognizedFields.push({ field: 'fairValueSourceType', rawValue: fvSourceTypeInsp.rawValue, messageAr: msg });
    readIssues.push({ code: 'unrecognized_enum_value', field: 'fairValueSourceType', rawValue: fvSourceTypeInsp.rawValue, messageAr: msg });
  }

  // Numeric fields (strictly preserve 0 vs null; never infer fairValue from carryingValue)
  const rawCarryingValue = src.carryingValue ?? null;
  const carryingValue = inspectStoredNonNegativeNumber(
    src.carryingValue,
    'carryingValue',
    'القيمة الدفترية',
    readIssues
  );

  const rawDisclosedFairValue = src.disclosedFairValue ?? null;
  const disclosedFairValue = inspectStoredNonNegativeNumber(
    src.disclosedFairValue,
    'disclosedFairValue',
    'القيمة العادلة المُفصح عنها',
    readIssues
  );

  // Tri-state boolean (true / false / null)
  const rawFairValueAssetScopeMatchesCarrying = src.fairValueAssetScopeMatchesCarrying ?? null;
  let fairValueAssetScopeMatchesCarrying: boolean | null = null;
  if (src.fairValueAssetScopeMatchesCarrying === true) {
    fairValueAssetScopeMatchesCarrying = true;
  } else if (src.fairValueAssetScopeMatchesCarrying === false) {
    fairValueAssetScopeMatchesCarrying = false;
  } else if (
    src.fairValueAssetScopeMatchesCarrying !== undefined &&
    src.fairValueAssetScopeMatchesCarrying !== null
  ) {
    readIssues.push({
      code: 'invalid_boolean_flag',
      field: 'fairValueAssetScopeMatchesCarrying',
      rawValue: rawFairValueAssetScopeMatchesCarrying,
      messageAr: `قيمة تطابق نطاق الأصول (${String(rawFairValueAssetScopeMatchesCarrying)}) غير صالحة؛ يُشترط true أو false أو null.`,
    });
  }

  // Original texts preserved verbatim (NO silent truncation)
  const assetUsageDescription = preserveStoredText(src.assetUsageDescription);
  const fairValueSource = preserveStoredText(src.fairValueSource);
  const footnoteReference = preserveStoredText(src.footnoteReference);
  const explanatoryNote = preserveStoredText(src.explanatoryNote);
  const storedCompletenessStatus = preserveAuditString(src.completenessStatus);

  const hasUnrecognizedCode = unrecognizedFields.length > 0;
  const hasInvalidStructure = readIssues.length > 0;

  const derivedStatus = deriveRealEstateDisclosureStatusBreakdown({
    carryingValue,
    disclosedFairValue,
    statementScope: scopeInsp.code ?? 'unspecified',
    fairValueStatementScope: fvScopeInsp.status === 'valid' ? fvScopeInsp.code : null,
    fairValueAssetScopeMatchesCarrying,
    balanceSheetDate,
    fairValueDate,
    accountingPolicy: policyInsp.code ?? 'unspecified',
    footnoteReference,
    fairValueSource,
    hasUnrecognizedCode,
    hasInvalidStructure,
  });

  return {
    docId,
    docPath: `${REAL_ESTATE_DISCLOSURES_COLLECTION}/${docId}`,
    storedDocId,
    revision,
    contentHash,
    createdAt,
    createdBy,
    updatedAt,
    updatedBy,
    serverUpdatedAt,
    serverUpdatedAtMs,
    isDeleted,
    schemaVersion,
    importId,
    sourceFile,
    sourceSheet,
    disclosureId,
    rawDisclosureId,
    ticker,
    rawTicker,
    fiscalYear,
    rawFiscalYear,
    fiscalQuarter,
    rawFiscalQuarter,
    linkedQuarterlyDocId,
    storedLinkedQuarterlyDocId,
    balanceSheetDate,
    rawBalanceSheetDate,
    statementScope: scopeInsp.code,
    rawStatementScope: scopeInsp.rawValue,
    statementScopeStatus: scopeInsp.status,
    assetCategory: categoryInsp.code,
    rawAssetCategory: categoryInsp.rawValue,
    assetCategoryStatus: categoryInsp.status,
    assetUsageDescription,
    accountingPolicy: policyInsp.code,
    rawAccountingPolicy: policyInsp.rawValue,
    accountingPolicyStatus: policyInsp.status,
    aggregationLevel: aggInsp.code,
    rawAggregationLevel: aggInsp.rawValue,
    aggregationLevelStatus: aggInsp.status,
    parentDisclosureId,
    rawParentDisclosureId,
    carryingValue,
    rawCarryingValue,
    disclosedFairValue,
    rawDisclosedFairValue,
    fairValueDate,
    rawFairValueDate,
    fairValueStatementScope: fvScopeInsp.code,
    rawFairValueStatementScope: fvScopeInsp.rawValue,
    fairValueStatementScopeStatus: fvScopeInsp.status,
    fairValueAssetScopeMatchesCarrying,
    rawFairValueAssetScopeMatchesCarrying,
    fairValueSource,
    fairValueSourceType: fvSourceTypeInsp.code,
    rawFairValueSourceType: fvSourceTypeInsp.rawValue,
    fairValueSourceTypeStatus: fvSourceTypeInsp.status,
    footnoteReference,
    explanatoryNote,
    storedCompletenessStatus,
    derivedStatus,
    readIntegrityStatus: readIssues.length === 0 ? 'clean' : 'needs_review',
    unrecognizedFields,
    readIssues,
  };
}

/**
 * Adapts a `RealEstateDisclosureReadRecord` into `RealEstateDisclosureInspectableInput`
 * for `evaluateRealEstateFairValueGap` / `summarizeRealEstateDisclosures`, preserving
 * unrecognized stored values and invalid raw inputs so reviewers see every diagnostic issue.
 */
export function toRealEstateDisclosureInspectableInput(
  record: RealEstateDisclosureReadRecord
): RealEstateDisclosureInspectableInput {
  return {
    disclosureId:
      record.disclosureId ??
      (typeof record.rawDisclosureId === 'string' ? record.rawDisclosureId : undefined),
    ticker:
      record.ticker ?? (typeof record.rawTicker === 'string' ? record.rawTicker : undefined),
    fiscalYear: record.fiscalYear,
    fiscalQuarter: record.fiscalQuarter,
    linkedQuarterlyDocId: record.linkedQuarterlyDocId,
    balanceSheetDate:
      record.balanceSheetDate ??
      (typeof record.rawBalanceSheetDate === 'string' ? record.rawBalanceSheetDate : null),
    statementScope: record.statementScope ?? record.rawStatementScope,
    assetCategory: record.assetCategory ?? record.rawAssetCategory,
    assetUsageDescription: record.assetUsageDescription,
    accountingPolicy: record.accountingPolicy ?? record.rawAccountingPolicy,
    aggregationLevel: record.aggregationLevel ?? record.rawAggregationLevel,
    parentDisclosureId:
      record.parentDisclosureId ??
      (typeof record.rawParentDisclosureId === 'string' ? record.rawParentDisclosureId : null),
    carryingValue:
      record.carryingValue !== null
        ? record.carryingValue
        : (record.rawCarryingValue as number | null),
    disclosedFairValue:
      record.disclosedFairValue !== null
        ? record.disclosedFairValue
        : (record.rawDisclosedFairValue as number | null),
    fairValueDate:
      record.fairValueDate ??
      (typeof record.rawFairValueDate === 'string' ? record.rawFairValueDate : null),
    fairValueStatementScope: (record.fairValueStatementScope ??
      record.rawFairValueStatementScope) as FinancialStatementScope | null,
    fairValueAssetScopeMatchesCarrying:
      record.fairValueAssetScopeMatchesCarrying !== null
        ? record.fairValueAssetScopeMatchesCarrying
        : (record.rawFairValueAssetScopeMatchesCarrying as boolean | null),
    fairValueSource: record.fairValueSource,
    fairValueSourceType: record.fairValueSourceType ?? record.rawFairValueSourceType,
    footnoteReference: record.footnoteReference,
    explanatoryNote: record.explanatoryNote,
    completenessStatus: record.derivedStatus.completenessStatus,
  };
}

function parseIsoEpochMsLocal(iso: unknown): number {
  if (typeof iso !== 'string' || !iso.trim()) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getRecordFreshnessEpochMs(record: RealEstateDisclosureReadRecord): number {
  if (record.serverUpdatedAtMs > 0) return record.serverUpdatedAtMs;
  const fromRaw = extractTimestampMsLocal(record.serverUpdatedAt);
  if (fromRaw > 0) return fromRaw;
  return parseIsoEpochMsLocal(record.updatedAt);
}

export interface RealEstateDisclosureDeletionMarker {
  docId: string;
  serverUpdatedAtMs: number;
  updatedAtMs: number;
  revision: number | null;
  source: 'soft_delete_doc' | 'tombstone' | 'explicit_id_only';
}

export type RealEstateMergeDecisionReason =
  | 'kept_active'
  | 'kept_active_newer_than_delete'
  | 'kept_active_missing_delete_ordering'
  | 'kept_active_incomparable_delete_ordering'
  | 'deleted_by_newer_or_equal_marker'
  | 'deleted_by_versioned_marker';

export interface RealEstateMergeDocDecision {
  docId: string;
  outcome: 'active' | 'deleted';
  reason: RealEstateMergeDecisionReason;
  activeEpochMs: number | null;
  activeRevision: number | null;
  deleteEpochMs: number | null;
  deleteRevision: number | null;
}

export interface RealEstateMergeResolution {
  records: RealEstateDisclosureReadRecord[];
  decisionsByDocId: Record<string, RealEstateMergeDocDecision>;
  unresolvedDeletions: RealEstateMergeDocDecision[];
}

export interface RealEstateDisclosureMergeOptions {
  /** Dated & versioned deletion markers preserved from snapshot mapping / server responses. */
  deletedMarkers?: ReadonlyArray<RealEstateDisclosureDeletionMarker>;
  /**
   * Compatibility list of deleted docIds.
   * NEVER overrides a versioned deletion marker or deletes a record without documented ordering metadata.
   */
  deletedDocIds?: ReadonlyArray<string>;
  /** Dated tombstone epochs by docId (e.g. from `sync_tombstones`). */
  deletedEpochsByDocId?: ReadonlyMap<string, number>;
}

/**
 * Extracts a dated & versioned deletion marker from a soft-deleted read record
 * without losing `serverUpdatedAtMs`, `updatedAt`, or `revision`.
 */
export function createDeletionMarkerFromReadRecord(
  record: RealEstateDisclosureReadRecord
): RealEstateDisclosureDeletionMarker {
  const serverMs =
    record.serverUpdatedAtMs > 0
      ? record.serverUpdatedAtMs
      : extractTimestampMsLocal(record.serverUpdatedAt);
  const updatedMs = parseIsoEpochMsLocal(record.updatedAt);
  return {
    docId: record.docId,
    serverUpdatedAtMs: serverMs,
    updatedAtMs: updatedMs,
    revision: record.revision,
    source: 'soft_delete_doc',
  };
}

interface ActiveCandidate {
  record: RealEstateDisclosureReadRecord;
  epochMs: number;
  revision: number | null;
  hasOrdering: boolean;
}

interface DeleteCandidate {
  epochMs: number;
  revision: number | null;
  hasOrdering: boolean;
  source: RealEstateDisclosureDeletionMarker['source'];
}

function markerEffectiveEpochMs(marker: RealEstateDisclosureDeletionMarker): number {
  if (marker.serverUpdatedAtMs > 0) return marker.serverUpdatedAtMs;
  if (marker.updatedAtMs > 0) return marker.updatedAtMs;
  return 0;
}

function pickNewerActive(current: ActiveCandidate | undefined, incoming: ActiveCandidate): ActiveCandidate {
  if (!current) return incoming;

  if (current.epochMs > 0 && incoming.epochMs > 0) {
    if (incoming.epochMs > current.epochMs) return incoming;
    if (current.epochMs > incoming.epochMs) return current;
    if (current.revision !== null && incoming.revision !== null) {
      return incoming.revision >= current.revision ? incoming : current;
    }
    if (incoming.revision !== null && current.revision === null) return incoming;
    if (current.revision !== null && incoming.revision === null) return current;
    return incoming;
  }

  if (current.revision !== null && incoming.revision !== null) {
    if (incoming.revision > current.revision) return incoming;
    if (current.revision > incoming.revision) return current;
    if (incoming.epochMs > current.epochMs) return incoming;
    if (current.epochMs > incoming.epochMs) return current;
    return incoming;
  }

  if (incoming.hasOrdering && !current.hasOrdering) return incoming;
  if (current.hasOrdering && !incoming.hasOrdering) return current;

  return incoming;
}

function pickNewerDelete(current: DeleteCandidate | undefined, incoming: DeleteCandidate): DeleteCandidate {
  if (!current) return incoming;

  if (current.hasOrdering && !incoming.hasOrdering) return current;
  if (incoming.hasOrdering && !current.hasOrdering) return incoming;

  if (current.epochMs > 0 && incoming.epochMs > 0) {
    if (incoming.epochMs > current.epochMs) return incoming;
    if (current.epochMs > incoming.epochMs) return current;
    if (current.revision !== null && incoming.revision !== null) {
      return incoming.revision >= current.revision ? incoming : current;
    }
    if (incoming.revision !== null && current.revision === null) return incoming;
    return current;
  }

  if (current.revision !== null && incoming.revision !== null) {
    if (incoming.revision > current.revision) return incoming;
    if (current.revision > incoming.revision) return current;
    if (incoming.epochMs > current.epochMs) return incoming;
    return current;
  }

  return current;
}

function resolveActiveVsDelete(
  docId: string,
  active: ActiveCandidate | undefined,
  del: DeleteCandidate | undefined
): RealEstateMergeDocDecision {
  if (!active) {
    return {
      docId,
      outcome: 'deleted',
      reason: del?.hasOrdering ? 'deleted_by_newer_or_equal_marker' : 'deleted_by_versioned_marker',
      activeEpochMs: null,
      activeRevision: null,
      deleteEpochMs: del && del.epochMs > 0 ? del.epochMs : null,
      deleteRevision: del ? del.revision : null,
    };
  }

  if (!del) {
    return {
      docId,
      outcome: 'active',
      reason: 'kept_active',
      activeEpochMs: active.epochMs > 0 ? active.epochMs : null,
      activeRevision: active.revision,
      deleteEpochMs: null,
      deleteRevision: null,
    };
  }

  // Case 1: Both sides carry authoritative timestamps
  if (active.epochMs > 0 && del.epochMs > 0) {
    if (active.epochMs > del.epochMs) {
      return {
        docId,
        outcome: 'active',
        reason: 'kept_active_newer_than_delete',
        activeEpochMs: active.epochMs,
        activeRevision: active.revision,
        deleteEpochMs: del.epochMs,
        deleteRevision: del.revision,
      };
    }
    if (del.epochMs > active.epochMs) {
      return {
        docId,
        outcome: 'deleted',
        reason: 'deleted_by_newer_or_equal_marker',
        activeEpochMs: active.epochMs,
        activeRevision: active.revision,
        deleteEpochMs: del.epochMs,
        deleteRevision: del.revision,
      };
    }
    // Equal timestamps: tie-break by revision when both are known
    if (active.revision !== null && del.revision !== null) {
      if (active.revision > del.revision) {
        return {
          docId,
          outcome: 'active',
          reason: 'kept_active_newer_than_delete',
          activeEpochMs: active.epochMs,
          activeRevision: active.revision,
          deleteEpochMs: del.epochMs,
          deleteRevision: del.revision,
        };
      }
      return {
        docId,
        outcome: 'deleted',
        reason: 'deleted_by_newer_or_equal_marker',
        activeEpochMs: active.epochMs,
        activeRevision: active.revision,
        deleteEpochMs: del.epochMs,
        deleteRevision: del.revision,
      };
    }
    return {
      docId,
      outcome: 'deleted',
      reason: 'deleted_by_newer_or_equal_marker',
      activeEpochMs: active.epochMs,
      activeRevision: active.revision,
      deleteEpochMs: del.epochMs,
      deleteRevision: del.revision,
    };
  }

  // Case 2: At least one timestamp missing, both carry explicit integer revisions
  if (active.revision !== null && del.revision !== null) {
    if (active.revision > del.revision) {
      return {
        docId,
        outcome: 'active',
        reason: 'kept_active_newer_than_delete',
        activeEpochMs: active.epochMs > 0 ? active.epochMs : null,
        activeRevision: active.revision,
        deleteEpochMs: del.epochMs > 0 ? del.epochMs : null,
        deleteRevision: del.revision,
      };
    }
    return {
      docId,
      outcome: 'deleted',
      reason: 'deleted_by_newer_or_equal_marker',
      activeEpochMs: active.epochMs > 0 ? active.epochMs : null,
      activeRevision: active.revision,
      deleteEpochMs: del.epochMs > 0 ? del.epochMs : null,
      deleteRevision: del.revision,
    };
  }

  // Case 3: Deletion marker lacks BOTH timestamp and revision -> explicit non-destructive handling
  if (!del.hasOrdering) {
    return {
      docId,
      outcome: 'active',
      reason: 'kept_active_missing_delete_ordering',
      activeEpochMs: active.epochMs > 0 ? active.epochMs : null,
      activeRevision: active.revision,
      deleteEpochMs: null,
      deleteRevision: null,
    };
  }

  // Case 4: Deletion marker carries ordering metadata while active record carries none
  if (!active.hasOrdering) {
    return {
      docId,
      outcome: 'deleted',
      reason: 'deleted_by_versioned_marker',
      activeEpochMs: null,
      activeRevision: null,
      deleteEpochMs: del.epochMs > 0 ? del.epochMs : null,
      deleteRevision: del.revision,
    };
  }

  // Case 5: Incomparable ordering axes (e.g., active has only epochMs while delete has only revision)
  return {
    docId,
    outcome: 'active',
    reason: 'kept_active_incomparable_delete_ordering',
    activeEpochMs: active.epochMs > 0 ? active.epochMs : null,
    activeRevision: active.revision,
    deleteEpochMs: del.epochMs > 0 ? del.epochMs : null,
    deleteRevision: del.revision,
  };
}

/**
 * Central, order-independent, deterministic merge & deletion-precedence resolver for
 * `real_estate_disclosures`:
 * - Unifies `base`, `incoming`, `deletedMarkers`, `deletedEpochsByDocId`, and `deletedDocIds`
 *   in a single per-`docId` precedence step so bare `deletedDocIds` can NEVER bypass a rejected
 *   older deletion marker.
 * - Order-independent across delta re-deliveries and out-of-order packets (newer re-creation
 *   survives older deletion; newer deletion blocks older active re-delivery).
 * - Handles missing or incomparable deletion ordering metadata explicitly without undocumented assumptions.
 */
export function resolveRealEstateDisclosureMerge(
  base: readonly RealEstateDisclosureReadRecord[],
  incoming: readonly RealEstateDisclosureReadRecord[],
  options?: RealEstateDisclosureMergeOptions
): RealEstateMergeResolution {
  const bestActiveByDocId = new Map<string, ActiveCandidate>();
  const bestDeleteByDocId = new Map<string, DeleteCandidate>();
  const allDocIds = new Set<string>();

  const ingestRecord = (item: RealEstateDisclosureReadRecord) => {
    if (!item.docId) return;
    allDocIds.add(item.docId);
    const epochMs = getRecordFreshnessEpochMs(item);
    const revision = item.revision;
    const hasOrdering = epochMs > 0 || revision !== null;
    if (item.isDeleted === true) {
      bestDeleteByDocId.set(
        item.docId,
        pickNewerDelete(bestDeleteByDocId.get(item.docId), {
          epochMs,
          revision,
          hasOrdering,
          source: 'soft_delete_doc',
        })
      );
      return;
    }
    bestActiveByDocId.set(
      item.docId,
      pickNewerActive(bestActiveByDocId.get(item.docId), {
        record: item,
        epochMs,
        revision,
        hasOrdering,
      })
    );
  };

  for (const item of base) ingestRecord(item);
  for (const item of incoming) ingestRecord(item);

  if (options?.deletedMarkers) {
    for (const marker of options.deletedMarkers) {
      if (!marker.docId) continue;
      allDocIds.add(marker.docId);
      const epochMs = markerEffectiveEpochMs(marker);
      const revision = marker.revision ?? null;
      const hasOrdering = epochMs > 0 || revision !== null;
      bestDeleteByDocId.set(
        marker.docId,
        pickNewerDelete(bestDeleteByDocId.get(marker.docId), {
          epochMs,
          revision,
          hasOrdering,
          source: marker.source,
        })
      );
    }
  }

  if (options?.deletedEpochsByDocId) {
    for (const [delId, tombMs] of options.deletedEpochsByDocId.entries()) {
      if (!delId) continue;
      allDocIds.add(delId);
      const validMs = Number.isFinite(tombMs) && tombMs > 0 ? tombMs : 0;
      bestDeleteByDocId.set(
        delId,
        pickNewerDelete(bestDeleteByDocId.get(delId), {
          epochMs: validMs,
          revision: null,
          hasOrdering: validMs > 0,
          source: 'tombstone',
        })
      );
    }
  }

  if (options?.deletedDocIds) {
    for (const delId of options.deletedDocIds) {
      if (!delId) continue;
      allDocIds.add(delId);
      // Bare ID NEVER overwrites or overrides a dated/versioned deletion marker
      if (!bestDeleteByDocId.has(delId)) {
        bestDeleteByDocId.set(delId, {
          epochMs: 0,
          revision: null,
          hasOrdering: false,
          source: 'explicit_id_only',
        });
      }
    }
  }

  const records: RealEstateDisclosureReadRecord[] = [];
  const decisionsByDocId: Record<string, RealEstateMergeDocDecision> = {};
  const unresolvedDeletions: RealEstateMergeDocDecision[] = [];

  for (const docId of Array.from(allDocIds).sort((a, b) => a.localeCompare(b))) {
    const active = bestActiveByDocId.get(docId);
    const del = bestDeleteByDocId.get(docId);
    const decision = resolveActiveVsDelete(docId, active, del);
    decisionsByDocId[docId] = decision;

    if (
      decision.reason === 'kept_active_missing_delete_ordering' ||
      decision.reason === 'kept_active_incomparable_delete_ordering'
    ) {
      unresolvedDeletions.push(decision);
    }

    if (decision.outcome === 'active' && active) {
      records.push(active.record);
    }
  }

  return {
    records,
    decisionsByDocId,
    unresolvedDeletions,
  };
}

/**
 * Deterministic delta merge for `real_estate_disclosures` keyed strictly by Firestore `docId`.
 * Delegates to the central `resolveRealEstateDisclosureMerge` engine.
 */
export function mergeRealEstateDisclosureDeltas(
  base: readonly RealEstateDisclosureReadRecord[],
  incoming: readonly RealEstateDisclosureReadRecord[],
  options?: RealEstateDisclosureMergeOptions
): RealEstateDisclosureReadRecord[] {
  return resolveRealEstateDisclosureMerge(base, incoming, options).records;
}

// --- Honest Read-Side Linkage (Zero N+1 Queries, Source-Confirmation Aware) ---

export type RealEstateReadCompanyLinkStatus =
  | RealEstateCompanyLinkStatus
  | 'pending_source_confirmation'
  | 'source_load_failed'
  | 'unverified_record_identity';

export type RealEstateReadQuarterlyLinkStatus =
  | RealEstateQuarterlyLinkStatus
  | 'pending_source_confirmation'
  | 'source_load_failed'
  | 'unverified_record_identity';

export type RealEstateReadOverallLinkageStatus =
  | RealEstateOverallLinkageStatus
  | 'pending_source_confirmation'
  | 'source_load_failed'
  | 'unverified_record';

export interface RealEstateLinkageSourcesContext {
  companies: readonly Company[];
  companiesConfirmed: boolean;
  companiesFromCache?: boolean;
  companiesError?: string | null;
  quarterlyRecords: readonly QuarterlyFinancialRecord[];
  quarterlyConfirmed: boolean;
  quarterlyFromCache?: boolean;
  quarterlyError?: string | null;
  sourcesVersion?: string;
}

export interface RealEstateDisclosureReadLinkageResult {
  docId: string;
  hasLogicalQuarterlyReference: boolean;
  logicalQuarterlyDocId: string | null;
  companyDocId: string | null;
  companyDocPath: string | null;
  companyExists: boolean | null;
  companyTicker: string | null;
  companySourceConfirmed: boolean;
  companyLinkStatus: RealEstateReadCompanyLinkStatus;
  quarterlyDocPath: string | null;
  quarterlyRecordExists: boolean | null;
  quarterlyTicker: string | null;
  quarterlyYear: number | null;
  quarterlyQuarter: string | null;
  quarterlySourceConfirmed: boolean;
  quarterlyLinkStatus: RealEstateReadQuarterlyLinkStatus;
  quarterlyPeriodEndDate: string | null;
  disclosureBalanceSheetDate: string | null;
  overallLinkageStatus: RealEstateReadOverallLinkageStatus;
  warningsAr: string[];
  /** Version signature of `companies` + `quarterly_financial_records` used during this check. */
  evaluatedSourcesVersion: string;
  /** Underlying output from central `evaluateRealEstateDisclosureLinkage` when record identity allows it. */
  baseVerification: RealEstateDisclosureLinkageVerification | null;
}

export interface RealEstateDisclosuresLinkageSnapshot {
  byDocId: Record<string, RealEstateDisclosureReadLinkageResult>;
  sourcesVersion: string;
  companiesConfirmed: boolean;
  quarterlyConfirmed: boolean;
  companiesError: string | null;
  quarterlyError: string | null;
  companiesCount: number;
  quarterlyRecordsCount: number;
  evaluatedCount: number;
}

/**
 * Deterministic version fingerprint representing the current state & confirmation readiness
 * of `companies` and `quarterly_financial_records` in session memory.
 */
export function computeRealEstateLinkageSourcesVersion(
  sources: RealEstateLinkageSourcesContext
): string {
  if (sources.sourcesVersion) return sources.sourcesVersion;

  const companySig = sources.companies
    .map((c) => {
      const rec = c as unknown as Record<string, unknown>;
      return `${c.id}|${c.ticker ?? ''}|${String(rec.updatedAt ?? '')}|${extractTimestampMsLocal(rec.serverUpdatedAt)}`;
    })
    .sort()
    .join(';');

  const quarterlySig = sources.quarterlyRecords
    .map((q) => {
      const rec = q as unknown as Record<string, unknown>;
      return `${q.ticker}_${q.year}_${q.quarter}|${q.periodEndDate ?? ''}|${String(q.updatedAt ?? '')}|${extractTimestampMsLocal(rec.serverUpdatedAt)}`;
    })
    .sort()
    .join(';');

  return [
    `c:${sources.companiesConfirmed ? '1' : '0'}:${sources.companiesFromCache ? 'cache' : 'srv'}:${sources.companiesError ? 'err' : 'ok'}:${sources.companies.length}:${companySig}`,
    `q:${sources.quarterlyConfirmed ? '1' : '0'}:${sources.quarterlyFromCache ? 'cache' : 'srv'}:${sources.quarterlyError ? 'err' : 'ok'}:${sources.quarterlyRecords.length}:${quarterlySig}`,
  ].join('||');
}

function toContractRecordForLinkage(
  record: RealEstateDisclosureReadRecord
): RealEstateDisclosureRecord | null {
  if (!record.ticker) return null;
  return {
    disclosureId: record.disclosureId ?? record.docId,
    ticker: record.ticker,
    fiscalYear: record.fiscalYear,
    fiscalQuarter: record.fiscalQuarter,
    linkedQuarterlyDocId: record.linkedQuarterlyDocId,
    balanceSheetDate: record.balanceSheetDate,
    statementScope: record.statementScope ?? 'unspecified',
    assetCategory: record.assetCategory ?? 'unspecified',
    assetUsageDescription: record.assetUsageDescription,
    accountingPolicy: record.accountingPolicy ?? 'unspecified',
    aggregationLevel: record.aggregationLevel ?? 'unspecified',
    parentDisclosureId: record.parentDisclosureId,
    carryingValue: record.carryingValue,
    disclosedFairValue: record.disclosedFairValue,
    fairValueDate: record.fairValueDate,
    fairValueStatementScope: record.fairValueStatementScope,
    fairValueAssetScopeMatchesCarrying: record.fairValueAssetScopeMatchesCarrying,
    fairValueSource: record.fairValueSource,
    fairValueSourceType: record.fairValueSourceType ?? 'unspecified',
    footnoteReference: record.footnoteReference,
    explanatoryNote: record.explanatoryNote,
    completenessStatus: record.derivedStatus.completenessStatus,
  };
}

function buildCompaniesIndex(
  companies: readonly Company[]
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const c of companies) {
    const raw = c as unknown as Record<string, unknown>;
    if (raw.isDeleted === true) continue;
    const idKey = typeof c.id === 'string' && c.id.trim() ? c.id.trim().toLowerCase() : null;
    if (idKey) {
      map.set(idKey, raw);
    }
    const tkKey = tryNormalizedTicker(c.ticker)?.toLowerCase() ?? null;
    if (tkKey && !map.has(tkKey)) {
      map.set(tkKey, raw);
    }
  }
  return map;
}

function buildQuarterlyIndex(
  quarterlyRecords: readonly QuarterlyFinancialRecord[]
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const q of quarterlyRecords) {
    const raw = q as unknown as Record<string, unknown>;
    if (raw.isDeleted === true) continue;
    const tk = tryNormalizedTicker(q.ticker) ?? q.ticker;
    const key = `${tk}_${q.year}_${String(q.quarter).toUpperCase()}`;
    map.set(key, raw);
  }
  return map;
}

function evaluateSingleReadLinkageWithIndices(
  record: RealEstateDisclosureReadRecord,
  companiesByDocId: ReadonlyMap<string, Record<string, unknown>>,
  quarterlyByDocId: ReadonlyMap<string, Record<string, unknown>>,
  sources: RealEstateLinkageSourcesContext,
  evaluatedSourcesVersion: string
): RealEstateDisclosureReadLinkageResult {
  const contractRecord = toContractRecordForLinkage(record);
  if (!contractRecord) {
    return {
      docId: record.docId,
      hasLogicalQuarterlyReference: false,
      logicalQuarterlyDocId: null,
      companyDocId: null,
      companyDocPath: null,
      companyExists: null,
      companyTicker: null,
      companySourceConfirmed: sources.companiesConfirmed,
      companyLinkStatus: 'unverified_record_identity',
      quarterlyDocPath: null,
      quarterlyRecordExists: null,
      quarterlyTicker: null,
      quarterlyYear: null,
      quarterlyQuarter: null,
      quarterlySourceConfirmed: sources.quarterlyConfirmed,
      quarterlyLinkStatus: 'unverified_record_identity',
      quarterlyPeriodEndDate: null,
      disclosureBalanceSheetDate: record.balanceSheetDate,
      overallLinkageStatus: 'unverified_record',
      warningsAr: [
        `تعذر فحص الربط المرجعي للمستند (${record.docId}) لأن رمز السهم (ticker) مفقود أو غير صالح.`,
      ],
      evaluatedSourcesVersion,
      baseVerification: null,
    };
  }

  const companyDocId = contractRecord.ticker.toLowerCase();
  const companyDoc = companiesByDocId.get(companyDocId);
  const quarterlyDoc = contractRecord.linkedQuarterlyDocId
    ? quarterlyByDocId.get(contractRecord.linkedQuarterlyDocId)
    : undefined;

  // Reuse central pure evaluator from `realEstateDisclosureTransaction.ts`
  const base = evaluateRealEstateDisclosureLinkage({
    record: contractRecord,
    companyDoc,
    quarterlyDoc,
  });

  const warningsAr: string[] = [];

  // 1) Company link status gated honestly by `sources.companiesConfirmed`
  let companyLinkStatus: RealEstateReadCompanyLinkStatus = base.companyLinkStatus;
  let companyExists: boolean | null = base.companyExists;

  if (!sources.companiesConfirmed) {
    if (!base.companyExists) {
      companyExists = null;
      if (sources.companiesError) {
        companyLinkStatus = 'source_load_failed';
        warningsAr.push(
          `تعذر التحقق من وجود الشركة (${contractRecord.ticker}) بسبب فشل تحميل مجموعة ${COMPANIES_COLLECTION}؛ لا يُصنَّف السهم كمفقود قبل تأكيد التحميل.`
        );
      } else {
        companyLinkStatus = 'pending_source_confirmation';
        warningsAr.push(
          `لم يُؤكَّد تحميل مجموعة ${COMPANIES_COLLECTION} من الخادم بعد؛ تعذر حسم وجود الشركة (${contractRecord.ticker}) ولا تُصنَّف كمفقودة قبل تأكيد التحميل.`
        );
      }
    } else if (base.companyLinkStatus === 'verified') {
      // Cached/unconfirmed source must NOT be reported as server-verified
      companyLinkStatus = 'pending_source_confirmation';
      warningsAr.push(
        `وثيقة الشركة (${base.companyDocPath}) متاحة محلياً لكن مجموعة ${COMPANIES_COLLECTION} لم تُؤكَّد من الخادم بعد؛ يُنتظر التأكيد قبل اعتماد حالة الربط.`
      );
    } else {
      // Surface identity/conflict issues transparently, while noting source is not yet confirmed
      warningsAr.push(
        ...base.warningsAr.filter((w) => w.includes(COMPANIES_COLLECTION) || w.includes(base.companyDocPath))
      );
      warningsAr.push(
        `تنبيه جاهزية: مجموعة ${COMPANIES_COLLECTION} لم تُؤكَّد من الخادم بعد؛ هذه الملاحظة مبدئية لحين اكتمال تأكيد التحميل.`
      );
    }
  } else {
    warningsAr.push(
      ...base.warningsAr.filter((w) => w.includes(COMPANIES_COLLECTION) || w.includes(base.companyDocPath))
    );
  }

  // 2) Quarterly link status gated honestly by `sources.quarterlyConfirmed`
  let quarterlyLinkStatus: RealEstateReadQuarterlyLinkStatus = base.quarterlyLinkStatus;
  let quarterlyRecordExists: boolean | null = base.hasLogicalQuarterlyReference
    ? base.quarterlyRecordExists
    : false;

  const baseQuarterlyWarnings = base.warningsAr.filter(
    (w) => !(w.includes(COMPANIES_COLLECTION) || w.includes(base.companyDocPath))
  );

  if (!base.hasLogicalQuarterlyReference) {
    quarterlyLinkStatus = 'not_linked_period';
    warningsAr.push(...baseQuarterlyWarnings);
  } else if (!sources.quarterlyConfirmed) {
    if (!base.quarterlyRecordExists) {
      quarterlyRecordExists = null;
      if (sources.quarterlyError) {
        quarterlyLinkStatus = 'source_load_failed';
        warningsAr.push(
          `تعذر التحقق من وجود السجل المالي (${base.logicalQuarterlyDocId}) بسبب فشل تحميل مجموعة ${QUARTERLY_FINANCIAL_RECORDS_COLLECTION}؛ لا يُصنَّف السجل كمفقود قبل تأكيد التحميل.`
        );
      } else {
        quarterlyLinkStatus = 'pending_source_confirmation';
        warningsAr.push(
          `لم يُؤكَّد تحميل مجموعة ${QUARTERLY_FINANCIAL_RECORDS_COLLECTION} من الخادم بعد؛ تعذر حسم وجود السجل المالي (${base.logicalQuarterlyDocId}) ولا يُصنَّف كمفقود قبل تأكيد التحميل.`
        );
      }
    } else if (
      base.quarterlyLinkStatus === 'verified' ||
      base.quarterlyLinkStatus === 'verified_without_period_end_date' ||
      base.quarterlyLinkStatus === 'verified_without_balance_sheet_date'
    ) {
      quarterlyLinkStatus = 'pending_source_confirmation';
      warningsAr.push(
        `السجل المالي (${base.logicalQuarterlyDocId}) متاح محلياً لكن مجموعة ${QUARTERLY_FINANCIAL_RECORDS_COLLECTION} لم تُؤكَّد من الخادم بعد؛ يُنتظر التأكيد قبل اعتماد حالة الربط.`
      );
    } else {
      warningsAr.push(...baseQuarterlyWarnings);
      warningsAr.push(
        `تنبيه جاهزية: مجموعة ${QUARTERLY_FINANCIAL_RECORDS_COLLECTION} لم تُؤكَّد من الخادم بعد؛ هذه الملاحظة مبدئية لحين اكتمال تأكيد التحميل.`
      );
    }
  } else {
    warningsAr.push(...baseQuarterlyWarnings);
  }

  // 3) Overall read-side linkage status (strictly preserves conflicts, failures, pending, missing, verified)
  let overallLinkageStatus: RealEstateReadOverallLinkageStatus;
  if (
    companyLinkStatus === 'company_ticker_conflict' ||
    quarterlyLinkStatus === 'ticker_conflict' ||
    quarterlyLinkStatus === 'period_conflict' ||
    quarterlyLinkStatus === 'date_conflict'
  ) {
    overallLinkageStatus = 'conflict';
  } else if (
    companyLinkStatus === 'source_load_failed' ||
    quarterlyLinkStatus === 'source_load_failed'
  ) {
    overallLinkageStatus = 'source_load_failed';
  } else if (
    companyLinkStatus === 'pending_source_confirmation' ||
    quarterlyLinkStatus === 'pending_source_confirmation'
  ) {
    overallLinkageStatus = 'pending_source_confirmation';
  } else if (
    companyLinkStatus === 'missing_company' ||
    quarterlyLinkStatus === 'missing_quarterly_record'
  ) {
    overallLinkageStatus = 'missing_reference';
  } else if (companyLinkStatus === 'verified' && quarterlyLinkStatus === 'verified') {
    overallLinkageStatus = 'verified';
  } else {
    overallLinkageStatus = 'partial_unverified';
  }

  return {
    docId: record.docId,
    hasLogicalQuarterlyReference: base.hasLogicalQuarterlyReference,
    logicalQuarterlyDocId: base.logicalQuarterlyDocId,
    companyDocId: base.companyDocId,
    companyDocPath: base.companyDocPath,
    companyExists,
    companyTicker: base.companyTicker,
    companySourceConfirmed: sources.companiesConfirmed,
    companyLinkStatus,
    quarterlyDocPath: base.quarterlyDocPath,
    quarterlyRecordExists,
    quarterlyTicker: base.quarterlyTicker,
    quarterlyYear: base.quarterlyYear,
    quarterlyQuarter: base.quarterlyQuarter,
    quarterlySourceConfirmed: sources.quarterlyConfirmed,
    quarterlyLinkStatus,
    quarterlyPeriodEndDate: base.quarterlyPeriodEndDate,
    disclosureBalanceSheetDate: base.disclosureBalanceSheetDate,
    overallLinkageStatus,
    warningsAr,
    evaluatedSourcesVersion,
    baseVerification: base,
  };
}

/**
 * Evaluates read-side linkage for a single `RealEstateDisclosureReadRecord` using
 * centrally loaded `companies` and `quarterly_financial_records` (zero Firestore queries).
 */
export function evaluateRealEstateDisclosureReadLinkage(
  record: RealEstateDisclosureReadRecord,
  sources: RealEstateLinkageSourcesContext
): RealEstateDisclosureReadLinkageResult {
  const version = computeRealEstateLinkageSourcesVersion(sources);
  const companiesByDocId = buildCompaniesIndex(sources.companies);
  const quarterlyByDocId = buildQuarterlyIndex(sources.quarterlyRecords);
  return evaluateSingleReadLinkageWithIndices(
    record,
    companiesByDocId,
    quarterlyByDocId,
    sources,
    version
  );
}

/**
 * Batch read-side linkage evaluator over all loaded `real_estate_disclosures`.
 * Builds O(N) lookup maps once for `companies` and `quarterly_financial_records` —
 * ZERO per-disclosure Firestore reads (no N+1 queries).
 */
export function evaluateRealEstateDisclosuresReadLinkage(
  records: readonly RealEstateDisclosureReadRecord[],
  sources: RealEstateLinkageSourcesContext
): RealEstateDisclosuresLinkageSnapshot {
  const sourcesVersion = computeRealEstateLinkageSourcesVersion(sources);
  const companiesByDocId = buildCompaniesIndex(sources.companies);
  const quarterlyByDocId = buildQuarterlyIndex(sources.quarterlyRecords);

  const byDocId: Record<string, RealEstateDisclosureReadLinkageResult> = {};
  for (const rec of records) {
    byDocId[rec.docId] = evaluateSingleReadLinkageWithIndices(
      rec,
      companiesByDocId,
      quarterlyByDocId,
      sources,
      sourcesVersion
    );
  }

  return {
    byDocId,
    sourcesVersion,
    companiesConfirmed: sources.companiesConfirmed,
    quarterlyConfirmed: sources.quarterlyConfirmed,
    companiesError: sources.companiesError ?? null,
    quarterlyError: sources.quarterlyError ?? null,
    companiesCount: sources.companies.length,
    quarterlyRecordsCount: sources.quarterlyRecords.length,
    evaluatedCount: records.length,
  };
}

/**
 * Compares a previously computed linkage snapshot against the current session's
 * `companies` / `quarterly_financial_records` state so stale linkage is NEVER
 * misrepresented as freshly verified.
 */
export function isRealEstateLinkageSnapshotFresh(
  snapshot: RealEstateDisclosuresLinkageSnapshot,
  currentSources: RealEstateLinkageSourcesContext
): { isFresh: boolean; staleReasonsAr: string[] } {
  const currentVersion = computeRealEstateLinkageSourcesVersion(currentSources);
  if (snapshot.sourcesVersion === currentVersion) {
    return { isFresh: true, staleReasonsAr: [] };
  }

  const staleReasonsAr: string[] = [];
  if (snapshot.companiesConfirmed !== currentSources.companiesConfirmed) {
    staleReasonsAr.push(
      `تغيّرت حالة تأكيد مجموعة ${COMPANIES_COLLECTION} منذ آخر فحص للربط (${snapshot.companiesConfirmed ? 'مؤكد' : 'غير مؤكد'} ← ${currentSources.companiesConfirmed ? 'مؤكد' : 'غير مؤكد'}).`
    );
  }
  if (snapshot.quarterlyConfirmed !== currentSources.quarterlyConfirmed) {
    staleReasonsAr.push(
      `تغيّرت حالة تأكيد مجموعة ${QUARTERLY_FINANCIAL_RECORDS_COLLECTION} منذ آخر فحص للربط (${snapshot.quarterlyConfirmed ? 'مؤكد' : 'غير مؤكد'} ← ${currentSources.quarterlyConfirmed ? 'مؤكد' : 'غير مؤكد'}).`
    );
  }
  if (snapshot.companiesCount !== currentSources.companies.length) {
    staleReasonsAr.push(
      `تغيّر عدد سجلات ${COMPANIES_COLLECTION} من ${snapshot.companiesCount} إلى ${currentSources.companies.length}.`
    );
  }
  if (snapshot.quarterlyRecordsCount !== currentSources.quarterlyRecords.length) {
    staleReasonsAr.push(
      `تغيّر عدد سجلات ${QUARTERLY_FINANCIAL_RECORDS_COLLECTION} من ${snapshot.quarterlyRecordsCount} إلى ${currentSources.quarterlyRecords.length}.`
    );
  }
  if (staleReasonsAr.length === 0) {
    staleReasonsAr.push(
      'تغيّرت محتويات أو طوابع تحديث الشركات أو السجلات المالية الفصلية منذ آخر فحص للربط المرجعي.'
    );
  }

  return { isFresh: false, staleReasonsAr };
}
