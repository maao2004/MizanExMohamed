/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Edit3,
  Filter,
  Info,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import {
  QuarterlyFinancialRecord,
  RequestedQuarterlyEditTarget,
  UserRole,
} from '../../types';
import {
  AuditSeverity,
  AuditWarning,
  AuditWarningRecordTarget,
} from '../../types/financial';
import { tryNormalizedTicker } from '../../core/contracts';

interface AccountingAuditWarningsPanelProps {
  selectedTicker: string;
  availableTickers: string[];
  onSelectTicker: (ticker: string) => void;
  warnings: AuditWarning[];
  quarterlyRecords: QuarterlyFinancialRecord[];
  userRole: UserRole;
  onRequestEditTarget: (target: RequestedQuarterlyEditTarget) => void;
}

const WARNING_TYPE_LABELS_AR: Record<AuditWarning['type'], string> = {
  revenue_drop: 'انخفاض الإيرادات التراكمية (YTD)',
  capex_drop: 'تراجع الإنفاق الاستثماري (CapEx YTD)',
  profit_exceeds_revenue: 'صافي الربح يتجاوز الإيرادات',
  blank_zero_confusion: 'اشتباه خلط الصفر مع BLANK',
  cashflow_divergence: 'تباين الربح والتدفق التشغيلي',
  unusual_repetition: 'تكرار غير معتاد للبيانات',
  negative_equity: 'حقوق ملكية سالبة',
};

const SEVERITY_META: Record<
  AuditSeverity,
  { labelAr: string; badgeClass: string; cardClass: string }
> = {
  critical: {
    labelAr: 'اشتباه حرج للمراجعة',
    badgeClass: 'bg-red-900/70 text-red-200 border-red-700/80',
    cardClass: 'bg-red-950/25 border-red-800/75',
  },
  warning: {
    labelAr: 'تحذير تدقيق',
    badgeClass: 'bg-amber-900/60 text-amber-200 border-amber-700/80',
    cardClass: 'bg-amber-950/20 border-amber-800/75',
  },
  info: {
    labelAr: 'معلومة مراجعة',
    badgeClass: 'bg-sky-900/60 text-sky-200 border-sky-700/80',
    cardClass: 'bg-slate-950/80 border-slate-700/80',
  },
};

const normalizeTickerKey = (ticker: string): string =>
  tryNormalizedTicker(ticker) ?? ticker.trim().toUpperCase();

