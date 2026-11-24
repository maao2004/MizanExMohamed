/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, FileSpreadsheet, Pencil } from 'lucide-react';
import type {
  AuditedMetricItem,
  MetricAuditBundle,
  MetricCompletenessStatus,
  RequestedQuarterlyEditTarget,
} from '../types/financial';

interface MetricAuditCardProps {
  metricAudit?: MetricAuditBundle | null;
  finCurrencyLabel?: string | null;
  defaultExpanded?: boolean;
  ticker?: string;
  onRequestEditTarget?: (target: RequestedQuarterlyEditTarget) => void;
}

const COMPLETENESS_LABEL_AR: Record<MetricCompletenessStatus, { label: string; cls: string }> = {
  complete: { label: 'مكتمل وموثق', cls: 'text-emerald-400' },
  unattested: { label: 'غير مفصول الأقلية', cls: 'text-amber-300' },
  partial: { label: 'جزئي', cls: 'text-amber-300' },
  mismatch: { label: 'عدم اتساق نطاق', cls: 'text-red-400' },
  unavailable: { label: 'غير متاح', cls: 'text-slate-400' },
};

const COMPARISON_STATUS_AR: Record<
  MetricAuditBundle['reportedVsAccountingComparison']['status'],
  { label: string; cls: string }
> = {
  aligned: { label: 'متطابق ضمن حد التقريب', cls: 'text-emerald-400' },
  discrepancy: { label: 'فرق تدقيقي يحتاج مراجعة', cls: 'text-amber-300' },
  withheld_period_or_basis_mismatch: { label: 'محجوب لاختلاف الفترة أو الأساس', cls: 'text-sky-300' },
  unavailable: { label: 'غير متاح للمقارنة', cls: 'text-slate-400' },
};

const SHARE_SOURCE_AR: Record<MetricAuditBundle['effectiveAnalyticalSharesSource'], string> = {
  quarterly_record: 'السجل الفصلي (EOP)',
  daily_listed_shares: 'الأسهم المدرجة اليومية',
  company_metadata: 'بيانات الشركة الوصفية',
  missing: 'غير متاح',
};

