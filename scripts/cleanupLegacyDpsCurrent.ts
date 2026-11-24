/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * أداة مستقلة ومحكومة لتنظيف حقل DPS_Current القديم من وثائق Firestore:
 * - النطاق الحصري: quarterly_financial_records و financials فقط.
 * - تحذف المسارات الأربعة الدقيقة فقط: dpsCurrent, DPS_Current, extendedFields.dpsCurrent, extendedFields.DPS_Current.
 * - لا تحذف أي وثيقة ولا تمس أي حقول أخرى أو مجموعات أخرى.
 * - الافتراضي هو --dry-run للمعاينة بدون أي تعديل، مع اشتراط --project الصريح.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildRestorePatchForDoc,
  CLEANUP_BACKUP_SCHEMA,
  CLEANUP_TOOL_VERSION,
  createEmptyCleanupReport,
  inspectLegacyDpsDocument,
  LEGACY_DPS_TARGET_COLLECTIONS,
  validateBackupEntryScopeAndPaths,
  type LegacyDpsBackupEntry,
  type LegacyDpsCleanupReport,
  type LegacyDpsDocPlan,
  type LegacyDpsFailedDocEntry,
  type LegacyDpsTargetCollection,
} from '../src/core/domain/legacyDpsCleanup';

export interface CleanupCliOptions {
  mode: 'dry-run' | 'apply' | 'restore';
  projectId: string;
  databaseId: string;
  batchSize: number;
  backupPath: string | null;
  restorePath: string | null;
  checkpointPath: string | null;
  reportPath: string | null;
  resumeAfter: Partial<Record<LegacyDpsTargetCollection, string>>;
}

export interface CleanupBackupFile {
  schema: typeof CLEANUP_BACKUP_SCHEMA;
  toolVersion: string;
  runId: string;
  projectId: string;
  databaseId: string;
  createdAt: string;
  updatedAt?: string;
  collections: LegacyDpsTargetCollection[];
  entries: LegacyDpsBackupEntry[];
}

export interface CleanupCheckpointState {
  mode: 'dry-run' | 'apply';
  runId: string;
  toolVersion: string;
  projectId: string;
  databaseId: string;
  backupPath: string | null;
  completed: boolean;
  updatedAt: string;
  completedCollections: LegacyDpsTargetCollection[];
  lastProcessedDocIdByCollection: Record<LegacyDpsTargetCollection, string | null>;
  failedDocs: LegacyDpsFailedDocEntry[];
}

export interface FirestoreDocSnapshotLike {
  id: string;
  exists: boolean;
  updateTime?: { toDate(): Date } | null;
  data(): Record<string, unknown> | undefined;
  ref: FirestoreDocRefLike;
}

export interface FirestoreDocRefLike {
  id: string;
  get(): Promise<FirestoreDocSnapshotLike>;
  update(
    data: Record<string, unknown>,
    precondition?: { lastUpdateTime?: unknown }
  ): Promise<unknown>;
  set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>;
}

export interface FirestoreQueryLike {
  orderBy(field: unknown): FirestoreQueryLike;
  startAfter(cursor: unknown): FirestoreQueryLike;
  limit(n: number): FirestoreQueryLike;
  get(): Promise<{ docs: FirestoreDocSnapshotLike[] }>;
}

export interface FirestoreTransactionLike {
  get(ref: FirestoreDocRefLike): Promise<FirestoreDocSnapshotLike>;
  set(
    ref: FirestoreDocRefLike,
    data: Record<string, unknown>,
    options?: { merge?: boolean }
  ): unknown;
  update(
    ref: FirestoreDocRefLike,
    data: Record<string, unknown>,
    precondition?: { lastUpdateTime?: unknown }
  ): unknown;
}

export interface FirestoreDbLike {
  collection(name: string): FirestoreQueryLike & {
    doc(id: string): FirestoreDocRefLike;
  };
  runTransaction?<T>(fn: (tx: FirestoreTransactionLike) => Promise<T>): Promise<T>;
}

export interface FirestoreSentinels {
  documentId: unknown;
  deleteField(): unknown;
  serverTimestamp(): unknown;
}

