/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { computeRecordBusinessHash } from './hashing';
import { CanonicalRfMethodology, normalizeRfMethodology } from './normalization';
import {
  getParameterDefinition,
  ParameterCategory,
  ParameterValueType,
} from './parameterRegistry';
import {
  isValidParameterCategory,
  ParameterTypeSource,
  resolveCanonicalParameterType,
} from './parameterTypeContract';
import {
  ParameterInputPayload,
  ParameterWritePrecondition,
  validateParameterRecords,
} from './records';

export interface MacroParameterWriteSource {
  key: string;
  nameAr?: string;
  descriptionAr?: string;
  description?: string;
  value: number;
  category?: ParameterCategory | string;
  valueType?: ParameterValueType | null;
  isPercentage?: boolean | null;
  unit?: string;
  asOfDate?: string;
  source?: string;
  rfMethodology?: string;
  currency?: string | null;
  forecastHorizonYears?: number | null;
  precondition?: ParameterWritePrecondition;
}

export interface ParameterDocumentProvenance {
  importId: string;
  sourceFile: string;
  sourceSheet: string;
  schemaVersion: number;
  updatedBy: string;
  updatedAt: string;
  serverUpdatedAt: unknown;
  isDeleted: boolean;
}

export type ParameterConcurrencyConflictReason =
  | 'ALREADY_EXISTS'
  | 'DELETED_ON_SERVER'
  | 'REVISION_MISMATCH'
  | 'HASH_MISMATCH'
  | 'MISSING_PRECONDITION'
  | 'INCOMPLETE_PRECONDITION';

export interface ParameterConcurrencyConflictItem {
  key: string;
  scope: 'global' | 'company';
  ticker: string | null;
  docPath: string;
  reason: ParameterConcurrencyConflictReason;
  expectedRevision: number | null;
  serverRevision: number | null;
  expectedContentHash: string | null;
  serverContentHash: string | null;
  serverValue: number | null;
  serverUpdatedAt: string | null;
  serverUpdatedBy: string | null;
  messageAr: string;
}

export class ParameterConcurrencyConflictError extends Error {
  public readonly code = 'failed-precondition';
  public readonly conflicts: ParameterConcurrencyConflictItem[];

  constructor(conflicts: ParameterConcurrencyConflictItem[], message?: string) {
    const primaryMsg =
      message ||
      (conflicts.length === 1
        ? conflicts[0].messageAr
        : `تعارض تزامن في ${conflicts.length} معاملات (${conflicts.map((c) => c.key).join('، ')})؛ تم تعديلها أو حذفها على الخادم بعد آخر قراءة. أعد المزامنة وراجع الفروق قبل الحفظ.`);
    super(primaryMsg);
    this.name = 'ParameterConcurrencyConflictError';
    this.conflicts = conflicts;
  }
}

export interface SavedParameterConfirmation {
  key: string;
  scope: 'global' | 'company';
  ticker: string | null;
  docPath: string;
  status: 'insert' | 'update' | 'skip';
  revision: number;
  contentHash: string;
  updatedAt: string;
}

export interface PlannedParameterWrite {
  docPath: string;
  scope: 'global' | 'company';
  key: string;
  ticker: string | null;
  status: 'insert' | 'update' | 'skip';
  revision: number;
  contentHash: string;
  existingHash: string | null;
  validated: ParameterInputPayload;
  document: Record<string, unknown> | null;
}

export interface PlannedParameterWriteBatch {
  validatedParams: ParameterInputPayload[];
  writes: PlannedParameterWrite[];
  touchedCompanyTickers: string[];
  insertedCount: number;
  updatedCount: number;
  skippedUnchangedCount: number;
}

export interface CanonicalMacroParameterRecord {
  key: string;
  nameAr: string;
  descriptionAr: string;
  value: number;
  category: ParameterCategory;
  valueType: ParameterValueType | null;
  isPercentage: boolean | null;
  parameterTypeSource: ParameterTypeSource;
  unit: string;
  scope: 'global';
  ticker: null;
  asOfDate: string;
  source: string;
  enabledInEngine: boolean;
  modeNoteAr?: string;
  rfMethodology?: CanonicalRfMethodology;
  currency?: 'EGP' | 'USD' | string | null;
  forecastHorizonYears?: number | null;
  revision?: number;
  contentHash?: string;
  updatedAt?: string;
  serverUpdatedAt?: unknown;
}

export function extractParameterRevision(doc: Record<string, any> | null | undefined): number {
  if (!doc) return 0;
  const rev = doc.revision;
  return typeof rev === 'number' && Number.isInteger(rev) && rev >= 0 ? rev : 0;
}

