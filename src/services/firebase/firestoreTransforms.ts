/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { QuerySnapshot, DocumentData } from 'firebase/firestore';
import {
  BetaAssumptionRecord,
  Company,
  CompanyParameterOverride,
  DecisionItem,
  InvestmentStory,
  QuarterlyFinancial,
  SectorDefinition,
  TombstoneRecord,
  TradeLog,
} from '../../types/financial';
import {
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  DividendRecord,
  DividendYearStatusRecord,
  MacroParameter,
  QuarterlyFinancialRecord,
} from '../../types';
import { CacheOperationGuard, CacheService, SyncCollectionKey } from '../storage/cacheService';
import {
  extractServerEpochMs,
  SnapshotMetadataInfo,
} from '../../core/domain/firestoreSessionManager';
import { sanitizeQuarterlyReadRecord } from '../../core/domain/quarterlyManualAudit';
import {
  deriveSectorPEMapFromDefinitions,
  normalizeCompanyOverrideFromFirestore,
  normalizeMacroParameterFromFirestore,
  normalizeRfMethodology,
  normalizeSectorDoc,
  REAL_ESTATE_DISCLOSURES_COLLECTION,
  stripLegacyQuarterlyDpsFromRecord,
  tryNormalizedTicker,
} from '../../core/contracts';
import {
  createDeletionMarkerFromReadRecord,
  normalizeRealEstateDisclosureFromFirestore,
  type RealEstateDisclosureDeletionMarker,
  type RealEstateDisclosureReadRecord,
} from '../../core/domain/realEstateDisclosureRead';

export const CURSOR_OVERLAP_MS = 15_000;

export const COLLECTIONS = {
  COMPANIES: 'companies',
  FINANCIALS: 'financials',
  STORIES: 'stories',
  DECISIONS: 'decisions',
  TRADES: 'trades',
  MACRO_PARAMS: 'macro_params',
  SECTOR_PE: 'sectorPE',
  DAILY_TRADING: 'daily_trading_records',
  DAILY_SCHEMAS: 'daily_trading_schemas',
  QUARTERLY_RECORDS: 'quarterly_financial_records',
  BETA_ASSUMPTIONS: 'beta_assumptions',
  DIVIDEND_RECORDS: 'dividend_records',
  DIVIDEND_YEAR_STATUSES: 'dividend_year_statuses',
  COMPANY_ASSUMPTIONS: 'company_assumptions',
  REAL_ESTATE_DISCLOSURES: REAL_ESTATE_DISCLOSURES_COLLECTION,
  TOMBSTONES: 'tombstones',
  IMPORT_BATCHES: 'import_batches',
  USERS: 'users',
} as const;

export function metaFromSnapshot(snapshot: {
  metadata?: { fromCache?: boolean; hasPendingWrites?: boolean };
}): SnapshotMetadataInfo {
  return {
    fromCache: Boolean(snapshot.metadata?.fromCache),
    hasPendingWrites: Boolean(snapshot.metadata?.hasPendingWrites),
  };
}

/**
 * استخراج أقصى طابع زمني من الخادم (serverUpdatedAt) عبر السجلات والـ tombstones المستلمة فعلياً فقط.
 * لا يستخدم ساعة العميل (Date.now) مطلقاً لتفادي انحراف الساعة وفقدان التحديثات المتزامنة.
 */
export function computeMaxServerEpochMs(records: Array<{ serverUpdatedAt?: unknown }>): number {
  let maxMs = 0;
  for (const item of records) {
    const ms = extractServerEpochMs(item?.serverUpdatedAt);
    if (ms > maxMs) {
      maxMs = ms;
    }
  }
  return maxMs;
}

export function computeCandidateDeltaCursor(
  previousCursorMs: number,
  fetchedServerItems: Array<{ serverUpdatedAt?: unknown }>
): number {
  const maxServerMs = computeMaxServerEpochMs(fetchedServerItems);
  if (maxServerMs <= 0) {
    return previousCursorMs;
  }
  return Math.max(previousCursorMs, maxServerMs);
}

export function buildOverlapSinceMs(deltaCursorMs: number): number {
  return Math.max(0, deltaCursorMs - CURSOR_OVERLAP_MS);
}

