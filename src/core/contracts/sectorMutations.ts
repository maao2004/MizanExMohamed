/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared authoritative sectorPE governance mutation engine (client-preview & server-enforced).
 * Supports single-transaction atomic updates within Firestore limits and hardened, resumable
 * multi-batch execution using bounded per-chunk transactions, mutationId resume binding,
 * pendingDelete locking, indexed sectorId queries, auditable legacy text fallback, and
 * full post-chunk / pre-delete live re-verification (catching behind-cursor writes).
 */

import { computeCanonicalHash } from './hashing';
import {
  normalizeSectorDoc,
  normalizeSectorToken,
  sanitizeSectorId,
  SectorDefinition,
} from './sectorRegistry';
import {
  classifyCompanySectorLinkage,
  companyMatchesSectorDefinition,
  SectorGovernanceConflictError,
  SectorGovernanceNotFoundError,
} from './sectorLinkage';
import {
  SectorDefinitionPayload,
  SectorDeletePayload,
  SectorStatusTogglePayload,
  validateSectorDefinitionPayload,
  validateSectorDeletePayload,
  validateSectorStatusTogglePayload,
} from './records';

export {
  classifyCompanySectorLinkage,
  companyMatchesSectorDefinition,
  SectorGovernanceConflictError,
  SectorGovernanceNotFoundError,
};

export const DEFAULT_MAX_ATOMIC_SECTOR_COMPANIES = 400;

export interface SectorMutationReport {
  operation: 'upsert_sector' | 'toggle_sector_status' | 'delete_sector';
  sectorId: string;
  mutationId: string;
  completed: boolean;
  atomic: boolean;
  linkedCompaniesCount: number;
  reassignedCount: number;
  updatedCompaniesCount: number;
  remainingLinkedCount: number;
  conflictedCount: number;
  failedCount: number;
  legacyTextLinkedCount: number;
  reassignedToSectorId: string | null;
  resumeAfterCompanyId: string | null;
  conflictsAr: string[];
  errorsAr: string[];
  warningAr: string | null;
  messageAr: string;
}

export interface SectorDocEntry {
  id: string;
  data: Record<string, any>;
}

export interface CompanyDocEntry {
  id: string;
  data: Record<string, any>;
}

export interface SectorMutationTxContext {
  getAllSectors: () => Promise<SectorDocEntry[]>;
  getAllCompanies: () => Promise<CompanyDocEntry[]>;
  getSectorDoc: (sectorId: string) => Promise<Record<string, any> | undefined>;
  getCompanyDoc?: (companyId: string) => Promise<Record<string, any> | undefined>;
  queryCompaniesBySectorId?: (sectorId: string, limit?: number) => Promise<CompanyDocEntry[]>;
  listLegacyCompaniesWithoutSectorId?: () => Promise<CompanyDocEntry[]>;
  setSectorDoc: (sectorId: string, payload: Record<string, any>, merge: boolean) => void;
  deleteSectorDoc: (sectorId: string) => void;
  setCompanyDoc: (companyId: string, payload: Record<string, any>, merge: boolean) => void;
  writeSectorTombstone: (sectorId: string) => void;
}

export interface SectorMutationPort {
  runTransaction: <T>(fn: (tx: SectorMutationTxContext) => Promise<T>) => Promise<T>;
  listAllSectors: () => Promise<SectorDocEntry[]>;
  listAllCompanies: () => Promise<CompanyDocEntry[]>;
  queryCompaniesBySectorId?: (sectorId: string, limit?: number) => Promise<CompanyDocEntry[]>;
  listLegacyCompaniesWithoutSectorId?: () => Promise<CompanyDocEntry[]>;
  commitBatch: (
    fn: (
      batch: Omit<
        SectorMutationTxContext,
        | 'getAllSectors'
        | 'getAllCompanies'
        | 'getSectorDoc'
        | 'getCompanyDoc'
        | 'queryCompaniesBySectorId'
        | 'listLegacyCompaniesWithoutSectorId'
      >
    ) => void
  ) => Promise<void>;
}

export interface SectorMutationExecutionResult {
  insertedCount: number;
  updatedCount: number;
  processedCount: number;
  report: SectorMutationReport;
}

interface PartitionedLinkedCompanies {
  explicitLinked: CompanyDocEntry[];
  legacyLinked: CompanyDocEntry[];
  allLinked: CompanyDocEntry[];
}

function generateMutationId(operation: SectorMutationReport['operation'], sectorId: string): string {
  const shortOp =
    operation === 'delete_sector'
      ? 'del'
      : operation === 'toggle_sector_status'
      ? 'tog'
      : 'ups';
  const rand = Math.random().toString(36).slice(2, 8);
  return `sec_${shortOp}_${sectorId}_${Date.now()}_${rand}`.slice(0, 118);
}

function normalizeAllSectorDefs(entries: SectorDocEntry[]): SectorDefinition[] {
  const out: SectorDefinition[] = [];
  for (const entry of entries) {
    const def = normalizeSectorDoc(entry.id, entry.data);
    if (def) out.push(def);
  }
  return out;
}

function sortCompaniesStable(companies: CompanyDocEntry[]): CompanyDocEntry[] {
  return [...companies].sort((a, b) => a.id.localeCompare(b.id));
}

