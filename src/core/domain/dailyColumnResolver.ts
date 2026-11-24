/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DailyRawCellValue,
  DailyTradingColumnSchema,
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  ManualCorrectionEntry,
} from '../../types';

export type DailyCellDisplayKind =
  | 'number'
  | 'zero'
  | 'date'
  | 'text'
  | 'boolean'
  | 'blank'
  | 'formula_missing'
  | 'invalid';

export interface IndexedDailySchema {
  schemaId: string;
  schema: DailyTradingSchemaRecord;
  colById: Map<string, DailyTradingColumnSchema>;
  mappedFieldToCol: Map<string, DailyTradingColumnSchema>;
  orderedColumns: DailyTradingColumnSchema[];
}

export interface UnifiedDailyColumn {
  key: string;
  scope: 'mapped' | 'schema_col' | 'fallback_col';
  mappedField: string | null;
  schemaId: string | null;
  colId: string | null;
  colLetter: string | null;
  headerName: string;
  rawHeaderName: string | null;
  isDuplicateHeader: boolean;
  isBlankHeader: boolean;
  isExtraBeyondStandard: boolean;
  orderIndex: number;
}

export interface ResolvedDailyCellDisplay {
  value: string | number | boolean | null;
  rawCell: DailyRawCellValue | null;
  displayText: string;
  kind: DailyCellDisplayKind;
  isManualCorrection: boolean;
  manualCorrection: ManualCorrectionEntry | null;
  originalValue: string | number | boolean | null | undefined;
  formulaMissingCachedResult: boolean;
  hasMissingSchemaWarning: boolean;
}

export const STANDARD_DAILY_MAPPED_FIELDS: Array<{ field: keyof DailyTradingRecord; labelAr: string }> = [
  { field: 'ticker', labelAr: 'الرمز' },
  { field: 'shortName', labelAr: 'الإسم المختصر' },
  { field: 'lastPrice', labelAr: 'أخر' },
  { field: 'changePct', labelAr: 'التغير%' },
  { field: 'tradesCount', labelAr: 'الصفقات' },
  { field: 'openPrice', labelAr: 'فتح' },
  { field: 'closePrice', labelAr: 'إقفال اليوم' },
  { field: 'turnoverValue', labelAr: 'قيمة التداول' },
  { field: 'netLiquidity', labelAr: 'صافي السيولة' },
  { field: 'volume', labelAr: 'حجم التداول' },
  { field: 'avgVolume5D', labelAr: 'متوسط الحجم 5 أيام' },
  { field: 'avgVolume30D', labelAr: 'متوسط 30 يوم' },
  { field: 'avgVolume90D', labelAr: 'متوسط 90 يوم' },
  { field: 'lowPrice', labelAr: 'الأدنى' },
  { field: 'highPrice', labelAr: 'أعلى' },
  { field: 'sector', labelAr: 'القطاع' },
  { field: 'totalBids', labelAr: 'اجمالي الطلبات' },
  { field: 'bidsCount', labelAr: 'عدد الطلبات' },
  { field: 'offersCount', labelAr: 'عدد العروض' },
  { field: 'totalOffers', labelAr: 'اجمالي العروض' },
  { field: 'avgVolume', labelAr: 'متوسط حجم التداول' },
  { field: 'high52W', labelAr: 'الأعلى 52 أسبوع' },
  { field: 'low52W', labelAr: 'الأدنى 52 أسبوع' },
  { field: 'prevClose', labelAr: 'إقفال سابق' },
  { field: 'marketCapThousands', labelAr: 'رأس مال السوق بالألأف' },
  { field: 'vwap', labelAr: 'متوسط السعر المرجح' },
  { field: 'peRatio', labelAr: 'مضاعف ربحية السهم' },
  { field: 'pbRatio', labelAr: 'مضاعف القيمة الدفترية' },
  { field: 'listedShares', labelAr: 'الأسهم المدرجة' },
  { field: 'isinCode', labelAr: 'الكود الدولي' },
  { field: 'inflowOrders', labelAr: 'أوامر السيولة الداخلة' },
  { field: 'inflowVolume', labelAr: 'حجم السيولة الداخلة' },
  { field: 'inflowLiquidity', labelAr: 'السيولة الداخلة' },
  { field: 'askTrades', labelAr: 'صفقات العرض' },
  { field: 'askTradesVolume', labelAr: 'حجم صفقات العرض' },
  { field: 'outflowLiquidity', labelAr: 'السيولة الخارجة' },
  { field: 'fullName', labelAr: 'الاسم' },
  { field: 'market', labelAr: 'السوق' },
  { field: 'volChange5DPct', labelAr: '% التغير 5 أيام' },
  { field: 'volChange30DPct', labelAr: 'تغير الحجم 30 يوم %' },
  { field: 'volChange90DPct', labelAr: 'تغير الحجم 90 يوم %' },
];