export function parseCleanupCliArgs(argv: string[]): CleanupCliOptions {
  let projectId = '';
  let databaseId = '(default)';
  let mode: CleanupCliOptions['mode'] = 'dry-run';
  let applyFlag = false;
  let dryRunFlag = false;
  let restorePath: string | null = null;
  let backupPath: string | null = null;
  let checkpointPath: string | null = null;
  let reportPath: string | null = null;
  let batchSize = 200;
  let resumeAfterGlobal: string | null = null;
  const resumeAfter: Partial<Record<LegacyDpsTargetCollection, string>> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const nextVal = (): string => {
      if (i + 1 >= argv.length) {
        throw new Error(`الخيار ${arg} يتطلب قيمة.`);
      }
      i += 1;
      return argv[i];
    };

    if (arg === '--project') {
      projectId = nextVal().trim();
    } else if (arg.startsWith('--project=')) {
      projectId = arg.slice('--project='.length).trim();
    } else if (arg === '--database') {
      databaseId = nextVal().trim() || '(default)';
    } else if (arg.startsWith('--database=')) {
      databaseId = arg.slice('--database='.length).trim() || '(default)';
    } else if (arg === '--dry-run') {
      dryRunFlag = true;
    } else if (arg === '--apply') {
      applyFlag = true;
    } else if (arg === '--restore') {
      restorePath = nextVal().trim();
    } else if (arg.startsWith('--restore=')) {
      restorePath = arg.slice('--restore='.length).trim();
    } else if (arg === '--backup') {
      backupPath = nextVal().trim();
    } else if (arg.startsWith('--backup=')) {
      backupPath = arg.slice('--backup='.length).trim();
    } else if (arg === '--checkpoint') {
      checkpointPath = nextVal().trim();
    } else if (arg.startsWith('--checkpoint=')) {
      checkpointPath = arg.slice('--checkpoint='.length).trim();
    } else if (arg === '--report') {
      reportPath = nextVal().trim();
    } else if (arg.startsWith('--report=')) {
      reportPath = arg.slice('--report='.length).trim();
    } else if (arg === '--batch-size') {
      batchSize = Number(nextVal());
    } else if (arg.startsWith('--batch-size=')) {
      batchSize = Number(arg.slice('--batch-size='.length));
    } else if (arg === '--resume-after') {
      const val = nextVal().trim();
      const colonIdx = val.indexOf(':');
      if (colonIdx > 0) {
        const col = val.slice(0, colonIdx) as LegacyDpsTargetCollection;
        const docId = val.slice(colonIdx + 1).trim();
        if (!LEGACY_DPS_TARGET_COLLECTIONS.includes(col)) {
          throw new Error(`اسم المجموعة غير مدعوم في --resume-after: ${col}`);
        }
        resumeAfter[col] = docId;
      } else {
        resumeAfterGlobal = val;
      }
    } else if (arg.startsWith('--resume-after=')) {
      const val = arg.slice('--resume-after='.length).trim();
      const colonIdx = val.indexOf(':');
      if (colonIdx > 0) {
        const col = val.slice(0, colonIdx) as LegacyDpsTargetCollection;
        const docId = val.slice(colonIdx + 1).trim();
        if (!LEGACY_DPS_TARGET_COLLECTIONS.includes(col)) {
          throw new Error(`اسم المجموعة غير مدعوم في --resume-after: ${col}`);
        }
        resumeAfter[col] = docId;
      } else {
        resumeAfterGlobal = val;
      }
    } else if (arg === '--help' || arg === '-h') {
      throw new Error('HELP_REQUESTED');
    } else {
      throw new Error(`خيار غير معروف: ${arg}`);
    }
  }

  if (!projectId) {
    throw new Error('المعامل --project <projectId> إلزامي لتفادي التشغيل على مشروع خاطئ.');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('قيمة --batch-size يجب أن تكون عدداً صحيحاً بين 1 و 500.');
  }

  if (restorePath) {
    if (applyFlag) {
      throw new Error('لا يمكن الجمع بين --apply و --restore في نفس الأمر.');
    }
    mode = 'restore';
  } else if (applyFlag && dryRunFlag) {
    throw new Error('لا يمكن الجمع بين --apply و --dry-run في نفس الأمر.');
  } else if (applyFlag) {
    mode = 'apply';
  } else {
    mode = 'dry-run';
  }

  if (resumeAfterGlobal) {
    for (const col of LEGACY_DPS_TARGET_COLLECTIONS) {
      if (!resumeAfter[col]) {
        resumeAfter[col] = resumeAfterGlobal;
      }
    }
  }

  return {
    mode,
    projectId,
    databaseId,
    batchSize,
    backupPath,
    restorePath,
    checkpointPath,
    reportPath,
    resumeAfter,
  };
}

export function buildFirestoreUpdateForPlan(
  plan: LegacyDpsDocPlan,
  sentinels: Pick<FirestoreSentinels, 'deleteField' | 'serverTimestamp'>,
  nowIso: string
): {
  updatePayload: Record<string, unknown>;
  deletedBusinessFieldCount: number;
  metadataUpdatedCount: number;
} {
  const updatePayload: Record<string, unknown> = {
    updatedAt: nowIso,
    serverUpdatedAt: sentinels.serverTimestamp(),
  };
  let metadataUpdatedCount = 2;

  for (const fieldPath of plan.pathsToDelete) {
    updatePayload[fieldPath] = sentinels.deleteField();
  }

  if (plan.collection === 'quarterly_financial_records' && plan.newContentHash) {
    updatePayload.contentHash = plan.newContentHash;
    metadataUpdatedCount += 1;
  }

  return {
    updatePayload,
    deletedBusinessFieldCount: plan.pathsToDelete.length,
    metadataUpdatedCount,
  };
}

