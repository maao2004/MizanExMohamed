/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X, FileSearch, Edit3, AlertTriangle } from 'lucide-react';
import type { ManualCorrectionsMap } from '../../types';
import {
  sanitizeReadManualCorrections,
  sanitizeReadOriginalValues,
} from '../../core/domain/quarterlyManualAudit';

interface RecordDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  record: Record<string, any> | null;
  schemaSummary?: {
    schemaId?: string | null;
    totalColumns?: number;
    missingSchema?: boolean;
  } | null;
}

function formatScalarValue(val: unknown): { text: string; toneClass: string } {
  if (val === null || val === undefined || val === '') {
    return { text: 'BLANK (غير متاح)', toneClass: 'text-slate-500 italic' };
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return { text: 'غير صالح (NaN/Inf)', toneClass: 'text-red-400' };
    if (val === 0) return { text: '0 (صفر فعلي)', toneClass: 'text-amber-300 font-bold' };
    return { text: val.toLocaleString('en-US', { maximumFractionDigits: 6 }), toneClass: 'text-slate-100' };
  }
  if (typeof val === 'boolean') {
    return { text: val ? 'TRUE (نعم)' : 'FALSE (لا)', toneClass: 'text-sky-300' };
  }
  if (typeof val === 'string') {
    return { text: val, toneClass: 'text-slate-200' };
  }
  return { text: JSON.stringify(val), toneClass: 'text-slate-300' };
}

function renderStructuredValue(val: unknown, depth = 0): React.ReactNode {
  if (val === null || val === undefined || typeof val !== 'object') {
    const formatted = formatScalarValue(val);
    return <span className={`font-mono text-[11px] ${formatted.toneClass}`}>{formatted.text}</span>;
  }

  if (Array.isArray(val)) {
    if (val.length === 0) {
      return <span className="font-mono text-[11px] text-slate-500 italic">[] (قائمة فارغة)</span>;
    }
    return (
      <div className="space-y-1 border-r-2 border-slate-700 pr-2 mt-1">
        {val.map((item, idx) => (
          <div key={idx} className="text-[11px] flex items-start gap-2">
            <span className="font-mono text-slate-500">[{idx}]</span>
            <div className="flex-1 break-all">{renderStructuredValue(item, depth + 1)}</div>
          </div>
        ))}
      </div>
    );
  }

  const entries = Object.entries(val as Record<string, unknown>);
  if (entries.length === 0) {
    return <span className="font-mono text-[11px] text-slate-500 italic">{'{} (كائن فارغ)'}</span>;
  }

  if (depth >= 3) {
    return <span className="font-mono text-[11px] text-slate-300 break-all">{JSON.stringify(val)}</span>;
  }

  return (
    <div className="space-y-1 border-r-2 border-slate-700 pr-2 mt-1">
      {entries.map(([k, v]) => (
        <div key={k} className="text-[11px] flex flex-wrap items-start gap-2">
          <span className="font-mono text-emerald-300 shrink-0">{k}:</span>
          <div className="flex-1 break-all">{renderStructuredValue(v, depth + 1)}</div>
        </div>
      ))}
    </div>
  );
}