/**
 * تثبيت مؤشر الدلتا المستقل لمجموعة محددة استناداً إلى serverUpdatedAt حصراً بعد نجاح الدمج والتخزين.
 */
export function commitCollectionCursorAfterConfirmedMerge(params: {
  collection: SyncCollectionKey;
  previousCursorMs: number;
  candidateCursorMs: number;
  mergeSucceeded: boolean;
  expectedScopeKey?: string;
  operationGuard?: CacheOperationGuard;
}): number {
  if (!params.mergeSucceeded) {
    return params.previousCursorMs;
  }
  if (params.expectedScopeKey && CacheService.getScopeKey() !== params.expectedScopeKey) {
    return params.previousCursorMs;
  }
  if (
    params.operationGuard &&
    !CacheService.isOperationGuardValid(params.operationGuard, [params.collection])
  ) {
    return params.previousCursorMs;
  }
  const next = Math.max(params.previousCursorMs, params.candidateCursorMs);
  if (next > 0) {
    const saved = CacheService.setCollectionDeltaCursorMs(
      params.collection,
      next,
      params.expectedScopeKey,
      params.operationGuard
    );
    if (!saved && typeof localStorage !== 'undefined') {
      return params.previousCursorMs;
    }
  }
  return next;
}

/**
 * دالة التوافق السابقة لتثبيت المؤشر العام عند الاختبارات أو التدفق الموحد.
 */
export function commitCursorAfterConfirmedMerge(params: {
  previousCursorMs: number;
  candidateCursorMs: number;
  mergeSucceeded: boolean;
  expectedScopeKey?: string;
  operationGuard?: CacheOperationGuard;
}): number {
  if (!params.mergeSucceeded) {
    return params.previousCursorMs;
  }
  if (params.expectedScopeKey && CacheService.getScopeKey() !== params.expectedScopeKey) {
    return params.previousCursorMs;
  }
  if (params.operationGuard && !CacheService.isOperationGuardValid(params.operationGuard, [])) {
    return params.previousCursorMs;
  }
  const next = Math.max(params.previousCursorMs, params.candidateCursorMs);
  if (next > 0) {
    const saved = CacheService.setDeltaCursorMs(
      next,
      params.expectedScopeKey,
      params.operationGuard
    );
    if (!saved && typeof localStorage !== 'undefined') {
      return params.previousCursorMs;
    }
  }
  return next;
}

export function mapQuarterlySnapshot(snap: QuerySnapshot<DocumentData>): QuarterlyFinancialRecord[] {
  const list: QuarterlyFinancialRecord[] = [];
  snap.forEach((d) =>
    list.push(sanitizeQuarterlyReadRecord(d.data() as QuarterlyFinancialRecord))
  );
  return list;
}

export function mapCompaniesSnapshot(snap: QuerySnapshot<DocumentData>): Company[] {
  const list: Company[] = [];
  snap.forEach((d) => list.push({ ...d.data(), id: d.id } as Company));
  return list;
}

export function mapDailySnapshot(snap: QuerySnapshot<DocumentData>): DailyTradingRecord[] {
  const list: DailyTradingRecord[] = [];
  snap.forEach((d) => list.push({ ...d.data() } as DailyTradingRecord));
  return list;
}

export function mapDailySchemasSnapshot(snap: QuerySnapshot<DocumentData>): {
  map: Record<string, DailyTradingSchemaRecord>;
  stamped: Array<{ serverUpdatedAt?: unknown }>;
} {
  const map: Record<string, DailyTradingSchemaRecord> = {};
  const stamped: Array<{ serverUpdatedAt?: unknown }> = [];
  snap.forEach((d) => {
    const raw = d.data() as DailyTradingSchemaRecord & { isDeleted?: boolean };
    stamped.push(raw);
    if (raw.isDeleted !== true) {
      map[d.id] = { ...raw, schemaId: raw.schemaId || d.id };
    }
  });
  return { map, stamped };
}