function isPreconditionError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  const msg = String((err as { message?: unknown })?.message || '').toUpperCase();
  return (
    code === 9 ||
    code === 6 ||
    code === 10 ||
    String(code).toUpperCase().includes('FAILED_PRECONDITION') ||
    String(code).toUpperCase().includes('ABORTED') ||
    msg.includes('FAILED_PRECONDITION') ||
    msg.includes('PRECONDITION') ||
    msg.includes('UPDATE_TIME')
  );
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const tmpPath = `${resolved}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, resolved);
}

function createRunId(mode: CleanupCliOptions['mode'], nowIsoStr: string): string {
  const rand = crypto.randomBytes(4).toString('hex');
  return `${mode}_${nowIsoStr.replace(/[:.]/g, '-')}_${rand}`;
}

function createFreshCheckpoint(params: {
  mode: 'dry-run' | 'apply';
  runId: string;
  projectId: string;
  databaseId: string;
  backupPath: string | null;
  nowIsoStr: string;
}): CleanupCheckpointState {
  return {
    mode: params.mode,
    runId: params.runId,
    toolVersion: CLEANUP_TOOL_VERSION,
    projectId: params.projectId,
    databaseId: params.databaseId,
    backupPath: params.backupPath,
    completed: false,
    updatedAt: params.nowIsoStr,
    completedCollections: [],
    lastProcessedDocIdByCollection: {
      quarterly_financial_records: null,
      financials: null,
    },
    failedDocs: [],
  };
}

function readCheckpoint(params: {
  checkpointPath: string | null;
  mode: 'dry-run' | 'apply';
  runId: string;
  projectId: string;
  databaseId: string;
  requestedBackupPath: string | null;
  nowIsoStr: string;
}): CleanupCheckpointState {
  const { checkpointPath, mode, runId, projectId, databaseId, requestedBackupPath, nowIsoStr } = params;

  if (!checkpointPath || !fs.existsSync(path.resolve(checkpointPath))) {
    return createFreshCheckpoint({
      mode,
      runId,
      projectId,
      databaseId,
      backupPath: mode === 'apply' ? requestedBackupPath : null,
      nowIsoStr,
    });
  }

  const raw = JSON.parse(
    fs.readFileSync(path.resolve(checkpointPath), 'utf8')
  ) as Partial<CleanupCheckpointState>;

  if (raw.projectId !== projectId) {
    throw new Error(
      `نقطة الاستئناف (${checkpointPath}) تخص المشروع "${String(raw.projectId)}" وليس "${projectId}".`
    );
  }
  const rawDbId = raw.databaseId || '(default)';
  if (rawDbId !== databaseId) {
    throw new Error(
      `نقطة الاستئناف (${checkpointPath}) تخص قاعدة البيانات "${rawDbId}" وليس "${databaseId}".`
    );
  }

  // عزل صارم لنقاط الاستئناف: لا يسمح dry-run أبداً بتخطي أي وثيقة عند تشغيل apply لاحقاً
  if (raw.mode && raw.mode !== mode) {
    return createFreshCheckpoint({
      mode,
      runId,
      projectId,
      databaseId,
      backupPath: mode === 'apply' ? requestedBackupPath : null,
      nowIsoStr,
    });
  }

  if (mode === 'apply' && raw.backupPath && requestedBackupPath) {
    if (path.resolve(raw.backupPath) !== path.resolve(requestedBackupPath)) {
      throw new Error(
        `المسار --backup (${requestedBackupPath}) لا يطابق مسار النسخة الاحتياطية المسجل في نقطة الاستئناف (${raw.backupPath}).`
      );
    }
  }

  return {
    mode,
    runId: raw.runId || runId,
    toolVersion: CLEANUP_TOOL_VERSION,
    projectId,
    databaseId,
    backupPath: mode === 'apply' ? (raw.backupPath ?? requestedBackupPath ?? null) : null,
    completed: Boolean(raw.completed),
    updatedAt: raw.updatedAt || nowIsoStr,
    completedCollections: Array.isArray(raw.completedCollections) ? [...raw.completedCollections] : [],
    lastProcessedDocIdByCollection: {
      quarterly_financial_records:
        raw.lastProcessedDocIdByCollection?.quarterly_financial_records ?? null,
      financials: raw.lastProcessedDocIdByCollection?.financials ?? null,
    },
    failedDocs: Array.isArray(raw.failedDocs) ? [...raw.failedDocs] : [],
  };
}

function upsertBackupEntry(
  backupEntries: LegacyDpsBackupEntry[],
  nextEntry: LegacyDpsBackupEntry
): LegacyDpsBackupEntry {
  const idx = backupEntries.findIndex(
    (e) => e.collection === nextEntry.collection && e.docId === nextEntry.docId
  );
  if (idx >= 0) {
    const existing = backupEntries[idx];
    const merged: LegacyDpsBackupEntry = {
      ...existing,
      ...nextEntry,
      backupStatus: existing.backupStatus ?? 'skipped_existing',
    };
    backupEntries[idx] = merged;
    return merged;
  }
  const inserted: LegacyDpsBackupEntry = {
    ...nextEntry,
    backupStatus: 'backed_up',
  };
  backupEntries.push(inserted);
  return inserted;
}

function persistBackupFile(params: {
  backupPath: string | null;
  projectId: string;
  databaseId: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  entries: LegacyDpsBackupEntry[];
}): void {
  if (!params.backupPath) return;
  const backupFile: CleanupBackupFile = {
    schema: CLEANUP_BACKUP_SCHEMA,
    toolVersion: CLEANUP_TOOL_VERSION,
    runId: params.runId,
    projectId: params.projectId,
    databaseId: params.databaseId,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    collections: [...LEGACY_DPS_TARGET_COLLECTIONS],
    entries: params.entries,
  };
  writeJsonAtomic(params.backupPath, backupFile);
}

export async function runLegacyDpsCleanup(params: {
  db: FirestoreDbLike;
  sentinels: FirestoreSentinels;
  options: CleanupCliOptions;
  nowIso?: () => string;
}): Promise<{ report: LegacyDpsCleanupReport; backupEntries: LegacyDpsBackupEntry[] }> {
  const { db, sentinels, options } = params;
  const nowIso = params.nowIso ?? (() => new Date().toISOString());
  const startIso = nowIso();
  const runId = createRunId(options.mode, startIso);
  const report = createEmptyCleanupReport(options.mode, options.projectId, [...LEGACY_DPS_TARGET_COLLECTIONS], {
    databaseId: options.databaseId,
    runId,
    toolVersion: CLEANUP_TOOL_VERSION,
  });

  const checkpointMode: 'dry-run' | 'apply' = options.mode === 'apply' ? 'apply' : 'dry-run';
  const defaultBackupPath =
    options.mode === 'apply'
      ? path.join(
          'backups',
          `legacy_dps_backup_${options.projectId}_${startIso.replace(/[:.]/g, '-')}.json`
        )
      : null;

  const checkpoint = readCheckpoint({
    checkpointPath: options.checkpointPath,
    mode: checkpointMode,
    runId,
    projectId: options.projectId,
    databaseId: options.databaseId,
    requestedBackupPath: options.backupPath ?? defaultBackupPath,
    nowIsoStr: startIso,
  });

  const effectiveBackupPath = options.mode === 'apply' ? checkpoint.backupPath : null;
  let backupCreatedAt = startIso;
  const backupEntries: LegacyDpsBackupEntry[] = [];

  if (effectiveBackupPath && fs.existsSync(path.resolve(effectiveBackupPath))) {
    const prev = JSON.parse(
      fs.readFileSync(path.resolve(effectiveBackupPath), 'utf8')
    ) as Partial<CleanupBackupFile>;

    if (prev.schema !== CLEANUP_BACKUP_SCHEMA) {
      throw new Error(`مخطط ملف النسخة الاحتياطية غير متوافق: ${String(prev.schema)}`);
    }
    if (prev.projectId !== options.projectId) {
      throw new Error(
        `ملف النسخة الاحتياطية (${effectiveBackupPath}) يخص المشروع "${String(prev.projectId)}" وليس "${options.projectId}".`
      );
    }
    const prevDbId = prev.databaseId || '(default)';
    if (prevDbId !== options.databaseId) {
      throw new Error(
        `ملف النسخة الاحتياطية (${effectiveBackupPath}) يخص قاعدة البيانات "${prevDbId}" وليس "${options.databaseId}".`
      );
    }
    if (prev.createdAt) {
      backupCreatedAt = prev.createdAt;
    }
    if (Array.isArray(prev.entries)) {
      backupEntries.push(...prev.entries);
    }
  }

  const recordFailure = (
    collection: LegacyDpsTargetCollection,
    docId: string,
    reason: string,
    writeResult: 'aborted_precondition' | 'failed'
  ) => {
    report.errors.push({ collection, docId, message: reason });
    const existingIdx = checkpoint.failedDocs.findIndex(
      (f) => f.collection === collection && f.docId === docId
    );
    if (existingIdx >= 0) {
      checkpoint.failedDocs[existingIdx] = {
        collection,
        docId,
        reason,
        attempts: checkpoint.failedDocs[existingIdx].attempts + 1,
        writeResult,
      };
    } else {
      checkpoint.failedDocs.push({
        collection,
        docId,
        reason,
        attempts: 1,
        writeResult,
      });
    }
  };

  const resolveDocWrite = async (
    docSnap: FirestoreDocSnapshotLike,
    collection: LegacyDpsTargetCollection,
    plan: LegacyDpsDocPlan
  ): Promise<void> => {
    const entry = upsertBackupEntry(backupEntries, plan.backupEntry);
    persistBackupFile({
      backupPath: effectiveBackupPath,
      projectId: options.projectId,
      databaseId: options.databaseId,
      runId: checkpoint.runId,
      createdAt: backupCreatedAt,
      updatedAt: nowIso(),
      entries: backupEntries,
    });

    const { updatePayload, deletedBusinessFieldCount, metadataUpdatedCount } =
      buildFirestoreUpdateForPlan(plan, sentinels, nowIso());
    try {
      const precondition = docSnap.updateTime ? { lastUpdateTime: docSnap.updateTime } : undefined;
      await docSnap.ref.update(updatePayload, precondition);
      entry.applyStatus = 'updated';
      entry.writeResult = 'updated';
      report.updatedDocsByCollection[collection] += 1;
      report.deletedBusinessFieldCount += deletedBusinessFieldCount;
      report.metadataUpdatedCount += metadataUpdatedCount;
      checkpoint.failedDocs = checkpoint.failedDocs.filter(
        (f) => !(f.collection === collection && f.docId === docSnap.id)
      );
    } catch (err) {
      if (isPreconditionError(err)) {
        entry.applyStatus = 'aborted_precondition';
        entry.writeResult = 'aborted_precondition';
        report.abortedPreconditionDocsByCollection[collection] += 1;
        recordFailure(
          collection,
          docSnap.id,
          'تم إجهاض التحديث لتغيّر updateTime للوثيقة أثناء التنظيف (precondition failed).',
          'aborted_precondition'
        );
      } else {
        entry.applyStatus = 'failed';
        entry.writeResult = 'failed';
        recordFailure(
          collection,
          docSnap.id,
          err instanceof Error ? err.message : String(err),
          'failed'
        );
      }
    }
  };

  // عند استئناف apply، أعد محاولة الوثائق الفاشلة/المجهضة سابقاً أولاً
  if (options.mode === 'apply' && checkpoint.failedDocs.length > 0) {
    const pendingRetries = [...checkpoint.failedDocs];
    for (const failedItem of pendingRetries) {
      if (!LEGACY_DPS_TARGET_COLLECTIONS.includes(failedItem.collection)) continue;
      const docRef = db.collection(failedItem.collection).doc(failedItem.docId);
      const freshSnap = await docRef.get();
      if (!freshSnap.exists) {
        checkpoint.failedDocs = checkpoint.failedDocs.filter(
          (f) => !(f.collection === failedItem.collection && f.docId === failedItem.docId)
        );
        continue;
      }
      report.scannedDocsByCollection[failedItem.collection] += 1;
      const rawData = freshSnap.data() ?? {};
      const updateTimeIso = freshSnap.updateTime ? freshSnap.updateTime.toDate().toISOString() : null;
      const plan = inspectLegacyDpsDocument(
        failedItem.collection,
        failedItem.docId,
        rawData,
        updateTimeIso
      );
      if (!plan) {
        report.skippedAlreadyCleanDocsByCollection[failedItem.collection] += 1;
        checkpoint.failedDocs = checkpoint.failedDocs.filter(
          (f) => !(f.collection === failedItem.collection && f.docId === failedItem.docId)
        );
        continue;
      }
      report.matchedDocsByCollection[failedItem.collection] += 1;
      for (const p of plan.pathsToDelete) {
        report.fieldsBreakdown[p] += 1;
      }
      await resolveDocWrite(freshSnap, failedItem.collection, plan);
    }

    persistBackupFile({
      backupPath: effectiveBackupPath,
      projectId: options.projectId,
      databaseId: options.databaseId,
      runId: checkpoint.runId,
      createdAt: backupCreatedAt,
      updatedAt: nowIso(),
      entries: backupEntries,
    });
  }

  for (const collection of LEGACY_DPS_TARGET_COLLECTIONS) {
    if (checkpoint.completedCollections.includes(collection) && !options.resumeAfter[collection]) {
      continue;
    }

    let cursorDocId: string | null =
      options.resumeAfter[collection] ?? checkpoint.lastProcessedDocIdByCollection[collection] ?? null;

    while (true) {
      let query: FirestoreQueryLike = db
        .collection(collection)
        .orderBy(sentinels.documentId)
        .limit(options.batchSize);

      if (cursorDocId) {
        query = query.startAfter(cursorDocId);
      }

      const snap = await query.get();
      if (!snap.docs || snap.docs.length === 0) {
        if (!checkpoint.completedCollections.includes(collection)) {
          checkpoint.completedCollections.push(collection);
        }
        break;
      }

      const matchedPlans: Array<{ doc: FirestoreDocSnapshotLike; plan: LegacyDpsDocPlan }> = [];

      for (const docSnap of snap.docs) {
        report.scannedDocsByCollection[collection] += 1;
        report.lastProcessedDocIdByCollection[collection] = docSnap.id;
        cursorDocId = docSnap.id;

        const rawData = docSnap.data() ?? {};
        const updateTimeIso = docSnap.updateTime ? docSnap.updateTime.toDate().toISOString() : null;
        const plan = inspectLegacyDpsDocument(collection, docSnap.id, rawData, updateTimeIso);

        if (!plan) {
          report.skippedAlreadyCleanDocsByCollection[collection] += 1;
          continue;
        }

        report.matchedDocsByCollection[collection] += 1;
        for (const p of plan.pathsToDelete) {
          report.fieldsBreakdown[p] += 1;
        }
        if (report.sampleMatchedDocIds.length < 50) {
          report.sampleMatchedDocIds.push({
            collection,
            docId: docSnap.id,
            paths: [...plan.pathsToDelete],
          });
        }
        matchedPlans.push({ doc: docSnap, plan });
      }

      if (options.mode === 'dry-run') {
        report.deletedBusinessFieldCount += matchedPlans.reduce(
          (acc, m) => acc + m.plan.pathsToDelete.length,
          0
        );
      } else if (options.mode === 'apply' && matchedPlans.length > 0) {
        // حفظ النسخة الاحتياطية قبل أي تعديل على الدفعة الحالية
        for (const { plan } of matchedPlans) {
          upsertBackupEntry(backupEntries, plan.backupEntry);
        }
        persistBackupFile({
          backupPath: effectiveBackupPath,
          projectId: options.projectId,
          databaseId: options.databaseId,
          runId: checkpoint.runId,
          createdAt: backupCreatedAt,
          updatedAt: nowIso(),
          entries: backupEntries,
        });

        const stampNow = nowIso();
        for (const { doc, plan } of matchedPlans) {
          const entry = upsertBackupEntry(backupEntries, plan.backupEntry);
          const { updatePayload, deletedBusinessFieldCount, metadataUpdatedCount } =
            buildFirestoreUpdateForPlan(plan, sentinels, stampNow);
          try {
            const precondition = doc.updateTime ? { lastUpdateTime: doc.updateTime } : undefined;
            await doc.ref.update(updatePayload, precondition);
            entry.applyStatus = 'updated';
            entry.writeResult = 'updated';
            report.updatedDocsByCollection[collection] += 1;
            report.deletedBusinessFieldCount += deletedBusinessFieldCount;
            report.metadataUpdatedCount += metadataUpdatedCount;
            checkpoint.failedDocs = checkpoint.failedDocs.filter(
              (f) => !(f.collection === collection && f.docId === doc.id)
            );
          } catch (err) {
            if (isPreconditionError(err)) {
              entry.applyStatus = 'aborted_precondition';
              entry.writeResult = 'aborted_precondition';
              report.abortedPreconditionDocsByCollection[collection] += 1;
              recordFailure(
                collection,
                doc.id,
                'تم إجهاض التحديث لتغيّر updateTime للوثيقة أثناء التنظيف (precondition failed).',
                'aborted_precondition'
              );
            } else {
              entry.applyStatus = 'failed';
              entry.writeResult = 'failed';
              recordFailure(
                collection,
                doc.id,
                err instanceof Error ? err.message : String(err),
                'failed'
              );
            }
          }
        }

        // تحديث حالة writeResult لكل وثيقة في ملف النسخة الاحتياطية بعد تنفيذ الدفعة
        persistBackupFile({
          backupPath: effectiveBackupPath,
          projectId: options.projectId,
          databaseId: options.databaseId,
          runId: checkpoint.runId,
          createdAt: backupCreatedAt,
          updatedAt: nowIso(),
          entries: backupEntries,
        });
      }

      checkpoint.lastProcessedDocIdByCollection[collection] = cursorDocId;
      checkpoint.updatedAt = nowIso();
      if (options.checkpointPath) {
        writeJsonAtomic(options.checkpointPath, checkpoint);
      }

      if (snap.docs.length < options.batchSize) {
        if (!checkpoint.completedCollections.includes(collection)) {
          checkpoint.completedCollections.push(collection);
        }
        checkpoint.updatedAt = nowIso();
        if (options.checkpointPath) {
          writeJsonAtomic(options.checkpointPath, checkpoint);
        }
        break;
      }
    }
  }

  const allCollectionsDone = LEGACY_DPS_TARGET_COLLECTIONS.every((c) =>
    checkpoint.completedCollections.includes(c)
  );
  checkpoint.completed =
    allCollectionsDone &&
    checkpoint.failedDocs.length === 0 &&
    report.errors.length === 0;
  checkpoint.updatedAt = nowIso();

  if (options.checkpointPath) {
    writeJsonAtomic(options.checkpointPath, checkpoint);
  }

  report.completed = checkpoint.completed;
  report.failedDocsCount = checkpoint.failedDocs.length;

  if (options.reportPath) {
    writeJsonAtomic(options.reportPath, report);
  }

  return { report, backupEntries };
}

function isEntryAlreadyRestored(
  entry: LegacyDpsBackupEntry,
  currentData: Record<string, unknown> | undefined
): boolean {
  if (!currentData) return false;
  const hasOwn = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const currentExt =
    currentData.extendedFields && typeof currentData.extendedFields === 'object'
      ? (currentData.extendedFields as Record<string, unknown>)
      : null;

  for (const [fieldPath, oldVal] of Object.entries(entry.removedFields)) {
    const normalizedOld = oldVal === undefined ? null : oldVal;
    if (fieldPath === 'dpsCurrent' || fieldPath === 'DPS_Current') {
      if (!hasOwn(currentData, fieldPath) || currentData[fieldPath] !== normalizedOld) {
        return false;
      }
    } else if (fieldPath === 'extendedFields.dpsCurrent') {
      if (!currentExt || !hasOwn(currentExt, 'dpsCurrent') || currentExt.dpsCurrent !== normalizedOld) {
        return false;
      }
    } else if (fieldPath === 'extendedFields.DPS_Current') {
      if (!currentExt || !hasOwn(currentExt, 'DPS_Current') || currentExt.DPS_Current !== normalizedOld) {
        return false;
      }
    }
  }
  return true;
}

export async function runLegacyDpsRestore(params: {
  db: FirestoreDbLike;
  sentinels: Pick<FirestoreSentinels, 'serverTimestamp'>;
  options: CleanupCliOptions;
  entries?: LegacyDpsBackupEntry[];
  nowIso?: () => string;
}): Promise<LegacyDpsCleanupReport> {
  const { db, sentinels, options } = params;
  const nowIso = params.nowIso ?? (() => new Date().toISOString());
  const startIso = nowIso();
  const report = createEmptyCleanupReport('restore', options.projectId, [...LEGACY_DPS_TARGET_COLLECTIONS], {
    databaseId: options.databaseId,
    runId: createRunId('restore', startIso),
    toolVersion: CLEANUP_TOOL_VERSION,
  });

  let entries = params.entries;
  if (!entries) {
    if (!options.restorePath) {
      throw new Error('المسار --restore <backupPath> مطلوب لوضع الاسترجاع.');
    }
    const rawJson = JSON.parse(
      fs.readFileSync(path.resolve(options.restorePath), 'utf8')
    ) as Partial<CleanupBackupFile> | LegacyDpsBackupEntry[];

    if (Array.isArray(rawJson)) {
      throw new Error('صيغة ملف النسخة الاحتياطية غير صالحة؛ يلزم ملف مغلف يتضمن schema و projectId و databaseId.');
    }
    if (rawJson.schema !== CLEANUP_BACKUP_SCHEMA) {
      throw new Error(`مخطط ملف النسخة الاحتياطية غير صالح للاسترجاع: ${String(rawJson.schema)}`);
    }
    if (rawJson.projectId !== options.projectId) {
      throw new Error(
        `ملف النسخة الاحتياطية يخص المشروع "${String(rawJson.projectId)}" وليس "${options.projectId}".`
      );
    }
    const backupDbId = rawJson.databaseId || '(default)';
    if (backupDbId !== options.databaseId) {
      throw new Error(
        `ملف النسخة الاحتياطية يخص قاعدة البيانات "${backupDbId}" وليس "${options.databaseId}".`
      );
    }
    entries = Array.isArray(rawJson.entries) ? rawJson.entries : [];
  }

  for (const entry of entries) {
    try {
      validateBackupEntryScopeAndPaths(entry);
    } catch (err) {
      const targetCol = LEGACY_DPS_TARGET_COLLECTIONS.includes(entry.collection)
        ? entry.collection
        : 'quarterly_financial_records';
      report.errors.push({
        collection: targetCol,
        docId: entry.docId || 'unknown',
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    report.scannedDocsByCollection[entry.collection] += 1;
    report.lastProcessedDocIdByCollection[entry.collection] = entry.docId;

    // تخطي أي مدخل لم تُنفذ كتابته فعلياً في قاعدة البيانات أثناء apply
    if (entry.writeResult !== undefined && entry.writeResult !== 'updated') {
      report.skippedNotAppliedDocsByCollection[entry.collection] += 1;
      continue;
    }

    const docRef = db.collection(entry.collection).doc(entry.docId);

    const runRestoreTx = async (): Promise<'missing' | 'already_restored' | 'updated'> => {
      const execInTx = async (tx: FirestoreTransactionLike): Promise<'missing' | 'already_restored' | 'updated'> => {
        const snap = await tx.get(docRef);
        if (!snap.exists) {
          return 'missing';
        }
        const currentData = snap.data();
        if (isEntryAlreadyRestored(entry, currentData)) {
          return 'already_restored';
        }
        const restoredPatch = buildRestorePatchForDoc(entry, currentData, nowIso());
        restoredPatch.serverUpdatedAt = sentinels.serverTimestamp();
        tx.set(docRef, restoredPatch, { merge: true });
        return 'updated';
      };

      if (typeof db.runTransaction === 'function') {
        return db.runTransaction(execInTx);
      }

      // Fallback only if mock/driver lacks runTransaction (never skips fresh read)
      return execInTx({
        get: (r) => r.get(),
        set: (r, d, o) => r.set(d, o),
        update: (r, d, p) => r.update(d, p),
      });
    };

    try {
      const outcome = await runRestoreTx();
      if (outcome === 'missing') {
        report.errors.push({
          collection: entry.collection,
          docId: entry.docId,
          message: 'الوثيقة غير موجودة عند الاسترجاع؛ تم تخطيها دون إنشاء وثيقة مبتورة.',
        });
      } else if (outcome === 'already_restored') {
        report.skippedAlreadyCleanDocsByCollection[entry.collection] += 1;
      } else {
        report.matchedDocsByCollection[entry.collection] += 1;
        report.updatedDocsByCollection[entry.collection] += 1;
        report.metadataUpdatedCount += entry.collection === 'quarterly_financial_records' ? 3 : 2;
      }
    } catch (err) {
      report.errors.push({
        collection: entry.collection,
        docId: entry.docId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  report.completed = report.errors.length === 0;

  if (options.reportPath) {
    writeJsonAtomic(options.reportPath, report);
  }

  return report;
}

function printUsage(): void {
  console.log(`
