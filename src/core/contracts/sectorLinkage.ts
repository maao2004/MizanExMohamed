/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single Source of Truth (SSOT) for Company ↔ Sector (sectorPE) linkage resolution
 * and server-side referential integrity validation across all write paths.
 */

import {
  cleanMetadataText,
  normalizeSectorDoc,
  normalizeSectorToken,
  sanitizeSectorId,
  type SectorDefinition,
  type SectorPeLoadStatus,
} from './sectorRegistry';

export class SectorGovernanceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectorGovernanceConflictError';
  }
}

export class SectorGovernanceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SectorGovernanceNotFoundError';
  }
}

export type CompanySectorLinkKind =
  | 'explicit_sector_id'
  | 'explicit_broken_ref'
  | 'explicit_unconfirmed_registry'
  | 'legacy_text_unambiguous'
  | 'legacy_text_ambiguous'
  | 'unlinked';

export interface CompanySectorLinkClassification {
  kind: CompanySectorLinkKind;
  matchedSectorId: string | null;
  explicitSectorId: string | null;
  evaluatedText: string | null;
  ambiguousSectorIds: string[];
  isLegacyTextOnly: boolean;
}

export interface CompanySectorLinkOptions {
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
}

export interface CompanySectorLike {
  isDeleted?: boolean;
  sectorId?: string | null;
  sector?: string | null;
  rawSector?: string | null;
}

function isRegistryUnconfirmed(
  allSectorDefs: ReadonlyArray<unknown> | null | undefined,
  options?: CompanySectorLinkOptions
): boolean {
  if (allSectorDefs === undefined || allSectorDefs === null) return true;
  if (options?.sectorPeConfirmed === false) return true;
  if (
    options?.sectorPeStatus === 'loading' ||
    options?.sectorPeStatus === 'error' ||
    options?.sectorPeStatus === 'permission_denied'
  ) {
    return true;
  }
  return false;
}

function defMatchesText(
  def: Pick<SectorDefinition, 'sectorId' | 'nameAr' | 'aliases'>,
  cleanedText: string,
  normText: string
): boolean {
  if (def.sectorId === cleanedText || def.nameAr.trim() === cleanedText) return true;
  if (
    normText &&
    (normalizeSectorToken(def.sectorId) === normText ||
      normalizeSectorToken(def.nameAr) === normText)
  ) {
    return true;
  }
  return def.aliases.some(
    (alias) => alias.trim() === cleanedText || (normText && normalizeSectorToken(alias) === normText)
  );
}

/**
 * Authoritative SSOT classifier for how a company record links to sectorPE.
 *
 * Rules:
 * 1. Explicit `sectorId` is strictly authoritative:
 *    - If `sectorPE` is omitted / loading / failed (`sectorPeConfirmed === false` or non-ready status)
 *      -> `explicit_unconfirmed_registry` (NEVER falsely claims the sector is missing/broken!).
 *    - If `sectorPE` is loaded and confirmed (INCLUDING an empty registry `[]`):
 *      - Exists in `allSectorDefs` (active or disabled, not deleted) -> `explicit_sector_id`.
 *      - Missing/deleted (or confirmed empty registry `[]`) -> `explicit_broken_ref` (NEVER falls back to text!).
 * 2. Text matching applies ONLY to legacy records WITHOUT an explicit `sectorId` when registry is confirmed:
 *    - Evaluates `sector` (or `rawSector` only if `sector` is empty/placeholder).
 *    - Links ONLY when matched unambiguously to a single sector definition; multiple matches -> `legacy_text_ambiguous`.
 */
