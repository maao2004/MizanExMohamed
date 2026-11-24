/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DailyTradingSchemaRecord,
  DividendDistributionSemantics,
  ImportPreviewItem,
  ImportPreviewResult,
  ImportRejectedRow,
  ImportSourceType,
} from '../../types';
import {
  buildDividendDocId,
  buildDividendYearStatusDocId,
  computeRecordBusinessHash,
  extractParameterRevision,
  getParameterDefinition,
  isActiveDividendRecordForConflict,
  normalizedTicker,
  resolveCanonicalParameterType,
  stableStringify,
} from '../contracts';
import type { ParsedParameterImportRow } from './parsers';

function createImportId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `imp_${Date.now()}_${rand}`;
}

export function buildDocIdForSource(
  sourceType: ImportSourceType,
  record: Record<string, any>
): string {
  if (sourceType === 'quarterly') {
    const tk = normalizedTicker(record.ticker);
    return `${tk}_${record.year}_${record.quarter}`;
  }
  if (sourceType === 'daily') {
    const tk = normalizedTicker(record.ticker);
    return `${tk}_${record.tradeDate}`;
  }
  if (sourceType === 'beta') {
    return normalizedTicker(record.ticker);
  }
  if (sourceType === 'dividend') {
    return buildDividendDocId({
      ticker: record.ticker,
      fiscalYear: record.fiscalYear,
      recordType: record.recordType ?? 'regular',
      distributionId: record.distributionId,
    });
  }
  const scope = record.scope === 'company' ? 'company' : 'global';
  if (scope === 'company') {
    const tk = normalizedTicker(record.ticker);
    return `${tk}__${record.key}`;
  }
  return String(record.key);
}

function normalizeRecordForHashing(
  sourceType: ImportSourceType,
  record: Record<string, any>
): { hashType: 'quarterly' | 'daily' | 'beta' | 'parameter' | 'dividend'; payload: Record<string, any> } {
  if (sourceType === 'parameters') {
    const p = record as Record<string, any>;
    const keyStr = typeof p.key === 'string' ? p.key.trim() : '';
    const def = keyStr ? getParameterDefinition(keyStr) : null;
    const resolvedType = keyStr
      ? resolveCanonicalParameterType(keyStr, {
          valueType: typeof p.valueType === 'string' ? p.valueType : null,
          isPercentage: typeof p.isPercentage === 'boolean' ? p.isPercentage : null,
          unit: typeof p.unit === 'string' ? p.unit : null,
        })
      : null;
    const rawNameAr = typeof p.nameAr === 'string' ? p.nameAr.trim() : '';
    const canonicalNameAr = def?.nameAr ?? (rawNameAr !== '' ? rawNameAr : keyStr);
    const rawDesc =
      typeof p.description === 'string'
        ? p.description.trim()
        : typeof p.descriptionAr === 'string'
        ? p.descriptionAr.trim()
        : '';
    const canonicalDesc = rawDesc !== '' ? rawDesc : (def?.descriptionAr ?? '');

    return {
      hashType: 'parameter',
      payload: {
        key: keyStr,
        nameAr: canonicalNameAr,
        value: p.value,
        description: canonicalDesc,
        scope: p.scope ?? 'global',
        ticker: p.ticker ?? null,
        unit: p.unit ?? def?.unit ?? resolvedType?.defaultUnit ?? 'number',
        valueType: resolvedType ? resolvedType.valueType : null,
        isPercentage: resolvedType ? resolvedType.isPercentage : null,
        asOfDate: typeof p.asOfDate === 'string' ? p.asOfDate.trim() : '',
        source: typeof p.source === 'string' ? p.source.trim() : '',
        rfMethodology: p.rfMethodology ?? p.RfMethodology ?? undefined,
        currency: p.currency ?? p.Currency ?? null,
        forecastHorizonYears: p.forecastHorizonYears ?? p.ForecastHorizonYears ?? null,
      },
    };
  }
  return { hashType: sourceType, payload: record };
}