/**
 * Returns a verified positive integer revision (>= 1) if present on the record,
 * or `null` when the record lacks a verified server-issued revision.
 */
export function extractVerifiedParameterRevision(
  doc: Record<string, any> | null | undefined
): number | null {
  if (!doc) return null;
  const rev = doc.revision;
  return typeof rev === 'number' && Number.isInteger(rev) && rev >= 1 ? rev : null;
}

function parseIsoTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export type MacroParameterReconcileDecision =
  | 'accept'
  | 'same_version'
  | 'ignore_stale'
  | 'ignore_unverified'
  | 'ignore_deleted';

export interface MacroParameterReconcileResult<T> {
  decision: MacroParameterReconcileDecision;
  record: T | null;
  currentRevision: number | null;
  incomingRevision: number | null;
}

/**
 * Single Source of Truth monotonic reconciliation rule for `macro_params`.
 *
 * Guarantees:
 * - An older verified `revision` NEVER replaces a newer verified `revision` (e.g. rev=2 never overwrites rev=3).
 * - A record lacking a verified revision (`null`) is NEVER assumed newer than a verified versioned record.
 * - When neither record has a verified revision, older `updatedAt` timestamps are rejected and
 *   unverified save confirmations lacking timestamps never displace timestamped records.
 * - A parameter marked deleted on the server is NEVER revived by a stale update confirmation.
 */
export function reconcileIncomingMacroParameterVersion<
  T extends { key: string; revision?: number; updatedAt?: string; contentHash?: string },
>(
  current: T | null | undefined,
  incoming: T,
  options?: {
    source?: 'save_confirmation' | 'server_snapshot';
    isDeletedOnServer?: boolean;
    allowRevive?: boolean;
  }
): MacroParameterReconcileResult<T> {
  const source = options?.source ?? 'save_confirmation';
  const currentRevision = extractVerifiedParameterRevision(current);
  const incomingRevision = extractVerifiedParameterRevision(incoming);

  if (options?.isDeletedOnServer && !options?.allowRevive) {
    return {
      decision: 'ignore_deleted',
      record: null,
      currentRevision: null,
      incomingRevision,
    };
  }

  if (!current) {
    return {
      decision: 'accept',
      record: incoming,
      currentRevision: null,
      incomingRevision,
    };
  }

  // Case 1: Both records have verified positive integer revisions
  if (currentRevision !== null && incomingRevision !== null) {
    if (incomingRevision < currentRevision) {
      return {
        decision: 'ignore_stale',
        record: current,
        currentRevision,
        incomingRevision,
      };
    }
    if (incomingRevision > currentRevision) {
      return {
        decision: 'accept',
        record: incoming,
        currentRevision,
        incomingRevision,
      };
    }
    // Equal verified revision: never downgrade; live snapshot can refresh metadata, confirmation is idempotent
    return {
      decision: 'same_version',
      record: source === 'server_snapshot' ? incoming : current,
      currentRevision,
      incomingRevision,
    };
  }

  // Case 2: Current has a verified revision, incoming lacks one -> NEVER assume incoming is newer
  if (currentRevision !== null && incomingRevision === null) {
    return {
      decision: 'ignore_unverified',
      record: current,
      currentRevision,
      incomingRevision: null,
    };
  }

  // Case 3: Current lacks a verified revision, incoming has one -> verified revision wins
  if (currentRevision === null && incomingRevision !== null) {
    return {
      decision: 'accept',
      record: incoming,
      currentRevision: null,
      incomingRevision,
    };
  }

  // Case 4: Neither record has a verified revision -> handle explicitly without blindly assuming newer
  const curMs = parseIsoTimestampMs(current.updatedAt);
  const incMs = parseIsoTimestampMs(incoming.updatedAt);

  if (curMs !== null && incMs !== null) {
    if (incMs < curMs) {
      return {
        decision: 'ignore_stale',
        record: current,
        currentRevision: null,
        incomingRevision: null,
      };
    }
    if (incMs === curMs) {
      return {
        decision: 'same_version',
        record: source === 'server_snapshot' ? incoming : current,
        currentRevision: null,
        incomingRevision: null,
      };
    }
    return {
      decision: 'accept',
      record: incoming,
      currentRevision: null,
      incomingRevision: null,
    };
  }

  if (source === 'save_confirmation' && curMs !== null && incMs === null) {
    return {
      decision: 'ignore_unverified',
      record: current,
      currentRevision: null,
      incomingRevision: null,
    };
  }

  // Live server snapshot for legacy unversioned records, or both lack revision & timestamp
  if (
    source === 'save_confirmation' &&
    current.contentHash &&
    incoming.contentHash &&
    current.contentHash === incoming.contentHash
  ) {
    return {
      decision: 'same_version',
      record: current,
      currentRevision: null,
      incomingRevision: null,
    };
  }

  return {
    decision: 'accept',
    record: incoming,
    currentRevision: null,
    incomingRevision: null,
  };
}

