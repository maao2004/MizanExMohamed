/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImportBatchReport, ImportPreviewItem, ImportPreviewResult } from '../../types';
import {
  estimateJsonUtf8Bytes,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  getSafeChunkSizeForSource,
  MAX_BATCH_PAYLOAD_BYTES,
  splitItemsIntoByteSafeChunks,
} from '../contracts';

export interface BatchWriteChunkResponse {
  insertedCount: number;
  updatedCount: number;
  skippedUnchangedCount: number;
}

export function getSafeChunkSize(sourceType: ImportPreviewResult['sourceType']): number {
  return getSafeChunkSizeForSource(sourceType);
}

/**
 * تنفيذ مجزّأ متسلسل لدفعات الاستيراد عبر الخادم مع التحقق من idempotency وإتاحة الاستئناف الآمن عند الفشل الجزئي.
 */
export async function executeChunkedImportBatches<T>(params: {
  preview: ImportPreviewResult<T>;
  startChunkIndex?: number;
  priorReport?: ImportBatchReport | null;
  sendChunk: (
    chunkItems: ImportPreviewItem<T>[],
    chunkIndex: number,
    totalChunks: number
  ) => Promise<BatchWriteChunkResponse>;
  onProgress?: (report: ImportBatchReport) => void;
}): Promise<ImportBatchReport> {
  const { preview, sendChunk, onProgress } = params;
  const itemsToWrite = [...preview.inserts, ...preview.updates];

  for (const item of itemsToWrite) {
    const itemBytes = estimateJsonUtf8Bytes(item.record);
    if (itemBytes > FIRESTORE_MAX_DOCUMENT_BYTES) {
      throw new Error(
        `السجل (${item.label}) يتجاوز الحد الأقصى لمستند Firestore (${itemBytes.toLocaleString('en-US')} بايت > ${FIRESTORE_MAX_DOCUMENT_BYTES.toLocaleString('en-US')} بايت)؛ لا يمكن حذفه جزئياً.`
      );
    }
  }

  const chunkSize = getSafeChunkSize(preview.sourceType);
  const chunks = splitItemsIntoByteSafeChunks(itemsToWrite, {
    maxItemsPerChunk: chunkSize,
    maxPayloadBytes: MAX_BATCH_PAYLOAD_BYTES,
    estimateItemBytes: (item) => estimateJsonUtf8Bytes(item.record),
    fixedFirstChunkBytes: preview.dailySchema ? estimateJsonUtf8Bytes(preview.dailySchema) : 0,
  });

  const totalBatches = chunks.length;
  const startIdx = Math.max(0, params.startChunkIndex ?? 0);

  let insertedCount = params.priorReport?.insertedCount ?? 0;
  let updatedCount = params.priorReport?.updatedCount ?? 0;
  let skippedUnchangedCount =
    params.priorReport?.skippedUnchangedCount ?? preview.unchanged.length;
  let completedBatches = startIdx;

  if (totalBatches === 0 || startIdx >= totalBatches) {
    const emptyReport: ImportBatchReport = {
      importId: preview.importId,
      sourceType: preview.sourceType,
      totalBatches,
      completedBatches: totalBatches,
      failedBatchIndex: null,
      insertedCount,
      updatedCount,
      skippedUnchangedCount,
      failedError: null,
      remainingItemsCount: 0,
    };
    onProgress?.(emptyReport);
    return emptyReport;
  }

  for (let idx = startIdx; idx < totalBatches; idx++) {
    const chunk = chunks[idx];
    try {
      const res = await sendChunk(chunk, idx, totalBatches);
      insertedCount += res.insertedCount;
      updatedCount += res.updatedCount;
      skippedUnchangedCount += res.skippedUnchangedCount;
      completedBatches = idx + 1;

      const remainingItemsCount = chunks
        .slice(idx + 1)
        .reduce((sum, c) => sum + c.length, 0);

      onProgress?.({
        importId: preview.importId,
        sourceType: preview.sourceType,
        totalBatches,
        completedBatches,
        failedBatchIndex: null,
        insertedCount,
        updatedCount,
        skippedUnchangedCount,
        failedError: null,
        remainingItemsCount,
      });
    } catch (err) {
      const remainingItemsCount = chunks
        .slice(idx)
        .reduce((sum, c) => sum + c.length, 0);
      const failureReport: ImportBatchReport = {
        importId: preview.importId,
        sourceType: preview.sourceType,
        totalBatches,
        completedBatches,
        failedBatchIndex: idx,
        insertedCount,
        updatedCount,
        skippedUnchangedCount,
        failedError: err instanceof Error ? err.message : 'فشلت الدفعة أثناء الكتابة إلى Firestore.',
        remainingItemsCount,
      };
      onProgress?.(failureReport);
      return failureReport;
    }
  }

  const finalReport: ImportBatchReport = {
    importId: preview.importId,
    sourceType: preview.sourceType,
    totalBatches,
    completedBatches: totalBatches,
    failedBatchIndex: null,
    insertedCount,
    updatedCount,
    skippedUnchangedCount,
    failedError: null,
    remainingItemsCount: 0,
  };
  onProgress?.(finalReport);
  return finalReport;
}