function diffKeys(
  nextObj: Record<string, any>,
  existingObj: Record<string, any>
): string[] {
  const ignore = new Set([
    'updatedAt',
    'serverUpdatedAt',
    'updatedBy',
    'importId',
    'sourceFile',
    'sourceSheet',
    'sourceRow',
    'schemaVersion',
    'contentHash',
    'isDeleted',
  ]);
  const changed: string[] = [];
  const allKeys = new Set([...Object.keys(nextObj), ...Object.keys(existingObj)]);
  for (const key of allKeys) {
    if (ignore.has(key) || typeof nextObj[key] === 'function') continue;
    if (stableStringify(nextObj[key] ?? null) !== stableStringify(existingObj[key] ?? null)) {
      changed.push(key);
    }
  }
  return changed;
}

/**
 * معاينة حتمية للمصدر قبل أي كتابة إلى Firestore:
 * تصنف الصفوف إلى (إضافات / تحديثات / بدون تغيير / مرفوضة) باستخدام التجزئة الموحّدة.
 */
export function buildImportPreview<T extends Record<string, any>>(params: {
  sourceType: ImportSourceType;
  fileName: string;
  sheetName: string;
  tradeDate?: string | null;
  dailySchema?: DailyTradingSchemaRecord | null;
  totalRows: number;
  parsedRecords: T[];
  rejected: ImportRejectedRow[];
  warnings: string[];
  existingDocsMap: Map<string, Record<string, any>>;
  requiresSemanticsConfirmation?: boolean;
  defaultSemanticsUsed?: DividendDistributionSemantics;
  requiresApprovalConfirmation?: boolean;
  rowsMissingApprovalCount?: number;
}): ImportPreviewResult<T> {
  const inserts: ImportPreviewItem<T>[] = [];
  const updates: ImportPreviewItem<T>[] = [];
  const unchanged: ImportPreviewItem<T>[] = [];
  const rejected: ImportRejectedRow[] = [...params.rejected];

  for (const rec of params.parsedRecords) {
    if (params.sourceType === 'dividend' && isActiveDividendRecordForConflict(rec)) {
      try {
        const statusDocId = buildDividendYearStatusDocId(rec.ticker, rec.fiscalYear);
        const yearStatusDoc = params.existingDocsMap.get(`year_status::${statusDocId}`);
        if (
          yearStatusDoc &&
          yearStatusDoc.isDeleted !== true &&
          yearStatusDoc.status === 'confirmed_no_dividend'
        ) {
          rejected.push({
            rowNumber: rec.sourceRow ?? 0,
            column: 'ApprovalStatus',
            ticker: rec.ticker,
            reasonAr: `تعارض حوكمة: السنة المالية ${rec.fiscalYear} للسهم ${rec.ticker} معتمدة كسنة بدون توزيعات مؤكدة (confirmed_no_dividend)؛ أزل هذه الحالة أولاً أو احفظ السجل كملغى/مقترح.`,
          });
          continue;
        }
      } catch {
        // Ignore invalid ticker/year fallback; record parser handles structural validation.
      }
    }

    const docId = buildDocIdForSource(params.sourceType, rec);
    const { hashType, payload } = normalizeRecordForHashing(params.sourceType, rec);
    const existing = params.existingDocsMap.get(docId);

    // Defense-in-depth: never let an untyped custom parameter row pass preview or wipe an existing explicit type.
    if (params.sourceType === 'parameters') {
      const paramKey = typeof rec.key === 'string' ? rec.key.trim() : '';
      if (paramKey && !getParameterDefinition(paramKey)) {
        const incomingType = resolveCanonicalParameterType(paramKey, {
          valueType: typeof rec.valueType === 'string' ? rec.valueType : null,
          isPercentage: typeof rec.isPercentage === 'boolean' ? rec.isPercentage : null,
          unit: typeof rec.unit === 'string' ? rec.unit : null,
        });
        if (incomingType.typeSource === 'unspecified') {
          const existingType =
            existing && existing.isDeleted !== true
              ? resolveCanonicalParameterType(paramKey, {
                  valueType: typeof existing.valueType === 'string' ? existing.valueType : null,
                  isPercentage: typeof existing.isPercentage === 'boolean' ? existing.isPercentage : null,
                  unit: typeof existing.unit === 'string' ? existing.unit : null,
                })
              : null;
          const existingHint =
            existingType && existingType.typeSource === 'explicit'
              ? ` (السجل الحالي معرّف كـ ${existingType.valueType} / isPercentage=${String(existingType.isPercentage)} ولن يُسمح بمحوه بصمت)`
              : '';
          rejected.push({
            rowNumber: rec.sourceRow ?? 0,
            column: 'ValueType / IsPercentage',
            ticker: rec.ticker ?? undefined,
            reasonAr: `الصف ${rec.sourceRow ?? '?'} — المعامل المخصص (${paramKey}): يفتقد تعريف النوع الصريح${existingHint}. الحقول المطلوبة: ValueType و/أو IsPercentage.`,
          });
          continue;
        }
      }
    }

    const contentHash = computeRecordBusinessHash(hashType, payload);

    const label =
      params.sourceType === 'quarterly'
        ? `${rec.ticker} · ${rec.year}${rec.quarter}`
        : params.sourceType === 'daily'
        ? `${rec.ticker} · ${rec.tradeDate}`
        : params.sourceType === 'beta'
        ? `${rec.ticker} · Beta=${rec.beta}`
        : params.sourceType === 'dividend'
        ? `${rec.ticker} · ${rec.fiscalYear} (${rec.recordType === 'special' ? 'استثنائي' : 'عادي'}) · DPS=${rec.cashDps} · ${rec.asOfDate}`
        : `${rec.scope === 'company' ? `${rec.ticker} / ` : ''}${rec.key} = ${rec.value}${payload.valueType ? ` (${payload.valueType})` : ''}`;

    if (!existing || existing.isDeleted === true) {
      inserts.push({
        docId,
        label,
        status: 'insert',
        record: rec,
        contentHash,
        existingHash: null,
        baseRevision: null,
        sourceRow: rec.sourceRow,
      });
      continue;
    }

    const existingNormalized = normalizeRecordForHashing(params.sourceType, existing);
    const existingHash =
      typeof existing.contentHash === 'string' && existing.contentHash.startsWith('mzh1_')
        ? existing.contentHash
        : computeRecordBusinessHash(existingNormalized.hashType, existingNormalized.payload);
    const baseRevision =
      params.sourceType === 'parameters' ? extractParameterRevision(existing) : null;

    if (existingHash === contentHash) {
      unchanged.push({
        docId,
        label,
        status: 'unchanged',
        record: rec,
        contentHash,
        existingHash,
        ...(params.sourceType === 'parameters' ? { baseRevision } : {}),
        sourceRow: rec.sourceRow,
      });
    } else {
      updates.push({
        docId,
        label,
        status: 'update',
        record: rec,
        contentHash,
        existingHash,
        ...(params.sourceType === 'parameters' ? { baseRevision } : {}),
        changedFields: diffKeys(payload, existingNormalized.payload),
        sourceRow: rec.sourceRow,
      });
    }
  }

  return {
    sourceType: params.sourceType,
    fileName: params.fileName,
    sheetName: params.sheetName,
    tradeDate: params.tradeDate ?? null,
    dailySchema: params.dailySchema ?? null,
    totalRows: params.totalRows,
    inserts,
    updates,
    unchanged,
    rejected,
    warnings: params.warnings,
    importId: createImportId(),
    ...(params.requiresSemanticsConfirmation !== undefined
      ? { requiresSemanticsConfirmation: params.requiresSemanticsConfirmation }
      : {}),
    ...(params.defaultSemanticsUsed !== undefined
      ? { defaultSemanticsUsed: params.defaultSemanticsUsed }
      : {}),
    ...(params.requiresApprovalConfirmation !== undefined
      ? { requiresApprovalConfirmation: params.requiresApprovalConfirmation }
      : {}),
    ...(params.rowsMissingApprovalCount !== undefined
      ? { rowsMissingApprovalCount: params.rowsMissingApprovalCount }
      : {}),
  };
}