/**
 * Builds an update precondition from a server-confirmed parameter snapshot.
 * Includes BOTH `expectedRevision` (0 for legacy documents without `revision`) and
 * `expectedContentHash` so concurrent edits are caught reliably on both legacy and revisioned docs.
 */
export function buildParameterUpdatePrecondition(
  record: Record<string, any>
): ParameterWritePrecondition {
  return {
    mode: 'update',
    expectedRevision: extractParameterRevision(record),
    expectedContentHash: computeExistingParameterHash(record),
  };
}

export interface MergeMacroParametersOptions {
  /** Keys known to have been deleted on the server in the current session. */
  deletedKeys?: ReadonlySet<string>;
  /** Keys explicitly created in this operation (`mode: 'create'`), permitted to appear after prior deletion. */
  createdKeys?: ReadonlySet<string>;
  /** Origin of incoming records. Defaults to `'save_confirmation'` (strict monotonic & deletion guard). */
  source?: 'save_confirmation' | 'server_snapshot';
}

/**
 * Single Source of Truth helper for merging macro parameters into an existing list by `key`.
 * - Preserves all untouched keys and their relative order (NEVER replaces the whole collection with a partial slice).
 * - Applies `reconcileIncomingMacroParameterVersion` so older/unverified revisions NEVER overwrite newer confirmed versions.
 * - Refuses to revive keys marked deleted on the server unless explicitly created (`createdKeys`).
 */
export function mergeMacroParametersByKey<
  T extends { key: string; revision?: number; updatedAt?: string; contentHash?: string },
>(
  existing: readonly T[],
  saved: readonly T[],
  options?: MergeMacroParametersOptions
): T[] {
  if (saved.length === 0) {
    return [...existing];
  }
  const source = options?.source ?? 'save_confirmation';
  const deletedKeys = options?.deletedKeys;
  const createdKeys = options?.createdKeys;

  const savedByKey = new Map<string, T>();
  for (const item of saved) {
    const prevIncoming = savedByKey.get(item.key);
    if (!prevIncoming) {
      savedByKey.set(item.key, item);
    } else {
      const reconciled = reconcileIncomingMacroParameterVersion(prevIncoming, item, { source });
      if (reconciled.record) {
        savedByKey.set(item.key, reconciled.record);
      }
    }
  }

  const merged: T[] = [];
  const seen = new Set<string>();
  for (const item of existing) {
    const incoming = savedByKey.get(item.key);
    if (!incoming) {
      merged.push(item);
    } else {
      const isDeleted = Boolean(deletedKeys?.has(item.key));
      const allowRevive = Boolean(createdKeys?.has(item.key) || source === 'server_snapshot');
      const reconciled = reconcileIncomingMacroParameterVersion(item, incoming, {
        source,
        isDeletedOnServer: isDeleted,
        allowRevive,
      });
      merged.push(reconciled.record ?? item);
    }
    seen.add(item.key);
  }

  for (const [key, item] of savedByKey.entries()) {
    if (seen.has(key)) continue;
    const isDeleted = Boolean(deletedKeys?.has(key));
    const allowRevive = Boolean(createdKeys?.has(key) || source === 'server_snapshot');
    if (isDeleted && !allowRevive) {
      continue;
    }
    merged.push(item);
  }
  return merged;
}

/**
 * Builds the canonical `ParameterInputPayload` sent by BOTH single (`saveMacroParameter`)
 * and bulk (`bulkSaveMacroParameters`) client write paths so they never diverge in meaning.
 */
