/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const FIRESTORE_BATCH_WRITE_LIMIT = 500;
export const FIRESTORE_MAX_DOCUMENT_BYTES = 950_000;
export const MAX_BATCH_PAYLOAD_BYTES = 2_500_000;

export type BatchImportKind = 'quarterly' | 'daily' | 'beta' | 'parameters' | 'dividend';

/**
 * حدود الدفعات الآمنة الموحدة بين الواجهة ووظائف السحابة:
 * - كل سجل ربع سنوي يكتب مستندين (quarterly_financial_records + financials) + سجل دفعة = 180 * 2 + 1 = 361 <= 500.
 * - التداول اليومي وبيتا والتوزيعات يكتبون مستنداً واحداً لكل صف + سجل دفعة = 350 + 1 <= 500.
 * - المعاملات قد تكتب مستند معامل + مستند الشركة الأب عند تخصيص الشركات = 240 * 2 + 1 = 481 <= 500.
 */
export const IMPORT_SAFE_CHUNK_SIZES: Record<BatchImportKind, number> = {
  quarterly: 180,
  daily: 350,
  beta: 350,
  parameters: 240,
  dividend: 350,
};

export const IMPORT_MAX_OPS_PER_ROW: Record<BatchImportKind, number> = {
  quarterly: 2,
  daily: 1,
  beta: 1,
  parameters: 2,
  dividend: 1,
};

export function getSafeChunkSizeForSource(sourceType: BatchImportKind): number {
  return IMPORT_SAFE_CHUNK_SIZES[sourceType];
}

export function getMaxRecordLimitForOperation(quarterly: boolean): number {
  return quarterly ? IMPORT_SAFE_CHUNK_SIZES.quarterly : IMPORT_SAFE_CHUNK_SIZES.daily;
}

export function estimateJsonUtf8Bytes(value: unknown): number {
  const json = JSON.stringify(value) ?? '';
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).length;
  }
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function splitItemsIntoByteSafeChunks<T>(
  items: T[],
  options: {
    maxItemsPerChunk: number;
    maxPayloadBytes?: number;
    estimateItemBytes?: (item: T) => number;
    fixedFirstChunkBytes?: number;
    fixedChunkOverheadBytes?: number;
  }
): T[][] {
  if (items.length === 0) return [];
  const maxItems = Math.max(1, options.maxItemsPerChunk);
  const maxBytes = Math.max(64_000, options.maxPayloadBytes ?? MAX_BATCH_PAYLOAD_BYTES);
  const estimateFn = options.estimateItemBytes ?? estimateJsonUtf8Bytes;
  const fixedOverhead = Math.max(0, options.fixedChunkOverheadBytes ?? 4_096);
  const fixedFirst = Math.max(0, options.fixedFirstChunkBytes ?? 0);

  const chunks: T[][] = [];
  let current: T[] = [];
  let currentBytes = fixedOverhead + fixedFirst;

  for (const item of items) {
    const itemBytes = estimateFn(item) + 16;
    const wouldExceedCount = current.length >= maxItems;
    const wouldExceedBytes = current.length > 0 && currentBytes + itemBytes > maxBytes;
    if (wouldExceedCount || wouldExceedBytes) {
      chunks.push(current);
      current = [];
      currentBytes = fixedOverhead;
    }
    current.push(item);
    currentBytes += itemBytes;
  }

  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}