const STANDARD_DAILY_LABEL_MAP = new Map<string, string>(
  STANDARD_DAILY_MAPPED_FIELDS.map((item) => [String(item.field), item.labelAr])
);

export function indexDailySchemas(
  schemasMap: Record<string, DailyTradingSchemaRecord> = {}
): Map<string, IndexedDailySchema> {
  const indexed = new Map<string, IndexedDailySchema>();
  for (const [schemaId, schema] of Object.entries(schemasMap)) {
    if (!schema || !Array.isArray(schema.columns)) continue;
    const orderedColumns = [...schema.columns].sort((a, b) => a.index - b.index);
    const colById = new Map<string, DailyTradingColumnSchema>();
    const mappedFieldToCol = new Map<string, DailyTradingColumnSchema>();
    for (const col of orderedColumns) {
      colById.set(col.colId, col);
      if (col.mappedField && !col.isDuplicateHeader && !mappedFieldToCol.has(col.mappedField)) {
        mappedFieldToCol.set(col.mappedField, col);
      }
    }
    indexed.set(schemaId, {
      schemaId,
      schema,
      colById,
      mappedFieldToCol,
      orderedColumns,
    });
  }
  return indexed;
}

/**
 * توحيد أعمدة التداول اليومي عبر مخططات متعددة:
 * - الحقول الدلالية المعروفة (mappedField) تُوحَّد حتى لو تغيّر موضع العمود بين ملفات التواريخ المختلفة.
 * - الأعمدة غير المعروفة أو المكررة أو الفارغة العنوان تُقيّد بمعرف المخطط (schemaId::colId) منعاً لأي خلط.
 * - السجلات التي تفتقد المخطط المقابل تُعرض بأمان عبر colId مع وسم تحذيري واضح.
 */