export function buildMacroParameterWritePayload(
  param: MacroParameterWriteSource,
  precondition?: ParameterWritePrecondition
): ParameterInputPayload {
  const key = param.key.trim();
  const def = getParameterDefinition(key);
  const resolvedType = resolveCanonicalParameterType(key, {
    valueType: param.valueType,
    isPercentage: param.isPercentage,
    unit: param.unit,
  });

  const nameAr =
    def?.nameAr ??
    (typeof param.nameAr === 'string' && param.nameAr.trim() !== '' ? param.nameAr.trim() : undefined);
  const category: ParameterCategory | undefined =
    def?.category ?? (isValidParameterCategory(param.category) ? param.category : undefined);
  const description = (param.descriptionAr ?? param.description ?? def?.descriptionAr ?? '').trim();
  const unit =
    (typeof param.unit === 'string' && param.unit.trim() !== '' ? param.unit.trim() : '') ||
    resolvedType.defaultUnit;
  const effectivePrecondition = precondition ?? param.precondition;

  return {
    key,
    ...(nameAr ? { nameAr } : {}),
    value: param.value,
    description: description || nameAr || key,
    scope: 'global',
    ticker: null,
    unit,
    ...(category ? { category } : {}),
    valueType: resolvedType.valueType,
    isPercentage: resolvedType.isPercentage,
    asOfDate: param.asOfDate || '',
    source: param.source || 'لوحة الإدارة',
    ...(param.rfMethodology ? { rfMethodology: normalizeRfMethodology(param.rfMethodology) } : {}),
    ...(param.currency === 'EGP' || param.currency === 'USD' ? { currency: param.currency } : {}),
    ...(param.forecastHorizonYears != null
      ? { forecastHorizonYears: param.forecastHorizonYears }
      : {}),
    ...(effectivePrecondition ? { precondition: effectivePrecondition } : {}),
  };
}

export interface ParameterImportWriteSource extends MacroParameterWriteSource {
  scope: 'global' | 'company';
  ticker?: string | null;
  sourceRow?: number;
}

/**
 * Builds the canonical `ParameterInputPayload` (plus optional `sourceRow`) for an imported
 * Excel parameter row (both `global` and `company` scopes) so `DataHubView` and tests send
 * the exact same type/metadata/precondition fields that preview & server validation expect.
 */
export function buildParameterWritePayloadFromImport(
  row: ParameterImportWriteSource
): ParameterInputPayload & { sourceRow?: number } {
  const key = row.key.trim();
  const def = getParameterDefinition(key);
  const resolvedType = resolveCanonicalParameterType(key, {
    valueType: row.valueType,
    isPercentage: row.isPercentage,
    unit: row.unit,
  });
  const scope = row.scope === 'company' ? 'company' : 'global';
  const ticker = scope === 'company' ? (row.ticker ?? null) : null;
  const nameAr =
    def?.nameAr ??
    (typeof row.nameAr === 'string' && row.nameAr.trim() !== '' ? row.nameAr.trim() : undefined);
  const category: ParameterCategory | undefined =
    def?.category ?? (isValidParameterCategory(row.category) ? row.category : undefined);
  const description = (row.description ?? row.descriptionAr ?? def?.descriptionAr ?? '').trim();
  const unit =
    (typeof row.unit === 'string' && row.unit.trim() !== '' ? row.unit.trim() : '') ||
    def?.unit ||
    resolvedType.defaultUnit;

  return {
    key,
    ...(nameAr ? { nameAr } : {}),
    value: row.value,
    description,
    scope,
    ticker,
    unit,
    ...(category ? { category } : {}),
    valueType: resolvedType.valueType,
    isPercentage: resolvedType.isPercentage,
    asOfDate: row.asOfDate || '',
    source: row.source || 'استيراد All_Parameters.xlsx',
    ...(row.rfMethodology ? { rfMethodology: normalizeRfMethodology(row.rfMethodology) } : {}),
    ...(row.currency === 'EGP' || row.currency === 'USD' ? { currency: row.currency } : {}),
    ...(row.forecastHorizonYears != null
      ? { forecastHorizonYears: row.forecastHorizonYears }
      : {}),
    ...(row.precondition ? { precondition: row.precondition } : {}),
    ...(typeof row.sourceRow === 'number' ? { sourceRow: row.sourceRow } : {}),
  };
}

export function getParameterDocumentPath(
  param: Pick<ParameterInputPayload, 'scope' | 'key' | 'ticker'>
): string {
  return param.scope === 'global'
    ? `macro_params/${param.key}`
    : `company_assumptions/${param.ticker!}/parameters/${param.key}`;
}

export function computeExistingParameterHash(
  existingData: Record<string, any> | undefined
): string | null {
  if (!existingData || existingData.isDeleted === true) return null;
  if (typeof existingData.contentHash === 'string' && existingData.contentHash.startsWith('mzh1_')) {
    return existingData.contentHash;
  }
  return computeRecordBusinessHash('parameter', existingData);
}

/**
 * Verifies optimistic concurrency preconditions inside an atomic transaction BEFORE
 * any skip or write decision is made. Never converts a conflict into a skip or success.
 */
