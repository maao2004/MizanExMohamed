/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SectorClassificationValue = 'non_financial' | 'financial' | 'unknown';
export type InstrumentTypeValue = 'equity' | 'bond' | 'other' | 'unknown';
export type SectorStatus = 'active' | 'disabled';
export type SectorPeLoadStatus = 'loading' | 'ready' | 'error' | 'permission_denied';

export interface SectorDefinition {
  sectorId: string;
  nameAr: string;
  aliases: string[];
  classification: SectorClassificationValue;
  multiple: number | null;
  multipleSource?: string | null;
  multipleAsOfDate?: string | null;
  status: SectorStatus;
  notes?: string | null;
  legacyDocId?: string | null;
  isLegacyFormat?: boolean;
  contentHash?: string;
  updatedAt?: string;
  updatedBy?: string;
  serverUpdatedAt?: unknown;
  isDeleted?: boolean;
  pendingDelete?: boolean;
  pendingDeleteOperationId?: string | null;
  pendingDeleteTargetSectorId?: string | null;
  pendingMutation?: {
    mutationId: string;
    operation: 'upsert_sector' | 'toggle_sector_status' | 'delete_sector';
    reassignToSectorId?: string | null;
  } | null;
}

export interface SectorMatchCandidate {
  sectorId: string;
  nameAr: string;
  classification: SectorClassificationValue;
  multiple: number | null;
  status: SectorStatus;
  matchedBy: 'sectorId' | 'exact_name' | 'normalized_name' | 'alias';
}

export interface SectorMatchResult {
  status: 'matched' | 'ambiguous' | 'disabled_match' | 'unmapped' | 'missing';
  sector: SectorDefinition | null;
  matchedBy: 'sectorId' | 'exact_name' | 'normalized_name' | 'alias' | null;
  candidates: SectorMatchCandidate[];
}

export interface UnifiedSectorResolution {
  sectorId: string | null;
  canonicalNameAr: string | null;
  rawSector: string | null;
  classification: SectorClassificationValue;
  source:
    | 'explicit_override'
    | 'sector_registry'
    | 'ambiguous'
    | 'disabled_sector'
    | 'missing'
    | 'unmapped'
    | 'registry_unavailable';
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
  candidates?: SectorMatchCandidate[];
  reasonAr?: string | null;
}

export interface SectorPeConflictEntry {
  key: string;
  value: number | null;
  resolvedSectorId: string | null;
}

export interface SectorPeLookupResult {
  multiple: number | null;
  matchedKey: string | null;
  matchedSectorId?: string | null;
  reasonAr: string;
  conflictDetected?: boolean;
  conflictingEntries?: SectorPeConflictEntry[];
  multipleIsNullInRegistry?: boolean;
  unavailableError?: boolean;
}

export interface InstrumentClassificationResult {
  instrumentType: InstrumentTypeValue;
  reasonAr: string | null;
}

export const MISSING_METADATA_TOKENS = new Set([
  '',
  '-',
  '--',
  '—',
  'n/a',
  'na',
  'null',
  'undefined',
  'none',
  'غير مصنف',
  'غير معروف',
  'غير محدد',
  'عام',
  'unknown',
  'unclassified',
  'unspecified',
]);

export function cleanMetadataText(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  const norm = normalizeSectorToken(trimmed);
  if (MISSING_METADATA_TOKENS.has(trimmed.toLowerCase()) || MISSING_METADATA_TOKENS.has(norm)) {
    return null;
  }
  return trimmed;
}

export function isMissingMetadataValue(raw: unknown): boolean {
  return cleanMetadataText(raw) === null;
}

export function normalizeSectorToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/&/g, ' و ')
    .replace(/[،,/|\\\-_().]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeSectorId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('/') || trimmed === '.' || trimmed === '..' || trimmed.includes('..')) {
    return null;
  }
  if (trimmed.length > 120) return null;
  if (isMissingMetadataValue(trimmed)) return null;
  return trimmed;
}