export function resolveUnifiedDailyColumns(
  records: DailyTradingRecord[],
  indexedSchemas: Map<string, IndexedDailySchema>
): {
  columns: UnifiedDailyColumn[];
  missingSchemaRecordCount: number;
  schemaCount: number;
} {
  const columns: UnifiedDailyColumn[] = [];
  const seenMappedFields = new Set<string>();
  const seenScopedColKeys = new Set<string>();
  const referencedSchemaIds: string[] = [];
  const seenSchemaIds = new Set<string>();
  let missingSchemaRecordCount = 0;

  // الحفاظ على ترتيب المخططات الظاهرة في السجلات (الأحدث فأقدم حسب ترتيب السجلات الواردة)
  for (const rec of records) {
    if (rec.schemaId) {
      if (indexedSchemas.has(rec.schemaId)) {
        if (!seenSchemaIds.has(rec.schemaId)) {
          seenSchemaIds.add(rec.schemaId);
          referencedSchemaIds.push(rec.schemaId);
        }
      } else {
        missingSchemaRecordCount += 1;
      }
    }
  }

  let orderCounter = 0;
  for (const schemaId of referencedSchemaIds) {
    const idxSchema = indexedSchemas.get(schemaId)!;
    const multipleSchemas = referencedSchemaIds.length > 1;
    for (const col of idxSchema.orderedColumns) {
      if (col.mappedField && !col.isDuplicateHeader) {
        if (seenMappedFields.has(col.mappedField)) continue;
        seenMappedFields.add(col.mappedField);
        const headerLabel =
          col.headerName ??
          STANDARD_DAILY_LABEL_MAP.get(col.mappedField) ??
          col.mappedField;
        columns.push({
          key: `mapped:${col.mappedField}`,
          scope: 'mapped',
          mappedField: col.mappedField,
          schemaId: multipleSchemas ? null : schemaId,
          colId: col.colId,
          colLetter: col.colLetter,
          headerName: headerLabel,
          rawHeaderName: col.headerName,
          isDuplicateHeader: false,
          isBlankHeader: col.headerName === null,
          isExtraBeyondStandard: false,
          orderIndex: orderCounter++,
        });
      } else {
        const scopedKey = `${schemaId}::${col.colId}`;
        if (seenScopedColKeys.has(scopedKey)) continue;
        seenScopedColKeys.add(scopedKey);
        const displayHeader = col.headerName ?? `عمود ${col.colLetter} (${col.colId})`;
        columns.push({
          key: `schema:${scopedKey}`,
          scope: 'schema_col',
          mappedField: null,
          schemaId,
          colId: col.colId,
          colLetter: col.colLetter,
          headerName: displayHeader,
          rawHeaderName: col.headerName,
          isDuplicateHeader: Boolean(col.isDuplicateHeader),
          isBlankHeader: col.headerName === null,
          isExtraBeyondStandard: true,
          orderIndex: orderCounter++,
        });
      }
    }
  }

  // تأمين الحقول القياسية لأي سجلات قديمة أو سجلات بمخطط مفقود دون تخمين عناوين rawCells
  const recordsWithoutSchema = records.filter((r) => !r.schemaId || !indexedSchemas.has(r.schemaId));
  if (recordsWithoutSchema.length > 0 || columns.length === 0) {
    for (const std of STANDARD_DAILY_MAPPED_FIELDS) {
      const f = String(std.field);
      if (seenMappedFields.has(f)) continue;
      const hasAnyValue = recordsWithoutSchema.some((r) => (r as any)[f] !== undefined && (r as any)[f] !== null);
      if (columns.length === 0 || hasAnyValue) {
        seenMappedFields.add(f);
        columns.push({
          key: `mapped:${f}`,
          scope: 'mapped',
          mappedField: f,
          schemaId: null,
          colId: null,
          colLetter: null,
          headerName: std.labelAr,
          rawHeaderName: std.labelAr,
          isDuplicateHeader: false,
          isBlankHeader: false,
          isExtraBeyondStandard: false,
          orderIndex: orderCounter++,
        });
      }
    }

    const fallbackRawColIds = new Set<string>();
    for (const rec of recordsWithoutSchema) {
      if (rec.rawCells && typeof rec.rawCells === 'object') {
        for (const colId of Object.keys(rec.rawCells)) {
          fallbackRawColIds.add(colId);
        }
      }
    }
    const sortedFallbackColIds = Array.from(fallbackRawColIds).sort((a, b) => {
      const na = /^col_(\d+)$/.exec(a);
      const nb = /^col_(\d+)$/.exec(b);
      if (na && nb) return Number(na[1]) - Number(nb[1]);
      return a.localeCompare(b);
    });
    for (const colId of sortedFallbackColIds) {
      columns.push({
        key: `fallback:${colId}`,
        scope: 'fallback_col',
        mappedField: null,
        schemaId: null,
        colId,
        colLetter: null,
        headerName: `خلية غير معنونة (${colId})`,
        rawHeaderName: null,
        isDuplicateHeader: false,
        isBlankHeader: true,
        isExtraBeyondStandard: true,
        orderIndex: orderCounter++,
      });
    }
  }

  return {
    columns,
    missingSchemaRecordCount,
    schemaCount: referencedSchemaIds.length,
  };
}