export function verifyParameterPreconditions(
  validatedParams: readonly ParameterInputPayload[],
  existingDocsByPath: Map<string, Record<string, any> | undefined>
): void {
  const conflicts: ParameterConcurrencyConflictItem[] = [];

  for (const p of validatedParams) {
    const pre = p.precondition;
    const docPath = getParameterDocumentPath(p);
    const existing = existingDocsByPath.get(docPath);
    const isPresent = Boolean(existing && existing.isDeleted !== true);
    const serverRevision = isPresent ? extractParameterRevision(existing) : null;
    const serverContentHash = isPresent ? computeExistingParameterHash(existing) : null;
    const serverValue = isPresent && typeof existing?.value === 'number' ? existing.value : null;
    const serverUpdatedAt =
      isPresent && typeof existing?.updatedAt === 'string' ? existing.updatedAt : null;
    const serverUpdatedBy =
      isPresent && typeof existing?.updatedBy === 'string' ? existing.updatedBy : null;
    const label = p.scope === 'company' && p.ticker ? `${p.ticker}/${p.key}` : p.key;

    if (!pre) {
      if (p.scope === 'global') {
        conflicts.push({
          key: p.key,
          scope: p.scope,
          ticker: p.ticker,
          docPath,
          reason: 'MISSING_PRECONDITION',
          expectedRevision: null,
          serverRevision,
          expectedContentHash: null,
          serverContentHash,
          serverValue,
          serverUpdatedAt,
          serverUpdatedBy,
          messageAr: `مرفوض: شرط التزامن (precondition) إلزامي عند كتابة المعامل العام (${label})؛ لا يُسمح بالكتابة بدون mode="create" أو mode="update" مع نسخة أساس صالحة.`,
        });
      }
      continue;
    }

    if (pre.mode === 'create') {
      if (isPresent) {
        conflicts.push({
          key: p.key,
          scope: p.scope,
          ticker: p.ticker,
          docPath,
          reason: 'ALREADY_EXISTS',
          expectedRevision: null,
          serverRevision,
          expectedContentHash: null,
          serverContentHash,
          serverValue,
          serverUpdatedAt,
          serverUpdatedBy,
          messageAr: `تعارض إنشاء: المعامل (${label}) موجود بالفعل على الخادم (إصدار ${serverRevision ?? 0})؛ لا يمكن استبداله عبر عملية إضافة جديدة.`,
        });
      }
      continue;
    }

    // mode === 'update'
    const hasExpectedRevision =
      typeof pre.expectedRevision === 'number' &&
      Number.isInteger(pre.expectedRevision) &&
      pre.expectedRevision >= 0;
    const hasExpectedHash =
      typeof pre.expectedContentHash === 'string' && pre.expectedContentHash.trim() !== '';

    if (!hasExpectedRevision && !hasExpectedHash) {
      conflicts.push({
        key: p.key,
        scope: p.scope,
        ticker: p.ticker,
        docPath,
        reason: 'INCOMPLETE_PRECONDITION',
        expectedRevision: null,
        serverRevision,
        expectedContentHash: null,
        serverContentHash,
        serverValue,
        serverUpdatedAt,
        serverUpdatedBy,
        messageAr: `مرفوض: شرط التحديث المتزامن للمعامل (${label}) ناقص؛ يتطلب expectedRevision أو expectedContentHash صالحاً ولا يُستنتج من الخادم.`,
      });
      continue;
    }

    if (!isPresent) {
      conflicts.push({
        key: p.key,
        scope: p.scope,
        ticker: p.ticker,
        docPath,
        reason: 'DELETED_ON_SERVER',
        expectedRevision: pre.expectedRevision ?? null,
        serverRevision: null,
        expectedContentHash: pre.expectedContentHash ?? null,
        serverContentHash: null,
        serverValue: null,
        serverUpdatedAt: null,
        serverUpdatedBy: null,
        messageAr: `تعارض حذف: المعامل (${label}) لم يعد موجوداً على الخادم (تم حذفه بعد بدء التحرير)؛ لا يُعاد إنشاؤه تلقائياً عند الحفظ.`,
      });
      continue;
    }

    if (typeof pre.expectedRevision === 'number' && serverRevision !== pre.expectedRevision) {
      conflicts.push({
        key: p.key,
        scope: p.scope,
        ticker: p.ticker,
        docPath,
        reason: 'REVISION_MISMATCH',
        expectedRevision: pre.expectedRevision,
        serverRevision,
        expectedContentHash: pre.expectedContentHash ?? null,
        serverContentHash,
        serverValue,
        serverUpdatedAt,
        serverUpdatedBy,
        messageAr: `تعارض إصدار للمعامل (${label}): الإصدار الأساسي المتوقع (${pre.expectedRevision}) يختلف عن الإصدار الحالي على الخادم (${serverRevision})؛ تم تعديل السجل من جلسة أخرى.`,
      });
      continue;
    }

    if (
      typeof pre.expectedContentHash === 'string' &&
      pre.expectedContentHash !== '' &&
      serverContentHash !== pre.expectedContentHash
    ) {
      conflicts.push({
        key: p.key,
        scope: p.scope,
        ticker: p.ticker,
        docPath,
        reason: 'HASH_MISMATCH',
        expectedRevision: pre.expectedRevision ?? null,
        serverRevision,
        expectedContentHash: pre.expectedContentHash,
        serverContentHash,
        serverValue,
        serverUpdatedAt,
        serverUpdatedBy,
        messageAr: `تعارض محتوى للمعامل (${label}): تغيّرت النسخة المحفوظة على الخادم بعد بدء التحرير أو المعاينة؛ أعد المزامنة وراجع الفرق قبل الحفظ.`,
      });
    }
  }

  if (conflicts.length > 0) {
    throw new ParameterConcurrencyConflictError(conflicts);
  }
}