export function classifyCompanySectorLinkage(
  companyData: CompanySectorLike | null | undefined,
  allSectorDefs?: ReadonlyArray<Pick<SectorDefinition, 'sectorId' | 'nameAr' | 'aliases' | 'status' | 'isDeleted'>> | null,
  options?: CompanySectorLinkOptions
): CompanySectorLinkClassification {
  if (!companyData || companyData.isDeleted === true) {
    return {
      kind: 'unlinked',
      matchedSectorId: null,
      explicitSectorId: null,
      evaluatedText: null,
      ambiguousSectorIds: [],
      isLegacyTextOnly: false,
    };
  }

  const explicitId = sanitizeSectorId(companyData.sectorId ?? '');
  const unconfirmed = isRegistryUnconfirmed(allSectorDefs, options);
  const validDefs = Array.isArray(allSectorDefs)
    ? allSectorDefs.filter((d) => d.isDeleted !== true)
    : [];

  if (explicitId) {
    if (unconfirmed) {
      return {
        kind: 'explicit_unconfirmed_registry',
        matchedSectorId: null,
        explicitSectorId: explicitId,
        evaluatedText: null,
        ambiguousSectorIds: [],
        isLegacyTextOnly: false,
      };
    }

    const exists = validDefs.some((d) => d.sectorId === explicitId);
    if (!exists) {
      return {
        kind: 'explicit_broken_ref',
        matchedSectorId: null,
        explicitSectorId: explicitId,
        evaluatedText: null,
        ambiguousSectorIds: [],
        isLegacyTextOnly: false,
      };
    }

    return {
      kind: 'explicit_sector_id',
      matchedSectorId: explicitId,
      explicitSectorId: explicitId,
      evaluatedText: null,
      ambiguousSectorIds: [],
      isLegacyTextOnly: false,
    };
  }

  // Legacy record WITHOUT explicit sectorId: text matching is strictly fallback-only and unambiguous-only.
  const evaluatedText = cleanMetadataText(companyData.sector) ?? cleanMetadataText(companyData.rawSector);
  if (unconfirmed || !evaluatedText || validDefs.length === 0) {
    return {
      kind: 'unlinked',
      matchedSectorId: null,
      explicitSectorId: null,
      evaluatedText,
      ambiguousSectorIds: [],
      isLegacyTextOnly: Boolean(evaluatedText),
    };
  }

  const normText = normalizeSectorToken(evaluatedText);
  const activeDefs = validDefs.filter((d) => d.status !== 'disabled');
  const disabledDefs = validDefs.filter((d) => d.status === 'disabled');

  const activeMatches = activeDefs.filter((d) => defMatchesText(d, evaluatedText, normText));
  if (activeMatches.length === 1) {
    return {
      kind: 'legacy_text_unambiguous',
      matchedSectorId: activeMatches[0].sectorId,
      explicitSectorId: null,
      evaluatedText,
      ambiguousSectorIds: [],
      isLegacyTextOnly: true,
    };
  }
  if (activeMatches.length > 1) {
    return {
      kind: 'legacy_text_ambiguous',
      matchedSectorId: null,
      explicitSectorId: null,
      evaluatedText,
      ambiguousSectorIds: activeMatches.map((d) => d.sectorId),
      isLegacyTextOnly: true,
    };
  }

  const disabledMatches = disabledDefs.filter((d) => defMatchesText(d, evaluatedText, normText));
  if (disabledMatches.length === 1) {
    return {
      kind: 'legacy_text_unambiguous',
      matchedSectorId: disabledMatches[0].sectorId,
      explicitSectorId: null,
      evaluatedText,
      ambiguousSectorIds: [],
      isLegacyTextOnly: true,
    };
  }
  if (disabledMatches.length > 1) {
    return {
      kind: 'legacy_text_ambiguous',
      matchedSectorId: null,
      explicitSectorId: null,
      evaluatedText,
      ambiguousSectorIds: disabledMatches.map((d) => d.sectorId),
      isLegacyTextOnly: true,
    };
  }

  return {
    kind: 'unlinked',
    matchedSectorId: null,
    explicitSectorId: null,
    evaluatedText,
    ambiguousSectorIds: [],
    isLegacyTextOnly: true,
  };
}

/**
 * Single Source of Truth matching rule for whether a company record references a sector definition.
 * Used identically by server-side governance checks, counting, reassignment, deletion, diagnostics,
 * migration reporting, and Admin UI impact previews.
 *
 * CRITICAL INVARIANTS:
 * - If `companyData.sectorId` is explicitly present, linkage belongs ONLY to that `sectorId`.
 *   NEVER falls back to `sector` or `rawSector` to match another sector.
 * - When `allSectorDefs` is supplied and confirmed (including `[]`), a sectorId absent from `allSectorDefs`
 *   does NOT match any sector.
 * - Text matching applies ONLY to legacy records WITHOUT an explicit `sectorId`.
 * - When `allSectorDefs` is supplied, ambiguous text matches NEVER link to any sector.
 */