const fmtRawNum = (val: number | null): string => {
  if (val === null || !Number.isFinite(val)) return 'غير متاح';
  if (Math.abs(val) >= 1000) {
    return val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  return Number(val.toFixed(4)).toString();
};

export const MetricAuditCard: React.FC<MetricAuditCardProps> = ({
  metricAudit,
  finCurrencyLabel,
  defaultExpanded = false,
  ticker,
  onRequestEditTarget,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!metricAudit) return null;

  const missingActionItems = [
    ...(metricAudit.missingCommonFields ?? []),
    ...(metricAudit.missingAccountingEpsFields ?? []),
  ];

  const auditRows: AuditedMetricItem[] = [
    metricAudit.reportedEps,
    metricAudit.accountingEpsLatest,
    metricAudit.accountingEpsTTM,
    metricAudit.analyticalEpsTTM,
    metricAudit.commonBvps,
    metricAudit.totalEquityBvps,
    metricAudit.valuationBvps,
    metricAudit.roeCommonEop,
    metricAudit.roeTotalEop,
    metricAudit.roeAverageEquity,
    metricAudit.valuationRoe,
  ];

  const comp = metricAudit.reportedVsAccountingComparison;
  const compBadge = COMPARISON_STATUS_AR[comp.status];

  return (
    <section
      aria-label="تدقيق الأساس المحاسبي للمؤشرات (EPS / BVPS / ROE)"
      data-testid="metric-audit-card"
      className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-xs divide-y divide-slate-800"
      dir="rtl"
    >
      {/* Header Bar */}
      <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950/60">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-cyan-400 shrink-0" />
          <h3 className="text-sm font-bold text-white">
            تدقيق الأساس المحاسبي للمؤشرات (EPS · BVPS · ROE)
          </h3>
          <span className="text-[11px] font-mono text-slate-400">
            {metricAudit.latestPeriod ? `· ${metricAudit.latestPeriod}` : ''}
          </span>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-semibold text-slate-200 transition-colors self-start sm:self-auto"
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
              <span>طي التفاصيل التدقيقية</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
              <span>عرض التفاصيل التدقيقية ({auditRows.length} مؤشر)</span>
            </>
          )}
        </button>
      </div>

      {/* Compact Top Summary Strip (3 EPS + BVPS + ROE + Comparison + Share Alignment) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-slate-800">
        {/* 1. Three EPS Variants */}
        <div className="p-4 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400">1. مسارات ربحية السهم الثلاثة</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">ReportedEPS:</span>
            <span className="font-mono tabular-nums font-bold text-slate-100">
              {metricAudit.reportedEps.formattedValue}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">AccountingEPS (الفترة / TTM):</span>
            <span className="font-mono tabular-nums font-bold text-emerald-300">
              {metricAudit.accountingEpsLatest.formattedValue} · {metricAudit.accountingEpsTTM.formattedValue}
            </span>
          </div>
          {(metricAudit.accountingEpsLatest.usedQ1DocumentedEquivalence ||
            metricAudit.accountingEpsTTM.usedQ1DocumentedEquivalence) && (
            <div
              data-testid="metric-audit-q1-equivalence-note"
              className="text-[10px] text-cyan-300 leading-relaxed"
            >
              تكافؤ Q1 موثق: الأساس الأصلي المحفوظ{' '}
              <span className="font-mono">
                {metricAudit.accountingEpsLatest.originalSharesBasis ?? 'standalone_quarter'}
              </span>{' '}
              ← الفعلي للحساب{' '}
              <span className="font-mono">
                {metricAudit.accountingEpsLatest.effectiveSharesBasis ??
                  metricAudit.accountingEpsTTM.effectiveSharesBasis ??
                  'q1_standalone_equivalent_to_ytd'}
              </span>{' '}
              (دون تغيير الرمز المحفوظ).
            </div>
          )}
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">Analytical EPS_TTM (للتقييم):</span>
            <span className="font-mono tabular-nums font-bold text-cyan-300">
              {metricAudit.analyticalEpsTTM.formattedValue}
            </span>
          </div>
        </div>

        {/* 2. Reported vs Accounting Comparison */}
        <div className="p-4 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400">2. مطابقة ReportedEPS و AccountingEPS</div>
          <div className={`font-semibold ${compBadge.cls}`}>{compBadge.label}</div>
          <div className="text-[11px] text-slate-300 leading-relaxed">{comp.messageAr}</div>
          {comp.reportedEpsPeriodStart && comp.reportedEpsPeriodEnd && (
            <div className="text-[10px] font-mono tabular-nums text-slate-400">
              حدود ReportedEPS: {comp.reportedEpsPeriodStart} → {comp.reportedEpsPeriodEnd}
            </div>
          )}
          {comp.remediationAr && (
            <div className="text-[10px] text-amber-300/90 leading-relaxed">
              الإجراء: {comp.remediationAr}
            </div>
          )}
          {comp.absoluteDifference !== null && (
            <div className="text-[10px] font-mono tabular-nums text-slate-400">
              الفرق المطلق: {comp.absoluteDifference.toFixed(4)}
              {comp.relativeDifferencePct !== null ? ` · النسبي: ${comp.relativeDifferencePct.toFixed(2)}%` : ''}
            </div>
          )}
        </div>

        {/* 3. BVPS & ROE Scope Alignment */}
        <div className="p-4 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400">3. القيمة الدفترية والعائد على الملكية</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">BVPS المعتمد ({metricAudit.equityBasisForValuation}):</span>
            <span className="font-mono tabular-nums font-bold text-white">
              {metricAudit.valuationBvps.formattedValue}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-slate-400">Common BVPS / Total BVPS:</span>
            <span className="font-mono tabular-nums text-slate-300">
              {metricAudit.commonBvps.formattedValue} / {metricAudit.totalEquityBvps.formattedValue}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">ROE لـ RIM / متوسط الملكية:</span>
            <span className="font-mono tabular-nums font-bold text-teal-300">
              {metricAudit.valuationRoe.formattedValue} · {metricAudit.roeAverageEquity.formattedValue}
            </span>
          </div>
        </div>

        {/* 4. Share Count Alignment */}
        <div className="p-4 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400">4. اتساق عدد الأسهم عبر المصادر</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">الأسهم الفعالة ({SHARE_SOURCE_AR[metricAudit.effectiveAnalyticalSharesSource]}):</span>
            <span className="font-mono tabular-nums font-bold text-white">
              {metricAudit.effectiveAnalyticalShares !== null
                ? metricAudit.effectiveAnalyticalShares.toLocaleString('en-US')
                : 'غير متاح'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-slate-400">فصلي EOP / يومي مدرج:</span>
            <span className="font-mono tabular-nums text-slate-300">
              {fmtRawNum(metricAudit.quarterlyEopShares)} / {fmtRawNum(metricAudit.dailyListedShares)}
            </span>
          </div>
          {metricAudit.sharesAlignmentNoteAr && (
            <div
              className={`text-[10px] leading-relaxed ${
                metricAudit.sharesAlignmentStatus === 'cross_source_mismatch'
                  ? 'text-amber-300'
                  : 'text-slate-400'
              }`}
            >
              {metricAudit.sharesAlignmentNoteAr}
            </div>
          )}
        </div>
      </div>

      {/* Summary Notes if any */}
      {metricAudit.summaryNotesAr.length > 0 && (
        <div className="px-5 py-2.5 bg-amber-950/25 text-[11px] text-amber-200 space-y-1">
          {metricAudit.summaryNotesAr.map((note, idx) => (
            <div key={idx}>• {note}</div>
          ))}
        </div>
      )}

      {/* Actionable Missing Accounting & Period Fields */}
      {missingActionItems.length > 0 && (
        <div
          data-testid="metric-audit-missing-fields"
          className="px-5 py-3 bg-slate-950/70 space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-amber-300">
              استكمال الحقول المحاسبية والفترية الناقصة ({missingActionItems.length})
            </span>
            <span className="text-[10px] text-slate-400">
              لا تُخترع قيم بديلة عند النقص؛ يمكنك الانتقال مباشرة إلى السجل والفترة والحقل المطلوب لاستكماله.
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {missingActionItems.map((item, idx) => (
              <div
                key={`${item.year}_${item.quarter}_${item.field}_${idx}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-bold text-slate-100">{item.labelAr}</span>
                    <span className="font-mono text-[10px] text-cyan-300">
                      {item.period} · {item.excelColumn}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 leading-relaxed">{item.reasonAr}</div>
                  {'remediationAr' in item && item.remediationAr && (
                    <div className="text-[10px] text-cyan-300/90 leading-relaxed">
                      خطوة الاستكمال: {item.remediationAr}
                    </div>
                  )}
                  {item.affectedModels.length > 0 && (
                    <div className="text-[10px] text-amber-300/90">
                      المتأثر: {item.affectedModels.join(' · ')}
                    </div>
                  )}
                </div>
                {onRequestEditTarget && ticker && (
                  <button
                    type="button"
                    data-testid={`edit-missing-${item.year}-${item.quarter}-${item.field}`}
                    onClick={() =>
                      onRequestEditTarget({
                        ticker,
                        year: item.year,
                        quarter: item.quarter,
                        field: item.field,
                        labelAr: item.labelAr,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-700/60 text-emerald-300 text-[10px] font-semibold shrink-0 self-start sm:self-center transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>تعديل الحقل في السجل</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expanded Full Audit Table */}
      {expanded && (
        <div className="p-4 space-y-3 bg-slate-950/40">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>
              جدول التفكيك المحاسبي الكامل (العملة النشطة: {finCurrencyLabel || 'القيم الأساسية'})
            </span>
            <span className="font-mono tabular-nums">
              NetIncome TTM: {fmtRawNum(metricAudit.netIncomeTTM)} · NetIncomeCommon TTM:{' '}
              {fmtRawNum(metricAudit.netIncomeCommonTTM)} ({metricAudit.netIncomeCommonTtmBasis})
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full text-[11px] text-start border-collapse">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2 text-start">المؤشر</th>
                  <th className="px-3 py-2 text-end font-mono">القيمة</th>
                  <th className="px-3 py-2 text-start">المعادلة والأساس</th>
                  <th className="px-3 py-2 text-end font-mono">البسط / المقام</th>
                  <th className="px-3 py-2 text-start">الفترة والحالة</th>
                  <th className="px-3 py-2 text-start">النماذج والملاحظات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {auditRows.map((item) => {
                  const statusMeta = COMPLETENESS_LABEL_AR[item.completenessStatus];
                  return (
                    <tr key={item.key} className="align-top">
                      <td className="px-3 py-2 text-slate-100 font-semibold whitespace-nowrap">
                        <div>{item.nameAr}</div>
                        <div className="text-[10px] font-mono text-slate-400">{item.key}</div>
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums font-bold text-emerald-300 whitespace-nowrap">
                        {item.formattedValue}
                      </td>
                      <td className="px-3 py-2 text-slate-300 min-w-[200px]">
                        <div className="font-mono text-[10px] text-cyan-300">{item.equationAr}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{item.basisLabelAr}</div>
                        {(item.originalSharesBasisLabelAr || item.effectiveSharesBasisLabelAr) && (
                          <div className="text-[10px] mt-1 space-y-0.5">
                            {item.originalSharesBasisLabelAr && (
                              <div className="text-slate-400">
                                الأساس الأصلي المحفوظ:{' '}
                                <span className="text-slate-200">{item.originalSharesBasisLabelAr}</span>
                              </div>
                            )}
                            {item.effectiveSharesBasisLabelAr && (
                              <div
                                className={
                                  item.usedQ1DocumentedEquivalence ? 'text-cyan-300 font-semibold' : 'text-slate-400'
                                }
                              >
                                الأساس الفعلي للحساب: {item.effectiveSharesBasisLabelAr}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-end font-mono tabular-nums text-[10px] text-slate-300 whitespace-nowrap">
                        <div>
                          {item.numeratorLabelAr}: {fmtRawNum(item.numeratorValue)}
                        </div>
                        <div className="text-slate-400">
                          {item.denominatorLabelAr}: {fmtRawNum(item.denominatorValue)}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="font-mono text-[10px] text-slate-200">
                          {item.periodLabel ?? '-'}
                        </div>
                        <div className={`text-[10px] font-semibold mt-0.5 ${statusMeta.cls}`}>
                          {statusMeta.label}
                        </div>
                        {item.isActionAdjusted !== undefined && item.isActionAdjusted !== null && (
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            ActionAdj: {item.isActionAdjusted ? 'TRUE' : 'FALSE'}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-300 min-w-[220px] space-y-0.5">
                        {item.usedByModels.length > 0 && (
                          <div className="text-sky-300">
                            المستهلكون: {item.usedByModels.join(' · ')}
                          </div>
                        )}
                        {item.unavailableReasonAr && (
                          <div className="text-amber-300">{item.unavailableReasonAr}</div>
                        )}
                        {item.remediationAr && (
                          <div className="text-cyan-300">خطوة الاستكمال: {item.remediationAr}</div>
                        )}
                        {item.notesAr.map((n, i) => (
                          <div key={i} className="text-slate-400">
                            {n}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