export const RecordDetailsModal: React.FC<RecordDetailsModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  record,
  schemaSummary = null,
}) => {
  if (!isOpen || !record) return null;

  const manualCorrections: ManualCorrectionsMap =
    sanitizeReadManualCorrections(record.manualCorrections) ?? {};
  const originalValues: Record<string, unknown> =
    sanitizeReadOriginalValues(record.originalValues) ?? {};
  const extendedFields = (record.extendedFields ?? null) as Record<string, unknown> | null;
  const rawCells = (record.rawCells ?? null) as Record<string, unknown> | null;

  const nestedKeys = new Set([
    'manualCorrections',
    'originalValues',
    'extendedFields',
    'rawCells',
  ]);
  const internalMetaKeys = new Set([
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

  const scalarAndOtherEntries = Object.entries(record).filter(
    ([key]) => !nestedKeys.has(key) && !internalMetaKeys.has(key)
  );
  const internalMetaEntries = Object.entries(record).filter(
    ([key]) => internalMetaKeys.has(key)
  );

  const correctionEntries = Object.entries(manualCorrections);
  const originalEntries = Object.entries(originalValues);
  const extendedEntries = extendedFields ? Object.entries(extendedFields) : [];
  const rawCellEntries = rawCells ? Object.entries(rawCells) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-950/80 border border-sky-800/60 flex items-center justify-center text-sky-400">
              <FileSearch className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white">{title}</h3>
              {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            aria-label="إغلاق التفاصيل"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {schemaSummary && (
            <div
              className={`rounded-xl border p-3 flex flex-wrap items-center justify-between gap-2 ${
                schemaSummary.missingSchema
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                  : 'bg-slate-950 border-slate-800 text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {schemaSummary.missingSchema && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                <span>
                  معرف المخطط المرجعي:{' '}
                  <strong className="font-mono text-white">{schemaSummary.schemaId || 'غير محدد'}</strong>
                  {schemaSummary.missingSchema
                    ? ' — المخطط غير موجود في الكتلة المحملة، تُعرض الخلايا حسب colId الأصلي.'
                    : ''}
                </span>
              </div>
              {typeof schemaSummary.totalColumns === 'number' && (
                <span className="font-mono text-[11px] text-slate-400">
                  أعمدة المخطط: {schemaSummary.totalColumns}
                </span>
              )}
            </div>
          )}

          {correctionEntries.length > 0 && (
            <div className="bg-amber-950/25 border border-amber-800/50 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 font-bold text-amber-300">
                <Edit3 className="w-4 h-4" />
                <span>سجل التعديلات اليدوية الموثقة ({correctionEntries.length})</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] text-start">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-2">الحقل</th>
                      <th className="p-2">القيمة الأصلية المستوردة</th>
                      <th className="p-2">القيمة المعدلة</th>
                      <th className="p-2">تاريخ التعديل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {correctionEntries.map(([field, entry]) => (
                      <tr key={field}>
                        <td className="p-2 text-emerald-300">{field}</td>
                        <td className="p-2 text-slate-400">{formatScalarValue(entry.originalValue).text}</td>
                        <td className="p-2 text-amber-200 font-semibold">{formatScalarValue(entry.correctedValue).text}</td>
                        <td className="p-2 text-slate-400">{entry.editedAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h4 className="font-bold text-slate-200 border-b border-slate-800 pb-1.5">
              كافة حقول السجل المحفوظة والحقول الإضافية العليا ({scalarAndOtherEntries.length})
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {scalarAndOtherEntries.map(([key, value]) => (
                <div key={key} className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-[11px] text-sky-300 font-semibold">{key}</span>
                    {manualCorrections[key] && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-700/60 text-amber-300">
                        معدّل يدوياً
                      </span>
                    )}
                  </div>
                  <div className="break-all">{renderStructuredValue(value)}</div>
                </div>
              ))}
            </div>
          </div>

          {internalMetaEntries.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-bold text-slate-400 border-b border-slate-800 pb-1.5">
                بيانات الحوكمة والتدقيق الداخلية ({internalMetaEntries.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {internalMetaEntries.map(([key, value]) => (
                  <div key={key} className="bg-slate-950/50 border border-slate-800/60 rounded-xl p-2.5">
                    <div className="font-mono text-[11px] text-slate-400 font-semibold mb-1">{key}</div>
                    <div className="break-all">{renderStructuredValue(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {extendedEntries.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-bold text-teal-300 border-b border-slate-800 pb-1.5">
                الحقول الإضافية الممتدة (extendedFields — {extendedEntries.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {extendedEntries.map(([key, value]) => (
                  <div key={key} className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5">
                    <div className="font-mono text-[11px] text-teal-300 font-semibold mb-1">{key}</div>
                    <div className="break-all">{renderStructuredValue(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rawCellEntries.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-bold text-amber-300 border-b border-slate-800 pb-1.5">
                خلايا المصدر الخام الكاملة (rawCells — {rawCellEntries.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                {rawCellEntries.map(([colId, cellVal]) => (
                  <div key={colId} className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5">
                    <div className="font-mono text-[11px] text-amber-300 font-semibold mb-1">{colId}</div>
                    <div className="break-all">{renderStructuredValue(cellVal)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {originalEntries.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-bold text-slate-300 border-b border-slate-800 pb-1.5">
                القيم الأصلية المرجعية (originalValues — {originalEntries.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {originalEntries.map(([k, v]) => (
                  <div key={k} className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5">
                    <div className="font-mono text-[11px] text-slate-300 font-semibold mb-1">{k}</div>
                    <div className="break-all">{renderStructuredValue(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-3.5 border-t border-slate-800 bg-slate-950/70 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