export function companyMatchesSectorDefinition(
  companyData: CompanySectorLike | null | undefined,
  sectorId: string,
  sectorDef: Pick<SectorDefinition, 'sectorId' | 'nameAr' | 'aliases'> | null,
  allSectorDefs?: ReadonlyArray<Pick<SectorDefinition, 'sectorId' | 'nameAr' | 'aliases' | 'status' | 'isDeleted'>> | null,
  options?: CompanySectorLinkOptions
): boolean {
  if (!companyData || companyData.isDeleted === true) return false;
  const targetSectorId = sanitizeSectorId(sectorId);
  if (!targetSectorId) return false;

  const explicitId = sanitizeSectorId(companyData.sectorId ?? '');
  if (explicitId) {
    if (Array.isArray(allSectorDefs) && !isRegistryUnconfirmed(allSectorDefs, options)) {
      const classification = classifyCompanySectorLinkage(companyData, allSectorDefs, options);
      return (
        classification.kind === 'explicit_sector_id' &&
        classification.matchedSectorId === targetSectorId
      );
    }
    // Explicit sectorId is strictly authoritative — never fall back to rawSector/sector text.
    return explicitId === targetSectorId;
  }

  if (Array.isArray(allSectorDefs)) {
    const classification = classifyCompanySectorLinkage(companyData, allSectorDefs, options);
    return (
      classification.kind === 'legacy_text_unambiguous' &&
      classification.matchedSectorId === targetSectorId
    );
  }

  if (!sectorDef) return false;
  const textToCheck =
    cleanMetadataText(companyData.sector) ?? cleanMetadataText(companyData.rawSector);
  if (!textToCheck) return false;
  const normText = normalizeSectorToken(textToCheck);
  return defMatchesText(sectorDef, textToCheck, normText);
}

export interface CompanySectorWriteValidationInput {
  existingCompanyData: Record<string, any> | undefined;
  incomingPatch: Record<string, any>;
  getSectorDoc: (sectorId: string) => Promise<Record<string, any> | undefined>;
  isCreate?: boolean;
}

export interface CompanySectorWriteValidationResult {
  canonicalPatch: Record<string, any>;
  resolvedSector: SectorDefinition | null;
  preservedExistingDisabledSector: boolean;
}

/**
 * Centralized server-side referential integrity validator for EVERY company write path
 * (`company_metadata`, `create_company`, `applyStockAndQuarterAtomicWrite`, etc.).
 *
 * Enforces inside the caller's Firestore transaction:
 * - New assignments or sector changes MUST reference an existing, active, non-deleted,
 *   non-pendingDelete sector in `sectorPE` (`multiple: null` is explicitly allowed).
 * - Authoritative `sector` (nameAr) and `sectorClassification` are ALWAYS derived/verified
 *   from `sectorPE` — never trusting client-supplied spoofing or bank classification bypasses.
 * - Independent financial/metadata edits on a company already linked to a disabled sector
 *   ARE allowed without forcing a sector change, preserving existing disabled diagnostics.
 * - Preserves `rawSector` untouched for audit/conflict visibility.
 */