Usage:
  node --import tsx scripts/cleanupLegacyDpsCurrent.ts --project <PROJECT_ID> [--dry-run | --apply | --restore <backup.json>]

Options:
  --project <id>         Firebase / GCP project ID (required)
  --database <id>        Firestore database ID (default: "(default)")
  --dry-run              Preview matched documents & fields without writing (default)
  --apply                Create scoped backup JSON then delete only the 4 legacy DPS fields
  --restore <path>       Transactionally & idempotently restore removed legacy fields from a backup JSON
  --backup <path>        Custom backup JSON file path for --apply
  --batch-size <n>       Page size for paginated documentId scan (1..500, default: 200)
  --resume-after <cur>   Resume after docId (either <docId> or <collection>:<docId>)
  --checkpoint <path>    JSON checkpoint path for resumable scans
  --report <path>        Optional path to save execution JSON report
`);
}

function loadFirebaseAdminModules(): {
  initializeApp: (opts?: Record<string, unknown>) => unknown;
  getApps: () => unknown[];
  getFirestore: (dbId?: string) => FirestoreDbLike;
  FieldPath: { documentId(): unknown };
  FieldValue: { delete(): unknown; serverTimestamp(): unknown };
} {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const functionsPkgPath = path.resolve(currentDir, '../functions/package.json');
  const req = createRequire(functionsPkgPath);
  const appMod = req('firebase-admin/app') as {
    initializeApp: (opts?: Record<string, unknown>) => unknown;
    getApps: () => unknown[];
  };
  const fsMod = req('firebase-admin/firestore') as {
    getFirestore: (dbId?: string) => FirestoreDbLike;
    FieldPath: { documentId(): unknown };
    FieldValue: { delete(): unknown; serverTimestamp(): unknown };
  };
  return {
    initializeApp: appMod.initializeApp,
    getApps: appMod.getApps,
    getFirestore: fsMod.getFirestore,
    FieldPath: fsMod.FieldPath,
    FieldValue: fsMod.FieldValue,
  };
}

async function main(): Promise<void> {
  let options: CleanupCliOptions;
  try {
    options = parseCleanupCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof Error && err.message === 'HELP_REQUESTED') {
      printUsage();
      return;
    }
    console.error('❌ خطأ في المعاملات:', err instanceof Error ? err.message : String(err));
    printUsage();
    process.exitCode = 1;
    return;
  }

  const admin = loadFirebaseAdminModules();
  if (admin.getApps().length === 0) {
    admin.initializeApp({ projectId: options.projectId });
  }
  const db =
    options.databaseId && options.databaseId !== '(default)'
      ? admin.getFirestore(options.databaseId)
      : admin.getFirestore();

  const sentinels: FirestoreSentinels = {
    documentId: admin.FieldPath.documentId(),
    deleteField: () => admin.FieldValue.delete(),
    serverTimestamp: () => admin.FieldValue.serverTimestamp(),
  };

  if (options.mode === 'restore') {
    const report = await runLegacyDpsRestore({ db, sentinels, options });
    console.log(JSON.stringify(report, null, 2));
    if (report.errors.length > 0 || !report.completed) process.exitCode = 1;
    return;
  }

  const { report } = await runLegacyDpsCleanup({ db, sentinels, options });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length > 0 || !report.completed) process.exitCode = 1;
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  void main();
}