/**
 * Single authoritative Firestore document builder for `macro_params/{key}`
 * used identically by both `bulk_parameters` and `macro_parameter` in Cloud Functions.
 *
 * Custom parameters are NEVER auto-enabled in the valuation engine (`enabledInEngine: false`).
 */
export function buildFirestoreGlobalParameterDoc(
  validated: ParameterInputPayload,
  stamp: ParameterDocumentProvenance & { sourceRow: number; contentHash: string; revision: number }
): Record<string, unknown> {
  const def = getParameterDefinition(validated.key);
  const resolvedType = resolveCanonicalParameterType(validated.key, {
    valueType: validated.valueType,
    isPercentage: validated.isPercentage,
    unit: validated.unit,
  });

  return {
    key: validated.key,
    nameAr: def?.nameAr || validated.nameAr || validated.key,
    descriptionAr: validated.description || def?.descriptionAr || '',
    value: validated.value,
    category: def?.category || validated.category || 'macro_inflation',
    valueType: resolvedType.valueType,
    isPercentage: resolvedType.isPercentage,
    parameterTypeSource: resolvedType.typeSource,
    unit: validated.unit,
    scope: 'global',
    ticker: null,
    asOfDate: validated.asOfDate,
    source: validated.source,
    enabledInEngine: def ? def.enabledInEngine : false,
    ...(def?.modeNoteAr ? { modeNoteAr: def.modeNoteAr } : {}),
    ...(validated.rfMethodology !== undefined ? { rfMethodology: validated.rfMethodology } : {}),
    ...(validated.currency !== undefined ? { currency: validated.currency } : {}),
    ...(validated.forecastHorizonYears !== undefined
      ? { forecastHorizonYears: validated.forecastHorizonYears }
      : {}),
    ...stamp,
  };
}

/**
 * Single authoritative Firestore document builder for `company_assumptions/{ticker}/parameters/{key}`.
 */
export function buildFirestoreCompanyParameterDoc(
  validated: ParameterInputPayload,
  stamp: ParameterDocumentProvenance & { sourceRow: number; contentHash: string; revision: number }
): Record<string, unknown> {
  const def = getParameterDefinition(validated.key);
  const resolvedType = resolveCanonicalParameterType(validated.key, {
    valueType: validated.valueType,
    isPercentage: validated.isPercentage,
    unit: validated.unit,
  });

  return {
    key: validated.key,
    nameAr: def?.nameAr || validated.nameAr || validated.key,
    value: validated.value,
    description: validated.description,
    scope: 'company',
    ticker: validated.ticker,
    unit: validated.unit,
    valueType: resolvedType.valueType,
    isPercentage: resolvedType.isPercentage,
    parameterTypeSource: resolvedType.typeSource,
    asOfDate: validated.asOfDate,
    source: validated.source,
    ...(validated.rfMethodology !== undefined ? { rfMethodology: validated.rfMethodology } : {}),
    ...(validated.currency !== undefined ? { currency: validated.currency } : {}),
    ...(validated.forecastHorizonYears !== undefined
      ? { forecastHorizonYears: validated.forecastHorizonYears }
      : {}),
    ...stamp,
  };
}

/**
 * Shared production server planner executed inside an atomic transaction by Cloud Functions
 * for both `bulk_parameters` and `macro_parameter` operations.
 */
