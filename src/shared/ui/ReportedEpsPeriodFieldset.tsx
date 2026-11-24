/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { AlertTriangle, Calendar, Info } from 'lucide-react';
import {
  formatReportedEpsPeriodDisplay,
  getReportedEpsPeriodOption,
  QuarterlyRecordQuarter,
  REPORTED_EPS_PERIOD_OPTIONS,
  ReportedEpsFiscalQuarter,
  ReportedEpsPeriodType,
  suggestReportedEpsPeriodDates,
} from '../../core/contracts';

export interface ReportedEpsPeriodFieldValue {
  reportedEpsPeriodType: ReportedEpsPeriodType | null;
  reportedEpsFiscalYear: number | null;
  reportedEpsFiscalQuarter: ReportedEpsFiscalQuarter | null;
  reportedEpsPeriodStart: string | null;
  reportedEpsPeriodEnd: string | null;
  reportedEpsPeriod: string | null;
}

interface ReportedEpsPeriodFieldsetProps {
  value: ReportedEpsPeriodFieldValue;
  onChange: (next: ReportedEpsPeriodFieldValue) => void;
  recordYear: number | null;
  recordQuarter: QuarterlyRecordQuarter | null;
  recordPeriodStartDate?: string | null;
  recordPeriodEndDate?: string | null;
  legacyReferenceText?: string | null;
  legacyReviewReasonAr?: string | null;
  highlightClass?: string;
}

