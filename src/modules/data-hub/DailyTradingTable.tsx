/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Calendar, Download, Eye, Pencil, Search, Trash2 } from 'lucide-react';
import {
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  UserRole,
} from '../../types';
import {
  indexDailySchemas,
  resolveDailyCellDisplay,
  resolveUnifiedDailyColumns,
  STANDARD_DAILY_MAPPED_FIELDS,
  UnifiedDailyColumn,
} from '../../core/domain/dailyColumnResolver';
import { RecordDetailsModal } from './RecordDetailsModal';

interface DailyTradingTableProps {
  selectedTicker: string;
  records: DailyTradingRecord[];
  dailySchemas?: Record<string, DailyTradingSchemaRecord>;
  userRole: UserRole;
  onRequestEdit: (record: DailyTradingRecord) => void;
  onRequestDelete: (target: { ticker: string; tradeDate: string }) => void;
  onExportDailyExcel?: () => void;
}

const VIRTUAL_THRESHOLD = 60;
const ROW_HEIGHT = 44;
const VIEWPORT_HEIGHT = 520;
const OVERSCAN = 8;

function renderUnifiedDailyCell(
  record: DailyTradingRecord,
  col: UnifiedDailyColumn,
  indexedSchemas: ReturnType<typeof indexDailySchemas>
): React.ReactNode {
  const cell = resolveDailyCellDisplay(record, col, indexedSchemas);

  const editBadge = cell.isManualCorrection ? (
    <span
      className="text-[9px] px-1 rounded bg-amber-950/70 border border-amber-700/60 text-amber-300"
      title={`تم التعديل يدوياً · الأصل: ${String(cell.originalValue ?? 'BLANK')}`}
    >
      معدّل
    </span>
  ) : null;

  if (cell.kind === 'formula_missing') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-700/60 text-amber-300 text-[10px]"
        title={cell.rawCell?.f ? `صيغة بلا قيمة مخبأة: =${cell.rawCell.f}` : 'صيغة بلا قيمة مخبأة'}
      >
        {cell.displayText}
        {editBadge}
      </span>
    );
  }

  if (cell.kind === 'invalid') {
    return (
      <span className="inline-flex items-center gap-1 text-red-400">
        {cell.displayText}
        {editBadge}
      </span>
    );
  }

  if (cell.kind === 'blank') {
    return (
      <span className="inline-flex items-center gap-1 text-slate-600 italic">
        BLANK
        {editBadge}
      </span>
    );
  }

  if (cell.kind === 'zero') {
    return (
      <span className="inline-flex items-center gap-1" title={cell.rawCell?.f ? `=${cell.rawCell.f}` : undefined}>
        <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-100 font-semibold">0</span>
        {cell.rawCell?.f && (
          <span className="text-[9px] px-1 rounded bg-sky-950/70 border border-sky-800/60 text-sky-300">
            fx
          </span>
        )}
        {editBadge}
      </span>
    );
  }

  if (cell.kind === 'boolean') {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 text-[10px]">
          {cell.displayText}
        </span>
        {editBadge}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1" title={cell.rawCell?.f ? `=${cell.rawCell.f}` : undefined}>
      <span className={cell.kind === 'date' ? 'text-sky-200' : ''}>{cell.displayText}</span>
      {cell.rawCell?.f && (
        <span className="text-[9px] px-1 rounded bg-sky-950/70 border border-sky-800/60 text-sky-300">
          fx
        </span>
      )}
      {editBadge}
    </span>
  );
}

