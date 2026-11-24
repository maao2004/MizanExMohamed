/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Calculator, AlertCircle, Save } from 'lucide-react';
import {
  CommonEquityBasis,
  CurrencyCode,
  NetIncomeCommonBasis,
  QuarterlyFinancialRecord,
  QuarterlyFinancialRecordWritePayload,
  WeightedAvgSharesBasis,
} from '../../types';
import {
  computeCalendarSpanDays,
  hasExplicitReportedEpsValue,
  inspectWeightedAvgSharesBasis,
  isValidCalendarDate,
  resolveCanonicalReportedEpsPeriod,
  validateAndNormalizeReportedEpsPeriod,
  validateAndNormalizeWeightedAvgSharesBasis,
  validateQuarterlyPeriodInputs,
  WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR,
  WEIGHTED_AVG_SHARES_BASIS_EMPTY_OPTION_AR,
  WEIGHTED_AVG_SHARES_BASIS_OPTIONS,
  WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR,
} from '../../core/contracts';
import {
  buildQuarterlyEditSubmission,
  sanitizeQuarterlyReadRecord,
} from '../../core/domain/quarterlyManualAudit';
import { FcffInputs } from '../../components/FcffInputs';
import { ReportedEpsPeriodFieldset } from '../../shared/ui/ReportedEpsPeriodFieldset';

interface EditQuarterlyRecordModalProps {
  isOpen: boolean;
  onClose: () => void | Promise<void>;
  record: QuarterlyFinancialRecord;
  onSave: (
    updatedRecord: QuarterlyFinancialRecord,
    writePayload?: QuarterlyFinancialRecordWritePayload
  ) => void | Promise<void>;
  focusField?: string | null;
}

const buildCleanRecordState = (rec: QuarterlyFinancialRecord): QuarterlyFinancialRecord => {
  const base = sanitizeQuarterlyReadRecord(rec);
  // When opening a legacy record without structured reportedEpsPeriodType:
  // - Conflicting, ambiguous, or missing-period records with ReportedEPS (including 0 / negative) MUST open explicitly as needs_review (NEVER picking an operational default!)
  // - Unambiguous bare legacy tokens with matching documented boundaries open cleanly with their resolved canonical structure.
  if (!base.reportedEpsPeriodType && (base.reportedEpsPeriod || hasExplicitReportedEpsValue(base.reportedEps))) {
    const resolved = resolveCanonicalReportedEpsPeriod(base);
    if (resolved.status === 'valid' && resolved.period) {
      base.reportedEpsPeriodType = resolved.period.periodType;
      base.reportedEpsFiscalYear = resolved.period.fiscalYear;
      base.reportedEpsFiscalQuarter = resolved.period.fiscalQuarter;
      base.reportedEpsPeriodStart = resolved.period.periodStart;
      base.reportedEpsPeriodEnd = resolved.period.periodEnd;
      base.reportedEpsPeriod = resolved.period.displayLabel;
    } else {
      base.reportedEpsPeriodType = 'needs_review';
      base.reportedEpsFiscalYear = null;
      base.reportedEpsFiscalQuarter = null;
      base.reportedEpsPeriodStart = null;
      base.reportedEpsPeriodEnd = null;
    }
  }
  return base;
};