export const ReportedEpsPeriodFieldset: React.FC<ReportedEpsPeriodFieldsetProps> = ({
  value,
  onChange,
  recordYear,
  recordQuarter,
  recordPeriodStartDate,
  recordPeriodEndDate,
  legacyReferenceText = null,
  legacyReviewReasonAr = null,
  highlightClass = '',
}) => {
  const selectedOption = useMemo(
    () => getReportedEpsPeriodOption(value.reportedEpsPeriodType),
    [value.reportedEpsPeriodType]
  );

  const suggestedDates = useMemo(
    () =>
      suggestReportedEpsPeriodDates({
        periodType: value.reportedEpsPeriodType,
        fiscalYear: value.reportedEpsFiscalYear,
        fiscalQuarter: value.reportedEpsFiscalQuarter,
        recordYear,
        recordQuarter,
        recordPeriodStartDate,
        recordPeriodEndDate,
      }),
    [
      value.reportedEpsPeriodType,
      value.reportedEpsFiscalYear,
      value.reportedEpsFiscalQuarter,
      recordYear,
      recordQuarter,
      recordPeriodStartDate,
      recordPeriodEndDate,
    ]
  );

  const derivedDisplay = useMemo(() => {
    if (!value.reportedEpsPeriodType) {
      return value.reportedEpsPeriod || 'غير محدد (BLANK)';
    }
    return formatReportedEpsPeriodDisplay({
      periodType: value.reportedEpsPeriodType,
      fiscalYear: value.reportedEpsFiscalYear,
      fiscalQuarter: value.reportedEpsFiscalQuarter,
      periodStart: value.reportedEpsPeriodStart,
      periodEnd: value.reportedEpsPeriodEnd,
      legacyText:
        value.reportedEpsPeriodType === 'needs_review'
          ? legacyReferenceText || value.reportedEpsPeriod
          : null,
    });
  }, [value, legacyReferenceText]);

  const emitWithDerived = (partial: Partial<ReportedEpsPeriodFieldValue>) => {
    const merged: ReportedEpsPeriodFieldValue = {
      ...value,
      ...partial,
    };
    if (merged.reportedEpsPeriodType && merged.reportedEpsPeriodType !== 'needs_review') {
      merged.reportedEpsPeriod = formatReportedEpsPeriodDisplay({
        periodType: merged.reportedEpsPeriodType,
        fiscalYear: merged.reportedEpsFiscalYear,
        fiscalQuarter: merged.reportedEpsFiscalQuarter,
        periodStart: merged.reportedEpsPeriodStart,
        periodEnd: merged.reportedEpsPeriodEnd,
      });
    } else if (merged.reportedEpsPeriodType === 'needs_review') {
      merged.reportedEpsPeriod = legacyReferenceText || merged.reportedEpsPeriod || null;
    } else {
      merged.reportedEpsPeriod = null;
    }
    onChange(merged);
  };

  const handleTypeChange = (rawCode: string) => {
    const nextType = rawCode ? (rawCode as ReportedEpsPeriodType) : null;
    if (!nextType) {
      onChange({
        reportedEpsPeriodType: null,
        reportedEpsFiscalYear: null,
        reportedEpsFiscalQuarter: null,
        reportedEpsPeriodStart: null,
        reportedEpsPeriodEnd: null,
        reportedEpsPeriod: null,
      });
      return;
    }
    if (nextType === 'needs_review') {
      onChange({
        reportedEpsPeriodType: 'needs_review',
        reportedEpsFiscalYear: null,
        reportedEpsFiscalQuarter: null,
        reportedEpsPeriodStart: null,
        reportedEpsPeriodEnd: null,
        reportedEpsPeriod: legacyReferenceText || null,
      });
      return;
    }
    const opt = getReportedEpsPeriodOption(nextType);
    const nextYear =
      opt?.requiresFiscalYear
        ? value.reportedEpsFiscalYear ?? recordYear ?? null
        : nextType === 'ttm'
        ? null
        : value.reportedEpsFiscalYear;
    const currentQuarterAllowed =
      opt?.requiresFiscalQuarter &&
      value.reportedEpsFiscalQuarter &&
      opt.allowedQuarters.includes(value.reportedEpsFiscalQuarter);
    const nextQuarter: ReportedEpsFiscalQuarter | null = opt?.requiresFiscalQuarter
      ? currentQuarterAllowed
        ? value.reportedEpsFiscalQuarter
        : null
      : null;

    emitWithDerived({
      reportedEpsPeriodType: nextType,
      reportedEpsFiscalYear: nextYear,
      reportedEpsFiscalQuarter: nextQuarter,
      reportedEpsPeriodStart: value.reportedEpsPeriodStart,
      reportedEpsPeriodEnd: value.reportedEpsPeriodEnd,
    });
  };

  return (
    <div
      data-testid="reported-eps-period-fieldset"
      className={`col-span-full rounded-xl bg-slate-950/70 border border-slate-800 p-3.5 space-y-3 text-xs ${highlightClass}`}
      dir="rtl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
        <div className="font-bold text-cyan-300 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-cyan-400" />
          <span>تعريف فترة ربحية السهم المعلنة (ReportedEPS Period — عقد مقيد)</span>
        </div>
        {suggestedDates && (
          <button
            type="button"
            data-testid="suggest-reported-eps-dates-btn"
            onClick={() =>
              emitWithDerived({
                reportedEpsPeriodStart: suggestedDates.periodStart,
                reportedEpsPeriodEnd: suggestedDates.periodEnd,
              })
            }
            className="px-2.5 py-1 rounded-lg bg-cyan-950/70 hover:bg-cyan-900/70 border border-cyan-700/60 text-[11px] font-semibold text-cyan-200 transition-colors"
            title={suggestedDates.sourceNoteAr}
          >
            اقتراح التواريخ الموثقة ({suggestedDates.periodStart} → {suggestedDates.periodEnd})
          </button>
        )}
      </div>

      {value.reportedEpsPeriodType === 'needs_review' && (legacyReferenceText || legacyReviewReasonAr) && (
        <div
          data-testid="reported-eps-legacy-review-banner"
          className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-700/60 text-[11px] text-amber-200 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold text-amber-300">
              سجل قديم يحتاج مراجعة صريحة (لم يتم اختيار نوع افتراضي تلقائياً)
            </div>
            {legacyReferenceText && (
              <div>
                النص الموروث للرجوع إليه: <span className="font-mono text-amber-100">{legacyReferenceText}</span>
              </div>
            )}
            {legacyReviewReasonAr && <div className="text-amber-200/90">{legacyReviewReasonAr}</div>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-slate-400 mb-1">
            نوع فترة ReportedEPS (ReportedEPS_PeriodType):
          </label>
          <select
            data-field="reportedEpsPeriodType"
            data-testid="reported-eps-period-type-select"
            value={value.reportedEpsPeriodType ?? ''}
            onChange={(e) => handleTypeChange(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
          >
            <option value="">غير محدد (BLANK)</option>
            {REPORTED_EPS_PERIOD_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.labelAr}
              </option>
            ))}
          </select>
        </div>

        {selectedOption?.requiresFiscalYear && (
          <div>
            <label className="block text-slate-400 mb-1">
              السنة المالية (FiscalYear):
            </label>
            <input
              type="number"
              step={1}
              min={1900}
              max={2200}
              data-field="reportedEpsFiscalYear"
              data-testid="reported-eps-fiscal-year-input"
              value={value.reportedEpsFiscalYear ?? ''}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const parsed = raw === '' ? null : Number(raw);
                emitWithDerived({
                  reportedEpsFiscalYear:
                    parsed !== null && Number.isFinite(parsed) ? Math.trunc(parsed) : null,
                });
              }}
              placeholder="مثال: 2026"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
        )}

        {selectedOption?.requiresFiscalQuarter && (
          <div>
            <label className="block text-slate-400 mb-1">
              الربع المالي (FiscalQuarter):
            </label>
            <select
              data-field="reportedEpsFiscalQuarter"
              data-testid="reported-eps-fiscal-quarter-select"
              value={value.reportedEpsFiscalQuarter ?? ''}
              onChange={(e) =>
                emitWithDerived({
                  reportedEpsFiscalQuarter: e.target.value
                    ? (e.target.value as ReportedEpsFiscalQuarter)
                    : null,
                })
              }
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              <option value="">اختر الربع...</option>
              {selectedOption.allowedQuarters.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </div>
        )}

        {value.reportedEpsPeriodType && value.reportedEpsPeriodType !== 'needs_review' && (
          <>
            <div>
              <label className="block text-slate-400 mb-1">
                بداية فترة EPS (PeriodStart):
              </label>
              <input
                type="date"
                data-field="reportedEpsPeriodStart"
                data-testid="reported-eps-period-start-input"
                value={value.reportedEpsPeriodStart ?? ''}
                onChange={(e) =>
                  emitWithDerived({
                    reportedEpsPeriodStart: e.target.value.trim() || null,
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">
                نهاية فترة EPS (PeriodEnd):
              </label>
              <input
                type="date"
                data-field="reportedEpsPeriodEnd"
                data-testid="reported-eps-period-end-input"
                value={value.reportedEpsPeriodEnd ?? ''}
                onChange={(e) =>
                  emitWithDerived({
                    reportedEpsPeriodEnd: e.target.value.trim() || null,
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </>
        )}
      </div>

      {/* Auto-derived Read-Only Display */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-800">
        <span className="text-[11px] text-slate-400">
          الوصف المشتق تلقائياً للعرض فقط (ReportedEPS_Period):
        </span>
        <span
          data-field="reportedEpsPeriod"
          data-testid="reported-eps-period-derived"
          className="font-mono text-[11px] font-semibold text-emerald-300"
        >
          {derivedDisplay}
        </span>
      </div>

      {/* Concise Domain Guidance */}
      <div className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
        <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          {selectedOption ? (
            <div className="text-slate-300">{selectedOption.descriptionAr}</div>
          ) : null}
          <div>
            <strong>الفرق الأساسي:</strong> «ربع مالي منفرد» يخص 3 أشهر فقط (مثل Q3 منفرد أو Q4 منفرد)، بينما «تراكمي YTD» يبدأ من أول السنة المالية حتى نهاية الربع، و«سنة مالية كاملة FY» تخص 12 شهراً كاملة. في <strong>Q1</strong> فقط تتطابق حدود Q1 المنفرد مع Q1 التراكمي عند توثيق التواريخ دون إعادة تصنيف. فترة ReportedEPS مستقلة عن فترة السجل المالي ولا تُحوّل أو تُسنّون قيمتها.
          </div>
        </div>
      </div>
    </div>
  );
};
