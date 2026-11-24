/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Central quarterly manual-audit diffing and read-model sanitization.
 *
 * Contract:
 * - Read model (`QuarterlyFinancialRecord.manualCorrections`) NEVER contains `null` deletion markers
 *   and is omitted (`undefined`) when no active corrections remain.
 * - Write payload (`QuarterlyFinancialRecordWritePayload.manualCorrections`) uses the server's
 *   explicit nested-map contract: `{ [revertedField]: null }` deletes ONLY the targeted active
 *   correction on the server, while omitting untouched keys preserves other active corrections
 *   and concurrent server edits.
 * - `originalValues` is preserved across reverts, including explicit `0` and `null` (BLANK) values.
 */

import type {
  ManualCorrectionEntry,
  ManualCorrectionsMap,
  ManualCorrectionsWritePatch,
  QuarterlyFinancialRecord,
  QuarterlyFinancialRecordWritePayload,
} from '../../types';
import { LEGACY_QUARTERLY_DPS_FIELDS, stripLegacyQuarterlyDpsFromRecord } from '../contracts';

const AUDIT_IGNORED_FIELDS = new Set<string>([
  'updatedAt',
  'originalValues',
  'manualCorrections',
  'extendedFields',
  'contentHash',
  'serverUpdatedAt',
  'updatedBy',
  'importId',
  'sourceFile',
  'sourceSheet',
  'sourceRow',
  'schemaVersion',
  'isDeleted',
  ...(LEGACY_QUARTERLY_DPS_FIELDS as readonly string[]),
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/**
 * Normalizes a scalar field value for audit comparison while strictly preserving
 * the distinction between numeric `0`, explicit `null` (BLANK), and booleans/strings.
 */
export function normalizeAuditScalar(value: unknown): string | number | boolean | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  return String(value);
}

/**
 * Sanitizes a raw `manualCorrections` map for the client read model:
 * - Drops any `null` / `undefined` / non-object entries (never leaks deletion markers into UI/cache).
 * - Drops legacy DPS keys.
 * - Returns `undefined` when no active corrections exist.
 */
export function sanitizeReadManualCorrections(raw: unknown): ManualCorrectionsMap | undefined {
  if (!isPlainObject(raw)) return undefined;
  const clean: ManualCorrectionsMap = {};
  for (const [key, entry] of Object.entries(raw)) {
    if ((LEGACY_QUARTERLY_DPS_FIELDS as readonly string[]).includes(key)) continue;
    if (!isPlainObject(entry)) continue;
    const typed = entry as Record<string, unknown>;
    clean[key] = {
      field: typeof typed.field === 'string' && typed.field.trim() ? typed.field : key,
      originalValue: normalizeAuditScalar(typed.originalValue),
      correctedValue: normalizeAuditScalar(typed.correctedValue),
      editedAt: typeof typed.editedAt === 'string' ? typed.editedAt : '',
      ...(typeof typed.reasonAr === 'string' && typed.reasonAr.trim()
        ? { reasonAr: typed.reasonAr }
        : {}),
    };
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * Sanitizes a raw `originalValues` map for the client read model while strictly
 * preserving explicit scalar `null` (BLANK) and numeric `0` values.
 */
export function sanitizeReadOriginalValues(
  raw: unknown
): Record<string, string | number | boolean | null> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val === undefined) continue;
    if ((LEGACY_QUARTERLY_DPS_FIELDS as readonly string[]).includes(key)) continue;
    clean[key] = normalizeAuditScalar(val);
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * Normalizes a quarterly record read from Firestore or local state so:
 * - `manualCorrections` is either a non-empty `ManualCorrectionsMap` or omitted (`undefined`).
 * - `originalValues` is either a non-empty scalar map (preserving `0` and `null`) or omitted (`undefined`).
 * - Legacy DPS fields are stripped.
 */
export function sanitizeQuarterlyReadRecord(
  record: QuarterlyFinancialRecord
): QuarterlyFinancialRecord {
  const base = stripLegacyQuarterlyDpsFromRecord({ ...record }) as Record<string, any>;
  const cleanCorrections = sanitizeReadManualCorrections(base.manualCorrections);
  const cleanOriginals = sanitizeReadOriginalValues(base.originalValues);

  delete base.manualCorrections;
  delete base.originalValues;

  if (cleanOriginals) {
    base.originalValues = cleanOriginals;
  }
  if (cleanCorrections) {
    base.manualCorrections = cleanCorrections;
  }
  return base as QuarterlyFinancialRecord;
}

export interface QuarterlyEditSubmission {
  /** Clean read-model record without deletion markers (for client state / UI / cache). */
  readRecord: QuarterlyFinancialRecord;
  /** Server write payload carrying explicit `{ [revertedField]: null }` deletions for `manualCorrections`. */
  writePayload: QuarterlyFinancialRecordWritePayload;
  /** Fields whose active manual correction was cleared (reverted to original value). */
  clearedCorrectionFields: string[];
  /** Fields whose active manual correction was created or updated. */
  updatedCorrectionFields: string[];
}

/**
 * Builds both the clean client read record and the explicit server write payload
 * for an edit in `EditQuarterlyRecordModal`.
 *
 * Guarantees:
 * 1. Never re-spreads stale `manualCorrections` from `normalizedFormData` after local deletion.
 * 2. Emits explicit `manualCorrections: { [field]: null }` deletion markers in `writePayload`
 *    ONLY for cleared fields (so untouched corrections and concurrent edits are preserved).
 * 3. Preserves `originalValues` (including `0` and `null`) across edits and reverts.
 * 4. Keeps `readRecord` strictly clean with zero `null` deletion markers.
 */
export function buildQuarterlyEditSubmission(
  originalRecord: QuarterlyFinancialRecord,
  normalizedFormData: QuarterlyFinancialRecord,
  nowIso: string = new Date().toISOString()
): QuarterlyEditSubmission {
  const existingOriginalValues = sanitizeReadOriginalValues(originalRecord.originalValues) ?? {};
  const existingManualCorrections =
    sanitizeReadManualCorrections(originalRecord.manualCorrections) ?? {};

  const nextOriginalValues: Record<string, string | number | boolean | null> = {
    ...existingOriginalValues,
  };
  const nextManualCorrections: ManualCorrectionsMap = {
    ...existingManualCorrections,
  };
  const manualCorrectionsWritePatch: ManualCorrectionsWritePatch = {};
  const clearedCorrectionFields: string[] = [];
  const updatedCorrectionFields: string[] = [];

  const allCandidateFields = new Set<string>([
    ...Object.keys(originalRecord),
    ...Object.keys(normalizedFormData),
    ...Object.keys(existingManualCorrections),
  ]);

  const origBag = originalRecord as unknown as Record<string, unknown>;
  const nextBag = normalizedFormData as unknown as Record<string, unknown>;

  for (const field of allCandidateFields) {
    if (AUDIT_IGNORED_FIELDS.has(field)) continue;

    const beforeVal = normalizeAuditScalar(origBag[field]);
    const afterVal = normalizeAuditScalar(nextBag[field]);
    const existingCorrection = existingManualCorrections[field];
    const hasOriginal = Object.prototype.hasOwnProperty.call(nextOriginalValues, field);

    const baselineOriginal = hasOriginal
      ? normalizeAuditScalar(nextOriginalValues[field])
      : existingCorrection && Object.prototype.hasOwnProperty.call(existingCorrection, 'originalValue')
      ? normalizeAuditScalar(existingCorrection.originalValue)
      : beforeVal;

    if (beforeVal === afterVal) {
      // Self-heal stale active correction if the current value already matches its original value
      if (existingCorrection && afterVal === baselineOriginal) {
        delete nextManualCorrections[field];
        manualCorrectionsWritePatch[field] = null;
        clearedCorrectionFields.push(field);
      }
      continue;
    }

    if (afterVal === baselineOriginal) {
      delete nextManualCorrections[field];
      if (existingCorrection || hasOriginal) {
        manualCorrectionsWritePatch[field] = null;
        clearedCorrectionFields.push(field);
      }
    } else {
      nextOriginalValues[field] = baselineOriginal;
      const entry: ManualCorrectionEntry = {
        field,
        originalValue: baselineOriginal,
        correctedValue: afterVal,
        editedAt: nowIso,
      };
      nextManualCorrections[field] = entry;
      manualCorrectionsWritePatch[field] = entry;
      updatedCorrectionFields.push(field);
    }
  }

  // Strip audit maps before constructing readRecord & writePayload so stale entries can NEVER leak back
  const baseRead = stripLegacyQuarterlyDpsFromRecord({ ...normalizedFormData }) as Record<string, any>;
  delete baseRead.manualCorrections;
  delete baseRead.originalValues;

  const hasOriginals = Object.keys(nextOriginalValues).length > 0;
  const hasActiveCorrections = Object.keys(nextManualCorrections).length > 0;
  const hasCorrectionPatch = Object.keys(manualCorrectionsWritePatch).length > 0;

  const readRecord: QuarterlyFinancialRecord = {
    ...(baseRead as QuarterlyFinancialRecord),
    ...(hasOriginals ? { originalValues: nextOriginalValues } : {}),
    ...(hasActiveCorrections ? { manualCorrections: nextManualCorrections } : {}),
    updatedAt: nowIso,
  };

  // For the server write payload, omit `extendedFields` (not edited by EditQuarterlyRecordModal)
  // so existing server extendedFields are preserved non-destructively under the central nested-map contract.
  const baseWrite = { ...baseRead };
  delete baseWrite.extendedFields;

  const writePayload: QuarterlyFinancialRecordWritePayload = {
    ...(baseWrite as Omit<
      QuarterlyFinancialRecord,
      'manualCorrections' | 'originalValues' | 'extendedFields'
    >),
    ...(hasOriginals ? { originalValues: nextOriginalValues } : {}),
    ...(hasCorrectionPatch ? { manualCorrections: manualCorrectionsWritePatch } : {}),
    updatedAt: nowIso,
  };

  return {
    readRecord,
    writePayload,
    clearedCorrectionFields,
    updatedCorrectionFields,
  };
}
