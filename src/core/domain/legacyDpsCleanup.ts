/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { computeRecordBusinessHash, validateRecords } from '../contracts';

export const CLEANUP_TOOL_VERSION = '2.0.0';
export const CLEANUP_BACKUP_SCHEMA = 'mizan_legacy_dps_cleanup_backup_v1' as const;

export type LegacyDpsTargetCollection = 'quarterly_financial_records' | 'financials';

export type LegacyDpsFieldPath =
  | 'dpsCurrent'
  | 'DPS_Current'
  | 'extendedFields.dpsCurrent'
  | 'extendedFields.DPS_Current';

export const LEGACY_DPS_TARGET_COLLECTIONS: readonly LegacyDpsTargetCollection[] = [
  'quarterly_financial_records',
  'financials',
] as const;

export const LEGACY_DPS_EXACT_PATHS: readonly LegacyDpsFieldPath[] = [
  'dpsCurrent',
  'DPS_Current',
  'extendedFields.dpsCurrent',
  'extendedFields.DPS_Current',
] as const;

export type LegacyDpsWriteResult = 'updated' | 'aborted_precondition' | 'failed';

export interface LegacyDpsBackupEntry {
  collection: LegacyDpsTargetCollection;
  docId: string;
  updateTime: string | null;
  removedFields: Partial<Record<LegacyDpsFieldPath, unknown>>;
  previousContentHash: string | null;
  newContentHash: string | null;
  previousUpdatedAt: string | null;
  backupStatus?: 'backed_up' | 'skipped_existing';
  applyStatus?: 'pending' | 'updated' | 'aborted_precondition' | 'failed';
  writeResult?: LegacyDpsWriteResult;
}

export interface LegacyDpsFailedDocEntry {
  collection: LegacyDpsTargetCollection;
  docId: string;
  reason: string;
  attempts: number;
  writeResult: 'aborted_precondition' | 'failed';
}

export interface LegacyDpsDocPlan {
  collection: LegacyDpsTargetCollection;
  docId: string;
  updateTime: string | null;
  pathsToDelete: LegacyDpsFieldPath[];
  cleanedQuarterlyDoc: Record<string, unknown> | null;
  newContentHash: string | null;
  backupEntry: LegacyDpsBackupEntry;
}