export function suggestSectorId(nameOrKey: string): string {
  const cleaned = cleanMetadataText(nameOrKey);
  if (!cleaned) return '';
  const sanitized = cleaned
    .replace(/[/\\.#$[\]]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return sanitized || '';
}

function normalizeAliasesArray(rawAliases: unknown, nameAr: string, sectorId: string): string[] {
  if (!Array.isArray(rawAliases)) return [];
  const seenNorm = new Set<string>([
    normalizeSectorToken(nameAr),
    normalizeSectorToken(sectorId),
  ]);
  const out: string[] = [];
  for (const item of rawAliases) {
    if (typeof item !== 'string') continue;
    const cleaned = cleanMetadataText(item);
    if (!cleaned) continue;
    const norm = normalizeSectorToken(cleaned);
    if (!norm || seenNorm.has(norm)) continue;
    seenNorm.add(norm);
    out.push(cleaned);
  }
  return out;
}

/**
 * قراءة وتطبيع مستند القطاع من مجموعة sectorPE مع دعم التوافق الخلفي للمستندات القديمة ({ value })
 * دون تعديل البيانات تلقائياً في قاعدة الإنتاج ودون أي استنتاج سحري للتصنيف.
 */
export function normalizeSectorDoc(docId: string, rawData: unknown): SectorDefinition | null {
  const cleanDocId = sanitizeSectorId(docId);
  if (!cleanDocId || !rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    return null;
  }
  const data = rawData as Record<string, any>;
  if (data.isDeleted === true) return null;

  const sectorId = sanitizeSectorId(data.sectorId) ?? cleanDocId;
  const nameAr =
    cleanMetadataText(data.nameAr) ??
    cleanMetadataText(data.displayNameAr) ??
    cleanMetadataText(cleanDocId) ??
    cleanDocId;

  const rawClass = typeof data.classification === 'string' ? data.classification.trim().toLowerCase() : '';
  const classification: SectorClassificationValue =
    rawClass === 'financial' || rawClass === 'non_financial' || rawClass === 'unknown'
      ? rawClass
      : 'unknown';

  const rawMultiple = data.multiple !== undefined ? data.multiple : data.value;
  const multiple =
    typeof rawMultiple === 'number' && Number.isFinite(rawMultiple) && rawMultiple > 0
      ? rawMultiple
      : null;

  const rawStatus = typeof data.status === 'string' ? data.status.trim().toLowerCase() : '';
  const status: SectorStatus = rawStatus === 'disabled' ? 'disabled' : 'active';

  const multipleSource =
    typeof data.multipleSource === 'string' && data.multipleSource.trim()
      ? data.multipleSource.trim()
      : null;
  const multipleAsOfDate =
    typeof data.multipleAsOfDate === 'string' && data.multipleAsOfDate.trim()
      ? data.multipleAsOfDate.trim()
      : null;
  const notes =
    typeof data.notes === 'string' && data.notes.trim() ? data.notes.trim() : null;

  const isLegacyFormat =
    typeof data.nameAr !== 'string' ||
    typeof data.classification !== 'string' ||
    typeof data.status !== 'string';

  return {
    sectorId,
    nameAr,
    aliases: normalizeAliasesArray(data.aliases, nameAr, sectorId),
    classification,
    multiple,
    multipleSource,
    multipleAsOfDate,
    status,
    notes,
    legacyDocId: cleanDocId,
    isLegacyFormat,
    ...(typeof data.contentHash === 'string' ? { contentHash: data.contentHash } : {}),
    ...(typeof data.updatedAt === 'string' ? { updatedAt: data.updatedAt } : {}),
    ...(typeof data.updatedBy === 'string' ? { updatedBy: data.updatedBy } : {}),
    ...(data.serverUpdatedAt !== undefined ? { serverUpdatedAt: data.serverUpdatedAt } : {}),
    ...(data.pendingDelete === true ? { pendingDelete: true } : {}),
    ...(typeof data.pendingDeleteOperationId === 'string' && data.pendingDeleteOperationId.trim()
      ? { pendingDeleteOperationId: data.pendingDeleteOperationId.trim() }
      : {}),
    ...(typeof data.pendingDeleteTargetSectorId === 'string' && data.pendingDeleteTargetSectorId.trim()
      ? { pendingDeleteTargetSectorId: data.pendingDeleteTargetSectorId.trim() }
      : {}),
    ...(data.pendingMutation && typeof data.pendingMutation === 'object' && !Array.isArray(data.pendingMutation)
      ? {
          pendingMutation: {
            mutationId: String(data.pendingMutation.mutationId || ''),
            operation: data.pendingMutation.operation,
            reassignToSectorId: data.pendingMutation.reassignToSectorId ?? null,
          },
        }
      : {}),
  };
}

export function buildSectorDefinitionsFromMap(
  sectorPEMap: Record<string, number> | null | undefined
): SectorDefinition[] {
  if (!sectorPEMap || typeof sectorPEMap !== 'object') return [];
  const defs: SectorDefinition[] = [];
  for (const [key, val] of Object.entries(sectorPEMap)) {
    const cleanKey = sanitizeSectorId(key);
    if (!cleanKey) continue;
    const multiple = typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;
    defs.push({
      sectorId: cleanKey,
      nameAr: cleanMetadataText(key) ?? cleanKey,
      aliases: [],
      classification: 'unknown',
      multiple,
      status: 'active',
      legacyDocId: key,
      isLegacyFormat: true,
    });
  }
  return defs;
}

export function deriveSectorPEMapFromDefinitions(
  defs: SectorDefinition[] | null | undefined
): Record<string, number> {
  const map: Record<string, number> = {};
  if (!defs) return map;
  for (const def of defs) {
    if (def.isDeleted === true || def.status === 'disabled') continue;
    if (typeof def.multiple === 'number' && Number.isFinite(def.multiple) && def.multiple > 0) {
      map[def.nameAr] = def.multiple;
    }
  }
  return map;
}

export function matchSectorFromRegistry(params: {
  rawSector?: string | null;
  sectorId?: string | null;
  sectorDefinitions: SectorDefinition[];
  includeDisabled?: boolean;
}): SectorMatchResult {
  const { rawSector, sectorId, sectorDefinitions, includeDisabled = false } = params;
  const activeDefs = sectorDefinitions.filter(
    (d) => d.isDeleted !== true && (includeDisabled || d.status !== 'disabled')
  );
  const disabledDefs = sectorDefinitions.filter(
    (d) => d.isDeleted !== true && d.status === 'disabled'
  );

  const cleanId = sanitizeSectorId(sectorId ?? '');
  if (cleanId) {
    const exactIdActive = activeDefs.find((d) => d.sectorId === cleanId);
    if (exactIdActive) {
      return {
        status: 'matched',
        sector: exactIdActive,
        matchedBy: 'sectorId',
        candidates: [
          {
            sectorId: exactIdActive.sectorId,
            nameAr: exactIdActive.nameAr,
            classification: exactIdActive.classification,
            multiple: exactIdActive.multiple,
            status: exactIdActive.status,
            matchedBy: 'sectorId',
          },
        ],
      };
    }
    const exactIdDisabled = disabledDefs.find((d) => d.sectorId === cleanId);
    if (exactIdDisabled) {
      return {
        status: 'disabled_match',
        sector: exactIdDisabled,
        matchedBy: 'sectorId',
        candidates: [
          {
            sectorId: exactIdDisabled.sectorId,
            nameAr: exactIdDisabled.nameAr,
            classification: exactIdDisabled.classification,
            multiple: exactIdDisabled.multiple,
            status: exactIdDisabled.status,
            matchedBy: 'sectorId',
          },
        ],
      };
    }
    // Explicit sectorId is authoritative: if missing/deleted in sectorPE, NEVER silently fall back to text matching.
    return {
      status: 'unmapped',
      sector: null,
      matchedBy: null,
      candidates: [],
    };
  }

  const cleanRaw = cleanMetadataText(rawSector);
  if (!cleanRaw) {
    return {
      status: 'missing',
      sector: null,
      matchedBy: null,
      candidates: [],
    };
  }

  const normRaw = normalizeSectorToken(cleanRaw);
  const findMatchesIn = (pool: SectorDefinition[]): Array<{
    def: SectorDefinition;
    matchedBy: 'sectorId' | 'exact_name' | 'normalized_name' | 'alias';
  }> => {
    const out: Array<{
      def: SectorDefinition;
      matchedBy: 'sectorId' | 'exact_name' | 'normalized_name' | 'alias';
    }> = [];
    for (const def of pool) {
      if (def.sectorId === cleanRaw || def.nameAr.trim() === cleanRaw) {
        out.push({ def, matchedBy: def.sectorId === cleanRaw ? 'sectorId' : 'exact_name' });
        continue;
      }
      if (
        normRaw &&
        (normalizeSectorToken(def.sectorId) === normRaw ||
          normalizeSectorToken(def.nameAr) === normRaw)
      ) {
        out.push({ def, matchedBy: 'normalized_name' });
        continue;
      }
      if (
        def.aliases.some(
          (alias) =>
            alias.trim() === cleanRaw ||
            (normRaw && normalizeSectorToken(alias) === normRaw)
        )
      ) {
        out.push({ def, matchedBy: 'alias' });
      }
    }
    return out;
  };

  const activeMatches = findMatchesIn(activeDefs);
  if (activeMatches.length === 1) {
    const { def, matchedBy } = activeMatches[0];
    return {
      status: 'matched',
      sector: def,
      matchedBy,
      candidates: [
        {
          sectorId: def.sectorId,
          nameAr: def.nameAr,
          classification: def.classification,
          multiple: def.multiple,
          status: def.status,
          matchedBy,
        },
      ],
    };
  }

  if (activeMatches.length > 1) {
    return {
      status: 'ambiguous',
      sector: null,
      matchedBy: null,
      candidates: activeMatches.map(({ def, matchedBy }) => ({
        sectorId: def.sectorId,
        nameAr: def.nameAr,
        classification: def.classification,
        multiple: def.multiple,
        status: def.status,
        matchedBy,
      })),
    };
  }

  const disabledMatches = findMatchesIn(disabledDefs);
  if (disabledMatches.length === 1) {
    const { def, matchedBy } = disabledMatches[0];
    return {
      status: 'disabled_match',
      sector: def,
      matchedBy,
      candidates: disabledMatches.map((m) => ({
        sectorId: m.def.sectorId,
        nameAr: m.def.nameAr,
        classification: m.def.classification,
        multiple: m.def.multiple,
        status: m.def.status,
        matchedBy: m.matchedBy,
      })),
    };
  }
  if (disabledMatches.length > 1) {
    return {
      status: 'ambiguous',
      sector: null,
      matchedBy: null,
      candidates: disabledMatches.map((m) => ({
        sectorId: m.def.sectorId,
        nameAr: m.def.nameAr,
        classification: m.def.classification,
        multiple: m.def.multiple,
        status: m.def.status,
        matchedBy: m.matchedBy,
      })),
    };
  }

  return {
    status: 'unmapped',
    sector: null,
    matchedBy: null,
    candidates: [],
  };
}

export function resolveUnifiedSector(
  rawSector: string | null | undefined,
  explicitClassification?: SectorClassificationValue | null,
  options?: {
    sectorId?: string | null;
    sectorDefinitions?: SectorDefinition[] | null;
    sectorPEMap?: Record<string, number> | null;
    sectorPeConfirmed?: boolean;
    sectorPeStatus?: SectorPeLoadStatus;
  }
): UnifiedSectorResolution {
  const cleanedRaw = cleanMetadataText(rawSector);
  const cleanExplicitId = sanitizeSectorId(options?.sectorId ?? '');
  const sectorPeConfirmed = options?.sectorPeConfirmed ?? true;
  const sectorPeStatus = options?.sectorPeStatus ?? (sectorPeConfirmed ? 'ready' : 'error');

  if (
    !sectorPeConfirmed ||
    sectorPeStatus === 'loading' ||
    sectorPeStatus === 'error' ||
    sectorPeStatus === 'permission_denied'
  ) {
    const classOverride =
      explicitClassification === 'financial' || explicitClassification === 'non_financial'
        ? explicitClassification
        : 'unknown';
    return {
      sectorId: cleanExplicitId,
      canonicalNameAr: cleanedRaw ?? cleanExplicitId,
      rawSector: cleanedRaw,
      classification: classOverride,
      source: 'registry_unavailable',
      sectorPeConfirmed: false,
      sectorPeStatus,
      reasonAr:
        sectorPeStatus === 'permission_denied'
          ? 'تعذر قراءة مجموعة sectorPE بسبب الصلاحيات؛ لا يتم خفض حالة القطاع تلقائياً إلى غير معروف.'
          : sectorPeStatus === 'loading'
          ? 'جاري تحميل تعريفات القطاعات الرسمية من sectorPE...'
          : 'تعذر تحميل مجموعة sectorPE من الخادم؛ حالة القطاع مؤجلة لحين نجاح القراءة.',
    };
  }

  const defs = Array.isArray(options?.sectorDefinitions)
    ? options.sectorDefinitions
    : options?.sectorPEMap && Object.keys(options.sectorPEMap).length > 0
    ? buildSectorDefinitionsFromMap(options.sectorPEMap)
    : [];

  const match =
    defs.length > 0
      ? matchSectorFromRegistry({
          rawSector: cleanedRaw,
          sectorId: cleanExplicitId,
          sectorDefinitions: defs,
        })
      : null;

  // Preserve disabled-sector and broken-explicit-sectorId diagnostics even when a cached classification exists
  if (match?.status === 'disabled_match' && match.sector) {
    return {
      sectorId: match.sector.sectorId,
      canonicalNameAr: match.sector.nameAr,
      rawSector: cleanedRaw,
      classification:
        explicitClassification === 'financial' || explicitClassification === 'non_financial'
          ? explicitClassification
          : 'unknown',
      source: 'disabled_sector',
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
      candidates: match.candidates,
      reasonAr: `القطاع "${match.sector.nameAr}" (${match.sector.sectorId}) معطّل في sectorPE؛ تبقى الروابط القائمة واضحة للتدقيق لحين إعادة ربط الشركة بقطاع نشط.`,
    };
  }

  if (cleanExplicitId && (!match || match.status === 'unmapped')) {
    return {
      sectorId: cleanExplicitId,
      canonicalNameAr: cleanedRaw ?? cleanExplicitId,
      rawSector: cleanedRaw,
      classification: 'unknown',
      source: 'unmapped',
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
      reasonAr: `معرف القطاع الصريح "${cleanExplicitId}" غير موجود أو محذوف في sectorPE؛ لم يتم ربط الشركة بقطاع آخر تلقائياً عبر النص ويلزم المراجعة الإدارية.`,
    };
  }

  if (explicitClassification === 'financial' || explicitClassification === 'non_financial') {
    const matchedDef = match?.status === 'matched' ? match.sector : null;
    return {
      sectorId: matchedDef?.sectorId ?? cleanExplicitId ?? null,
      canonicalNameAr: matchedDef?.nameAr ?? cleanedRaw ?? cleanExplicitId ?? null,
      rawSector: cleanedRaw,
      classification: explicitClassification,
      source: 'explicit_override',
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
      ...(match?.candidates?.length ? { candidates: match.candidates } : {}),
    };
  }

  if (match?.status === 'matched' && match.sector) {
    return {
      sectorId: match.sector.sectorId,
      canonicalNameAr: match.sector.nameAr,
      rawSector: cleanedRaw,
      classification: match.sector.classification,
      source: 'sector_registry',
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
      candidates: match.candidates,
    };
  }

  if (match?.status === 'ambiguous') {
    return {
      sectorId: null,
      canonicalNameAr: cleanedRaw,
      rawSector: cleanedRaw,
      classification: 'unknown',
      source: 'ambiguous',
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
      candidates: match.candidates,
      reasonAr: `تطابق غامض لاسم القطاع "${cleanedRaw}" مع أكثر من تعريف في sectorPE؛ يتطلب مراجعة إدارية صريحة.`,
    };
  }

  if (!cleanedRaw && !cleanExplicitId) {
    return {
      sectorId: null,
      canonicalNameAr: null,
      rawSector: null,
      classification: 'unknown',
      source: 'missing',
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
    };
  }

  return {
    sectorId: cleanExplicitId ?? null,
    canonicalNameAr: cleanedRaw ?? cleanExplicitId ?? null,
    rawSector: cleanedRaw,
    classification: 'unknown',
    source: 'unmapped',
    sectorPeConfirmed: true,
    sectorPeStatus: 'ready',
    reasonAr: cleanedRaw
      ? `القطاع "${cleanedRaw}" غير معرف في مجموعة sectorPE الرسمية؛ لا يتم إنشاء قطاع تلقائياً ولا افتراض تصنيفه.`
      : `معرف القطاع "${cleanExplicitId}" غير موجود في مجموعة sectorPE الرسمية.`,
  };
}

export function resolveSectorPeFromRegistry(options: {
  sectorDefinitions?: SectorDefinition[] | null;
  sectorPEMap?: Record<string, number> | null;
  rawSector?: string | null;
  resolvedSectorId?: string | null;
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
}): SectorPeLookupResult {
  const {
    sectorDefinitions,
    sectorPEMap,
    rawSector,
    resolvedSectorId,
    sectorPeConfirmed = true,
    sectorPeStatus = 'ready',
  } = options;

  if (!sectorPeConfirmed || sectorPeStatus === 'error' || sectorPeStatus === 'permission_denied' || sectorPeStatus === 'loading') {
    return {
      multiple: null,
      matchedKey: null,
      matchedSectorId: resolvedSectorId ?? null,
      conflictDetected: false,
      unavailableError: true,
      reasonAr:
        sectorPeStatus === 'permission_denied'
          ? 'تعذر قراءة مضاعفات القطاعات (sectorPE) من الخادم بسبب الصلاحيات.'
          : sectorPeStatus === 'loading'
          ? 'جاري تحميل مضاعفات القطاعات الرسمية (sectorPE)...'
          : 'تعذر قراءة مجموعة sectorPE من الخادم؛ أعد المحاولة قبل الاعتماد على مضاعف القطاع.',
    };
  }

  const effectiveDefs: SectorDefinition[] = Array.isArray(sectorDefinitions)
    ? sectorDefinitions
    : sectorPEMap && Object.keys(sectorPEMap).length > 0
    ? buildSectorDefinitionsFromMap(sectorPEMap)
    : [];

  const cleanId = sanitizeSectorId(resolvedSectorId ?? '');

  if (effectiveDefs.length === 0) {
    return {
      multiple: null,
      matchedKey: null,
      matchedSectorId: null,
      conflictDetected: false,
      reasonAr: cleanId
        ? `مجموعة sectorPE الرسمية فارغة؛ معرف القطاع الصريح "${cleanId}" غير موجود فيها (مرجع مكسور) ولم يتم الرجوع للنص تلقائياً.`
        : 'لا توجد تعريفات قطاعات مسجلة في مجموعة sectorPE الرسمية.',
    };
  }

  const activeDefs = effectiveDefs.filter((d) => d.isDeleted !== true && d.status !== 'disabled');
  const disabledDefs = effectiveDefs.filter((d) => d.isDeleted !== true && d.status === 'disabled');
  const cleanRaw = cleanMetadataText(rawSector);

  // Explicit sectorId is authoritative: NEVER mix rawSector text matching into other sectors when sectorId is present.
  const matchingDefs = new Map<string, SectorDefinition>();
  const normRaw = cleanRaw ? normalizeSectorToken(cleanRaw) : '';

  if (cleanId) {
    const exactActive = activeDefs.find((d) => d.sectorId === cleanId);
    if (exactActive) {
      matchingDefs.set(exactActive.sectorId, exactActive);
    } else {
      const exactDisabled = disabledDefs.find((d) => d.sectorId === cleanId);
      if (exactDisabled) {
        return {
          multiple: null,
          matchedKey: null,
          matchedSectorId: exactDisabled.sectorId,
          conflictDetected: false,
          reasonAr: `القطاع "${exactDisabled.nameAr}" (${exactDisabled.sectorId}) معطّل في sectorPE؛ لا يُستخدم مضاعفه تلقائياً لحين إعادة ربط الشركة أو تفعيل القطاع.`,
        };
      }
      return {
        multiple: null,
        matchedKey: null,
        matchedSectorId: null,
        conflictDetected: false,
        reasonAr: `معرف القطاع الصريح "${cleanId}" غير موجود أو محذوف في sectorPE؛ لم يتم البحث بنص بديل تلقائياً.`,
      };
    }
  } else {
    for (const def of activeDefs) {
      const nameMatch =
        cleanRaw &&
        (def.sectorId === cleanRaw ||
          def.nameAr.trim() === cleanRaw ||
          (normRaw &&
            (normalizeSectorToken(def.sectorId) === normRaw ||
              normalizeSectorToken(def.nameAr) === normRaw)));
      const aliasMatch =
        cleanRaw &&
        def.aliases.some(
          (a) => a.trim() === cleanRaw || (normRaw && normalizeSectorToken(a) === normRaw)
        );

      if (nameMatch || aliasMatch) {
        matchingDefs.set(def.sectorId, def);
      }
    }
  }

  // Also check if legacy sectorPEMap passed alongside sectorDefinitions contains additional alias entries with conflicting multiples
  if (sectorPEMap && Object.keys(sectorPEMap).length > 0 && matchingDefs.size === 1) {
    const primaryDef = Array.from(matchingDefs.values())[0];
    const primaryTokens = new Set<string>([
      normalizeSectorToken(primaryDef.sectorId),
      normalizeSectorToken(primaryDef.nameAr),
      ...primaryDef.aliases.map((a) => normalizeSectorToken(a)),
    ]);
    // Only include normRaw when sectorId was NOT explicit (prevents old rawSector from injecting an old sector's P/E conflict)
    if (!cleanId && normRaw) primaryTokens.add(normRaw);

    const competingMapEntries: SectorPeConflictEntry[] = [];
    for (const [k, v] of Object.entries(sectorPEMap)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      const nk = normalizeSectorToken(k);
      if (nk && primaryTokens.has(nk)) {
        competingMapEntries.push({
          key: k,
          value: v,
          resolvedSectorId: primaryDef.sectorId,
        });
      }
    }
    const distinctMapVals = new Set(
      competingMapEntries
        .filter((c): c is SectorPeConflictEntry & { value: number } => typeof c.value === 'number' && Number.isFinite(c.value))
        .map((c) => Number(c.value.toFixed(6)))
    );
    if (distinctMapVals.size > 1) {
      const summaryPairs = competingMapEntries
        .map((c) => `"${c.key}": ${c.value ?? 'null'}x`)
        .join(' مقابل ');
      return {
        multiple: null,
        matchedKey: null,
        matchedSectorId: primaryDef.sectorId,
        conflictDetected: true,
        conflictingEntries: competingMapEntries,
        reasonAr: `تعارض رقمي في مضاعف القطاع المحفوظ (sectorPE): (${summaryPairs}) لنفس القطاع؛ تعذر اختيار قيمة تلقائياً ويجب توحيد المضاعف أو إدخال Target_PE للشركة.`,
      };
    }
  }

  const matchedList = Array.from(matchingDefs.values());
  if (matchedList.length > 1) {
    const conflictingEntries: SectorPeConflictEntry[] = matchedList.map((m) => ({
      key: m.nameAr,
      value: m.multiple,
      resolvedSectorId: m.sectorId,
    }));
    const summaryPairs = conflictingEntries
      .map((c) => `"${c.key}": ${c.value !== null ? `${c.value}x` : 'بدون مضاعف'}`)
      .join(' مقابل ');
    return {
      multiple: null,
      matchedKey: null,
      matchedSectorId: null,
      conflictDetected: true,
      conflictingEntries,
      reasonAr: `تعارض أو ازدواج في تعريفات قطاع (${cleanRaw || cleanId}) داخل sectorPE: (${summaryPairs})؛ يرجى دمج التعريفات أو إدخال Target_PE للشركة.`,
    };
  }

  if (matchedList.length === 1) {
    const def = matchedList[0];
    if (typeof def.multiple === 'number' && Number.isFinite(def.multiple) && def.multiple > 0) {
      return {
        multiple: def.multiple,
        matchedKey: def.nameAr,
        matchedSectorId: def.sectorId,
        conflictDetected: false,
        reasonAr: `مطابقة مضاعف القطاع الرسمي "${def.nameAr}" (${def.sectorId}) من sectorPE.`,
      };
    }
    return {
      multiple: null,
      matchedKey: def.nameAr,
      matchedSectorId: def.sectorId,
      conflictDetected: false,
      multipleIsNullInRegistry: true,
      reasonAr: `القطاع "${def.nameAr}" معرف في sectorPE ولكن مضاعف الربحية غير مدخل (null)؛ أدخل المضاعف للقطاع أو خصص Target_PE للشركة.`,
    };
  }

  const displayTarget = cleanRaw ?? cleanId ?? 'غير محدد';
  return {
    multiple: null,
    matchedKey: null,
    matchedSectorId: null,
    conflictDetected: false,
    reasonAr:
      cleanRaw || cleanId
        ? `القطاع "${displayTarget}" غير معرف في مجموعة sectorPE الرسمية؛ يلزم ربطه إدارياً بقطاع نشط.`
        : 'القطاع غير محدد للسهم؛ تعذر البحث عن مضاعف القطاع في sectorPE.',
  };
}

export function resolveSectorPeFromMap(
  sectorPEMap: Record<string, number> | null | undefined,
  rawSector: string | null | undefined,
  resolvedSectorId?: string | null,
  sectorDefinitions?: SectorDefinition[] | null,
  sectorPeConfirmed = true,
  sectorPeStatus: SectorPeLoadStatus = 'ready'
): SectorPeLookupResult {
  return resolveSectorPeFromRegistry({
    sectorDefinitions,
    sectorPEMap,
    rawSector,
    resolvedSectorId,
    sectorPeConfirmed,
    sectorPeStatus,
  });
}

export function classifyInstrumentType(input: {
  ticker?: string | null;
  shortName?: string | null;
  fullName?: string | null;
  sector?: string | null;
  market?: string | null;
  isinCode?: string | null;
  instrumentType?: InstrumentTypeValue | string | null;
  extendedFields?: Record<string, any> | null;
}): InstrumentClassificationResult {
  const ticker = String(input.ticker || '').trim().toUpperCase();
  const isin = String(input.isinCode || '').trim().toUpperCase();
  const market = String(input.market || '').trim().toLowerCase();
  const sector = String(input.sector || '').trim().toLowerCase();
  const shortName = String(input.shortName || '').trim().toLowerCase();
  const fullName = String(input.fullName || '').trim().toLowerCase();
  const explicitInputType = String(input.instrumentType || '').trim().toLowerCase();
  const extType = String(
    input.extendedFields?.instrumentType ??
      input.extendedFields?.InstrumentType ??
      input.extendedFields?.['نوع الورقة المالية'] ??
      ''
  )
    .trim()
    .toLowerCase();

  const combinedText = `${market} ${sector} ${shortName} ${fullName} ${extType} ${explicitInputType}`;

  const isBondIsin = /^EGB[A-Z0-9]{6,}$/.test(isin);
  const isBondTicker =
    /^(EGB|EGT|EGBOND|TBOND|TBILL)/.test(ticker) ||
    /^EGB\d+/i.test(ticker) ||
    /BOND|SUKUK|TBILL/.test(ticker);
  const bondKeywords = [
    'سندات خزانة',
    'سندات حكومية',
    'سندات شركات',
    'سندات توريق',
    'أذون خزانة',
    'اذون خزانة',
    'دخل ثابت',
    'صكوك',
    'treasury bond',
    'treasury bill',
    'government bond',
    'securitization bond',
    'corporate bond',
    'fixed income',
    'sukuk',
    'bonds',
    'bond',
  ];
  if (
    explicitInputType === 'bond' ||
    isBondIsin ||
    isBondTicker ||
    bondKeywords.some((kw) => combinedText.includes(kw))
  ) {
    return {
      instrumentType: 'bond',
      reasonAr: 'تم استبعاد الورقة لأنها أداة دين/سندات وليست سهماً عادياً في قائمة التقييم.',
    };
  }

  const otherKeywords = [
    'حق اكتتاب',
    'حقوق اكتتاب',
    'وثيقة استثمار',
    'صندوق استثمار',
    'صناديق',
    'rights issue',
    'etf',
    'warrant',
  ];
  if (
    explicitInputType === 'other' ||
    /^R_[A-Z0-9]+$/.test(ticker) ||
    /RIGHT|WARRANT|ETF/.test(ticker) ||
    otherKeywords.some((kw) => combinedText.includes(kw))
  ) {
    return {
      instrumentType: 'other',
      reasonAr: 'تم استبعاد الورقة لأنها أداة غير سهم عادي (حق اكتتاب/وثيقة/صندوق).',
    };
  }

  const equityTypeTokens = ['equity', 'stock', 'common stock', 'ordinary share', 'سهم', 'اسهم', 'أسهم', 'سهم عادي', 'أسهم عادية'];
  const equityMarketTokens = ['egx', 'main market', 'nilex', 'sme', 'equities', 'السوق الرئيسي', 'بورصة النيل', 'سوق المشروعات', 'الأسهم', 'الاسهم'];

  const hasEquityIsin = /^EGS[A-Z0-9]{6,}$/.test(isin);
  const hasExplicitEquityType =
    explicitInputType === 'equity' ||
    equityTypeTokens.some((tok) => extType.includes(tok) || explicitInputType === tok);
  const hasEquityMarket = equityMarketTokens.some((tok) => market.includes(tok));

  if (hasEquityIsin || hasExplicitEquityType || hasEquityMarket) {
    return { instrumentType: 'equity', reasonAr: null };
  }

  return {
    instrumentType: 'unknown',
    reasonAr: 'لم تتوافر أدلة كافية لتصنيف نوع الورقة (ISIN مصري EGS أو سوق الأسهم أو تصنيف صريح).',
  };
}