function dedupeAndSortCompanies(list: CompanyDocEntry[]): CompanyDocEntry[] {
  const map = new Map<string, CompanyDocEntry>();
  for (const item of list) {
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return sortCompaniesStable(Array.from(map.values()));
}

function partitionMatchedCompanies(
  explicitCandidates: CompanyDocEntry[],
  legacyCandidates: CompanyDocEntry[],
  sectorId: string,
  targetDef: SectorDefinition | null,
  allSectorDefs: SectorDefinition[]
): PartitionedLinkedCompanies {
  const explicitLinked: CompanyDocEntry[] = [];
  const seenIds = new Set<string>();

  for (const c of explicitCandidates) {
    if (!c.data || c.data.isDeleted === true) continue;
    const explicitId = sanitizeSectorId(c.data.sectorId ?? '');
    if (explicitId === sectorId) {
      explicitLinked.push(c);
      seenIds.add(c.id);
    }
  }

  const legacyLinked: CompanyDocEntry[] = [];
  for (const c of legacyCandidates) {
    if (seenIds.has(c.id)) continue;
    if (!c.data || c.data.isDeleted === true) continue;
    const explicitId = sanitizeSectorId(c.data.sectorId ?? '');
    if (explicitId) continue; // Explicit sectorId never falls back to text
    if (companyMatchesSectorDefinition(c.data, sectorId, targetDef, allSectorDefs)) {
      legacyLinked.push(c);
      seenIds.add(c.id);
    }
  }

  const sortedExplicit = dedupeAndSortCompanies(explicitLinked);
  const sortedLegacy = dedupeAndSortCompanies(legacyLinked);
  const allLinked = dedupeAndSortCompanies([...sortedExplicit, ...sortedLegacy]);
  return { explicitLinked: sortedExplicit, legacyLinked: sortedLegacy, allLinked };
}

async function listLinkedCompaniesPartitioned(
  port: SectorMutationPort,
  sectorId: string,
  targetDef: SectorDefinition | null,
  allSectorDefs: SectorDefinition[]
): Promise<PartitionedLinkedCompanies> {
  if (port.queryCompaniesBySectorId && port.listLegacyCompaniesWithoutSectorId) {
    const [explicitCandidates, legacyCandidates] = await Promise.all([
      port.queryCompaniesBySectorId(sectorId),
      port.listLegacyCompaniesWithoutSectorId(),
    ]);
    return partitionMatchedCompanies(
      explicitCandidates,
      legacyCandidates,
      sectorId,
      targetDef,
      allSectorDefs
    );
  }
  if (port.queryCompaniesBySectorId) {
    const [explicitCandidates, allCompanies] = await Promise.all([
      port.queryCompaniesBySectorId(sectorId),
      port.listAllCompanies(),
    ]);
    return partitionMatchedCompanies(
      explicitCandidates,
      allCompanies,
      sectorId,
      targetDef,
      allSectorDefs
    );
  }
  const allCompanies = await port.listAllCompanies();
  return partitionMatchedCompanies(allCompanies, allCompanies, sectorId, targetDef, allSectorDefs);
}

async function getLinkedCompaniesPartitionedInTx(
  tx: SectorMutationTxContext,
  sectorId: string,
  targetDef: SectorDefinition | null,
  allSectorDefs: SectorDefinition[]
): Promise<PartitionedLinkedCompanies> {
  if (tx.queryCompaniesBySectorId && tx.listLegacyCompaniesWithoutSectorId) {
    const [explicitCandidates, legacyCandidates] = await Promise.all([
      tx.queryCompaniesBySectorId(sectorId),
      tx.listLegacyCompaniesWithoutSectorId(),
    ]);
    return partitionMatchedCompanies(
      explicitCandidates,
      legacyCandidates,
      sectorId,
      targetDef,
      allSectorDefs
    );
  }
  if (tx.queryCompaniesBySectorId) {
    const [explicitCandidates, allCompanies] = await Promise.all([
      tx.queryCompaniesBySectorId(sectorId),
      tx.getAllCompanies(),
    ]);
    return partitionMatchedCompanies(
      explicitCandidates,
      allCompanies,
      sectorId,
      targetDef,
      allSectorDefs
    );
  }
  const allCompanies = await tx.getAllCompanies();
  return partitionMatchedCompanies(allCompanies, allCompanies, sectorId, targetDef, allSectorDefs);
}

async function readChunkLiveCompaniesInTx(
  tx: SectorMutationTxContext,
  chunk: CompanyDocEntry[]
): Promise<Map<string, Record<string, any> | undefined>> {
  const liveMap = new Map<string, Record<string, any> | undefined>();
  if (chunk.length === 0) return liveMap;
  if (tx.getCompanyDoc) {
    const docs = await Promise.all(chunk.map((c) => tx.getCompanyDoc!(c.id)));
    chunk.forEach((c, idx) => {
      liveMap.set(c.id, docs[idx]);
    });
    return liveMap;
  }
  const allCompanies = await tx.getAllCompanies();
  const byId = new Map<string, Record<string, any>>();
  for (const c of allCompanies) {
    byId.set(c.id, c.data);
  }
  for (const c of chunk) {
    liveMap.set(c.id, byId.get(c.id));
  }
  return liveMap;
}

function findNameOrAliasConflict(
  allSectors: SectorDocEntry[],
  candidateSectorId: string,
  candidateNameAr: string,
  candidateAliases: string[],
  includeDisabled = false
): SectorDefinition | null {
  const candidateTokens = new Set<string>([
    normalizeSectorToken(candidateNameAr),
    ...candidateAliases.map((a) => normalizeSectorToken(a)),
  ]);
  candidateTokens.delete('');

  for (const entry of allSectors) {
    if (entry.id === candidateSectorId) continue;
    const existingOther = normalizeSectorDoc(entry.id, entry.data);
    if (!existingOther) continue;
    if (!includeDisabled && existingOther.status === 'disabled') continue;

    const otherTokens = new Set<string>([
      normalizeSectorToken(existingOther.nameAr),
      ...existingOther.aliases.map((a) => normalizeSectorToken(a)),
    ]);
    for (const tok of candidateTokens) {
      if (otherTokens.has(tok)) {
        return existingOther;
      }
    }
  }
  return null;
}

function selectChunkAfterCursor(
  sortedCompanies: CompanyDocEntry[],
  resumeAfterCompanyId: string | null | undefined,
  chunkLimit: number
): { chunk: CompanyDocEntry[]; remainingCount: number; lastId: string | null } {
  const filtered = resumeAfterCompanyId
    ? sortedCompanies.filter((c) => c.id > resumeAfterCompanyId)
    : sortedCompanies;
  const chunk = filtered.slice(0, chunkLimit);
  const remainingCount = Math.max(0, filtered.length - chunk.length);
  const lastId = chunk.length > 0 ? chunk[chunk.length - 1].id : null;
  return { chunk, remainingCount, lastId };
}

function assertValidReplacementSector(
  altDef: SectorDefinition | null,
  reassignToSectorId: string
): SectorDefinition {
  if (!altDef) {
    throw new SectorGovernanceConflictError(
      `القطاع البديل (${reassignToSectorId}) غير موجود أو محذوف في sectorPE.`
    );
  }
  if (altDef.status === 'disabled') {
    throw new SectorGovernanceConflictError(
      `القطاع البديل "${altDef.nameAr}" (${reassignToSectorId}) معطّل في sectorPE ولا يمكن نقل الشركات إليه.`
    );
  }
  if (altDef.pendingDelete === true) {
    throw new SectorGovernanceConflictError(
      `القطاع البديل "${altDef.nameAr}" (${reassignToSectorId}) قيد الحذف حالياً ولا يمكن نقل الشركات إليه.`
    );
  }
  return altDef;
}

function resolveAndValidateResumeBinding(params: {
  operation: SectorMutationReport['operation'];
  sectorDef: SectorDefinition;
  requestedMutationId: string | null | undefined;
  requestedReassignTarget: string | null | undefined;
  isResumeCall: boolean;
}): string {
  const { operation, sectorDef, requestedMutationId, requestedReassignTarget, isResumeCall } = params;
  const existingPendingOp = sectorDef.pendingMutation;
  const existingDelOpId = sectorDef.pendingDelete ? sectorDef.pendingDeleteOperationId ?? null : null;
  const existingDelTarget = sectorDef.pendingDelete ? sectorDef.pendingDeleteTargetSectorId ?? null : null;

  if (operation === 'delete_sector') {
    if (sectorDef.pendingDelete) {
      if (
        existingDelTarget &&
        requestedReassignTarget &&
        existingDelTarget !== requestedReassignTarget
      ) {
        throw new SectorGovernanceConflictError(
          `تعارض استئناف حذف القطاع "${sectorDef.nameAr}": القطاع البديل المطلوب (${requestedReassignTarget}) يختلف عن القطاع البديل المرتبط بالعملية الجارية (${existingDelTarget}).`
        );
      }
      if (requestedMutationId && existingDelOpId && requestedMutationId !== existingDelOpId) {
        throw new SectorGovernanceConflictError(
          `تعارض معرّف العملية (mutationId): العملية الجارية لحذف القطاع "${sectorDef.nameAr}" تحمل المعرّف (${existingDelOpId}) وليس (${requestedMutationId}).`
        );
      }
      return existingDelOpId ?? requestedMutationId ?? generateMutationId(operation, sectorDef.sectorId);
    }
    if (isResumeCall && requestedMutationId && existingPendingOp && existingPendingOp.mutationId !== requestedMutationId) {
      throw new SectorGovernanceConflictError(
        `معرّف العملية (mutationId: ${requestedMutationId}) لا يطابق أي عملية جارية على القطاع "${sectorDef.nameAr}".`
      );
    }
    return requestedMutationId ?? generateMutationId(operation, sectorDef.sectorId);
  }

  // Non-delete operations cannot run over an active pendingDelete lock
  if (sectorDef.pendingDelete) {
    throw new SectorGovernanceConflictError(
      `القطاع "${sectorDef.nameAr}" (${sectorDef.sectorId}) مقفول حالياً بعملية حذف قيد الاستئناف (${existingDelOpId ?? 'pending_delete'}).`
    );
  }

  if (existingPendingOp && existingPendingOp.mutationId) {
    if (existingPendingOp.operation !== operation) {
      throw new SectorGovernanceConflictError(
        `توجد عملية حوكمة أخرى جارية على القطاع "${sectorDef.nameAr}" (${existingPendingOp.operation} / ${existingPendingOp.mutationId}).`
      );
    }
    if (requestedMutationId && requestedMutationId !== existingPendingOp.mutationId) {
      throw new SectorGovernanceConflictError(
        `تعارض معرّف العملية (mutationId): العملية الجارية على القطاع "${sectorDef.nameAr}" تحمل المعرّف (${existingPendingOp.mutationId}) وليس (${requestedMutationId}).`
      );
    }
    if (
      existingPendingOp.reassignToSectorId &&
      requestedReassignTarget &&
      existingPendingOp.reassignToSectorId !== requestedReassignTarget
    ) {
      throw new SectorGovernanceConflictError(
        `تعارض القطاع البديل أثناء الاستئناف: العملية الجارية مرتبطة بالقطاع (${existingPendingOp.reassignToSectorId}) وليس (${requestedReassignTarget}).`
      );
    }
    return existingPendingOp.mutationId;
  }

  if (isResumeCall && requestedMutationId) {
    // Allow first-time explicit mutationId only when not contradicting an existing lock
    return requestedMutationId;
  }
  return requestedMutationId ?? generateMutationId(operation, sectorDef.sectorId);
}

function companyNeedsSyncToSector(
  companyData: Record<string, any> | undefined,
  sectorDef: Pick<SectorDefinition, 'sectorId' | 'nameAr' | 'classification'>
): boolean {
  if (!companyData || companyData.isDeleted === true) return false;
  return (
    sanitizeSectorId(companyData.sectorId ?? '') !== sectorDef.sectorId ||
    companyData.sector !== sectorDef.nameAr ||
    companyData.sectorClassification !== sectorDef.classification
  );
}

function computeNextResumeCursor(
  liveRemaining: CompanyDocEntry[],
  lastProcessedId: string | null
): { nextCursor: string | null; detectedBehindCursorCount: number } {
  if (liveRemaining.length === 0) {
    return { nextCursor: null, detectedBehindCursorCount: 0 };
  }
  if (!lastProcessedId) {
    return { nextCursor: null, detectedBehindCursorCount: 0 };
  }
  const behindOrAt = liveRemaining.filter((c) => c.id <= lastProcessedId);
  const ahead = liveRemaining.filter((c) => c.id > lastProcessedId);
  if (ahead.length > 0) {
    return { nextCursor: lastProcessedId, detectedBehindCursorCount: behindOrAt.length };
  }
  // All remaining linked companies exist BEHIND or AT the cursor -> reset cursor to null so next resume sweeps them!
  return { nextCursor: null, detectedBehindCursorCount: behindOrAt.length };
}

export async function executeUpsertSectorGovernance(
  port: SectorMutationPort,
  params: {
    rawPayload: unknown;
    stamp: Record<string, any>;
    maxAtomicCompanies?: number;
  }
): Promise<SectorMutationExecutionResult> {
  const validated: SectorDefinitionPayload = validateSectorDefinitionPayload(params.rawPayload);
  const maxAtomic = Math.min(
    validated.batchLimit ?? params.maxAtomicCompanies ?? DEFAULT_MAX_ATOMIC_SECTOR_COMPANIES,
    DEFAULT_MAX_ATOMIC_SECTOR_COMPANIES
  );

  const preSectors = await port.listAllSectors();
  const preAllDefs = normalizeAllSectorDefs(preSectors);
  const preExisting = preSectors.find((s) => s.id === validated.sectorId);
  const preTargetDef = preExisting ? normalizeSectorDoc(preExisting.id, preExisting.data) : null;

  if (preTargetDef?.pendingDelete) {
    throw new SectorGovernanceConflictError(
      `لا يمكن تعديل القطاع "${preTargetDef.nameAr}" (${preTargetDef.sectorId}) لأنه قيد الحذف حالياً.`
    );
  }

  const prePartition = preTargetDef
    ? await listLinkedCompaniesPartitioned(port, validated.sectorId, preTargetDef, preAllDefs)
    : { explicitLinked: [], legacyLinked: [], allLinked: [] };
  const preLinked = prePartition.allLinked;

  const isResumeCall = Boolean(validated.resumeAfterCompanyId || validated.mutationId);
  const needsMultiBatch =
    validated.propagateToCompanies !== false &&
    (Boolean(validated.resumeAfterCompanyId) ||
      Boolean(preTargetDef?.pendingMutation && preTargetDef.pendingMutation.operation === 'upsert_sector') ||
      preLinked.length > maxAtomic);

  const activeMutationId = preTargetDef
    ? resolveAndValidateResumeBinding({
        operation: 'upsert_sector',
        sectorDef: preTargetDef,
        requestedMutationId: validated.mutationId,
        requestedReassignTarget: null,
        isResumeCall,
      })
    : validated.mutationId ?? generateMutationId('upsert_sector', validated.sectorId);

  const contentHash = computeCanonicalHash({
    sourceType: 'sectorPE',
    sectorId: validated.sectorId,
    nameAr: validated.nameAr,
    aliases: validated.aliases,
    classification: validated.classification,
    multiple: validated.multiple,
    multipleSource: validated.multipleSource,
    multipleAsOfDate: validated.multipleAsOfDate,
    status: validated.status,
    notes: validated.notes,
  });

  const sectorWriteDoc = {
    sectorId: validated.sectorId,
    nameAr: validated.nameAr,
    aliases: validated.aliases,
    classification: validated.classification,
    multiple: validated.multiple,
    value: validated.multiple,
    multipleSource: validated.multipleSource,
    multipleAsOfDate: validated.multipleAsOfDate,
    status: validated.status,
    notes: validated.notes,
    contentHash,
    pendingMutation: null,
    ...params.stamp,
  };

  if (!needsMultiBatch) {
    return port.runTransaction(async (tx) => {
      const allSectors = await tx.getAllSectors();
      const allDefs = normalizeAllSectorDefs(allSectors);

      const conflict = findNameOrAliasConflict(
        allSectors,
        validated.sectorId,
        validated.nameAr,
        validated.aliases,
        false
      );
      if (conflict) {
        throw new SectorGovernanceConflictError(
          `يوجد قطاع نشط آخر مسجل بنفس الاسم أو المرادف الموحّد "${conflict.nameAr}" (${conflict.sectorId}).`
        );
      }

      const existingEntry = allSectors.find((s) => s.id === validated.sectorId);
      const existingDef = existingEntry ? normalizeSectorDoc(existingEntry.id, existingEntry.data) : null;
      if (existingDef?.pendingDelete) {
        throw new SectorGovernanceConflictError(
          `القطاع "${existingDef.nameAr}" (${existingDef.sectorId}) قيد الحذف حالياً ولا يمكن تعديله.`
        );
      }

      const livePartition = existingDef
        ? await getLinkedCompaniesPartitionedInTx(tx, validated.sectorId, existingDef, allDefs)
        : { explicitLinked: [], legacyLinked: [], allLinked: [] };
      const liveLinked = livePartition.allLinked;

      if (validated.propagateToCompanies !== false && liveLinked.length > maxAtomic) {
        throw new SectorGovernanceConflictError(
          `تزايد عدد الشركات المرتبطة بالقطاع إلى ${liveLinked.length}؛ أعد المحاولة لتنفيذ التحديث عبر دفعات قابلة للاستئناف.`
        );
      }

      tx.setSectorDoc(validated.sectorId, sectorWriteDoc, true);

      let updatedCompaniesCount = 0;
      if (validated.propagateToCompanies !== false && liveLinked.length > 0) {
        for (const cDoc of liveLinked) {
          tx.setCompanyDoc(
            cDoc.id,
            {
              sectorId: validated.sectorId,
              sector: validated.nameAr,
              sectorClassification: validated.classification,
              sectorSource: 'sector_registry_sync',
              ...params.stamp,
            },
            true
          );
          updatedCompaniesCount += 1;
        }
      }

      const isUpdate = Boolean(existingEntry);
      return {
        insertedCount: isUpdate ? 0 : 1,
        updatedCount: isUpdate ? 1 : 0,
        processedCount: 1,
        report: {
          operation: 'upsert_sector',
          sectorId: validated.sectorId,
          mutationId: activeMutationId,
          completed: true,
          atomic: true,
          linkedCompaniesCount: liveLinked.length,
          reassignedCount: 0,
          updatedCompaniesCount,
          remainingLinkedCount: 0,
          conflictedCount: 0,
          failedCount: 0,
          legacyTextLinkedCount: livePartition.legacyLinked.length,
          reassignedToSectorId: null,
          resumeAfterCompanyId: null,
          conflictsAr: [],
          errorsAr: [],
          warningAr: null,
          messageAr: `تم حفظ القطاع "${validated.nameAr}" (${validated.sectorId}) بنجاح في معاملة ذرية واحدة${
            updatedCompaniesCount > 0 ? ` مع مزامنة ${updatedCompaniesCount} شركة مرتبطة` : ''
          }.`,
        },
      };
    });
  }

  // Hardened multi-batch resumable execution: bounded per-chunk transaction + live re-verification
  const conflict = findNameOrAliasConflict(
    preSectors,
    validated.sectorId,
    validated.nameAr,
    validated.aliases,
    false
  );
  if (conflict) {
    throw new SectorGovernanceConflictError(
      `يوجد قطاع نشط آخر مسجل بنفس الاسم أو المرادف الموحّد "${conflict.nameAr}" (${conflict.sectorId}).`
    );
  }

  const preNeedingSync = preLinked.filter((c) =>
    companyNeedsSyncToSector(c.data, {
      sectorId: validated.sectorId,
      nameAr: validated.nameAr,
      classification: validated.classification,
    })
  );
  const effectivePrePool = preNeedingSync.length > 0 ? preNeedingSync : preLinked;

  const { chunk, lastId } = selectChunkAfterCursor(
    effectivePrePool,
    validated.resumeAfterCompanyId,
    maxAtomic
  );

  const chunkResult = await port.runTransaction(async (tx) => {
    const allSectors = await tx.getAllSectors();
    const allDefs = normalizeAllSectorDefs(allSectors);
    const liveConflict = findNameOrAliasConflict(
      allSectors,
      validated.sectorId,
      validated.nameAr,
      validated.aliases,
      false
    );
    if (liveConflict) {
      throw new SectorGovernanceConflictError(
        `يوجد قطاع نشط آخر مسجل بنفس الاسم أو المرادف الموحّد "${liveConflict.nameAr}" (${liveConflict.sectorId}).`
      );
    }

    const liveSourceEntry = allSectors.find((s) => s.id === validated.sectorId);
    const liveSourceDef = liveSourceEntry
      ? normalizeSectorDoc(liveSourceEntry.id, liveSourceEntry.data)
      : null;
    if (liveSourceDef) {
      resolveAndValidateResumeBinding({
        operation: 'upsert_sector',
        sectorDef: liveSourceDef,
        requestedMutationId: activeMutationId,
        requestedReassignTarget: null,
        isResumeCall,
      });
    }

    const liveChunkDocs = await readChunkLiveCompaniesInTx(tx, chunk);

    tx.setSectorDoc(
      validated.sectorId,
      {
        ...sectorWriteDoc,
        pendingMutation: {
          mutationId: activeMutationId,
          operation: 'upsert_sector',
          reassignToSectorId: null,
        },
      },
      true
    );

    let updatedInChunk = 0;
    let conflictedCount = 0;
    const conflictsAr: string[] = [];

    for (const previewDoc of chunk) {
      const liveData = liveChunkDocs.get(previewDoc.id);
      const stillMatches = companyMatchesSectorDefinition(
        liveData,
        validated.sectorId,
        liveSourceDef ?? preTargetDef,
        allDefs
      );
      if (!stillMatches) {
        conflictedCount += 1;
        conflictsAr.push(
          `تم تخطي الشركة (${previewDoc.id}) أثناء المزامنة: تغير ارتباطها القطاعي قبل التنفيذ ولم تتم الكتابة فوقها.`
        );
        continue;
      }
      tx.setCompanyDoc(
        previewDoc.id,
        {
          sectorId: validated.sectorId,
          sector: validated.nameAr,
          sectorClassification: validated.classification,
          sectorSource: 'sector_registry_sync',
          ...params.stamp,
        },
        true
      );
      updatedInChunk += 1;
    }

    return { updatedInChunk, conflictedCount, conflictsAr, existedBefore: Boolean(liveSourceEntry) };
  });

  // Live re-verification across entire sector (catches behind-cursor companies needing sync)
  const postSectors = await port.listAllSectors();
  const postAllDefs = normalizeAllSectorDefs(postSectors);
  const postSourceEntry = postSectors.find((s) => s.id === validated.sectorId);
  const postSourceDef = postSourceEntry
    ? normalizeSectorDoc(postSourceEntry.id, postSourceEntry.data)
    : null;
  const postPartition = postSourceDef
    ? await listLinkedCompaniesPartitioned(port, validated.sectorId, postSourceDef, postAllDefs)
    : { explicitLinked: [], legacyLinked: [], allLinked: [] };
  const remainingUnsynced = postPartition.allLinked.filter((c) =>
    companyNeedsSyncToSector(c.data, {
      sectorId: validated.sectorId,
      nameAr: validated.nameAr,
      classification: validated.classification,
    })
  );

  const canComplete = remainingUnsynced.length === 0 && chunkResult.conflictedCount === 0;
  if (canComplete) {
    await port.runTransaction(async (tx) => {
      const liveSec = await tx.getSectorDoc(validated.sectorId);
      if (liveSec && liveSec.isDeleted !== true) {
        tx.setSectorDoc(validated.sectorId, { pendingMutation: null, ...params.stamp }, true);
      }
    });
  }

  const { nextCursor, detectedBehindCursorCount } = computeNextResumeCursor(remainingUnsynced, lastId);
  const completed = canComplete;

  return {
    insertedCount: !validated.resumeAfterCompanyId && !preExisting ? 1 : 0,
    updatedCount: !validated.resumeAfterCompanyId && preExisting ? 1 : 0,
    processedCount: chunkResult.updatedInChunk + (!validated.resumeAfterCompanyId ? 1 : 0),
    report: {
      operation: 'upsert_sector',
      sectorId: validated.sectorId,
      mutationId: activeMutationId,
      completed,
      atomic: false,
      linkedCompaniesCount: Math.max(preLinked.length, postPartition.allLinked.length),
      reassignedCount: 0,
      updatedCompaniesCount: chunkResult.updatedInChunk,
      remainingLinkedCount: remainingUnsynced.length,
      conflictedCount: chunkResult.conflictedCount,
      failedCount: 0,
      legacyTextLinkedCount: postPartition.legacyLinked.length,
      reassignedToSectorId: null,
      resumeAfterCompanyId: completed ? null : nextCursor,
      conflictsAr: chunkResult.conflictsAr,
      errorsAr: [],
      warningAr: completed
        ? 'تم إتمام المزامنة عبر دفعات متعددة محمية بمعاملات مقيدة والتحقق النهائي.'
        : chunkResult.conflictedCount > 0
        ? `تم اكتشاف ${chunkResult.conflictedCount} تعارض(ات) أثناء الدفعة ولم تُعلن العملية مكتملة؛ راجع التعارضات ثم استأنف التأكيد.`
        : detectedBehindCursorCount > 0
        ? `ظهرت ${detectedBehindCursorCount} شركة غير متزامنة خلف مؤشر الاستئناف؛ أُعيد ضبط المؤشر لاستكمالها.`
        : `تحديث متعدد الدفعات (غير ذري عبر الدفعات): تمت مزامنة ${chunkResult.updatedInChunk} شركة وتبقى ${remainingUnsynced.length} شركة للاستئناف.`,
      messageAr: completed
        ? `اكتملت مزامنة القطاع "${validated.nameAr}" (${validated.sectorId}) مع جميع الشركات المرتبطة.`
        : `تمت مزامنة دفعة (${chunkResult.updatedInChunk} شركة) وتبقى ${remainingUnsynced.length} شركة${
            chunkResult.conflictedCount > 0 ? ` مع ${chunkResult.conflictedCount} تعارض(ات)` : ''
          } للقطاع "${validated.nameAr}" — استأنف لإتمام التحقق.`,
    },
  };
}

export async function executeToggleSectorStatusGovernance(
  port: SectorMutationPort,
  params: {
    rawPayload: unknown;
    stamp: Record<string, any>;
    maxAtomicCompanies?: number;
  }
): Promise<SectorMutationExecutionResult> {
  const validated: SectorStatusTogglePayload = validateSectorStatusTogglePayload(params.rawPayload);
  const maxAtomic = Math.min(
    validated.batchLimit ?? params.maxAtomicCompanies ?? DEFAULT_MAX_ATOMIC_SECTOR_COMPANIES,
    DEFAULT_MAX_ATOMIC_SECTOR_COMPANIES
  );

  const preSectors = await port.listAllSectors();
  const preAllDefs = normalizeAllSectorDefs(preSectors);
  const preTarget = preSectors.find((s) => s.id === validated.sectorId);
  const preTargetDef = preTarget ? normalizeSectorDoc(preTarget.id, preTarget.data) : null;
  if (!preTargetDef) {
    throw new SectorGovernanceNotFoundError(`القطاع (${validated.sectorId}) غير موجود في sectorPE.`);
  }

  const isResumeCall = Boolean(validated.resumeAfterCompanyId || validated.mutationId);
  const activeMutationId = resolveAndValidateResumeBinding({
    operation: 'toggle_sector_status',
    sectorDef: preTargetDef,
    requestedMutationId: validated.mutationId,
    requestedReassignTarget: validated.reassignToSectorId ?? null,
    isResumeCall,
  });

  const prePartition = await listLinkedCompaniesPartitioned(
    port,
    validated.sectorId,
    preTargetDef,
    preAllDefs
  );
  const preLinked = prePartition.allLinked;

  const needsReassignMultiBatch =
    validated.status === 'disabled' &&
    Boolean(validated.reassignToSectorId) &&
    (Boolean(validated.resumeAfterCompanyId) ||
      Boolean(
        preTargetDef.pendingMutation &&
          preTargetDef.pendingMutation.operation === 'toggle_sector_status'
      ) ||
      preLinked.length > maxAtomic);

  if (!needsReassignMultiBatch) {
    return port.runTransaction(async (tx) => {
      const allSectors = await tx.getAllSectors();
      const allDefs = normalizeAllSectorDefs(allSectors);

      const targetEntry = allSectors.find((s) => s.id === validated.sectorId);
      const targetDef = targetEntry ? normalizeSectorDoc(targetEntry.id, targetEntry.data) : null;
      if (!targetDef) {
        throw new SectorGovernanceNotFoundError(`القطاع (${validated.sectorId}) غير موجود في sectorPE.`);
      }

      resolveAndValidateResumeBinding({
        operation: 'toggle_sector_status',
        sectorDef: targetDef,
        requestedMutationId: activeMutationId,
        requestedReassignTarget: validated.reassignToSectorId ?? null,
        isResumeCall,
      });

      if (validated.status === 'active') {
        const activeConflict = findNameOrAliasConflict(
          allSectors,
          targetDef.sectorId,
          targetDef.nameAr,
          targetDef.aliases,
          false
        );
        if (activeConflict) {
          throw new SectorGovernanceConflictError(
            `لا يمكن إعادة تفعيل القطاع "${targetDef.nameAr}" لوجود قطاع نشط آخر يحمل نفس الاسم أو المرادف "${activeConflict.nameAr}" (${activeConflict.sectorId}).`
          );
        }
      }

      const livePartition = await getLinkedCompaniesPartitionedInTx(
        tx,
        validated.sectorId,
        targetDef,
        allDefs
      );
      const liveLinked = livePartition.allLinked;

      let reassignedCount = 0;
      let reassignedToSectorId: string | null = null;

      if (validated.status === 'disabled' && validated.reassignToSectorId) {
        const altEntry = allSectors.find((s) => s.id === validated.reassignToSectorId);
        const altDef = assertValidReplacementSector(
          altEntry ? normalizeSectorDoc(altEntry.id, altEntry.data) : null,
          validated.reassignToSectorId
        );
        if (liveLinked.length > maxAtomic) {
          throw new SectorGovernanceConflictError(
            `عدد الشركات المرتبطة (${liveLinked.length}) يتجاوز حد المعاملة الذرية الواحدة؛ أعد المحاولة بالتنفيذ المرحلي القابل للاستئناف.`
          );
        }
        for (const cDoc of liveLinked) {
          tx.setCompanyDoc(
            cDoc.id,
            {
              sectorId: altDef.sectorId,
              sector: altDef.nameAr,
              sectorClassification: altDef.classification,
              sectorSource: 'sector_registry_reassign',
              ...params.stamp,
            },
            true
          );
          reassignedCount += 1;
        }
        reassignedToSectorId = altDef.sectorId;
      }

      tx.setSectorDoc(
        validated.sectorId,
        {
          sectorId: targetDef.sectorId,
          nameAr: targetDef.nameAr,
          status: validated.status,
          pendingMutation: null,
          ...params.stamp,
        },
        true
      );

      const remainingLinkedCount =
        validated.status === 'disabled' && reassignedToSectorId ? 0 : liveLinked.length;

      return {
        insertedCount: 0,
        updatedCount: 1,
        processedCount: 1 + reassignedCount,
        report: {
          operation: 'toggle_sector_status',
          sectorId: targetDef.sectorId,
          mutationId: activeMutationId,
          completed: true,
          atomic: true,
          linkedCompaniesCount: liveLinked.length,
          reassignedCount,
          updatedCompaniesCount: reassignedCount,
          remainingLinkedCount,
          conflictedCount: 0,
          failedCount: 0,
          legacyTextLinkedCount: livePartition.legacyLinked.length,
          reassignedToSectorId,
          resumeAfterCompanyId: null,
          conflictsAr: [],
          errorsAr: [],
          warningAr:
            validated.status === 'disabled' && !reassignedToSectorId && liveLinked.length > 0
              ? `تم تعطيل القطاع مع الإبقاء على ارتباط ${liveLinked.length} شركة قائمة لأغراض التدقيق (ستظهر كقطاع معطّل لحين إعادة ربطها عند الرغبة).`
              : null,
          messageAr:
            validated.status === 'disabled'
              ? reassignedToSectorId
                ? `تم تعطيل القطاع "${targetDef.nameAr}" وإعادة إسناد ${reassignedCount} شركة إلى (${reassignedToSectorId}) ذرياً.`
                : `تم تعطيل القطاع "${targetDef.nameAr}" بنجاح؛ لن يظهر للاختيارات الجديدة وتبقى الروابط القائمة (${liveLinked.length}) قابلة للتدقيق.`
              : `تم إعادة تفعيل القطاع "${targetDef.nameAr}" (${targetDef.sectorId}) بنجاح.`,
        },
      };
    });
  }

  // Hardened multi-batch resumable reassignment before disabling: bounded per-chunk transaction + live re-check
  const reassignTargetId = validated.reassignToSectorId!;
  const preAltEntry = preSectors.find((s) => s.id === reassignTargetId);
  assertValidReplacementSector(
    preAltEntry ? normalizeSectorDoc(preAltEntry.id, preAltEntry.data) : null,
    reassignTargetId
  );

  const { chunk, lastId } = selectChunkAfterCursor(
    preLinked,
    validated.resumeAfterCompanyId,
    maxAtomic
  );

  const chunkResult = await port.runTransaction(async (tx) => {
    const allSectors = await tx.getAllSectors();
    const allDefs = normalizeAllSectorDefs(allSectors);

    const liveSourceEntry = allSectors.find((s) => s.id === validated.sectorId);
    const liveSourceDef = liveSourceEntry
      ? normalizeSectorDoc(liveSourceEntry.id, liveSourceEntry.data)
      : null;
    if (!liveSourceDef) {
      throw new SectorGovernanceNotFoundError(`القطاع (${validated.sectorId}) غير موجود في sectorPE.`);
    }

    resolveAndValidateResumeBinding({
      operation: 'toggle_sector_status',
      sectorDef: liveSourceDef,
      requestedMutationId: activeMutationId,
      requestedReassignTarget: reassignTargetId,
      isResumeCall,
    });

    const liveAltEntry = allSectors.find((s) => s.id === reassignTargetId);
    const liveAltDef = assertValidReplacementSector(
      liveAltEntry ? normalizeSectorDoc(liveAltEntry.id, liveAltEntry.data) : null,
      reassignTargetId
    );

    const liveChunkDocs = await readChunkLiveCompaniesInTx(tx, chunk);

    // Record pending mutation binding on the source sector
    tx.setSectorDoc(
      validated.sectorId,
      {
        pendingMutation: {
          mutationId: activeMutationId,
          operation: 'toggle_sector_status',
          reassignToSectorId: liveAltDef.sectorId,
        },
        ...params.stamp,
      },
      true
    );

    let reassignedInChunk = 0;
    let conflictedCount = 0;
    const conflictsAr: string[] = [];

    for (const previewDoc of chunk) {
      const liveData = liveChunkDocs.get(previewDoc.id);
      const stillMatches = companyMatchesSectorDefinition(
        liveData,
        validated.sectorId,
        liveSourceDef,
        allDefs
      );
      if (!stillMatches) {
        conflictedCount += 1;
        conflictsAr.push(
          `تم تخطي الشركة (${previewDoc.id}) أثناء إعادة الإسناد: تغير ارتباطها القطاعي بعد المعاينة ولم تتم الكتابة فوقها.`
        );
        continue;
      }
      tx.setCompanyDoc(
        previewDoc.id,
        {
          sectorId: liveAltDef.sectorId,
          sector: liveAltDef.nameAr,
          sectorClassification: liveAltDef.classification,
          sectorSource: 'sector_registry_reassign',
          ...params.stamp,
        },
        true
      );
      reassignedInChunk += 1;
    }

    return {
      reassignedInChunk,
      conflictedCount,
      conflictsAr,
      liveAltDef,
      liveSourceDef,
    };
  });

  // Live post-chunk re-scan across the entire source sector (catches behind-cursor inserts!)
  const postSectors = await port.listAllSectors();
  const postAllDefs = normalizeAllSectorDefs(postSectors);
  const postSourceEntry = postSectors.find((s) => s.id === validated.sectorId);
  const postSourceDef = postSourceEntry
    ? normalizeSectorDoc(postSourceEntry.id, postSourceEntry.data)
    : null;
  if (!postSourceDef) {
    throw new SectorGovernanceNotFoundError(`القطاع (${validated.sectorId}) غير موجود في sectorPE.`);
  }

  const postPartition = await listLinkedCompaniesPartitioned(
    port,
    validated.sectorId,
    postSourceDef,
    postAllDefs
  );
  const liveRemaining = postPartition.allLinked;

  if (liveRemaining.length > 0 || chunkResult.conflictedCount > 0) {
    const { nextCursor, detectedBehindCursorCount } = computeNextResumeCursor(liveRemaining, lastId);
    return {
      insertedCount: 0,
      updatedCount: 0,
      processedCount: chunkResult.reassignedInChunk,
      report: {
        operation: 'toggle_sector_status',
        sectorId: postSourceDef.sectorId,
        mutationId: activeMutationId,
        completed: false,
        atomic: false,
        linkedCompaniesCount: Math.max(preLinked.length, liveRemaining.length + chunkResult.reassignedInChunk),
        reassignedCount: chunkResult.reassignedInChunk,
        updatedCompaniesCount: chunkResult.reassignedInChunk,
        remainingLinkedCount: liveRemaining.length,
        conflictedCount: chunkResult.conflictedCount,
        failedCount: 0,
        legacyTextLinkedCount: postPartition.legacyLinked.length,
        reassignedToSectorId: chunkResult.liveAltDef.sectorId,
        resumeAfterCompanyId: nextCursor,
        conflictsAr: chunkResult.conflictsAr,
        errorsAr: [],
        warningAr:
          chunkResult.conflictedCount > 0
            ? `تم اكتشاف ${chunkResult.conflictedCount} تعارض(ات) أثناء إعادة الإسناد ولم يُعطّل القطاع بعد؛ راجع التعارضات ثم استأنف.`
            : detectedBehindCursorCount > 0
            ? `تم اكتشاف ${detectedBehindCursorCount} شركة مرتبطة خلف مؤشر الاستئناف؛ أُعيد ضبط المؤشر لضمان نقلها قبل التعطيل.`
            : `عملية متعددة الدفعات (غير ذرية عبر الدفعات): نُقلت ${chunkResult.reassignedInChunk} شركة وتبقى ${liveRemaining.length} شركة قبل إتمام تعطيل القطاع.`,
        messageAr: `تم نقل دفعة (${chunkResult.reassignedInChunk} شركة) إلى "${chunkResult.liveAltDef.nameAr}" وتبقى ${liveRemaining.length} شركة${
          chunkResult.conflictedCount > 0 ? ` مع ${chunkResult.conflictedCount} تعارض(ات)` : ''
        } — استأنف لإتمام التعطيل.`,
      },
    };
  }

  // Final transactional verification confirming 0 remaining links before finalizing disabled status
  return port.runTransaction(async (tx) => {
    const allSectors = await tx.getAllSectors();
    const allDefs = normalizeAllSectorDefs(allSectors);
    const targetEntry = allSectors.find((s) => s.id === validated.sectorId);
    const targetDef = targetEntry ? normalizeSectorDoc(targetEntry.id, targetEntry.data) : null;
    if (!targetDef) {
      throw new SectorGovernanceNotFoundError(`القطاع (${validated.sectorId}) غير موجود في sectorPE.`);
    }

    const finalPartition = await getLinkedCompaniesPartitionedInTx(
      tx,
      validated.sectorId,
      targetDef,
      allDefs
    );
    if (finalPartition.allLinked.length > 0) {
      return {
        insertedCount: 0,
        updatedCount: 0,
        processedCount: chunkResult.reassignedInChunk,
        report: {
          operation: 'toggle_sector_status',
          sectorId: targetDef.sectorId,
          mutationId: activeMutationId,
          completed: false,
          atomic: false,
          linkedCompaniesCount: finalPartition.allLinked.length,
          reassignedCount: chunkResult.reassignedInChunk,
          updatedCompaniesCount: chunkResult.reassignedInChunk,
          remainingLinkedCount: finalPartition.allLinked.length,
          conflictedCount: 0,
          failedCount: 0,
          legacyTextLinkedCount: finalPartition.legacyLinked.length,
          reassignedToSectorId: chunkResult.liveAltDef.sectorId,
          resumeAfterCompanyId: null,
          conflictsAr: [],
          errorsAr: [],
          warningAr: `ظهرت ${finalPartition.allLinked.length} شركة جديدة مرتبطة بالقطاع قبل التأكيد النهائي؛ لم يُعطّل القطاع ويمكن الاستئناف لنقلها.`,
          messageAr: `نُقلت ${chunkResult.reassignedInChunk} شركة وبقي ${finalPartition.allLinked.length} شركة مرتبطة حديثاً قبل تعطيل "${targetDef.nameAr}".`,
        },
      };
    }

    tx.setSectorDoc(
      validated.sectorId,
      {
        sectorId: targetDef.sectorId,
        nameAr: targetDef.nameAr,
        status: 'disabled',
        pendingMutation: null,
        ...params.stamp,
      },
      true
    );

    return {
      insertedCount: 0,
      updatedCount: 1,
      processedCount: chunkResult.reassignedInChunk + 1,
      report: {
        operation: 'toggle_sector_status',
        sectorId: targetDef.sectorId,
        mutationId: activeMutationId,
        completed: true,
        atomic: false,
        linkedCompaniesCount: preLinked.length,
        reassignedCount: chunkResult.reassignedInChunk,
        updatedCompaniesCount: chunkResult.reassignedInChunk,
        remainingLinkedCount: 0,
        conflictedCount: 0,
        failedCount: 0,
        legacyTextLinkedCount: 0,
        reassignedToSectorId: chunkResult.liveAltDef.sectorId,
        resumeAfterCompanyId: null,
        conflictsAr: [],
        errorsAr: [],
        warningAr: 'تم تنفيذ إعادة الإسناد والتعطيل عبر دفعات متعددة محمية ثم تأكيد خلو الروابط ذرياً.',
        messageAr: `تم إتمام نقل الشركات وتعطيل القطاع "${targetDef.nameAr}" بنجاح.`,
      },
    };
  });
}

export async function executeDeleteSectorGovernance(
  port: SectorMutationPort,
  params: {
    rawPayload: unknown;
    stamp: Record<string, any>;
    maxAtomicCompanies?: number;
  }
): Promise<SectorMutationExecutionResult> {
  const validated: SectorDeletePayload = validateSectorDeletePayload(params.rawPayload);
  const maxAtomic = Math.min(
    validated.batchLimit ?? params.maxAtomicCompanies ?? DEFAULT_MAX_ATOMIC_SECTOR_COMPANIES,
    DEFAULT_MAX_ATOMIC_SECTOR_COMPANIES
  );

  const preSectors = await port.listAllSectors();
  const preAllDefs = normalizeAllSectorDefs(preSectors);
  const preTarget = preSectors.find((s) => s.id === validated.sectorId);
  const preTargetDef = preTarget ? normalizeSectorDoc(preTarget.id, preTarget.data) : null;
  if (!preTargetDef) {
    throw new SectorGovernanceNotFoundError(`القطاع (${validated.sectorId}) غير موجود في sectorPE.`);
  }

  const isResumeCall = Boolean(validated.resumeAfterCompanyId || validated.mutationId);
  const activeMutationId = resolveAndValidateResumeBinding({
    operation: 'delete_sector',
    sectorDef: preTargetDef,
    requestedMutationId: validated.mutationId,
    requestedReassignTarget: validated.reassignToSectorId ?? null,
    isResumeCall,
  });

  const prePartition = await listLinkedCompaniesPartitioned(
    port,
    validated.sectorId,
    preTargetDef,
    preAllDefs
  );
  const preLinked = prePartition.allLinked;

  if (preLinked.length > 0 && !validated.reassignToSectorId) {
    throw new SectorGovernanceConflictError(
      `لا يمكن حذف القطاع "${preTargetDef.nameAr}" لوجود ${preLinked.length} شركة مرتبطة به؛ اختر قطاعاً بديلاً نشطاً لإعادة إسناد الشركات أولاً أو استخدم التعطيل بدلاً من الحذف.`
    );
  }

  const needsMultiBatchReassign =
    Boolean(validated.reassignToSectorId) &&
    (Boolean(validated.resumeAfterCompanyId) ||
      preTargetDef.pendingDelete === true ||
      preLinked.length > maxAtomic);

  if (!needsMultiBatchReassign) {
    return port.runTransaction(async (tx) => {
      const allSectors = await tx.getAllSectors();
      const allDefs = normalizeAllSectorDefs(allSectors);

      const targetEntry = allSectors.find((s) => s.id === validated.sectorId);
      const targetDef = targetEntry ? normalizeSectorDoc(targetEntry.id, targetEntry.data) : null;
      if (!targetDef) {
        throw new SectorGovernanceNotFoundError(`القطاع (${validated.sectorId}) غير موجود في sectorPE.`);
      }

      resolveAndValidateResumeBinding({
        operation: 'delete_sector',
        sectorDef: targetDef,
        requestedMutationId: activeMutationId,
        requestedReassignTarget: validated.reassignToSectorId ?? null,
        isResumeCall,
      });

      const livePartition = await getLinkedCompaniesPartitionedInTx(
        tx,
        validated.sectorId,
        targetDef,
        allDefs
      );
      const liveLinked = livePartition.allLinked;

      let reassignedCount = 0;
      let reassignedToSectorId: string | null = null;

      if (liveLinked.length > 0) {
        if (!validated.reassignToSectorId) {
          throw new SectorGovernanceConflictError(
            `تم رفض الحذف بعد إعادة الفحص في الخادم: توجد ${liveLinked.length} شركة مرتبطة حالياً بالقطاع "${targetDef.nameAr}"؛ حدد قطاعاً بديلاً نشطاً لإعادة الإسناد.`
          );
        }
        const altEntry = allSectors.find((s) => s.id === validated.reassignToSectorId);
        const altDef = assertValidReplacementSector(
          altEntry ? normalizeSectorDoc(altEntry.id, altEntry.data) : null,
          validated.reassignToSectorId
        );
        if (liveLinked.length > maxAtomic) {
          throw new SectorGovernanceConflictError(
            `تزايد عدد الشركات المرتبطة أثناء التنفيذ إلى ${liveLinked.length}؛ أعد التنفيذ بنمط الدفعات القابلة للاستئناف.`
          );
        }
        for (const cDoc of liveLinked) {
          tx.setCompanyDoc(
            cDoc.id,
            {
              sectorId: altDef.sectorId,
              sector: altDef.nameAr,
              sectorClassification: altDef.classification,
              sectorSource: 'sector_registry_reassign',
              ...params.stamp,
            },
            true
          );
          reassignedCount += 1;
        }
        reassignedToSectorId = altDef.sectorId;
      }

      tx.deleteSectorDoc(validated.sectorId);
      tx.writeSectorTombstone(validated.sectorId);

      return {
        insertedCount: 0,
        updatedCount: 0,
        processedCount: 1 + reassignedCount,
        report: {
          operation: 'delete_sector',
          sectorId: targetDef.sectorId,
          mutationId: activeMutationId,
          completed: true,
          atomic: true,
          linkedCompaniesCount: liveLinked.length,
          reassignedCount,
          updatedCompaniesCount: reassignedCount,
          remainingLinkedCount: 0,
          conflictedCount: 0,
          failedCount: 0,
          legacyTextLinkedCount: livePartition.legacyLinked.length,
          reassignedToSectorId,
          resumeAfterCompanyId: null,
          conflictsAr: [],
          errorsAr: [],
          warningAr: null,
          messageAr:
            reassignedCount > 0
              ? `تم نقل ${reassignedCount} شركة إلى (${reassignedToSectorId}) وحذف القطاع "${targetDef.nameAr}" ذرياً مع إصدار شاهد حذف موثق.`
              : `تم حذف القطاع "${targetDef.nameAr}" (${targetDef.sectorId}) ذرياً مع إصدار شاهد حذف موثق دون المساس بأي شركات أو سجلات مالية.`,
        },
      };
    });
  }

  // Hardened multi-batch resumable deletion:
  // 1. Locks source sector with `pendingDelete: true` inside chunk transaction so concurrent company writes reject new links.
  // 2. Executes EVERY chunk inside a bounded transaction re-verifying source sector, replacement sector, and every company.
  // 3. Re-scans entire source sector after chunk (catching behind-cursor links).
  // 4. NEVER deletes sector or declares completed:true while remaining links, conflicts, or failures exist.
  const reassignTargetId = validated.reassignToSectorId!;
  const preAltEntry = preSectors.find((s) => s.id === reassignTargetId);
  assertValidReplacementSector(
    preAltEntry ? normalizeSectorDoc(preAltEntry.id, preAltEntry.data) : null,
    reassignTargetId
  );

  const { chunk, lastId } = selectChunkAfterCursor(
    preLinked,
    validated.resumeAfterCompanyId,
    maxAtomic
  );

  const chunkResult = await port.runTransaction(async (tx) => {
    const allSectors = await tx.getAllSectors();
    const allDefs = normalizeAllSectorDefs(allSectors);

    const liveSourceEntry = allSectors.find((s) => s.id === validated.sectorId);
    const liveSourceDef = liveSourceEntry
      ? normalizeSectorDoc(liveSourceEntry.id, liveSourceEntry.data)
      : null;
    if (!liveSourceDef) {
      throw new SectorGovernanceNotFoundError(`القطاع (${validated.sectorId}) غير موجود في sectorPE.`);
    }

    resolveAndValidateResumeBinding({
      operation: 'delete_sector',
      sectorDef: liveSourceDef,
      requestedMutationId: activeMutationId,
      requestedReassignTarget: reassignTargetId,
      isResumeCall,
    });

    const liveAltEntry = allSectors.find((s) => s.id === reassignTargetId);
    const liveAltDef = assertValidReplacementSector(
      liveAltEntry ? normalizeSectorDoc(liveAltEntry.id, liveAltEntry.data) : null,
      reassignTargetId
    );

    const liveChunkDocs = await readChunkLiveCompaniesInTx(tx, chunk);

    // Atomically lock source sector as pendingDelete so NO concurrent company write can link new companies to it
    tx.setSectorDoc(
      validated.sectorId,
      {
        pendingDelete: true,
        pendingDeleteOperationId: activeMutationId,
        pendingDeleteTargetSectorId: liveAltDef.sectorId,
        pendingMutation: {
          mutationId: activeMutationId,
          operation: 'delete_sector',
          reassignToSectorId: liveAltDef.sectorId,
        },
        ...params.stamp,
      },
      true
    );

    let reassignedInChunk = 0;
    let conflictedCount = 0;
    const conflictsAr: string[] = [];

    for (const previewDoc of chunk) {
      const liveData = liveChunkDocs.get(previewDoc.id);
      const stillMatches = companyMatchesSectorDefinition(
        liveData,
        validated.sectorId,
        liveSourceDef,
        allDefs
      );
      if (!stillMatches) {
        conflictedCount += 1;
        conflictsAr.push(
          `تم تخطي الشركة (${previewDoc.id}) أثناء إعادة الإسناد: تغير ارتباطها القطاعي بعد المعاينة ولم تتم الكتابة فوقها.`
        );
        continue;
      }
      tx.setCompanyDoc(
        previewDoc.id,
        {
          sectorId: liveAltDef.sectorId,
          sector: liveAltDef.nameAr,
          sectorClassification: liveAltDef.classification,
          sectorSource: 'sector_registry_reassign',
          ...params.stamp,
        },
        true
      );
      reassignedInChunk += 1;
    }

    return {
      reassignedInChunk,
      conflictedCount,
      conflictsAr,
      liveAltDef,
      liveSourceDef,
    };
  });

  // Live full re-check across the ENTIRE source sector (catches behind-cursor companies!)
  const postSectors = await port.listAllSectors();
  const postAllDefs = normalizeAllSectorDefs(postSectors);
  const postSourceEntry = postSectors.find((s) => s.id === validated.sectorId);
  const postSourceDef = postSourceEntry
    ? normalizeSectorDoc(postSourceEntry.id, postSourceEntry.data)
    : null;
  if (!postSourceDef) {
    throw new SectorGovernanceNotFoundError(`القطاع (${validated.sectorId}) غير موجود في sectorPE.`);
  }

  const postPartition = await listLinkedCompaniesPartitioned(
    port,
    validated.sectorId,
    postSourceDef,
    postAllDefs
  );
  const liveRemaining = postPartition.allLinked;

  if (liveRemaining.length > 0 || chunkResult.conflictedCount > 0) {
    const { nextCursor, detectedBehindCursorCount } = computeNextResumeCursor(liveRemaining, lastId);
    return {
      insertedCount: 0,
      updatedCount: 0,
      processedCount: chunkResult.reassignedInChunk,
      report: {
        operation: 'delete_sector',
        sectorId: postSourceDef.sectorId,
        mutationId: activeMutationId,
        completed: false,
        atomic: false,
        linkedCompaniesCount: Math.max(
          preLinked.length,
          liveRemaining.length + chunkResult.reassignedInChunk
        ),
        reassignedCount: chunkResult.reassignedInChunk,
        updatedCompaniesCount: chunkResult.reassignedInChunk,
        remainingLinkedCount: liveRemaining.length,
        conflictedCount: chunkResult.conflictedCount,
        failedCount: 0,
        legacyTextLinkedCount: postPartition.legacyLinked.length,
        reassignedToSectorId: chunkResult.liveAltDef.sectorId,
        resumeAfterCompanyId: nextCursor,
        conflictsAr: chunkResult.conflictsAr,
        errorsAr: [],
        warningAr:
          chunkResult.conflictedCount > 0
            ? `تم اكتشاف ${chunkResult.conflictedCount} تعارض(ات) أثناء إعادة الإسناد ولم يُحذف القطاع؛ راجع التعارضات ثم استأنف التأكيد النهائي.`
            : detectedBehindCursorCount > 0
            ? `تم اكتشاف ${detectedBehindCursorCount} شركة مرتبطة خلف مؤشر الاستئناف؛ أُعيد ضبط المؤشر ولم يُحذف القطاع بعد.`
            : `عملية متعددة الدفعات (غير ذرية عبر الدفعات): نُقلت ${chunkResult.reassignedInChunk} شركة وتبقى ${liveRemaining.length} شركة مرتبطة — قُفل القطاع (pendingDelete) ولم يُحذف بعد منعاً للمراجع المعلقة.`,
        messageAr: `تم نقل دفعة (${chunkResult.reassignedInChunk} شركة) إلى "${chunkResult.liveAltDef.nameAr}" وتبقى ${liveRemaining.length} شركة${
          chunkResult.conflictedCount > 0 ? ` مع ${chunkResult.conflictedCount} تعارض(ات)` : ''
        }؛ استأنف لإتمام حذف القطاع "${postSourceDef.nameAr}".`,
      },
    };
  }

  // Final atomic verification & deletion ONLY after confirming 0 remaining explicit AND legacy links
  return port.runTransaction(async (tx) => {
    const allSectors = await tx.getAllSectors();
    const allDefs = normalizeAllSectorDefs(allSectors);
    const targetEntry = allSectors.find((s) => s.id === validated.sectorId);
    const targetDef = targetEntry ? normalizeSectorDoc(targetEntry.id, targetEntry.data) : null;
    if (!targetDef) {
      throw new SectorGovernanceNotFoundError(`القطاع (${validated.sectorId}) غير موجود في sectorPE.`);
    }

    resolveAndValidateResumeBinding({
      operation: 'delete_sector',
      sectorDef: targetDef,
      requestedMutationId: activeMutationId,
      requestedReassignTarget: reassignTargetId,
      isResumeCall: true,
    });

    const finalPartition = await getLinkedCompaniesPartitionedInTx(
      tx,
      validated.sectorId,
      targetDef,
      allDefs
    );
    const newlyLinked = finalPartition.allLinked;
    if (newlyLinked.length > 0) {
      return {
        insertedCount: 0,
        updatedCount: 0,
        processedCount: chunkResult.reassignedInChunk,
        report: {
          operation: 'delete_sector',
          sectorId: targetDef.sectorId,
          mutationId: activeMutationId,
          completed: false,
          atomic: false,
          linkedCompaniesCount: newlyLinked.length,
          reassignedCount: chunkResult.reassignedInChunk,
          updatedCompaniesCount: chunkResult.reassignedInChunk,
          remainingLinkedCount: newlyLinked.length,
          conflictedCount: 0,
          failedCount: 0,
          legacyTextLinkedCount: finalPartition.legacyLinked.length,
          reassignedToSectorId: chunkResult.liveAltDef.sectorId,
          resumeAfterCompanyId: null,
          conflictsAr: [],
          errorsAr: [],
          warningAr: `ظهرت ${newlyLinked.length} شركة مرتبطة بالقطاع أثناء الفحص النهائي؛ لم يُحذف القطاع منعاً للمراجع المعلقة، ويمكن الاستئناف لنقلها.`,
          messageAr: `نُقلت ${chunkResult.reassignedInChunk} شركة، وبقي ${newlyLinked.length} شركة مرتبطة قبل حذف "${targetDef.nameAr}".`,
        },
      };
    }

    tx.deleteSectorDoc(validated.sectorId);
    tx.writeSectorTombstone(validated.sectorId);

    return {
      insertedCount: 0,
      updatedCount: 0,
      processedCount: chunkResult.reassignedInChunk + 1,
      report: {
        operation: 'delete_sector',
        sectorId: targetDef.sectorId,
        mutationId: activeMutationId,
        completed: true,
        atomic: false,
        linkedCompaniesCount: preLinked.length,
        reassignedCount: chunkResult.reassignedInChunk,
        updatedCompaniesCount: chunkResult.reassignedInChunk,
        remainingLinkedCount: 0,
        conflictedCount: 0,
        failedCount: 0,
        legacyTextLinkedCount: 0,
        reassignedToSectorId: chunkResult.liveAltDef.sectorId,
        resumeAfterCompanyId: null,
        conflictsAr: [],
        errorsAr: [],
        warningAr:
          'أُنجزت إعادة إسناد الشركات عبر دفعات محمية بمعاملات مقيدة ثم حُذف القطاع بعد التأكد الذري من خلو الروابط.',
        messageAr: `اكتمل نقل الشركات وحذف القطاع "${targetDef.nameAr}" (${targetDef.sectorId}) مع إصدار شاهد حذف موثق.`,
      },
    };
  });
}