export const EditQuarterlyRecordModal: React.FC<EditQuarterlyRecordModalProps> = ({
  isOpen,
  onClose,
  record,
  onSave,
  focusField = null,
}) => {
  const [formData, setFormData] = useState<QuarterlyFinancialRecord>(() =>
    buildCleanRecordState(record)
  );
  const [periodDaysAutoSynced, setPeriodDaysAutoSynced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [highlightedField, setHighlightedField] = useState<string | null>(focusField);
  const formRef = useRef<HTMLFormElement | null>(null);

  // Reset form state cleanly whenever the target record or modal open state changes (zero state leakage)
  useEffect(() => {
    if (!isOpen) return;
    setFormData(buildCleanRecordState(record));
    setPeriodDaysAutoSynced(false);
    setSubmitting(false);
    setErrorMsg(null);
    setHighlightedField(focusField ?? null);
  }, [
    isOpen,
    record.ticker,
    record.year,
    record.quarter,
    record.updatedAt,
    record,
    focusField,
  ]);

  // Focus & scroll to the requested target field when opened from MetricAuditCard / DataHubView
  useEffect(() => {
    if (!isOpen || !focusField || !formRef.current) return;
    const candidates = formRef.current.querySelectorAll<HTMLElement>('[data-field]');
    let targetEl: HTMLElement | null = null;
    for (const el of Array.from(candidates)) {
      if (el.getAttribute('data-field') === focusField) {
        targetEl = el;
        break;
      }
    }
    if (!targetEl) return;
    setHighlightedField(focusField);
    if (typeof targetEl.scrollIntoView === 'function') {
      targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    if (typeof targetEl.focus === 'function') {
      targetEl.focus();
    }
  }, [isOpen, focusField, record.ticker, record.year, record.quarter]);

  const liveCalendarSpan = useMemo(() => {
    const start = formData.periodStartDate?.trim() ?? '';
    const end = formData.periodEndDate?.trim() ?? '';
    if (!start || !end) return null;
    if (!isValidCalendarDate(start) || !isValidCalendarDate(end) || start > end) return null;
    const days = computeCalendarSpanDays(start, end);
    return days >= 1 && days <= 370 ? days : null;
  }, [formData.periodStartDate, formData.periodEndDate]);

  const legacyReportedEpsInfo = useMemo(() => {
    if (record.reportedEpsPeriodType && record.reportedEpsPeriodType !== 'needs_review') {
      return { legacyText: null, reasonAr: null };
    }
    const res = resolveCanonicalReportedEpsPeriod(record);
    const legacyText =
      res.legacyText ??
      (record.reportedEpsPeriodType === 'needs_review' ? record.reportedEpsPeriod ?? null : null);
    if (res.status === 'needs_review') {
      const combinedReason = [res.reasonAr, res.remediationAr].filter(Boolean).join(' ');
      return {
        legacyText,
        reasonAr: combinedReason || null,
      };
    }
    if (res.status === 'empty' && hasExplicitReportedEpsValue(record.reportedEps)) {
      return {
        legacyText: null,
        reasonAr:
          'تم تسجيل قيمة ReportedEPS في السجل القديم دون توثيق نوع الفترة؛ فُتح السجل على حالة «غير محدد / يحتاج مراجعة» دون اختيار فترة تشغيلية تلقائياً. اختر نوع الفترة الصريح وتواريخها أو احتفظ بهذه الحالة لحجب المقارنة فقط.',
      };
    }
    return {
      legacyText,
      reasonAr: null,
    };
  }, [record]);

  const sharesBasisInspection = useMemo(
    () => inspectWeightedAvgSharesBasis(formData.weightedAvgSharesBasis),
    [formData.weightedAvgSharesBasis]
  );

  if (!isOpen) return null;

  const fieldRingClass = (field: string): string =>
    highlightedField === field
      ? 'ring-2 ring-amber-400 border-amber-400 bg-amber-950/20'
      : '';

  // Helper to handle numeric inputs preserving BLANK vs 0
  const handleNumberChange = (field: keyof QuarterlyFinancialRecord, valueStr: string) => {
    if (valueStr.trim() === '') {
      setFormData((prev) => ({ ...prev, [field]: null }));
    } else {
      const num = Number(valueStr);
      setFormData((prev) => ({ ...prev, [field]: Number.isFinite(num) ? num : null }));
    }
  };

  const handlePeriodDateChange = (
    which: 'periodStartDate' | 'periodEndDate',
    rawValue: string
  ) => {
    const clean = rawValue.trim() === '' ? null : rawValue.trim();
    setFormData((prev) => {
      const next: QuarterlyFinancialRecord = { ...prev, [which]: clean };
      const s = next.periodStartDate?.trim() ?? '';
      const e = next.periodEndDate?.trim() ?? '';
      const bothValid = Boolean(s && e && isValidCalendarDate(s) && isValidCalendarDate(e) && s <= e);
      if (bothValid) {
        const span = computeCalendarSpanDays(s, e);
        if (span >= 1 && span <= 370 && (prev.periodDays == null || periodDaysAutoSynced)) {
          next.periodDays = span;
          setPeriodDaysAutoSynced(true);
        }
      } else if (periodDaysAutoSynced) {
        next.periodDays = null;
        setPeriodDaysAutoSynced(false);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);

    try {
      if (formData.shares === null || formData.shares === undefined || !Number.isFinite(formData.shares) || formData.shares <= 0) {
        throw new Error('عدد الأسهم الكامل (Shares) مطلوب ويجب أن يكون أكبر من صفر.');
      }
      if (
        formData.weightedAvgSharesYTD !== null &&
        formData.weightedAvgSharesYTD !== undefined &&
        (!Number.isFinite(formData.weightedAvgSharesYTD) || formData.weightedAvgSharesYTD <= 0)
      ) {
        throw new Error('المتوسط المرجح للأسهم (WeightedAvgSharesYTD) يجب أن يكون أكبر من صفر عند إدخاله.');
      }
      if (
        formData.depreciationAmortizationYTD !== null &&
        formData.depreciationAmortizationYTD !== undefined &&
        formData.depreciationAmortizationYTD < 0
      ) {
        throw new Error('الإهلاك والاستنفاد (DA_YTD) يجب أن يكون موجباً أو صفراً.');
      }
      if (
        formData.valuationTaxRate !== null &&
        formData.valuationTaxRate !== undefined &&
        (formData.valuationTaxRate < 0 || formData.valuationTaxRate > 1)
      ) {
        throw new Error('ضريبة التقييم (ValuationTaxRate) يجب أن تكون كسراً عشرياً بين 0 و 1.');
      }

      // Single Source of Truth period validation (real dates, leap years, start <= end, no conflicting periodDays, never fabricating Jan 1)
      const validatedPeriod = validateQuarterlyPeriodInputs({
        periodStartDate: formData.periodStartDate ?? null,
        periodEndDate: formData.periodEndDate ?? null,
        periodDays: formData.periodDays ?? null,
      });

      const validatedReportedEpsPeriod = validateAndNormalizeReportedEpsPeriod({
        reportedEps: formData.reportedEps ?? null,
        reportedEpsPeriodType: formData.reportedEpsPeriodType ?? null,
        reportedEpsFiscalYear: formData.reportedEpsFiscalYear ?? null,
        reportedEpsFiscalQuarter: formData.reportedEpsFiscalQuarter ?? null,
        reportedEpsPeriodStart: formData.reportedEpsPeriodStart ?? null,
        reportedEpsPeriodEnd: formData.reportedEpsPeriodEnd ?? null,
        reportedEpsPeriod: formData.reportedEpsPeriod ?? null,
      });

      const validatedSharesBasis = validateAndNormalizeWeightedAvgSharesBasis(
        formData.weightedAvgSharesBasis ?? null
      );

      const normalizedFormData: QuarterlyFinancialRecord = {
        ...formData,
        weightedAvgSharesBasis: validatedSharesBasis,
        periodStartDate: validatedPeriod.periodStartDate,
        periodEndDate: validatedPeriod.periodEndDate,
        periodDays: validatedPeriod.periodDays,
        reportedEpsPeriodType: validatedReportedEpsPeriod.reportedEpsPeriodType,
        reportedEpsFiscalYear: validatedReportedEpsPeriod.reportedEpsFiscalYear,
        reportedEpsFiscalQuarter: validatedReportedEpsPeriod.reportedEpsFiscalQuarter,
        reportedEpsPeriodStart: validatedReportedEpsPeriod.reportedEpsPeriodStart,
        reportedEpsPeriodEnd: validatedReportedEpsPeriod.reportedEpsPeriodEnd,
        reportedEpsPeriod: validatedReportedEpsPeriod.reportedEpsPeriod,
      };

      const nowIso = new Date().toISOString();
      const { readRecord, writePayload } = buildQuarterlyEditSubmission(
        record,
        normalizedFormData,
        nowIso
      );

      setSubmitting(true);
      await onSave(readRecord, writePayload);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حفظ تعديلات السجل المالي.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="edit-quarterly-record-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-white">
                تعديل وتحديث القائمة المالية: {record.ticker} ({record.quarter} {record.year})
              </h3>
              <p className="text-xs text-slate-400">
                تحديث البيانات في كاش المنصة وقاعدة بيانات Firestore السحابية فوراً مع توثيق التعديلات اليدوية
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body (Scrollable Form) */}
        <form ref={formRef} onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-6">
          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-950/70 border border-red-800 text-xs text-red-200 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <FcffInputs
            record={formData}
            onChange={(updates) => setFormData((prev) => ({ ...prev, ...updates }))}
          />

          <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-xs text-emerald-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              قاعدة النظام المحاسبي: ترك الحقل فارغاً يعني <strong>BLANK (غير مُدخل)</strong>، بينما كتابة{' '}
              <strong>0</strong> تعني صفراً حسابياً فعلياً. تبقى جميع المبالغ وأعداد الأسهم بقيمتها الأساسية دون تحويل تلقائي.
            </span>
          </div>

          {/* Section 0: Period Boundaries, Weighted Avg Shares Basis & Currency */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-400 border-b border-slate-800 pb-1.5">
              0. حدود الفترة المالية وأساس المتوسط المرجح للأسهم (Period Boundaries & Shares Basis)
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              للسنوات المالية غير التقويمية (مثل يوليو–يونيو)، أدخل تاريخي البداية والنهاية معاً لاحتساب الأيام بدقة دون افتراض 1 يناير.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">بداية الفترة (PeriodStartDate):</label>
                <input
                  type="date"
                  data-field="periodStartDate"
                  value={formData.periodStartDate ?? ''}
                  onChange={(e) => handlePeriodDateChange('periodStartDate', e.target.value)}
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('periodStartDate')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">نهاية الفترة (PeriodEndDate):</label>
                <input
                  type="date"
                  data-field="periodEndDate"
                  value={formData.periodEndDate ?? ''}
                  onChange={(e) => handlePeriodDateChange('periodEndDate', e.target.value)}
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('periodEndDate')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  أيام الفترة (PeriodDays):
                  {liveCalendarSpan !== null && (
                    <span className="text-emerald-400 font-mono mr-1">({liveCalendarSpan})</span>
                  )}
                </label>
                <input
                  type="number"
                  step={1}
                  min={1}
                  max={370}
                  data-field="periodDays"
                  value={formData.periodDays ?? ''}
                  onChange={(e) => {
                    setPeriodDaysAutoSynced(false);
                    handleNumberChange('periodDays', e.target.value);
                  }}
                  placeholder="يُحسب تلقائياً"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('periodDays')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">أساس المتوسط المرجح (WeightedAvgShares_Basis):</label>
                <select
                  data-field="weightedAvgSharesBasis"
                  value={
                    sharesBasisInspection.status === 'empty'
                      ? ''
                      : sharesBasisInspection.status === 'valid' && sharesBasisInspection.code
                      ? sharesBasisInspection.code
                      : sharesBasisInspection.rawValue ?? ''
                  }
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      weightedAvgSharesBasis: e.target.value
                        ? (e.target.value as WeightedAvgSharesBasis)
                        : null,
                    }))
                  }
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('weightedAvgSharesBasis')}`}
                >
                  <option value="">{WEIGHTED_AVG_SHARES_BASIS_EMPTY_OPTION_AR}</option>
                  {sharesBasisInspection.status === 'unrecognized' && sharesBasisInspection.rawValue && (
                    <option value={sharesBasisInspection.rawValue}>
                      قيمة محفوظة غير معروفة ({sharesBasisInspection.rawValue}) — اختر أساساً معتمداً أو اتركه فارغاً
                    </option>
                  )}
                  {WEIGHTED_AVG_SHARES_BASIS_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.selectLabelAr}
                    </option>
                  ))}
                </select>
                {sharesBasisInspection.status === 'unrecognized' && sharesBasisInspection.rawValue ? (
                  <p className="mt-1 text-[10px] text-amber-300 leading-relaxed">
                    القيمة المحفوظة الحالية ({sharesBasisInspection.rawValue}) غير معروفة ولم يُختر أول خيار تلقائياً؛ اختر رمزاً معتمداً أو اترك الحقل فارغاً قبل الحفظ.
                  </p>
                ) : sharesBasisInspection.option ? (
                  <p className="mt-1 text-[10px] text-slate-400 leading-relaxed">
                    {sharesBasisInspection.option.meaningAr} {sharesBasisInspection.option.usageLimitsAr}
                  </p>
                ) : null}
                <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">
                  {WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR}
                </p>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">عملة القوائم (اختياري):</label>
                <select
                  data-field="financialCurrency"
                  value={formData.financialCurrency ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      financialCurrency: e.target.value
                        ? (e.target.value as CurrencyCode)
                        : null,
                    }))
                  }
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('financialCurrency')}`}
                >
                  <option value="">غير محددة (BLANK)</option>
                  <option value="EGP">EGP (جنيه مصري)</option>
                  <option value="USD">USD (دولار أمريكي)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Section 1: Income Statement Metrics (قائمة الدخل YTD) */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 border-b border-slate-800 pb-1.5">
              1. مؤشرات قائمة الدخل التراكمية (Income Statement YTD) — بالقيمة الأساسية
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">الإيرادات (Revenue YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="revenueYTD"
                  value={formData.revenueYTD ?? ''}
                  onChange={(e) => handleNumberChange('revenueYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('revenueYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">مجمل الربح (Gross Profit YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="grossProfitYTD"
                  value={formData.grossProfitYTD ?? ''}
                  onChange={(e) => handleNumberChange('grossProfitYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('grossProfitYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">الربح التشغيلي (EBIT YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="ebitYTD"
                  value={formData.ebitYTD ?? ''}
                  onChange={(e) => handleNumberChange('ebitYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('ebitYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">الأرباح قبل الضريبة (PBT YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="pbtYTD"
                  value={formData.pbtYTD ?? ''}
                  onChange={(e) => handleNumberChange('pbtYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('pbtYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold text-emerald-400">صافي الربح (Net Income YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="netIncomeYTD"
                  value={formData.netIncomeYTD ?? ''}
                  onChange={(e) => handleNumberChange('netIncomeYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-emerald-700/60 rounded-lg px-3 py-2 font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-500 ${fieldRingClass('netIncomeYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">مصروف الضريبة (Tax Expense YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="taxExpenseYTD"
                  value={formData.taxExpenseYTD ?? ''}
                  onChange={(e) => handleNumberChange('taxExpenseYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('taxExpenseYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold text-sky-300">
                  صافي ربح المساهمين العاديين (NetIncomeCommon YTD):
                </label>
                <input
                  type="number"
                  step="any"
                  data-field="netIncomeCommonYTD"
                  value={formData.netIncomeCommonYTD ?? ''}
                  onChange={(e) => handleNumberChange('netIncomeCommonYTD', e.target.value)}
                  placeholder="BLANK (مطلوب لحساب الاحتجاز والتقييم بدقة)"
                  className={`w-full bg-slate-950 border border-sky-800/60 rounded-lg px-3 py-2 font-mono text-sky-200 focus:outline-none focus:border-emerald-500 ${fieldRingClass('netIncomeCommonYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  أساس صافي ربح المساهمين العاديين (NetIncomeCommon_Basis):
                </label>
                <select
                  data-field="netIncomeCommonBasis"
                  value={formData.netIncomeCommonBasis ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      netIncomeCommonBasis: e.target.value
                        ? (e.target.value as NetIncomeCommonBasis)
                        : null,
                    }))
                  }
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('netIncomeCommonBasis')}`}
                >
                  <option value="">غير محدد (يوقف الاعتماد الصامت على NetIncomeYTD)</option>
                  <option value="explicit_common">explicit_common (مسجل صراحةً للشركة الأم)</option>
                  <option value="attested_net_income_equals_common">
                    attested_net_income_equals_common (إقرار موثق بتطابق NetIncomeYTD)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  ملاحظة توثيق أساس ربح العاديين (NetIncomeCommon_Note):
                </label>
                <input
                  type="text"
                  maxLength={400}
                  data-field="netIncomeCommonNote"
                  value={formData.netIncomeCommonNote ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      netIncomeCommonNote: e.target.value.trim() === '' ? null : e.target.value,
                    }))
                  }
                  placeholder="مثال: قوائم مستقلة بدون حقوق أقلية"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('netIncomeCommonNote')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  المتوسط المرجح للأسهم (WeightedAvgShares YTD — عدد أسهم):
                </label>
                <input
                  type="number"
                  step="any"
                  data-field="weightedAvgSharesYTD"
                  value={formData.weightedAvgSharesYTD ?? ''}
                  onChange={(e) => handleNumberChange('weightedAvgSharesYTD', e.target.value)}
                  placeholder="BLANK (عدد أسهم كامل وليس EPS)"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('weightedAvgSharesYTD')}`}
                />
                <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">
                  {WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR}
                </p>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">ربحية السهم المعلنة (ReportedEPS):</label>
                <input
                  type="number"
                  step="any"
                  data-field="reportedEps"
                  value={formData.reportedEps ?? ''}
                  onChange={(e) => handleNumberChange('reportedEps', e.target.value)}
                  placeholder="BLANK (من قائمة الدخل)"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('reportedEps')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">مصدر EPS المعلنة (ReportedEPS_Source):</label>
                <input
                  type="text"
                  maxLength={200}
                  data-field="reportedEpsSource"
                  value={formData.reportedEpsSource ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      reportedEpsSource: e.target.value.trim() === '' ? null : e.target.value,
                    }))
                  }
                  placeholder="مثال: القوائم المجمعة المدققة"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('reportedEpsSource')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">معدل لأحداث رأس المال (IsCapitalActionAdjusted):</label>
                <select
                  data-field="isCapitalActionAdjusted"
                  value={
                    formData.isCapitalActionAdjusted === true
                      ? 'true'
                      : formData.isCapitalActionAdjusted === false
                      ? 'false'
                      : ''
                  }
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      isCapitalActionAdjusted:
                        e.target.value === 'true'
                          ? true
                          : e.target.value === 'false'
                          ? false
                          : null,
                    }))
                  }
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('isCapitalActionAdjusted')}`}
                >
                  <option value="">غير محدد (BLANK)</option>
                  <option value="true">نعم — معدل رأسمالياً (TRUE)</option>
                  <option value="false">لا — غير معدل (FALSE)</option>
                </select>
              </div>

              <ReportedEpsPeriodFieldset
                value={{
                  reportedEpsPeriodType: formData.reportedEpsPeriodType ?? null,
                  reportedEpsFiscalYear: formData.reportedEpsFiscalYear ?? null,
                  reportedEpsFiscalQuarter: formData.reportedEpsFiscalQuarter ?? null,
                  reportedEpsPeriodStart: formData.reportedEpsPeriodStart ?? null,
                  reportedEpsPeriodEnd: formData.reportedEpsPeriodEnd ?? null,
                  reportedEpsPeriod: formData.reportedEpsPeriod ?? null,
                }}
                onChange={(nextPeriod) =>
                  setFormData((prev) => ({
                    ...prev,
                    ...nextPeriod,
                  }))
                }
                recordYear={formData.year}
                recordQuarter={formData.quarter}
                recordPeriodStartDate={formData.periodStartDate ?? null}
                recordPeriodEndDate={formData.periodEndDate ?? null}
                legacyReferenceText={legacyReportedEpsInfo.legacyText}
                legacyReviewReasonAr={legacyReportedEpsInfo.reasonAr}
                highlightClass={
                  highlightedField === 'reportedEpsPeriod' ||
                  highlightedField === 'reportedEpsPeriodType'
                    ? 'ring-2 ring-amber-400 border-amber-400'
                    : ''
                }
              />
            </div>
          </div>

          {/* Section 2: Cash Flow & CapEx (التدفقات النقدية والاستثمار) */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-teal-400 border-b border-slate-800 pb-1.5">
              2. التدفقات النقدية والإنفاق الرأسمالي (Cash Flow & CapEx) — بالقيمة الأساسية
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">التدفق التشغيلي (OCF YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="ocfYTD"
                  value={formData.ocfYTD ?? ''}
                  onChange={(e) => handleNumberChange('ocfYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('ocfYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">الإنفاق الرأسمالي (CapEx YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="capexYTD"
                  value={formData.capexYTD ?? ''}
                  onChange={(e) => handleNumberChange('capexYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('capexYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">صافي التدفق الاستثماري (Net Investing CF):</label>
                <input
                  type="number"
                  step="any"
                  data-field="netInvestingCfYTD"
                  value={formData.netInvestingCfYTD ?? ''}
                  onChange={(e) => handleNumberChange('netInvestingCfYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('netInvestingCfYTD')}`}
                />
              </div>
            </div>
          </div>

          {/* Section 3: Balance Sheet & Capital (الميزانية العمومية والسيولة) */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 border-b border-slate-800 pb-1.5">
              3. الميزانية العمومية ورأس المال (Balance Sheet & Liquidity)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">حقوق الملكية (Total Equity):</label>
                <input
                  type="number"
                  step="any"
                  data-field="equity"
                  value={formData.equity ?? ''}
                  onChange={(e) => handleNumberChange('equity', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono font-semibold text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('equity')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold text-sky-300">
                  حقوق المساهمين العاديين (EquityCommon):
                </label>
                <input
                  type="number"
                  step="any"
                  data-field="equityCommon"
                  value={formData.equityCommon ?? ''}
                  onChange={(e) => handleNumberChange('equityCommon', e.target.value)}
                  placeholder="BLANK (لفصل حقوق الأقلية عن BVPS/ROE)"
                  className={`w-full bg-slate-950 border border-sky-800/60 rounded-lg px-3 py-2 font-mono text-sky-200 focus:outline-none focus:border-emerald-500 ${fieldRingClass('equityCommon')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  أساس حقوق المساهمين العاديين (EquityCommon_Basis):
                </label>
                <select
                  data-field="equityCommonBasis"
                  value={formData.equityCommonBasis ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      equityCommonBasis: e.target.value
                        ? (e.target.value as CommonEquityBasis)
                        : null,
                    }))
                  }
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('equityCommonBasis')}`}
                >
                  <option value="">غير محدد (يُميز كـ إجمالي غير موثق للفصل)</option>
                  <option value="explicit_common">explicit_common (مسجلة صراحة للشركة الأم)</option>
                  <option value="attested_total_equals_common">
                    attested_total_equals_common (إقرار موثق بتطابق Equity الكلي)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  ملاحظة توثيق حقوق العاديين (EquityCommon_Note):
                </label>
                <input
                  type="text"
                  maxLength={400}
                  data-field="equityCommonNote"
                  value={formData.equityCommonNote ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      equityCommonNote: e.target.value.trim() === '' ? null : e.target.value,
                    }))
                  }
                  placeholder="مثال: حقوق مساهمي الشركة الأم دون الأقلية"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('equityCommonNote')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">إجمالي الأصول (Total Assets):</label>
                <input
                  type="number"
                  step="any"
                  data-field="totalAssets"
                  value={formData.totalAssets ?? ''}
                  onChange={(e) => handleNumberChange('totalAssets', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('totalAssets')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">الأصول غير الملموسة (Intangible Assets):</label>
                <input
                  type="number"
                  step="any"
                  data-field="intangibleAssets"
                  value={formData.intangibleAssets ?? ''}
                  onChange={(e) => handleNumberChange('intangibleAssets', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('intangibleAssets')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">النقدية وما في حكمها (Cash):</label>
                <input
                  type="number"
                  step="any"
                  data-field="cash"
                  value={formData.cash ?? ''}
                  onChange={(e) => handleNumberChange('cash', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('cash')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">إجمالي الديون (Total Debt Without TX):</label>
                <input
                  type="number"
                  step="any"
                  data-field="totalDebtWithoutTX"
                  value={formData.totalDebtWithoutTX ?? ''}
                  onChange={(e) => handleNumberChange('totalDebtWithoutTX', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('totalDebtWithoutTX')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">إجمالي الالتزامات (Total Liabilities):</label>
                <input
                  type="number"
                  step="any"
                  data-field="totalLiabilities"
                  value={formData.totalLiabilities ?? ''}
                  onChange={(e) => handleNumberChange('totalLiabilities', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('totalLiabilities')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold text-amber-400">عدد الأسهم الكامل (Shares):</label>
                <input
                  type="number"
                  step="any"
                  data-field="shares"
                  value={formData.shares ?? ''}
                  onChange={(e) => handleNumberChange('shares', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono font-bold text-amber-300 focus:outline-none focus:border-emerald-500 ${fieldRingClass('shares')}`}
                />
              </div>
            </div>
          </div>

          {/* Section 4: Dividends Paid & Financing Costs (التوزيعات المدفوعة وتكاليف التمويل) */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-purple-400 border-b border-slate-800 pb-1.5">
              4. التوزيعات المدفوعة وتكاليف التمويل (Dividends Paid & Financing)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">التوزيعات المدفوعة YTD (Dividends Paid):</label>
                <input
                  type="number"
                  step="any"
                  data-field="dividendsPaidYTD"
                  value={formData.dividendsPaidYTD ?? ''}
                  onChange={(e) => handleNumberChange('dividendsPaidYTD', e.target.value)}
                  placeholder="BLANK (تراكمي لا يجمع)"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('dividendsPaidYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">مصروف الفائدة (Interest Expense YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="interestExpenseYTD"
                  value={formData.interestExpenseYTD ?? ''}
                  onChange={(e) => handleNumberChange('interestExpenseYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('interestExpenseYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">تكاليف التمويل (Finance Costs YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="financeCostsYTD"
                  value={formData.financeCostsYTD ?? ''}
                  onChange={(e) => handleNumberChange('financeCostsYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('financeCostsYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">إيراد الفائدة (Interest Income YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="interestIncomeYTD"
                  value={formData.interestIncomeYTD ?? ''}
                  onChange={(e) => handleNumberChange('interestIncomeYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('interestIncomeYTD')}`}
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">الفوائد المدفوعة (Interest Paid YTD):</label>
                <input
                  type="number"
                  step="any"
                  data-field="interestPaidYTD"
                  value={formData.interestPaidYTD ?? ''}
                  onChange={(e) => handleNumberChange('interestPaidYTD', e.target.value)}
                  placeholder="BLANK"
                  className={`w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500 ${fieldRingClass('interestPaidYTD')}`}
                />
              </div>
            </div>
          </div>

          {/* Submit Actions */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              إلغاء
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-950/40 transition-all disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{submitting ? 'جارٍ الحفظ...' : 'حفظ التعديلات في قاعدة بيانات Firestore'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