export function mapFinancialsSnapshot(snap: QuerySnapshot<DocumentData>): QuarterlyFinancial[] {
  const list: QuarterlyFinancial[] = [];
  snap.forEach((d) =>
    list.push(
      stripLegacyQuarterlyDpsFromRecord({ ...d.data(), id: d.id } as Record<string, any>) as QuarterlyFinancial
    )
  );
  return list;
}

export function mapStoriesSnapshot(snap: QuerySnapshot<DocumentData>): {
  map: Record<string, InvestmentStory>;
  stamped: Array<{ serverUpdatedAt?: unknown }>;
} {
  const map: Record<string, InvestmentStory> = {};
  const stamped: Array<{ serverUpdatedAt?: unknown }> = [];
  snap.forEach((d) => {
    const raw = d.data() as InvestmentStory & { serverUpdatedAt?: unknown };
    map[d.id] = { ...raw, companyId: d.id };
    stamped.push(raw);
  });
  return { map, stamped };
}

export function mapDecisionsSnapshot(snap: QuerySnapshot<DocumentData>): {
  map: Record<string, DecisionItem>;
  stamped: Array<{ serverUpdatedAt?: unknown }>;
} {
  const map: Record<string, DecisionItem> = {};
  const stamped: Array<{ serverUpdatedAt?: unknown }> = [];
  snap.forEach((d) => {
    const raw = d.data() as DecisionItem & { serverUpdatedAt?: unknown };
    map[d.id] = { ...raw, companyId: d.id };
    stamped.push(raw);
  });
  return { map, stamped };
}

export function mapTradesSnapshot(snap: QuerySnapshot<DocumentData>): TradeLog[] {
  const list: TradeLog[] = [];
  snap.forEach((d) => list.push({ ...d.data(), id: d.id } as TradeLog));
  return list;
}

export function mapMacroSnapshot(snap: QuerySnapshot<DocumentData>): MacroParameter[] {
  const list: MacroParameter[] = [];
  snap.forEach((d) => {
    const raw = d.data() as Record<string, any>;
    list.push(normalizeMacroParameterFromFirestore(d.id, raw) as MacroParameter);
  });
  return list;
}

export function mapSectorPESnapshot(snap: QuerySnapshot<DocumentData>): {
  definitions: SectorDefinition[];
  values: Record<string, number>;
  stamped: Array<{ serverUpdatedAt?: unknown }>;
} {
  const definitions: SectorDefinition[] = [];
  const stamped: Array<{ serverUpdatedAt?: unknown }> = [];
  snap.forEach((d) => {
    const raw = d.data() as Record<string, unknown>;
    stamped.push(raw);
    const normalized = normalizeSectorDoc(d.id, raw);
    if (normalized) {
      definitions.push(normalized);
    }
  });
  const values = deriveSectorPEMapFromDefinitions(definitions);
  return { definitions, values, stamped };
}

export function mapBetaSnapshot(snap: QuerySnapshot<DocumentData>): {
  records: BetaAssumptionRecord[];
  stamped: Array<{ serverUpdatedAt?: unknown }>;
} {
  const records: BetaAssumptionRecord[] = [];
  const stamped: Array<{ serverUpdatedAt?: unknown }> = [];
  snap.forEach((d) => {
    const raw = d.data() as BetaAssumptionRecord;
    stamped.push(raw);
    if (raw.isDeleted !== true) {
      records.push({ ...raw, ticker: tryNormalizedTicker(raw.ticker || d.id) ?? d.id });
    }
  });
  return { records, stamped };
}

export function mapCompanyOverridesSnapshot(snap: QuerySnapshot<DocumentData>): {
  records: CompanyParameterOverride[];
  stamped: Array<{ serverUpdatedAt?: unknown }>;
} {
  const records: CompanyParameterOverride[] = [];
  const stamped: Array<{ serverUpdatedAt?: unknown }> = [];
  snap.forEach((d) => {
    const raw = d.data() as CompanyParameterOverride;
    stamped.push(raw);
    if (raw.isDeleted !== true) {
      const tk = tryNormalizedTicker(raw.ticker || d.ref.parent.parent?.id);
      if (tk) {
        records.push(
          normalizeCompanyOverrideFromFirestore(d.id, tk, raw as Record<string, any>) as CompanyParameterOverride
        );
      }
    }
  });
  return { records, stamped };
}