export const DailyTradingTable: React.FC<DailyTradingTableProps> = ({
  selectedTicker,
  records,
  dailySchemas = {},
  userRole,
  onRequestEdit,
  onRequestDelete,
  onExportDailyExcel,
}) => {
  const [columnQuery, setColumnQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [inspectRecord, setInspectRecord] = useState<DailyTradingRecord | null>(null);

  const indexedSchemas = useMemo(() => indexDailySchemas(dailySchemas), [dailySchemas]);

  const { columns, missingSchemaRecordCount, schemaCount } = useMemo(
    () => resolveUnifiedDailyColumns(records, indexedSchemas),
    [records, indexedSchemas]
  );

  const extraTopLevelKeys = useMemo(() => {
    const knownKeys = new Set<string>([
      ...STANDARD_DAILY_MAPPED_FIELDS.map((f) => String(f.field)),
      'id',
      'tradeDate',
      'updatedAt',
      'schemaId',
      'rawCells',
      'rawRowHeadersMissingCount',
      'formulaMissingCachedCount',
      'originalValues',
      'manualCorrections',
      'contentHash',
      'serverUpdatedAt',
      'updatedBy',
      'importId',
      'sourceFile',
      'sourceSheet',
      'sourceRow',
      'schemaVersion',
      'isDeleted',
    ]);
    const found = new Set<string>();
    for (const r of records) {
      for (const k of Object.keys(r)) {
        if (!knownKeys.has(k) && (r as unknown as Record<string, unknown>)[k] !== undefined) {
          found.add(k);
        }
      }
    }
    return Array.from(found).sort((a, b) => a.localeCompare(b));
  }, [records]);

  const filteredColumns = useMemo(() => {
    const q = columnQuery.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter((c) => {
      const header = (c.headerName ?? '').toLowerCase();
      const letter = (c.colLetter ?? '').toLowerCase();
      const mapped = (c.mappedField ?? '').toLowerCase();
      const colId = (c.colId ?? '').toLowerCase();
      const schemaId = (c.schemaId ?? '').toLowerCase();
      return (
        header.includes(q) ||
        letter.includes(q) ||
        mapped.includes(q) ||
        colId.includes(q) ||
        schemaId.includes(q)
      );
    });
  }, [columns, columnQuery]);

  const filteredExtraTopLevelKeys = useMemo(() => {
    const q = columnQuery.trim().toLowerCase();
    if (!q) return extraTopLevelKeys;
    return extraTopLevelKeys.filter((k) => k.toLowerCase().includes(q) || `extra.${k}`.includes(q));
  }, [extraTopLevelKeys, columnQuery]);

  const useVirtual = records.length > VIRTUAL_THRESHOLD;
  const visibleWindow = useMemo(() => {
    if (!useVirtual) {
      return {
        startIndex: 0,
        endIndex: records.length,
        padTop: 0,
        padBottom: 0,
      };
    }
    const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT);
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIndex = Math.min(records.length, startIndex + visibleCount + OVERSCAN * 2);
    return {
      startIndex,
      endIndex,
      padTop: startIndex * ROW_HEIGHT,
      padBottom: Math.max(0, (records.length - endIndex) * ROW_HEIGHT),
    };
  }, [records.length, scrollTop, useVirtual]);

  const displayedRows = useMemo(
    () => records.slice(visibleWindow.startIndex, visibleWindow.endIndex),
    [records, visibleWindow.startIndex, visibleWindow.endIndex]
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-sm overflow-hidden p-5 space-y-4">
      <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">
              سجل التداول اليومي الشامل لشاشة البورصة — {selectedTicker}
            </h3>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            تطابق موحّد لكافة أعمدة شاشات التداول عبر {schemaCount || 1} مخطط(ات) ({columns.length} عموداً متاحاً · {records.length} يوم تداول).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onExportDailyExcel && records.length > 0 && (
            <button
              type="button"
              onClick={onExportDailyExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-emerald-300 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير Excel الشامل ({columns.length} عموداً)</span>
            </button>
          )}
        </div>
      </div>

      {missingSchemaRecordCount > 0 && (
        <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-3 text-xs text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            تنبيه: يوجد {missingSchemaRecordCount} سجل تداول يومي يشير إلى مخطط أعمدة (schemaId) غير متاح محلياً؛ تم عرض حقوله القياسية وخلاياه المتبقية حسب colId الأصلي دون تخمين.
          </span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 text-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={columnQuery}
            onChange={(e) => setColumnQuery(e.target.value)}
            placeholder="ابحث باسم العمود أو الحرف أو معرف الحقل (مثل: P/B، col_65، رأس مال)..."
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="text-[11px] text-slate-400 font-mono">
          يُعرض {filteredColumns.length} من أصل {columns.length} عموداً
        </div>
      </div>

      <div
        className={`overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700 ${
          useVirtual ? 'max-h-[520px] overflow-y-auto' : ''
        }`}
        onScroll={(e) => {
          if (useVirtual) {
            setScrollTop(e.currentTarget.scrollTop);
          }
        }}
      >
        <table className="w-full text-xs text-start whitespace-nowrap divide-y divide-slate-800">
          <thead className="bg-slate-950 text-slate-400 sticky top-0 z-20">
            <tr>
              <th className="p-3 text-start sticky right-0 bg-slate-950 z-30 border-b border-slate-800 font-mono">
                تاريخ التداول
              </th>
              {filteredColumns.map((col) => (
                <th
                  key={col.key}
                  className="p-3 text-start border-b border-slate-800 font-mono"
                  title={`${col.colLetter ?? ''} (${col.colId ?? col.key})${col.mappedField ? ` → ${col.mappedField}` : ''}${col.schemaId ? ` · Schema: ${col.schemaId}` : ''}`}
                >
                  <div className="flex items-center gap-1.5">
                    {col.colLetter && (
                      <span className="text-[10px] px-1 rounded bg-slate-900 border border-slate-800 text-slate-500">
                        {col.colLetter}
                      </span>
                    )}
                    <span className={!col.isBlankHeader ? 'text-slate-200' : 'text-amber-300 italic'}>
                      {col.rawHeaderName ?? col.headerName}
                    </span>
                    {col.isDuplicateHeader && (
                      <span className="text-[9px] px-1 rounded bg-amber-950/60 border border-amber-700/60 text-amber-300">
                        مكرر
                      </span>
                    )}
                  </div>
                </th>
              ))}
              {filteredExtraTopLevelKeys.map((extraKey) => (
                <th
                  key={`extra:${extraKey}`}
                  className="p-3 text-start border-b border-slate-800 font-mono text-amber-200"
                  title={`extra.${extraKey}`}
                >
                  {`حقل إضافي: ${extraKey}`}
                </th>
              ))}
              <th className="p-3 text-center sticky left-0 bg-slate-950 z-30 border-b border-slate-800">
                إجراءات
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 font-mono tabular-nums">
            {records.length === 0 ? (
              <tr>
                <td colSpan={filteredColumns.length + filteredExtraTopLevelKeys.length + 2} className="p-8 text-center text-slate-400 font-sans">
                  لا توجد بيانات تداول مسجلة لهذا السهم. ارفع ملف التداول اليومي لبدء التحليل.
                </td>
              </tr>
            ) : (
              <>
                {visibleWindow.padTop > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={filteredColumns.length + filteredExtraTopLevelKeys.length + 2} style={{ height: `${visibleWindow.padTop}px`, padding: 0 }} />
                  </tr>
                )}
                {displayedRows.map((d) => {
                  const correctionsCount = d.manualCorrections ? Object.keys(d.manualCorrections).length : 0;
                  return (
                    <tr
                      key={`${d.ticker}_${d.tradeDate}`}
                      className="hover:bg-slate-800/40 transition-colors"
                      style={useVirtual ? { height: `${ROW_HEIGHT}px` } : undefined}
                    >
                      <td className="p-3 text-start font-bold text-slate-200 sticky right-0 bg-slate-900/95 z-10 border-l border-slate-800/60">
                        <div className="flex items-center gap-1.5">
                          <span>{d.tradeDate}</span>
                          {correctionsCount > 0 && (
                            <span
                              className="text-[9px] px-1 py-0.5 rounded bg-amber-950/70 border border-amber-700/60 text-amber-300"
                              title={`يحتوي ${correctionsCount} تعديلاً يدوياً موثقاً`}
                            >
                              معدّل ({correctionsCount})
                            </span>
                          )}
                        </div>
                      </td>

                      {filteredColumns.map((col) => (
                        <td key={col.key} className="p-3 text-start text-slate-300">
                          {renderUnifiedDailyCell(d, col, indexedSchemas)}
                        </td>
                      ))}
                      {filteredExtraTopLevelKeys.map((extraKey) => {
                        const extraVal = (d as unknown as Record<string, unknown>)[extraKey];
                        return (
                          <td key={`extra:${extraKey}`} className="p-3 text-start text-amber-200">
                            {extraVal === null || extraVal === undefined || extraVal === ''
                              ? 'BLANK'
                              : typeof extraVal === 'object'
                              ? JSON.stringify(extraVal)
                              : String(extraVal)}
                          </td>
                        );
                      })}

                      <td className="p-3 text-center sticky left-0 bg-slate-900/95 z-10 border-r border-slate-800/60">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setInspectRecord(d)}
                            className="p-1.5 rounded-lg text-sky-400 hover:text-white hover:bg-sky-600/80 transition-colors"
                            title="تفاصيل السجل الكاملة والخلايا الخام"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onRequestEdit(d)}
                            className="p-1.5 rounded-lg text-emerald-400 hover:text-white hover:bg-emerald-600/80 transition-colors"
                            title="تعديل بيانات التداول لهذا اليوم"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          {userRole === 'admin' && (
                            <button
                              type="button"
                              onClick={() => onRequestDelete({ ticker: d.ticker, tradeDate: d.tradeDate })}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                              title="حذف سجل التداول لهذا اليوم"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleWindow.padBottom > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={filteredColumns.length + filteredExtraTopLevelKeys.length + 2} style={{ height: `${visibleWindow.padBottom}px`, padding: 0 }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      <RecordDetailsModal
        isOpen={Boolean(inspectRecord)}
        onClose={() => setInspectRecord(null)}
        title={
          inspectRecord
            ? `تفاصيل التداول اليومي — ${inspectRecord.ticker} (${inspectRecord.tradeDate})`
            : ''
        }
        subtitle="عرض كامل لجميع الحقول المحفوظة، rawCells، وسجل التعديلات اليدوية"
        record={inspectRecord}
        schemaSummary={
          inspectRecord
            ? {
                schemaId: inspectRecord.schemaId ?? null,
                totalColumns: inspectRecord.schemaId ? dailySchemas[inspectRecord.schemaId]?.totalColumns : undefined,
                missingSchema: Boolean(inspectRecord.schemaId && !dailySchemas[inspectRecord.schemaId]),
              }
            : null
        }
      />
    </div>
  );
};