function classifyScalarDisplay(
  value: string | number | boolean | null,
  rawCell: DailyRawCellValue | null
): { kind: DailyCellDisplayKind; displayText: string } {
  if (rawCell?.formulaMissingCachedResult) {
    return {
      kind: 'formula_missing',
      displayText: rawCell.f ? `= ${rawCell.f} (بدون قيمة مخبأة)` : 'صيغة بلا قيمة مخبأة',
    };
  }
  if (rawCell?.t === 'e') {
    return {
      kind: 'invalid',
      displayText: String(rawCell.w ?? rawCell.v ?? 'خطأ صيغة'),
    };
  }
  if (value === null || value === undefined || value === '') {
    return { kind: 'blank', displayText: 'BLANK' };
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolean', displayText: value ? 'TRUE' : 'FALSE' };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { kind: 'invalid', displayText: 'غير صالح' };
    }
    if (value === 0) {
      return { kind: 'zero', displayText: '0' };
    }
    return {
      kind: 'number',
      displayText: Number.isInteger(value)
        ? value.toLocaleString('en-US')
        : value.toLocaleString('en-US', { maximumFractionDigits: 4 }),
    };
  }
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return { kind: 'date', displayText: str };
  }
  if (rawCell?.w && rawCell.t === 's') {
    return { kind: 'text', displayText: rawCell.w };
  }
  return { kind: 'text', displayText: str };
}

export function resolveDailyCellDisplay(
  record: DailyTradingRecord,
  column: UnifiedDailyColumn,
  indexedSchemas: Map<string, IndexedDailySchema>
): ResolvedDailyCellDisplay {
  const schemaMissing = Boolean(record.schemaId && !indexedSchemas.has(record.schemaId));
  const idxSchema = record.schemaId ? indexedSchemas.get(record.schemaId) : undefined;

  let rawCell: DailyRawCellValue | null = null;
  let value: string | number | boolean | null = null;
  let correctionKey: string | null = null;

  if (column.scope === 'mapped' && column.mappedField) {
    correctionKey = column.mappedField;
    const directVal = (record as any)[column.mappedField];
    if (directVal !== undefined && directVal !== null) {
      value = directVal;
    }
    const mappedCol = idxSchema?.mappedFieldToCol.get(column.mappedField);
    if (mappedCol && record.rawCells && record.rawCells[mappedCol.colId]) {
      rawCell = record.rawCells[mappedCol.colId];
      if (value === null && rawCell.v !== undefined && rawCell.v !== null && !rawCell.formulaMissingCachedResult) {
        value = rawCell.v;
      }
      // الحفاظ على النص الأصلي ذي الأصفار البادئة عند تساوي نوع النص
      if (rawCell.t === 's' && typeof rawCell.v === 'string' && value === null) {
        value = rawCell.v;
      }
    }
  } else if (column.scope === 'schema_col' && column.schemaId && column.colId) {
    if (record.schemaId === column.schemaId && record.rawCells && record.rawCells[column.colId]) {
      rawCell = record.rawCells[column.colId];
      value = rawCell.formulaMissingCachedResult ? null : rawCell.v ?? null;
    }
    correctionKey = column.colId;
  } else if (column.scope === 'fallback_col' && column.colId) {
    if ((!record.schemaId || schemaMissing) && record.rawCells && record.rawCells[column.colId]) {
      rawCell = record.rawCells[column.colId];
      value = rawCell.formulaMissingCachedResult ? null : rawCell.v ?? null;
    }
    correctionKey = column.colId;
  }

  const manualCorrection =
    correctionKey && record.manualCorrections?.[correctionKey]
      ? record.manualCorrections[correctionKey]
      : null;

  const originalValue =
    manualCorrection !== null
      ? manualCorrection.originalValue
      : correctionKey && record.originalValues && correctionKey in record.originalValues
      ? record.originalValues[correctionKey]
      : undefined;

  const classified = classifyScalarDisplay(value, rawCell);

  return {
    value,
    rawCell,
    displayText: classified.displayText,
    kind: classified.kind,
    isManualCorrection: manualCorrection !== null,
    manualCorrection,
    originalValue,
    formulaMissingCachedResult: Boolean(rawCell?.formulaMissingCachedResult),
    hasMissingSchemaWarning: schemaMissing,
  };
}