export function planParameterPersistenceWrites(params: {
  rawInputs: unknown[];
  existingDocsByPath: Map<string, Record<string, any> | undefined>;
  provenance: ParameterDocumentProvenance;
  maxBatch?: number;
}): PlannedParameterWriteBatch {
  const validatedParams = validateParameterRecords(params.rawInputs, params.maxBatch);

  // Optimistic concurrency preconditions MUST be verified BEFORE any unchanged-skip check.
  verifyParameterPreconditions(validatedParams, params.existingDocsByPath);

  const writes: PlannedParameterWrite[] = [];
  const touchedCompanyTickers = new Set<string>();
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedUnchangedCount = 0;

  for (let idx = 0; idx < validatedParams.length; idx++) {
    const p = validatedParams[idx];
    const rawItem = params.rawInputs[idx] as Record<string, unknown> | undefined;
    const sourceRow = typeof rawItem?.sourceRow === 'number' ? rawItem.sourceRow : idx + 1;
    const docPath = getParameterDocumentPath(p);
    const contentHash = computeRecordBusinessHash('parameter', p);
    const existing = params.existingDocsByPath.get(docPath);
    const existingRevision = extractParameterRevision(existing);

    // Server-side guard against silently erasing an existing custom parameter's explicit type.
    if (!getParameterDefinition(p.key) && existing && existing.isDeleted !== true) {
      const existingType = resolveCanonicalParameterType(p.key, {
        valueType: typeof existing.valueType === 'string' ? existing.valueType : null,
        isPercentage: typeof existing.isPercentage === 'boolean' ? existing.isPercentage : null,
        unit: typeof existing.unit === 'string' ? existing.unit : null,
      });
      const incomingType = resolveCanonicalParameterType(p.key, {
        valueType: p.valueType,
        isPercentage: p.isPercentage,
        unit: p.unit,
      });
      if (existingType.typeSource === 'explicit' && incomingType.typeSource === 'unspecified') {
        throw new Error(
          `مرفوض: لا يمكن تحديث المعامل المخصص (${p.key}) بدون تعريف نوع صريح (ValueType / IsPercentage) لأن السجل الحالي معرّف بالفعل كـ (${existingType.valueType} / isPercentage=${String(existingType.isPercentage)})؛ أرسل النوع الصريح لمنع محوه بصمت.`
        );
      }
    }

    const existingHash = computeExistingParameterHash(existing);

    if (existing && existing.isDeleted !== true && existingHash === contentHash) {
      skippedUnchangedCount += 1;
      writes.push({
        docPath,
        scope: p.scope,
        key: p.key,
        ticker: p.ticker,
        status: 'skip',
        revision: existingRevision,
        contentHash,
        existingHash,
        validated: p,
        document: null,
      });
      continue;
    }

    const isInsert = !existing || existing.isDeleted === true;
    if (isInsert) insertedCount += 1;
    else updatedCount += 1;

    const nextRevision = existingRevision + 1;
    const stamp = { ...params.provenance, sourceRow, contentHash, revision: nextRevision };
    const document =
      p.scope === 'global'
        ? buildFirestoreGlobalParameterDoc(p, stamp)
        : buildFirestoreCompanyParameterDoc(p, stamp);

    if (p.scope === 'company' && p.ticker) {
      touchedCompanyTickers.add(p.ticker);
    }

    writes.push({
      docPath,
      scope: p.scope,
      key: p.key,
      ticker: p.ticker,
      status: isInsert ? 'insert' : 'update',
      revision: nextRevision,
      contentHash,
      existingHash,
      validated: p,
      document,
    });
  }

  return {
    validatedParams,
    writes,
    touchedCompanyTickers: Array.from(touchedCompanyTickers),
    insertedCount,
    updatedCount,
    skippedUnchangedCount,
  };
}

/**
 * Canonical reader transform for `macro_params/{docId}` documents read from Firestore.
 * Guarantees registry precedence for known parameters, preserves explicit custom type metadata
 * and server-controlled `revision`, and marks legacy untyped custom documents explicitly as
 * `parameterTypeSource: 'unspecified'`.
 */