export interface LegacyDpsCleanupReport {
  mode: 'dry-run' | 'apply' | 'restore';
  runId: string;
  toolVersion: string;
  projectId: string;
  databaseId: string;
  completed: boolean;
  failedDocsCount: number;
  collections: LegacyDpsTargetCollection[];
  scannedDocsByCollection: Record<LegacyDpsTargetCollection, number>;
  matchedDocsByCollection: Record<LegacyDpsTargetCollection, number>;
  updatedDocsByCollection: Record<LegacyDpsTargetCollection, number>;
  skippedAlreadyCleanDocsByCollection: Record<LegacyDpsTargetCollection, number>;
  skippedNotAppliedDocsByCollection: Record<LegacyDpsTargetCollection, number>;
  abortedPreconditionDocsByCollection: Record<LegacyDpsTargetCollection, number>;
  deletedBusinessFieldCount: number;
  metadataUpdatedCount: number;
  fieldsBreakdown: Record<LegacyDpsFieldPath, number>;
  lastProcessedDocIdByCollection: Record<LegacyDpsTargetCollection, string | null>;
  sampleMatchedDocIds: Array<{
    collection: LegacyDpsTargetCollection;
    docId: string;
    paths: LegacyDpsFieldPath[];
  }>;
  errors: Array<{
    collection: LegacyDpsTargetCollection;
    docId: string;
    message: string;
  }>;
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

const hasOwn = (obj: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

export function validateBackupEntryScopeAndPaths(entry: LegacyDpsBackupEntry): void {
  if (!LEGACY_DPS_TARGET_COLLECTIONS.includes(entry.collection)) {
    throw new Error(`مجموعة غير مصرح بها في ملف النسخة الاحتياطية: ${String(entry.collection)}`);
  }
  if (!isPlainRecord(entry.removedFields)) {
    throw new Error(`حقل removedFields غير صالح للوثيقة ${entry.collection}/${entry.docId}.`);
  }
  for (const key of Object.keys(entry.removedFields)) {
    if (!LEGACY_DPS_EXACT_PATHS.includes(key as LegacyDpsFieldPath)) {
      throw new Error(
        `مسار غير مصرح باسترجاعه في ${entry.collection}/${entry.docId}: ${key}. المسموح فقط: ${LEGACY_DPS_EXACT_PATHS.join(', ')}`
      );
    }
  }
}

export function buildCleanedQuarterlyDocData(rawData: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...rawData };
  delete cleaned.dpsCurrent;
  delete cleaned.DPS_Current;
  if (isPlainRecord(rawData.extendedFields)) {
    const extCopy: Record<string, unknown> = { ...rawData.extendedFields };
    delete extCopy.dpsCurrent;
    delete extCopy.DPS_Current;
    cleaned.extendedFields = Object.keys(extCopy).length > 0 ? extCopy : null;
  }
  return cleaned;
}

/**
 * يفحص وثيقة واحدة في quarterly_financial_records أو financials للتحقق من وجود أي من حقول DPS_Current الأربعة فقط.
 * لا يمس أياً من حقول extendedFields الشقيقة ولا يعدل الوثائق النظيفة مسبقاً.
 */
export function inspectLegacyDpsDocument(
  collection: LegacyDpsTargetCollection,
  docId: string,
  rawData: Record<string, unknown>,
  updateTime: string | null = null
): LegacyDpsDocPlan | null {
  const pathsToDelete: LegacyDpsFieldPath[] = [];
  const removedFields: Partial<Record<LegacyDpsFieldPath, unknown>> = {};

  if (hasOwn(rawData, 'dpsCurrent')) {
    pathsToDelete.push('dpsCurrent');
    removedFields.dpsCurrent = rawData.dpsCurrent;
  }
  if (hasOwn(rawData, 'DPS_Current')) {
    pathsToDelete.push('DPS_Current');
    removedFields.DPS_Current = rawData.DPS_Current;
  }
  if (isPlainRecord(rawData.extendedFields)) {
    if (hasOwn(rawData.extendedFields, 'dpsCurrent')) {
      pathsToDelete.push('extendedFields.dpsCurrent');
      removedFields['extendedFields.dpsCurrent'] = rawData.extendedFields.dpsCurrent;
    }
    if (hasOwn(rawData.extendedFields, 'DPS_Current')) {
      pathsToDelete.push('extendedFields.DPS_Current');
      removedFields['extendedFields.DPS_Current'] = rawData.extendedFields.DPS_Current;
    }
  }

  if (pathsToDelete.length === 0) {
    return null;
  }

  const previousContentHash =
    typeof rawData.contentHash === 'string' ? rawData.contentHash : null;
  const previousUpdatedAt =
    typeof rawData.updatedAt === 'string' ? rawData.updatedAt : null;

  let cleanedQuarterlyDoc: Record<string, unknown> | null = null;
  let newContentHash: string | null = null;

  if (collection === 'quarterly_financial_records') {
    cleanedQuarterlyDoc = buildCleanedQuarterlyDocData(rawData);
    newContentHash = computeRecordBusinessHash('quarterly', cleanedQuarterlyDoc);
  }

  return {
    collection,
    docId,
    updateTime,
    pathsToDelete,
    cleanedQuarterlyDoc,
    newContentHash,
    backupEntry: {
      collection,
      docId,
      updateTime,
      removedFields,
      previousContentHash,
      newContentHash,
      previousUpdatedAt,
      backupStatus: 'backed_up',
      applyStatus: 'pending',
    },
  };
}

/**
 * يبني حمولة الاسترجاع (Restore) لإعادة الحقول المحذوفة فقط من النسخة الاحتياطية
 * دون مسح الحقول الشقيقة الموجودة حالياً في الوثيقة، مع احتساب contentHash على البيانات الحية.
 */
export function buildRestorePatchForDoc(
  entry: LegacyDpsBackupEntry,
  currentDocData: Record<string, unknown> | undefined,
  restoredAtIso: string
): Record<string, unknown> {
  validateBackupEntryScopeAndPaths(entry);

  const patch: Record<string, unknown> = {
    updatedAt: restoredAtIso,
  };

  const baseDoc: Record<string, unknown> = currentDocData ? { ...currentDocData } : {};

  if (hasOwn(entry.removedFields, 'dpsCurrent')) {
    patch.dpsCurrent = entry.removedFields.dpsCurrent ?? null;
    baseDoc.dpsCurrent = patch.dpsCurrent;
  }
  if (hasOwn(entry.removedFields, 'DPS_Current')) {
    patch.DPS_Current = entry.removedFields.DPS_Current ?? null;
    baseDoc.DPS_Current = patch.DPS_Current;
  }

  const currentExt = isPlainRecord(currentDocData?.extendedFields)
    ? { ...currentDocData!.extendedFields }
    : {};
  let hasExtRestore = false;

  if (hasOwn(entry.removedFields, 'extendedFields.dpsCurrent')) {
    currentExt.dpsCurrent = entry.removedFields['extendedFields.dpsCurrent'] ?? null;
    hasExtRestore = true;
  }
  if (hasOwn(entry.removedFields, 'extendedFields.DPS_Current')) {
    currentExt.DPS_Current = entry.removedFields['extendedFields.DPS_Current'] ?? null;
    hasExtRestore = true;
  }

  if (hasExtRestore) {
    patch.extendedFields = currentExt;
    baseDoc.extendedFields = currentExt;
  }

  if (entry.collection === 'quarterly_financial_records') {
    const unmodifiedSinceCleanup =
      Boolean(entry.previousContentHash) &&
      (!entry.newContentHash || currentDocData?.contentHash === entry.newContentHash);
    patch.contentHash = unmodifiedSinceCleanup
      ? entry.previousContentHash!
      : computeRecordBusinessHash('quarterly', baseDoc);
  }

  return patch;
}

export function verifyPostApplyDpsCleanup(
  docs: Array<{
    collection: LegacyDpsTargetCollection;
    docId: string;
    data: Record<string, unknown>;
  }>
): {
  ok: boolean;
  checkedCount: number;
  validCount: number;
  issues: Array<{ collection: LegacyDpsTargetCollection; docId: string; reason: string }>;
} {
  const issues: Array<{ collection: LegacyDpsTargetCollection; docId: string; reason: string }> = [];
  let validCount = 0;

  for (const item of docs) {
    const remainingPlan = inspectLegacyDpsDocument(item.collection, item.docId, item.data);
    if (remainingPlan) {
      issues.push({
        collection: item.collection,
        docId: item.docId,
        reason: `حقول قديمة متبقية: ${remainingPlan.pathsToDelete.join(', ')}`,
      });
      continue;
    }

    if (item.collection === 'quarterly_financial_records') {
      try {
        validateRecords([{ ...item.data }], true, undefined, { legacyCompatibilityMode: true });
      } catch (err) {
        issues.push({
          collection: item.collection,
          docId: item.docId,
          reason: `فشل تحليل/تحقق السجل المالي بعد التنظيف: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      const expectedHash = computeRecordBusinessHash('quarterly', item.data);
      if (item.data.contentHash !== expectedHash) {
        issues.push({
          collection: item.collection,
          docId: item.docId,
          reason: `عدم تطابق contentHash بعد التنظيف (الحالي ${String(item.data.contentHash ?? 'null')} مقابل المتوقع ${expectedHash}).`,
        });
        continue;
      }
    }

    validCount += 1;
  }

  return {
    ok: issues.length === 0,
    checkedCount: docs.length,
    validCount,
    issues,
  };
}

export function createEmptyCleanupReport(
  mode: LegacyDpsCleanupReport['mode'],
  projectId: string,
  collections: LegacyDpsTargetCollection[] = [...LEGACY_DPS_TARGET_COLLECTIONS],
  meta?: {
    databaseId?: string;
    runId?: string;
    toolVersion?: string;
  }
): LegacyDpsCleanupReport {
  return {
    mode,
    runId: meta?.runId ?? `dps_cleanup_${Date.now()}`,
    toolVersion: meta?.toolVersion ?? CLEANUP_TOOL_VERSION,
    projectId,
    databaseId: meta?.databaseId ?? '(default)',
    completed: false,
    failedDocsCount: 0,
    collections,
    scannedDocsByCollection: { quarterly_financial_records: 0, financials: 0 },
    matchedDocsByCollection: { quarterly_financial_records: 0, financials: 0 },
    updatedDocsByCollection: { quarterly_financial_records: 0, financials: 0 },
    skippedAlreadyCleanDocsByCollection: { quarterly_financial_records: 0, financials: 0 },
    skippedNotAppliedDocsByCollection: { quarterly_financial_records: 0, financials: 0 },
    abortedPreconditionDocsByCollection: { quarterly_financial_records: 0, financials: 0 },
    deletedBusinessFieldCount: 0,
    metadataUpdatedCount: 0,
    fieldsBreakdown: {
      dpsCurrent: 0,
      DPS_Current: 0,
      'extendedFields.dpsCurrent': 0,
      'extendedFields.DPS_Current': 0,
    },
    lastProcessedDocIdByCollection: { quarterly_financial_records: null, financials: null },
    sampleMatchedDocIds: [],
    errors: [],
  };
}