export function mapDividendsSnapshot(snap: QuerySnapshot<DocumentData>): {
  records: DividendRecord[];
  stamped: Array<{ serverUpdatedAt?: unknown }>;
} {
  const records: DividendRecord[] = [];
  const stamped: Array<{ serverUpdatedAt?: unknown }> = [];
  snap.forEach((d) => {
    const raw = d.data() as DividendRecord & { serverUpdatedAt?: unknown };
    stamped.push(raw);
    if (raw.isDeleted !== true) {
      records.push({
        ...raw,
        ticker: tryNormalizedTicker(raw.ticker) ?? raw.ticker,
      });
    }
  });
  return { records, stamped };
}

export function mapDividendYearStatusesSnapshot(snap: QuerySnapshot<DocumentData>): {
  records: DividendYearStatusRecord[];
  stamped: Array<{ serverUpdatedAt?: unknown }>;
} {
  const records: DividendYearStatusRecord[] = [];
  const stamped: Array<{ serverUpdatedAt?: unknown }> = [];
  snap.forEach((d) => {
    const raw = d.data() as DividendYearStatusRecord & { serverUpdatedAt?: unknown };
    stamped.push(raw);
    if (raw.isDeleted !== true) {
      records.push({
        ...raw,
        id: d.id,
        ticker: tryNormalizedTicker(raw.ticker) ?? raw.ticker,
      });
    }
  });
  return { records, stamped };
}

export function mapRealEstateDisclosureDoc(
  docId: string,
  rawData: Record<string, unknown> | null | undefined
): RealEstateDisclosureReadRecord {
  return normalizeRealEstateDisclosureFromFirestore(docId, rawData);
}

export interface RealEstateDisclosuresSnapshotMapped {
  /** Active records (`isDeleted !== true`); NEVER drops records due to unrecognized codes or invalid fields. */
  records: RealEstateDisclosureReadRecord[];
  /** All normalized records from the snapshot including `isDeleted === true` markers for delta removal. */
  allRecords: RealEstateDisclosureReadRecord[];
  /** Dated & versioned deletion markers (`isDeleted === true`) preserving `serverUpdatedAtMs`, `updatedAtMs`, and `revision`. */
  deletedMarkers: RealEstateDisclosureDeletionMarker[];
  /** Document IDs marked `isDeleted === true` in this snapshot (compatibility view; NEVER overrides versioned deletion precedence). */
  deletedDocIds: string[];
  /** Raw documents carrying `serverUpdatedAt` for cursor advancement. */
  stamped: Array<{ serverUpdatedAt?: unknown }>;
}

export function mapRealEstateDisclosuresSnapshot(
  snap: QuerySnapshot<DocumentData> | { forEach: (cb: (doc: { id: string; data: () => DocumentData }) => void) => void }
): RealEstateDisclosuresSnapshotMapped {
  const records: RealEstateDisclosureReadRecord[] = [];
  const allRecords: RealEstateDisclosureReadRecord[] = [];
  const deletedMarkers: RealEstateDisclosureDeletionMarker[] = [];
  const deletedDocIds: string[] = [];
  const stamped: Array<{ serverUpdatedAt?: unknown }> = [];

  snap.forEach((d) => {
    const raw = (d.data() ?? {}) as Record<string, unknown>;
    stamped.push(raw as { serverUpdatedAt?: unknown });
    const normalized = normalizeRealEstateDisclosureFromFirestore(d.id, raw);
    allRecords.push(normalized);
    if (normalized.isDeleted) {
      deletedDocIds.push(d.id);
      deletedMarkers.push(createDeletionMarkerFromReadRecord(normalized));
    } else {
      records.push(normalized);
    }
  });

  return { records, allRecords, deletedMarkers, deletedDocIds, stamped };
}

export function mapTombstonesSnapshot(snap: QuerySnapshot<DocumentData>): TombstoneRecord[] {
  const list: TombstoneRecord[] = [];
  snap.forEach((d) => list.push({ ...d.data(), id: d.id } as TombstoneRecord));
  return list;
}