export function normalizeMacroParameterFromFirestore(
  docId: string,
  rawData: Record<string, any>
): CanonicalMacroParameterRecord {
  const key = docId.trim();
  const def = getParameterDefinition(key);
  const resolvedType = resolveCanonicalParameterType(key, {
    valueType: typeof rawData.valueType === 'string' ? rawData.valueType : null,
    isPercentage: typeof rawData.isPercentage === 'boolean' ? rawData.isPercentage : null,
    unit: typeof rawData.unit === 'string' ? rawData.unit : null,
  });

  const category: ParameterCategory =
    def?.category ??
    (isValidParameterCategory(rawData.category) ? rawData.category : 'macro_inflation');

  const unit =
    (typeof rawData.unit === 'string' && rawData.unit.trim() !== '' ? rawData.unit.trim() : '') ||
    resolvedType.defaultUnit;

  const revision =
    typeof rawData.revision === 'number' && Number.isInteger(rawData.revision) && rawData.revision >= 0
      ? rawData.revision
      : undefined;

  return {
    ...rawData,
    key,
    nameAr:
      def?.nameAr ||
      (typeof rawData.nameAr === 'string' && rawData.nameAr.trim() !== '' ? rawData.nameAr.trim() : key),
    descriptionAr:
      (typeof rawData.descriptionAr === 'string' && rawData.descriptionAr.trim() !== ''
        ? rawData.descriptionAr
        : typeof rawData.description === 'string' && rawData.description.trim() !== ''
        ? rawData.description
        : def?.descriptionAr || ''),
    value: rawData.value,
    category,
    valueType: resolvedType.valueType,
    isPercentage: resolvedType.isPercentage,
    parameterTypeSource: resolvedType.typeSource,
    unit,
    scope: 'global',
    ticker: null,
    asOfDate: typeof rawData.asOfDate === 'string' ? rawData.asOfDate : '',
    source: typeof rawData.source === 'string' ? rawData.source : '',
    enabledInEngine: def ? def.enabledInEngine : false,
    ...(revision !== undefined ? { revision } : {}),
    ...(def?.modeNoteAr
      ? { modeNoteAr: def.modeNoteAr }
      : typeof rawData.modeNoteAr === 'string'
      ? { modeNoteAr: rawData.modeNoteAr }
      : {}),
    ...(rawData.rfMethodology
      ? { rfMethodology: normalizeRfMethodology(rawData.rfMethodology) }
      : {}),
  };
}

export interface CanonicalCompanyOverrideRecord {
  key: string;
  nameAr: string;
  value: number;
  description: string;
  scope: 'company';
  ticker: string;
  valueType: ParameterValueType | null;
  isPercentage: boolean | null;
  parameterTypeSource: ParameterTypeSource;
  unit: string;
  currency?: 'EGP' | 'USD' | string | null;
  forecastHorizonYears?: number | null;
  asOfDate: string;
  source: string;
  rfMethodology?: CanonicalRfMethodology;
  revision?: number;
  contentHash?: string;
  updatedAt?: string;
  serverUpdatedAt?: unknown;
  updatedBy?: string;
  isDeleted?: boolean;
}

/**
 * Canonical reader transform for `company_assumptions/{ticker}/parameters/{docId}`.
 * Mirrors `normalizeMacroParameterFromFirestore` so company-scoped custom parameters
 * preserve their exact explicit type metadata and `revision` across read, export, and re-import.
 */
export function normalizeCompanyOverrideFromFirestore(
  docId: string,
  normalizedTickerValue: string,
  rawData: Record<string, any>
): CanonicalCompanyOverrideRecord {
  const key = docId.trim();
  const def = getParameterDefinition(key);
  const resolvedType = resolveCanonicalParameterType(key, {
    valueType: typeof rawData.valueType === 'string' ? rawData.valueType : null,
    isPercentage: typeof rawData.isPercentage === 'boolean' ? rawData.isPercentage : null,
    unit: typeof rawData.unit === 'string' ? rawData.unit : null,
  });
  const unit =
    (typeof rawData.unit === 'string' && rawData.unit.trim() !== '' ? rawData.unit.trim() : '') ||
    def?.unit ||
    resolvedType.defaultUnit;

  const revision =
    typeof rawData.revision === 'number' && Number.isInteger(rawData.revision) && rawData.revision >= 0
      ? rawData.revision
      : undefined;

  return {
    ...rawData,
    key,
    nameAr:
      def?.nameAr ||
      (typeof rawData.nameAr === 'string' && rawData.nameAr.trim() !== '' ? rawData.nameAr.trim() : key),
    value: rawData.value,
    description:
      typeof rawData.description === 'string' && rawData.description.trim() !== ''
        ? rawData.description
        : typeof rawData.descriptionAr === 'string' && rawData.descriptionAr.trim() !== ''
        ? rawData.descriptionAr
        : def?.descriptionAr || '',
    scope: 'company',
    ticker: normalizedTickerValue,
    valueType: resolvedType.valueType,
    isPercentage: resolvedType.isPercentage,
    parameterTypeSource: resolvedType.typeSource,
    unit,
    asOfDate: typeof rawData.asOfDate === 'string' ? rawData.asOfDate : '',
    source: typeof rawData.source === 'string' ? rawData.source : '',
    ...(revision !== undefined ? { revision } : {}),
    ...(rawData.rfMethodology
      ? { rfMethodology: normalizeRfMethodology(rawData.rfMethodology) }
      : {}),
  };
}