export const AccountingAuditWarningsPanel: React.FC<AccountingAuditWarningsPanelProps> = ({
  selectedTicker,
  availableTickers,
  onSelectTicker,
  warnings,
  quarterlyRecords,
  userRole,
  onRequestEditTarget,
}) => {
  const selectedBaseTicker = normalizeTickerKey(selectedTicker || '');
  const [severityFilter, setSeverityFilter] = useState<'all' | AuditSeverity>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | AuditWarning['type']>('all');

  // Reset active filters whenever the selected stock changes so filters never leak across stocks
  useEffect(() => {
    setSeverityFilter('all');
    setTypeFilter('all');
  }, [selectedBaseTicker]);

  // Strict stock-context isolation: never display warnings belonging to any other ticker
  const stockWarnings = useMemo(() => {
    if (!selectedBaseTicker) return [];
    return warnings.filter((w) => normalizeTickerKey(w.companyTicker) === selectedBaseTicker);
  }, [warnings, selectedBaseTicker]);

  const availableTypes = useMemo(() => {
    const seen = new Set<AuditWarning['type']>();
    for (const w of stockWarnings) seen.add(w.type);
    return Array.from(seen);
  }, [stockWarnings]);

  const severityCounts = useMemo(
    () => ({
      critical: stockWarnings.filter((w) => w.severity === 'critical').length,
      warning: stockWarnings.filter((w) => w.severity === 'warning').length,
      info: stockWarnings.filter((w) => w.severity === 'info').length,
    }),
    [stockWarnings]
  );

  const filteredWarnings = useMemo(() => {
    return stockWarnings.filter((w) => {
      if (severityFilter !== 'all' && w.severity !== severityFilter) return false;
      if (typeFilter !== 'all' && w.type !== typeFilter) return false;
      return true;
    });
  }, [stockWarnings, severityFilter, typeFilter]);

  const hasActiveFilters = severityFilter !== 'all' || typeFilter !== 'all';
  const canEdit = userRole === 'admin' || userRole === 'data_entry';

  const clearFilters = () => {
    setSeverityFilter('all');
    setTypeFilter('all');
  };

  const hasExactQuarterlyRecord = (target: AuditWarningRecordTarget): boolean => {
    const normTarget = normalizeTickerKey(target.ticker);
    return quarterlyRecords.some(
      (r) =>
        normalizeTickerKey(r.ticker) === normTarget &&
        r.year === target.year &&
        r.quarter === target.quarter
    );
  };

  const renderDetectedFields = (warning: AuditWarning) => {
    if (warning.detectedFields && warning.detectedFields.length > 0) {
      return warning.detectedFields;
    }
    return Object.entries(warning.detectedValues || {}).map(([key, value]) => ({
      labelAr: key,
      value: String(value ?? 'BLANK'),
    }));
  };

  return (
    <section
      data-testid="accounting-audit-warnings-panel"
      aria-label="ملاحظات التدقيق المحاسبي"
      className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4"
    >
      {/* Header + Stock Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-3">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              ملاحظات التدقيق المحاسبي لجودة البيانات —{' '}
              <span className="font-mono text-amber-300">{selectedTicker || 'غير محدد'}</span>
            </span>
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
            ملاحظات اشتباه صادرة عن محرك التدقيق الآلي للسجلات التراكمية (مستقلة عن مصفوفة الفحص الـ 9) — تتطلب مراجعة يدوية لمصادرها ولا تُعد أخطاء محاسبية مثبتة قبل التحقق، دون أي تعديل آلي.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs shrink-0">
          <span className="text-slate-400">السهم المحدد:</span>
          <select
            aria-label="اختيار السهم في ملاحظات التدقيق"
            value={selectedTicker}
            onChange={(e) => onSelectTicker(e.target.value)}
            disabled={availableTickers.length === 0}
            className="bg-slate-950 border border-slate-700 rounded-lg p-1.5 font-mono text-emerald-400 font-bold disabled:opacity-60"
          >
            {availableTickers.length === 0 ? (
              <option value="">لا يوجد أسهم مسجلة</option>
            ) : (
              availableTickers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Explicit Counts Bar: Total for Selected Stock vs Visible After Filtering */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/70 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span data-testid="audit-total-count" className="text-slate-200 font-semibold">
            إجمالي ملاحظات التدقيق للسهم:{' '}
            <span className="font-mono text-amber-300">{stockWarnings.length}</span>
          </span>
          <span className="text-slate-600">|</span>
          <span data-testid="audit-visible-count" className="text-slate-300">
            المعروض بعد التصفية:{' '}
            <span className="font-mono text-emerald-300 font-semibold">
              {filteredWarnings.length}
            </span>
          </span>
          {stockWarnings.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="px-2 py-0.5 rounded bg-red-950/60 border border-red-800/60 text-red-300 font-mono">
                اشتباه حرج: {severityCounts.critical}
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/60 text-amber-300 font-mono">
                تحذير: {severityCounts.warning}
              </span>
              <span className="px-2 py-0.5 rounded bg-sky-950/60 border border-sky-800/60 text-sky-300 font-mono">
                معلومة: {severityCounts.info}
              </span>
            </div>
          )}
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            data-testid="audit-clear-filters-btn"
            onClick={clearFilters}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-200 border border-slate-700 font-semibold"
          >
            <RotateCcw className="w-3 h-3" />
            <span>إزالة المرشحات</span>
          </button>
        )}
      </div>

      {/* Filters Bar */}
      {stockWarnings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span>تصفية:</span>
          </span>

          {(
            [
              { id: 'all', label: `الكل (${stockWarnings.length})` },
              { id: 'critical', label: `اشتباه حرج للمراجعة (${severityCounts.critical})` },
              { id: 'warning', label: `تحذير تدقيق (${severityCounts.warning})` },
              { id: 'info', label: `معلومة مراجعة (${severityCounts.info})` },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`audit-filter-severity-${item.id}`}
              onClick={() => setSeverityFilter(item.id)}
              className={`px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                severityFilter === item.id
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}

          {availableTypes.length > 1 && (
            <select
              aria-label="تصفية حسب نوع الملاحظة"
              data-testid="audit-filter-type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | AuditWarning['type'])}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200"
            >
              <option value="all">جميع أنواع الملاحظات</option>
              {availableTypes.map((typeKey) => (
                <option key={typeKey} value={typeKey}>
                  {WARNING_TYPE_LABELS_AR[typeKey] || typeKey}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Warnings List or Empty States */}
      {stockWarnings.length === 0 ? (
        <div
          data-testid="audit-empty-state"
          className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 text-center space-y-1"
        >
          <p className="text-emerald-400 font-semibold">
            ✓ لا توجد ملاحظات تدقيق محاسبي مرصودة لسهم {selectedTicker || '—'}.
          </p>
          <p className="text-slate-400 text-[11px]">
            لم يرصد محرك التدقيق الآلي تناقضات في تراكم الإيرادات أو CapEx أو تكراراً غير معتاد ضمن القوائم المحملة لهذا السهم.
          </p>
        </div>
      ) : filteredWarnings.length === 0 ? (
        <div
          data-testid="audit-filtered-empty-state"
          className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 text-center space-y-2.5"
        >
          <p>لا توجد ملاحظات تطابق المرشحات النشطة حالياً (الإجمالي قبل التصفية: {stockWarnings.length}).</p>
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-200 border border-slate-700 font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>إزالة المرشحات وإظهار جميع الملاحظات</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredWarnings.map((warning) => {
            const sevMeta = SEVERITY_META[warning.severity] ?? SEVERITY_META.warning;
            const fields = renderDetectedFields(warning);
            const targets = warning.relatedRecords ?? [];

            return (
              <article
                key={warning.id}
                data-testid={`audit-warning-card-${warning.id}`}
                className={`p-4 rounded-xl border text-xs space-y-3 ${sevMeta.cardClass}`}
              >
                {/* Top Row: Icon, Title, Stock, Period, Severity */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {warning.severity === 'critical' ? (
                      <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
                    ) : warning.severity === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : (
                      <Info className="w-4 h-4 text-sky-400 shrink-0" />
                    )}
                    <h4 className="font-bold text-slate-100 text-sm">{warning.title}</h4>
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-emerald-300">
                      {warning.companyTicker}
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
                      {warning.period}
                    </span>
                  </div>

                  <span
                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded border ${sevMeta.badgeClass}`}
                  >
                    {sevMeta.labelAr}
                  </span>
                </div>

                {/* Compared Fields & Values */}
                {fields.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {fields.map((item, idx) => (
                      <div
                        key={`${warning.id}_field_${idx}`}
                        className="rounded-lg bg-slate-950/80 border border-slate-800 px-3 py-2"
                      >
                        <div className="text-[10px] text-slate-400">{item.labelAr}</div>
                        <div className="font-mono font-semibold text-slate-100 mt-0.5">
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Suspicion Reason */}
                <p className="text-slate-200 leading-relaxed">
                  <strong className="text-white">سبب الاشتباه المحاسبي: </strong>
                  {warning.reasonAr}
                </p>

                {/* Review Step */}
                <div className="p-2.5 rounded-lg bg-slate-950/85 border border-slate-800 text-[11px] text-emerald-300 flex items-start gap-2">
                  <span className="font-bold shrink-0 text-slate-200">خطوة المراجعة المطلوبة:</span>
                  <span className="leading-relaxed">{warning.reviewActionAr}</span>
                </div>

                {/* Structured Edit Routing Actions */}
                {targets.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {targets.map((target, idx) => {
                        const recordExists = hasExactQuarterlyRecord(target);
                        const actionLabel = target.roleAr
                          ? `تعديل ${target.quarter} ${target.year} (${target.roleAr}) — ${target.fieldLabelAr}`
                          : `تعديل ${target.quarter} ${target.year} — ${target.fieldLabelAr}`;

                        return (
                          <button
                            key={`${warning.id}_target_${target.year}_${target.quarter}_${target.field}_${idx}`}
                            type="button"
                            data-testid={`audit-edit-btn-${warning.id}-${target.year}-${target.quarter}-${target.field}`}
                            onClick={() =>
                              onRequestEditTarget({
                                ticker: target.ticker,
                                year: target.year,
                                quarter: target.quarter,
                                field: target.field,
                                labelAr: target.fieldLabelAr,
                              })
                            }
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                              canEdit && recordExists
                                ? 'bg-slate-900 hover:bg-emerald-950/70 text-emerald-300 border-emerald-800/70'
                                : 'bg-slate-950/80 hover:bg-slate-900 text-slate-300 border-slate-700'
                            }`}
                          >
                            <Edit3 className="w-3.5 h-3.5 shrink-0" />
                            <span>{actionLabel}</span>
                          </button>
                        );
                      })}
                    </div>

                    {!canEdit && (
                      <p className="text-[11px] text-amber-300/90">
                        ملاحظة الصلاحية: التعديل متاح فقط لمدير النظام أو مدخل البيانات؛ النقر يعرض التوضيح دون فتح نموذج التعديل.
                      </p>
                    )}

                    {canEdit && targets.some((t) => !hasExactQuarterlyRecord(t)) && (
                      <p className="text-[11px] text-amber-300/90">
                        تنبيه: أحد السجلات المرتبطة بهذه الملاحظة غير موجود في البيانات المحملة حالياً؛ لن يُختار سجل بديل ولن يُنشأ سجل تلقائياً.
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};