export async function validateAndCanonicalizeCompanySectorWrite(
  input: CompanySectorWriteValidationInput
): Promise<CompanySectorWriteValidationResult> {
  const { existingCompanyData, incomingPatch, getSectorDoc, isCreate = false } = input;
  const existing =
    existingCompanyData && existingCompanyData.isDeleted !== true ? existingCompanyData : undefined;
  const existingSectorId = sanitizeSectorId(existing?.sectorId ?? '');
  const existingSectorName = cleanMetadataText(existing?.sector);
  const existingClassification =
    existing?.sectorClassification === 'financial' ||
    existing?.sectorClassification === 'non_financial' ||
    existing?.sectorClassification === 'unknown'
      ? existing.sectorClassification
      : null;

  const canonicalPatch: Record<string, any> = { ...incomingPatch };

  const hasSectorIdKey =
    Object.prototype.hasOwnProperty.call(incomingPatch, 'sectorId') &&
    incomingPatch.sectorId !== undefined;
  const rawIncomingSectorId = hasSectorIdKey ? incomingPatch.sectorId : undefined;
  const incomingSectorId =
    rawIncomingSectorId !== undefined && rawIncomingSectorId !== null && rawIncomingSectorId !== ''
      ? sanitizeSectorId(rawIncomingSectorId)
      : null;

  if (
    hasSectorIdKey &&
    rawIncomingSectorId !== null &&
    rawIncomingSectorId !== '' &&
    !incomingSectorId
  ) {
    throw new SectorGovernanceConflictError('معرّف القطاع (sectorId) غير صالح.');
  }

  const hasSectorKey =
    Object.prototype.hasOwnProperty.call(incomingPatch, 'sector') &&
    incomingPatch.sector !== undefined;
  const incomingSectorText = hasSectorKey ? cleanMetadataText(incomingPatch.sector) : null;

  const hasClassKey =
    Object.prototype.hasOwnProperty.call(incomingPatch, 'sectorClassification') &&
    incomingPatch.sectorClassification !== undefined;
  const incomingClass = hasClassKey ? incomingPatch.sectorClassification : undefined;

  // Case 1: Assigning a new sectorId on creation OR changing sectorId on an existing company
  if (incomingSectorId && (isCreate || !existing || existingSectorId !== incomingSectorId)) {
    const rawSectorDoc = await getSectorDoc(incomingSectorId);
    if (!rawSectorDoc || rawSectorDoc.isDeleted === true) {
      throw new SectorGovernanceConflictError(
        `لا يمكن ربط الشركة بقطاع غير موجود أو محذوف في sectorPE (${incomingSectorId}).`
      );
    }
    const secDef = normalizeSectorDoc(incomingSectorId, rawSectorDoc);
    if (!secDef) {
      throw new SectorGovernanceConflictError(
        `تعريف القطاع (${incomingSectorId}) غير صالح في sectorPE.`
      );
    }
    if (secDef.status === 'disabled') {
      throw new SectorGovernanceConflictError(
        `لا يمكن ربط الشركة بالقطاع المعطّل "${secDef.nameAr}" (${secDef.sectorId})؛ اختر قطاعاً نشطاً من sectorPE.`
      );
    }
    if (secDef.pendingDelete === true) {
      throw new SectorGovernanceConflictError(
        `القطاع "${secDef.nameAr}" (${secDef.sectorId}) قيد الحذف حالياً؛ لا يمكن إنشاء ارتباط جديد به.`
      );
    }

    if (
      hasClassKey &&
      incomingClass !== null &&
      incomingClass !== secDef.classification
    ) {
      throw new SectorGovernanceConflictError(
        `تصنيف النشاط المرسل (${String(incomingClass)}) يخالف التصنيف المعتمد للقطاع "${secDef.nameAr}" في sectorPE (${secDef.classification}).`
      );
    }

    // Authoritative canonical values derived strictly from sectorPE
    canonicalPatch.sectorId = secDef.sectorId;
    canonicalPatch.sector = secDef.nameAr;
    canonicalPatch.sectorClassification = secDef.classification;

    return {
      canonicalPatch,
      resolvedSector: secDef,
      preservedExistingDisabledSector: false,
    };
  }

  // Case 2: Existing company preserving its existing sectorId (either omitted or same sectorId echoed)
  if (!isCreate && existing && existingSectorId && (!hasSectorIdKey || incomingSectorId === existingSectorId)) {
    const rawSectorDoc = await getSectorDoc(existingSectorId);
    const secDef =
      rawSectorDoc && rawSectorDoc.isDeleted !== true
        ? normalizeSectorDoc(existingSectorId, rawSectorDoc)
        : null;

    const attemptedClassChange =
      hasClassKey &&
      incomingClass !== existingClassification &&
      !(incomingClass === null && existingClassification === null);
    const attemptedSectorNameChange =
      hasSectorKey &&
      incomingSectorText !== null &&
      existingSectorName !== null &&
      normalizeSectorToken(incomingSectorText) !== normalizeSectorToken(existingSectorName);

    if (secDef && secDef.status === 'disabled') {
      if (attemptedClassChange) {
        throw new SectorGovernanceConflictError(
          `الشركة مرتبطة بالقطاع المعطّل "${secDef.nameAr}" (${secDef.sectorId})؛ لا يمكن تعديل تصنيف النشاط منفرداً — أعد ربطها بقطاع نشط أو اترك القطاع كما هو للتدقيق.`
        );
      }
      if (attemptedSectorNameChange && normalizeSectorToken(incomingSectorText!) !== normalizeSectorToken(secDef.nameAr)) {
        throw new SectorGovernanceConflictError(
          `لا يمكن تعديل اسم القطاع نصياً مع الإبقاء على معرف القطاع المعطّل (${secDef.sectorId}).`
        );
      }
      // Allow independent financial/metadata edit while preserving existing disabled link untouched
      canonicalPatch.sectorId = existingSectorId;
      if (hasSectorKey) canonicalPatch.sector = existing.sector ?? secDef.nameAr;
      if (hasClassKey) canonicalPatch.sectorClassification = existingClassification ?? secDef.classification;
      return {
        canonicalPatch,
        resolvedSector: secDef,
        preservedExistingDisabledSector: true,
      };
    }

    if (secDef && secDef.status === 'active') {
      if (hasClassKey && incomingClass !== null && incomingClass !== secDef.classification) {
        throw new SectorGovernanceConflictError(
          `لا يمكن تعديل تصنيف نشاط الشركة إلى (${String(incomingClass)}) بما يخالف تصنيف القطاع "${secDef.nameAr}" في sectorPE (${secDef.classification}).`
        );
      }
      if (
        attemptedSectorNameChange &&
        normalizeSectorToken(incomingSectorText!) !== normalizeSectorToken(secDef.nameAr)
      ) {
        throw new SectorGovernanceConflictError(
          `اسم القطاع المرسل ("${incomingSectorText}") لا يطابق الاسم الرسمي للقطاع "${secDef.nameAr}" (${secDef.sectorId}) في sectorPE.`
        );
      }
      if (hasSectorIdKey || hasSectorKey || hasClassKey) {
        canonicalPatch.sectorId = secDef.sectorId;
        canonicalPatch.sector = secDef.nameAr;
        canonicalPatch.sectorClassification = secDef.classification;
      }
      return {
        canonicalPatch,
        resolvedSector: secDef,
        preservedExistingDisabledSector: false,
      };
    }

    // Broken existing sectorId reference (sector doc missing/deleted)
    if (attemptedClassChange || attemptedSectorNameChange) {
      throw new SectorGovernanceConflictError(
        `معرّف القطاع الحالي للشركة (${existingSectorId}) غير موجود في sectorPE؛ أعد ربط الشركة بقطاع نشط بدلاً من تعديل الاسم أو التصنيف منفرداً.`
      );
    }
    // Independent financial/metadata edits are still permitted without forcing sector change
    return {
      canonicalPatch,
      resolvedSector: null,
      preservedExistingDisabledSector: false,
    };
  }

  // Case 3: Explicitly clearing sectorId to null
  if (hasSectorIdKey && rawIncomingSectorId === null) {
    if (existingClassification === 'financial' && hasClassKey && incomingClass === 'non_financial') {
      throw new SectorGovernanceConflictError(
        'لا يمكن تغيير تصنيف شركة مالية/بنك إلى غير مالي عند إزالة القطاع لتجاوز قواعد الأهلية.'
      );
    }
    canonicalPatch.sectorId = null;
    return {
      canonicalPatch,
      resolvedSector: null,
      preservedExistingDisabledSector: false,
    };
  }

  // Case 4: Company without sectorId (legacy unlinked record or newly created unmapped company)
  if (existing && existingClassification === 'financial' && hasClassKey && incomingClass === 'non_financial') {
    throw new SectorGovernanceConflictError(
      'لا يمكن تغيير تصنيف شركة مالية/بنك إلى غير مالي مباشرة؛ اربطها بقطاع معتمد في sectorPE.'
    );
  }

  return {
    canonicalPatch,
    resolvedSector: null,
    preservedExistingDisabledSector: false,
  };
}
