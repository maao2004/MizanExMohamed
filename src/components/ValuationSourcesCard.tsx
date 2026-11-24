/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  FileCheck2,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  CurrencyCode,
  ModelWeightsBreakdown,
  ValuationSourcesSummary,
} from '../types/financial';
import { getSectorClassificationLabelAr } from '../core/domain/valuationAssumptions';

interface ValuationSourcesCardProps {
  summary?: ValuationSourcesSummary | null;
}

const formatAssumptionValue = (
  val: number | null,
  unitOrFormat?: 'pct' | 'multiple' | 'number' | 'mode'
): string => {
  if (val === null) return 'غير متاح';
  if (unitOrFormat === 'pct') return `${(val * 100).toFixed(2)}%`;
  if (unitOrFormat === 'multiple') return `${val.toFixed(2)}x`;
  if (unitOrFormat === 'mode') return `النمط ${val}`;
  return Number.isInteger(val) ? String(val) : val.toFixed(2);
};

const formatSourceLabel = (source: 'company' | 'global' | 'missing'): string => {
  if (source === 'company') return 'خاص بالشركة';
  if (source === 'global') return 'عام محفوظ';
  return 'غير متاح';
};

const formatCurrencyTag = (cur: CurrencyCode | 'UNSUPPORTED' | null | undefined): string => {
  if (cur === 'EGP') return 'ج.م (EGP)';
  if (cur === 'USD') return 'دولار (USD)';
  if (cur === 'UNSUPPORTED') return 'عملة غير مدعومة';
  return 'غير محددة';
};

const formatCurrencySuffix = (cur: CurrencyCode | 'UNSUPPORTED' | null | undefined): string => {
  if (cur === 'EGP') return 'ج.م';
  if (cur === 'USD') return 'USD';
  return '';
};

const formatAmountUnitAr = (unit: string | null | undefined): string => {
  if (unit === 'base' || unit === 'EGP_base' || unit === 'USD_base') return 'قيمة أساسية كما أُدخلت';
  if (unit === 'EGP_millions') return 'سجل قديم (EGP_millions)';
  if (unit === 'USD_millions') return 'سجل قديم (USD_millions)';
  return 'قيمة أساسية (افتراضي)';
};

const formatRfMethodologyLabel = (
  rf: ValuationSourcesSummary['rfMethodology']
): string => {
  if (rf === 'sovereign_yield') return 'عائد سيادي خام (sovereign_yield)';
  if (rf === 'default_free') return 'خالٍ من التعثر السيادي (default_free)';
  if (rf === 'synthetic') return 'عائد تركيبي (synthetic)';
  return 'غير مصنفة صراحةً (unspecified)';
};

const MODEL_WEIGHT_LABELS: Array<{ key: keyof ModelWeightsBreakdown; label: string }> = [
  { key: 'dcf', label: 'DCF' },
  { key: 'ddm', label: 'DDM' },
  { key: 'rim', label: 'RIM' },
  { key: 'relative', label: 'نسبي' },
  { key: 'graham', label: 'جراهام' },
];

export const ValuationSourcesCard: React.FC<ValuationSourcesCardProps> = ({ summary }) => {
  if (!summary) return null;

  const marketPriceSourceAr =
    summary.marketPriceSource === 'lastPrice'
      ? 'آخر سعر (Last Price)'
      : summary.marketPriceSource === 'closePrice'
      ? 'إقفال اليوم (Close Price)'
      : 'غير متاح';

  const sharesSourceAr =
    summary.sharesSource === 'quarterly_record'
      ? `سجل ربع سنوي${summary.sharesPeriod ? ` (${summary.sharesPeriod})` : ''}`
      : summary.sharesSource === 'daily_listed_shares'
      ? `الأسهم المدرجة اليومية${summary.sharesPeriod ? ` (${summary.sharesPeriod})` : ''}`
      : summary.sharesSource === 'company_metadata'
      ? 'بيانات الشركة الوصفية'
      : 'غير متاح';

  const priorityLabel =
    summary.assumptionPriority === 'global_first'
      ? 'الأولوية: الافتراض العام أولاً'
      : 'الأولوية: تخصيص الشركة أولاً';

  const betaBadgeText =
    summary.betaStatus === 'actual'
      ? `بيتا فعلية (${summary.betaSource || 'beta_assumptions'}${summary.betaAsOfDate ? ` · ${summary.betaAsOfDate}` : ''})`
      : summary.betaStatus === 'defaulted_missing'
      ? 'بيتا مفترضة = 1 (بعد تأكيد غياب السجل)'
      : 'تعذر تأكيد سجل بيتا من الخادم';

  const tvMethodLabel =
    summary.terminalValueMethod === 'exit_multiple'
      ? 'مضاعف الخروج (EV/EBITDA)'
      : 'النمو الدائم (g)';

  const fairValueSuffix = formatCurrencySuffix(summary.financialCurrency);
  const marketPriceSuffix = formatCurrencySuffix(summary.marketPriceCurrency);
  const invalidGlobals = summary.invalidGlobalParameters ?? [];
  const configuredWeights = summary.configuredWeights ?? { dcf: 0, ddm: 0, rim: 0, relative: 0, graham: 0 };
  const activeWeights = summary.activeWeights ?? configuredWeights;

  return (
    <section
      aria-label="مصادر التقييم واكتمال المدخلات"
      className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden text-xs divide-y divide-slate-800"
      dir="rtl"
    >
      {/* Header Bar */}
      <div className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950/60">
        <div className="flex items-center gap-2">
          <FileCheck2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <h3 className="text-sm font-bold text-white">
            ملخص مصادر التقييم واكتمال المدخلات الفعلية — <span className="font-mono">{summary.ticker}</span>
          </h3>
        </div>
        <div className="text-[11px] font-medium text-slate-300 font-mono">
          {priorityLabel}
        </div>
      </div>

      {/* Explicit Blocking / Governance Alerts */}
      {(summary.currencyConsistencyBlockedReasonAr ||
        summary.singleModelWarningAr ||
        summary.sectorPeConflictDetected ||
        summary.betaPolicyConflictAr ||
        invalidGlobals.length > 0) && (
        <div className="divide-y divide-slate-800">
          {summary.currencyConsistencyBlockedReasonAr && (
            <div
              role="alert"
              className="px-5 py-3 bg-red-950/40 text-red-200 flex items-start gap-2.5 leading-relaxed"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <span className="font-bold text-red-300">حجب سلامة العملات والوحدات: </span>
                <span>{summary.currencyConsistencyBlockedReasonAr}</span>
              </div>
            </div>
          )}

          {summary.betaPolicyConflictAr && (
            <div
              role="alert"
              className="px-5 py-2.5 bg-amber-950/40 text-amber-200 flex items-start gap-2.5 leading-relaxed"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <span className="font-bold text-amber-300">تنبيه تعارض سياسة Beta_Default: </span>
                <span>{summary.betaPolicyConflictAr}</span>
              </div>
            </div>
          )}

          {summary.sectorPeConflictDetected && (
            <div
              role="alert"
              className="px-5 py-2.5 bg-red-950/30 text-red-200 flex items-start gap-2.5 leading-relaxed"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <span className="font-bold text-red-300">تعارض مضاعف ربحية القطاع (Sector P/E): </span>
                <span>{summary.sectorPeLookupReasonAr}</span>
                {summary.sectorPeConflictingEntries && summary.sectorPeConflictingEntries.length > 0 && (
                  <div className="font-mono text-[10px] text-red-200/90 mt-0.5">
                    {summary.sectorPeConflictingEntries.map((e) => `${e.key}=${e.value}x`).join(' | ')}
                  </div>
                )}
              </div>
            </div>
          )}

          {summary.singleModelWarningAr && (
            <div className="px-5 py-2.5 bg-amber-950/30 text-amber-200 flex items-start gap-2.5 leading-relaxed">
              <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <span>{summary.singleModelWarningAr}</span>
            </div>
          )}

          {invalidGlobals.length > 0 && (
            <div className="px-5 py-2.5 bg-amber-950/30 text-amber-200 space-y-1">
              <div className="font-bold text-amber-300">معاملات عامة مخالفة للنطاق (تم تجاهلها):</div>
              {invalidGlobals.map((ig) => (
                <div key={ig.key} className="font-mono text-[11px]">
                  • {ig.key}: <span className="font-sans">{ig.reasonAr}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sections 1-4: Structural Flat Grid (Periods, Currencies, Shares/EPS/ROE, FCFF & Beta/Rf) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-slate-800">
        {/* 1. Latest Period & Market Price */}
        <div className="p-4 space-y-2">
          <div className="text-[11px] font-semibold text-slate-400">1. آخر فترة مالية والتداول</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">الفترة المالية:</span>
            <span className="font-mono tabular-nums font-bold text-white">
              {summary.latestFinancialPeriod ?? 'غير متاح'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">تاريخ السجل:</span>
            <span className="font-mono tabular-nums text-slate-300">
              {summary.latestFinancialPeriodDate ?? 'غير محدد'}
            </span>
          </div>
          <div className="pt-1.5 border-t border-slate-800/70 space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-slate-400">السعر السوقي:</span>
              <span className="font-mono tabular-nums font-bold text-emerald-400">
                {summary.marketPrice !== null
                  ? `${summary.marketPrice.toFixed(2)}${marketPriceSuffix ? ` ${marketPriceSuffix}` : ''}`
                  : 'غير متاح'}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-slate-400">جلسة السعر والمصدر:</span>
              <span className="font-mono tabular-nums text-slate-300">
                {summary.priceSessionDate ?? summary.marketPriceDate ?? 'غير متاح'} · {marketPriceSourceAr}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-slate-400">تاريخ التقييم المعتمد:</span>
              <span className="font-mono tabular-nums text-emerald-300">
                {summary.valuationDate ?? 'غير محدد'}
              </span>
            </div>
            {summary.historicalRestatementLimitationAr && (
              <div className="text-[10px] text-slate-400 leading-relaxed pt-1">
                {summary.historicalRestatementLimitationAr}
              </div>
            )}
            {summary.providerMarketCapThousands !== null &&
              summary.providerMarketCapThousands !== undefined && (
                <div className="flex items-baseline justify-between gap-2 text-[10px] text-slate-400">
                  <span>قيمة المزود الخام (عمود رأس مال السوق بالألف):</span>
                  <span className="font-mono tabular-nums text-slate-300">
                    {summary.providerMarketCapThousands.toLocaleString('ar-EG', {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              )}
          </div>
        </div>

        {/* 2. Currencies & Units Matrix */}
        <div className="p-4 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400">2. منظومة العملات والوحدات</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">عملة القوائم المالية:</span>
            <span className="font-mono tabular-nums font-semibold text-slate-100">
              {formatCurrencyTag(summary.financialCurrency)}
              {summary.financialCurrencyStatus ? ` [${summary.financialCurrencyStatus}]` : ''}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">وحدة القوائم:</span>
            <span className="font-mono text-slate-200">{formatAmountUnitAr(summary.amountUnit)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">عملة السعر السوقي:</span>
            <span className="font-mono text-slate-200">{formatCurrencyTag(summary.marketPriceCurrency)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">وحدة الأسهم:</span>
            <span className="font-mono text-slate-300">
              {summary.sharesUnit === 'shares'
                ? 'سهم كامل (shares)'
                : summary.sharesUnit === 'millions'
                ? 'مليون سهم (قديماً)'
                : 'غير محددة'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-[11px] pt-1 border-t border-slate-800/70">
            <span className="text-slate-400">Ke / WACC / التدفقات:</span>
            <span className="font-mono tabular-nums text-slate-200">
              {summary.keCurrency ?? '-'} / {summary.waccCurrency ?? '-'} / {summary.projectedCashflowCurrency ?? '-'}
            </span>
          </div>
        </div>

        {/* 3. Shares, Analytical EPS & ROE Basis */}
        <div className="p-4 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400">3. الأسهم وربحية السهم والعائد</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">عدد الأسهم:</span>
            <span className="font-mono tabular-nums font-bold text-white">
              {summary.sharesOutstanding !== null
                ? `${summary.sharesOutstanding.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} سهم`
                : 'غير متاح'}
            </span>
          </div>
          <div className="text-[11px] text-slate-300">المصدر: {sharesSourceAr}</div>
          <div className="text-[10px] text-amber-300/90 leading-relaxed">
            {summary.sharesIsEndOfPeriodNoteAr}
          </div>
          {summary.epsBasisLabelAr && (
            <div className="text-[10px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800/70">
              أساس EPS_TTM: <span className="text-slate-300">{summary.epsBasisLabelAr}</span>
            </div>
          )}
          {summary.reportedEps !== undefined && summary.reportedEps !== null && (
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="text-slate-400">EPS المعلنة بالقوائم:</span>
              <span className="font-mono tabular-nums text-emerald-300">
                {summary.reportedEps.toFixed(2)}
                {summary.reportedEpsPeriod ? ` (${summary.reportedEpsPeriod})` : ''}
                {summary.reportedEpsSource ? ` · ${summary.reportedEpsSource}` : ''}
              </span>
            </div>
          )}
          {summary.metricAudit?.accountingEpsLatest?.value !== null &&
            summary.metricAudit?.accountingEpsLatest?.value !== undefined &&
            summary.metricAudit.accountingEpsLatest.usedQ1DocumentedEquivalence && (
              <div className="text-[10px] text-cyan-300 leading-relaxed">
                AccountingEPS ({summary.metricAudit.accountingEpsLatest.periodLabel ?? 'Q1'}):{' '}
                <span className="font-mono tabular-nums font-semibold">
                  {summary.metricAudit.accountingEpsLatest.formattedValue}
                </span>{' '}
                — تكافؤ Q1 موثق (الأصل المحفوظ:{' '}
                <span className="font-mono">
                  {summary.metricAudit.accountingEpsLatest.originalSharesBasis ?? 'standalone_quarter'}
                </span>{' '}
                ← الفعلي:{' '}
                <span className="font-mono">
                  {summary.metricAudit.accountingEpsLatest.effectiveSharesBasis ?? 'q1_standalone_equivalent_to_ytd'}
                </span>
                ).
              </div>
            )}
          {summary.metricAudit?.accountingEpsTTM?.value !== null &&
            summary.metricAudit?.accountingEpsTTM?.value !== undefined && (
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-slate-400">AccountingEPS (TTM):</span>
                <span className="font-mono tabular-nums text-cyan-300">
                  {summary.metricAudit.accountingEpsTTM.formattedValue}
                </span>
              </div>
            )}
          {summary.metricAudit?.reportedVsAccountingComparison && (
            <div className="text-[10px] text-slate-400 leading-relaxed">
              مطابقة EPS: <span className="text-slate-300">{summary.metricAudit.reportedVsAccountingComparison.messageAr}</span>
            </div>
          )}
          <div className="text-[10px] text-slate-400 leading-relaxed">
            أساس BVPS:{' '}
            <span className="text-slate-300">
              {summary.bvpsBasisLabelAr ?? summary.metricAudit?.valuationBvps.basisLabelAr ?? 'إجمالي حقوق الملكية'}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 leading-relaxed">
            أساس ROE: <span className="text-slate-300">{summary.roeBasisLabelAr ?? 'end_of_period_equity'}</span>
            {summary.roeAverageEquity !== null && summary.roeAverageEquity !== undefined && (
              <span className="font-mono tabular-nums text-teal-300 block">
                ROE (متوسط حقوق الملكية): {(summary.roeAverageEquity * 100).toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        {/* 4. FCFF, Beta & Risk-Free Methodology */}
        <div className="p-4 space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-400">4. FCFF وبيتا ومنهجية Rf</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-slate-400">FCFF:</span>
            <span className="font-semibold text-slate-100">
              {summary.fcffStatus === 'available'
                ? 'متاح وموثق'
                : summary.fcffStatus === 'available_undocumented'
                ? 'محسوب (غير موثق المصدر)'
                : 'غير متاح'}
            </span>
          </div>
          <div className="text-[11px] text-slate-400">
            المصدر: <span className="text-slate-200">{summary.fcffSource ?? 'غير موثق'}</span> · المقياس:{' '}
            <span className="font-mono text-slate-200">{summary.fcffUnit ?? 'قيمة أساسية'}</span>
          </div>
          {summary.fcffDocumentationWarningAr && (
            <div className="text-[10px] text-amber-300 leading-relaxed">
              {summary.fcffDocumentationWarningAr}
            </div>
          )}
          <div className="space-y-0.5 text-[11px]">
            <div className="text-sky-300 leading-relaxed">
              {summary.sectorName || 'غير محدد'} — {getSectorClassificationLabelAr(summary.sectorClassification)}
            </div>
            {(summary.sectorId || summary.sectorSource || summary.sectorDate) && (
              <div className="text-[10px] font-mono text-slate-400">
                {summary.sectorId ? `sectorId: ${summary.sectorId}` : 'غير مربوط بسجل القطاعات'}
                {summary.sectorSource ? ` · مصدر: ${summary.sectorSource}` : ''}
                {summary.sectorDate ? ` (${summary.sectorDate})` : ''}
              </div>
            )}
            {summary.rawSector && summary.rawSector !== summary.sectorName && (
              <div className="text-[10px] text-slate-400">
                النص الخام بالمصدر: <span className="font-mono text-slate-300">{summary.rawSector}</span>
              </div>
            )}
            {summary.sectorClassificationSource && (
              <div className="text-[10px] text-slate-400">
                مصدر تصنيف النشاط: <span className="font-mono text-slate-300">{summary.sectorClassificationSource}</span>
              </div>
            )}
            {summary.dcfSectorEligibilityReasonAr && (
              <div className="text-[10px] text-amber-300/90 leading-relaxed">
                أهلية DCF: {summary.dcfSectorEligibilityReasonAr}
              </div>
            )}
            {(summary.sectorPeMatchedKey || summary.sectorPeLookupReasonAr) && (
              <div className="text-[10px] text-slate-400 leading-relaxed">
                P/E القطاع: {summary.sectorPeMatchedKey ? `مطابقة "${summary.sectorPeMatchedKey}"` : summary.sectorPeLookupReasonAr}
              </div>
            )}
          </div>
          <div className="pt-1 border-t border-slate-800/70 space-y-1">
            <div className="font-mono tabular-nums font-bold text-white">
              β خام: {summary.betaRaw !== null ? summary.betaRaw.toFixed(2) : 'غير متاح'} · معدّلة (Blume):{' '}
              {summary.betaAdjusted !== null ? summary.betaAdjusted.toFixed(2) : 'غير متاح'}
            </div>
            {summary.betaAnalyticalOverride !== null && summary.betaAnalyticalOverride !== undefined && (
              <div className="font-mono tabular-nums text-[10px] text-sky-300">
                Beta_Analytical (تقدير تحليلي للشركة): {summary.betaAnalyticalOverride.toFixed(2)}
                {summary.betaAnalyticalSource ? ` · ${summary.betaAnalyticalSource}` : ''}
                {summary.betaAnalyticalAsOfDate ? ` (${summary.betaAnalyticalAsOfDate})` : ''}
              </div>
            )}
            <div className="font-mono tabular-nums text-[10px] text-emerald-300">
              بيتا المستخدمة في Ke: {summary.effectiveBetaForKe !== null && summary.effectiveBetaForKe !== undefined ? summary.effectiveBetaForKe.toFixed(2) : 'غير متاح'}
              {summary.betaAnalyticalOverride !== null && summary.betaAnalyticalOverride !== undefined
                ? ' (من Beta_Analytical)'
                : summary.betaAdjusted !== null
                ? ' (من Blume المعدلة)'
                : ''}
            </div>
            <div
              className={`text-[10px] leading-relaxed ${
                summary.betaStatus === 'actual'
                  ? 'text-emerald-300'
                  : summary.betaStatus === 'defaulted_missing'
                  ? 'text-amber-300'
                  : 'text-red-300'
              }`}
            >
              {betaBadgeText}
            </div>
            <div className="text-[11px] text-slate-400">
              {tvMethodLabel} · سنوات: <span className="font-mono tabular-nums text-slate-200">{summary.forecastYears ?? 'غير متاح'}</span>
            </div>
            <div className="text-[11px] text-slate-400">
              منهجية Rf:{' '}
              <span className="text-slate-200">{formatRfMethodologyLabel(summary.rfMethodology)}</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              مصدر Rf النشط: {summary.rfResolvedKey ?? 'غير متاح'} ({formatSourceLabel(summary.rfResolvedScope ?? 'missing')})
            </div>
          </div>
        </div>
      </div>

      {/* Sections 5-8: Assumptions, Models Eligibility, & Configured vs Active Weights */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-slate-800">
        {/* 5. Influential Assumptions & Documentation-only Params */}
        <div className="lg:col-span-6 p-4 space-y-3">
          <div className="text-[11px] font-semibold text-slate-300">
            5. الافتراضات المؤثرة المعتمدة ومصادرها وتواريخها
          </div>

          {summary.assumptionsUsed.length === 0 ? (
            <div className="text-[11px] text-amber-300 flex items-center gap-1.5 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>لا توجد افتراضات محفوظة صالحة بعد لهذا السهم أو في المتغيرات الكلية.</span>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-[11px] text-start">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-2.5 py-1.5 text-start">المعامل</th>
                    <th className="px-2.5 py-1.5 text-start">المصدر</th>
                    <th className="px-2.5 py-1.5 text-end font-mono">القيمة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {summary.assumptionsUsed.map((a) => (
                    <tr key={a.key}>
                      <td className="px-2.5 py-1.5 text-slate-200">
                        <div>{a.labelAr}</div>
                        {(a.asOfDate || a.rfMethodology) && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            {a.asOfDate ? `تاريخ: ${a.asOfDate}` : ''}
                            {a.asOfDate && a.rfMethodology ? ' · ' : ''}
                            {a.rfMethodology ? `Rf: ${a.rfMethodology}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-slate-400">
                        {formatSourceLabel(a.source)}
                        {a.isOverriddenByPriority ? ' (أولوية عامة)' : ''}
                      </td>
                      <td className="px-2.5 py-1.5 text-end font-mono tabular-nums font-bold text-emerald-400">
                        {formatAssumptionValue(a.value, a.unitOrFormat)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {summary.inactiveParameters && summary.inactiveParameters.length > 0 && (
            <div className="pt-2 border-t border-slate-800/80 space-y-1">
              <div className="text-[10px] font-semibold text-slate-400">
                6. معاملات محفوظة للتوثيق فقط (غير مفعّلة حسابياً في المحرك):
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-300 space-y-0.5">
                {summary.inactiveParameters.map((p) => (
                  <div key={p.key} className="flex items-center justify-between border-b border-slate-800/40 py-0.5">
                    <span>{p.key}</span>
                    <span>{formatAssumptionValue(p.value, p.unitOrFormat)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 7 & 8. Models Eligibility + Configured vs Active Weights */}
        <div className="lg:col-span-6 p-4 space-y-3">
          <div className="text-[11px] font-semibold text-slate-300">
            7. حالة نماذج التقييم الخمسة وأسباب الاستبعاد
          </div>

          <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-lg">
            {summary.modelStatuses.map((ms) => (
              <div key={ms.model} className="px-3 py-2 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  {ms.status === 'available' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-slate-200">{ms.nameAr}</div>
                    {ms.status === 'available' && ms.inputBasisSummaryAr && (
                      <div className="text-[10px] text-slate-400 leading-relaxed">{ms.inputBasisSummaryAr}</div>
                    )}
                    {ms.status === 'excluded' && ms.reasonAr && (
                      <div className="text-[10px] text-amber-300/90 leading-relaxed">{ms.reasonAr}</div>
                    )}
                  </div>
                </div>
                <div className="text-end shrink-0 font-mono tabular-nums">
                  {ms.status === 'available' && ms.fairValue !== null ? (
                    <>
                      <div className="text-[11px] font-bold text-emerald-400">
                        {ms.fairValue.toFixed(2)}{fairValueSuffix ? ` ${fairValueSuffix}` : ''}
                      </div>
                      <div className="text-[10px] text-slate-400">وزن فعلي: {ms.weightPct.toFixed(1)}%</div>
                    </>
                  ) : (
                    <span className="text-[10px] text-slate-400">مستبعد</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 8. Configured vs Normalized Active Weights */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-300">
              8. مقارنة الأوزان المكونة مقابل الأوزان الفعلية المعاد تطبيعها
            </div>
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-[11px] font-mono tabular-nums text-center">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="px-2 py-1.5 text-start font-sans">النوع</th>
                    {MODEL_WEIGHT_LABELS.map((m) => (
                      <th key={m.key} className="px-2 py-1.5">{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  <tr>
                    <td className="px-2 py-1.5 text-start font-sans text-slate-400">المكوّن (Configured)</td>
                    {MODEL_WEIGHT_LABELS.map((m) => (
                      <td key={m.key} className="px-2 py-1.5 text-slate-300">
                        {configuredWeights[m.key].toFixed(1)}%
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="px-2 py-1.5 text-start font-sans text-emerald-300">الفعلي المطبّع (Active)</td>
                    {MODEL_WEIGHT_LABELS.map((m) => (
                      <td key={m.key} className="px-2 py-1.5 font-bold text-emerald-400">
                        {activeWeights[m.key].toFixed(1)}%
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {summary.rimMethodologyNoteAr && (
            <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 leading-relaxed">
              {summary.rimMethodologyNoteAr}
            </div>
          )}
        </div>
      </div>

      {/* Section 9: Dividend Governance (DPS_Actual) & RIM Retention Policy */}
      <div className="p-4 space-y-3 bg-slate-950/30">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-300">
            <span>9. حوكمة التوزيعات الفعلية (DPS_Actual) وسياسة احتجاز RIM</span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded border font-mono ${
                summary.dividendSummary?.dividendYearStatus === 'complete'
                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                  : summary.dividendSummary?.dividendYearStatus === 'confirmed_no_dividend'
                  ? 'bg-sky-950/70 text-sky-300 border-sky-800/60'
                  : summary.dividendSummary?.dividendYearStatus === 'partial'
                  ? 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                  : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              yearStatus: {summary.dividendSummary?.dividendYearStatus ?? 'unknown'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            المصدر:{' '}
            <span className="text-emerald-300 font-semibold">
              {summary.dividendSummary?.source === 'dividend_records'
                ? 'سجل DPS_Actual الفعلي'
                : summary.dividendSummary?.source === 'confirmed_no_dividend'
                ? 'سنة بدون توزيعات مؤكدة'
                : 'غير متاح'}
            </span>
            {summary.dividendSummary?.targetFiscalYear
              ? ` · السنة: ${summary.dividendSummary.targetFiscalYear}`
              : ''}
            {summary.dividendSummary?.cutoffDate
              ? ` · تاريخ القطع: ${summary.dividendSummary.cutoffDate}`
              : ''}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-[11px]">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
            <div className="text-slate-400 text-[10px]">التوزيع العادي (DDM)</div>
            <div className="font-mono font-bold text-emerald-400 mt-0.5">
              {summary.dividendSummary?.regularDps === 0
                ? `0.00${fairValueSuffix ? ` ${fairValueSuffix}` : ''} (صفري مؤكد)`
                : summary.dividendSummary?.regularDps !== null &&
                  summary.dividendSummary?.regularDps !== undefined
                ? `${summary.dividendSummary.regularDps.toFixed(2)}${fairValueSuffix ? ` ${fairValueSuffix}` : ''}`
                : 'غير متاح'}
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
            <div className="text-slate-400 text-[10px]">التوزيع الاستثنائي (مستبعد)</div>
            <div className="font-mono font-bold text-purple-300 mt-0.5">
              {summary.dividendSummary?.specialDps !== null &&
              summary.dividendSummary?.specialDps !== undefined
                ? `${summary.dividendSummary.specialDps.toFixed(2)}${fairValueSuffix ? ` ${fairValueSuffix}` : ''}`
                : 'غير متاح'}
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
            <div className="text-slate-400 text-[10px]">إجمالي التوزيع المنسوب (معتمد+مدفوع)</div>
            <div className="font-mono font-bold text-slate-200 mt-0.5">
              {summary.dividendSummary?.totalAttributableDividends !== null &&
              summary.dividendSummary?.totalAttributableDividends !== undefined
                ? `${summary.dividendSummary.totalAttributableDividends.toLocaleString('ar-EG', {
                    maximumFractionDigits: 2,
                  })}${fairValueSuffix ? ` ${fairValueSuffix}` : ''}`
                : 'غير متاح'}
            </div>
            {summary.dividendSummary?.paidTotalDps !== null &&
              summary.dividendSummary?.paidTotalDps !== undefined && (
                <div className="text-[10px] font-mono text-sky-300 mt-0.5">
                  المدفوع فعلياً: {summary.dividendSummary.paidTotalDps.toFixed(2)} ({summary.dividendSummary.paidRecordsCount ?? 0} سجل)
                </div>
              )}
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
            <div className="text-slate-400 text-[10px]">نسبة التوزيع التاريخية الرسمية</div>
            <div className="font-mono font-bold text-sky-300 mt-0.5">
              {summary.historicalPayoutRatio !== null && summary.historicalPayoutRatio !== undefined
                ? `${(summary.historicalPayoutRatio * 100).toFixed(1)}%`
                : 'غير متاح'}
            </div>
            {summary.historicalPayoutRatio == null &&
              summary.dividendSummary?.partialPayoutRatio !== null &&
              summary.dividendSummary?.partialPayoutRatio !== undefined && (
                <div className="text-[10px] font-mono text-amber-300 mt-0.5">
                  جزئي للتدقيق: {(summary.dividendSummary.partialPayoutRatio * 100).toFixed(1)}%
                </div>
              )}
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
            <div className="text-slate-400 text-[10px]">نسبة الاحتجاز التاريخية الرسمية</div>
            <div className="font-mono font-bold text-teal-300 mt-0.5">
              {summary.historicalRetentionRatio !== null && summary.historicalRetentionRatio !== undefined
                ? `${(summary.historicalRetentionRatio * 100).toFixed(1)}%`
                : 'غير متاح'}
            </div>
            {summary.historicalRetentionRatio == null &&
              summary.dividendSummary?.partialRetentionRatio !== null &&
              summary.dividendSummary?.partialRetentionRatio !== undefined && (
                <div className="text-[10px] font-mono text-amber-300 mt-0.5">
                  جزئي للتدقيق: {(summary.dividendSummary.partialRetentionRatio * 100).toFixed(1)}%
                </div>
              )}
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
            <div className="text-slate-400 text-[10px]">
              الاحتجاز النشط في RIM (
              {summary.rimRetentionPolicy === 'historical_retention'
                ? 'التاريخي'
                : summary.rimRetentionPolicy === 'minimum'
                ? 'الحد الأدنى'
                : 'RIM_Retention'}
              )
            </div>
            <div className="font-mono font-bold text-cyan-300 mt-0.5">
              {summary.activeRimRetentionUsed !== null && summary.activeRimRetentionUsed !== undefined
                ? `${(summary.activeRimRetentionUsed * 100).toFixed(1)}%`
                : 'غير متاح'}
            </div>
            {summary.rimRetentionPolicySource && (
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                {summary.rimRetentionPolicySource}
              </div>
            )}
          </div>
        </div>

        {summary.dividendSummary && (
          <div className="text-[10px] text-slate-300 bg-slate-950/70 border border-slate-800 rounded-lg px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              تاريخ التقييم: <strong className="font-mono text-emerald-300">{summary.dividendSummary.valuationDate ?? summary.dividendSummary.cutoffDate ?? 'غير محدد'}</strong>
            </span>
            <span>
              سنة أساس DDM: <strong className="font-mono text-teal-300">{summary.dividendSummary.ddmBasisFiscalYear ?? summary.dividendSummary.targetFiscalYear ?? 'غير متوفرة'}</strong>
            </span>
            {summary.dividendSummary.displayLatestEventsYear != null && (
              <span>
                أحدث أحداث التوزيع: <strong className="font-mono">{summary.dividendSummary.displayLatestEventsYear}</strong>
              </span>
            )}
            <span>
              السنة المالية المكتملة (FY): <strong className="font-mono">{summary.dividendSummary.completedFiscalYear ?? 'غير متوفرة'}</strong>
            </span>
            {summary.dividendSummary.dividendYearStatusSource && (
              <span>
                توثيق حالة السنة: <strong className="font-mono text-slate-100">{summary.dividendSummary.dividendYearStatusSource}</strong>
                {summary.dividendSummary.dividendYearStatusConfirmedAt ? ` (${summary.dividendSummary.dividendYearStatusConfirmedAt})` : ''}
              </span>
            )}
            {summary.dividendSummary.interimFiscalYears && summary.dividendSummary.interimFiscalYears.length > 0 && (
              <span>
                فترات مرحلية فقط: <strong className="font-mono text-amber-300">{summary.dividendSummary.interimFiscalYears.join(', ')}</strong>
              </span>
            )}
            <span>
              مقام الربح: <strong className="font-mono">{summary.dividendSummary.fiscalYearIncomeSource ?? 'unavailable'}</strong>
              {summary.dividendSummary.fiscalYearIncomeUsed !== null && summary.dividendSummary.fiscalYearIncomeUsed !== undefined
                ? ` (${summary.dividendSummary.fiscalYearIncomeUsed.toLocaleString('ar-EG', { maximumFractionDigits: 2 })})`
                : ''}
            </span>
            <span>
              أساس إجمالي التوزيعات: <strong className="font-mono">{summary.dividendSummary.attributableBasis ?? 'unavailable'}</strong>
            </span>
          </div>
        )}

        {(summary.dividendSummary?.attributableUnavailableReasonAr ||
          summary.dividendSummary?.payoutUnavailableReasonAr ||
          summary.dividendSummary?.ddmVsRetentionDifferenceReasonAr ||
          (summary.historicalRetentionSuitableForRim === false && summary.historicalRetentionRimBlockReasonAr) ||
          summary.rimRetentionSelectionRuleNoteAr ||
          summary.dividendDatePolicyNoteAr) && (
          <div className="text-[10px] text-amber-300/90 space-y-0.5 leading-relaxed">
            {summary.dividendSummary?.ddmVsRetentionDifferenceReasonAr && (
              <div className="text-sky-300">• {summary.dividendSummary.ddmVsRetentionDifferenceReasonAr}</div>
            )}
            {summary.dividendSummary?.attributableUnavailableReasonAr && (
              <div>• {summary.dividendSummary.attributableUnavailableReasonAr}</div>
            )}
            {summary.dividendSummary?.payoutUnavailableReasonAr &&
              summary.dividendSummary.payoutUnavailableReasonAr !== summary.dividendSummary.attributableUnavailableReasonAr && (
                <div>• {summary.dividendSummary.payoutUnavailableReasonAr}</div>
              )}
            {summary.historicalRetentionSuitableForRim === false && summary.historicalRetentionRimBlockReasonAr && (
              <div>• {summary.historicalRetentionRimBlockReasonAr}</div>
            )}
            {summary.rimRetentionSelectionRuleNoteAr && (
              <div className="text-cyan-300/90">• {summary.rimRetentionSelectionRuleNoteAr}</div>
            )}
            {summary.dividendDatePolicyNoteAr && (
              <div className="text-slate-300">• {summary.dividendDatePolicyNoteAr}</div>
            )}
          </div>
        )}

        {summary.dividendSummary &&
          (summary.dividendSummary.excludedFutureCount > 0 ||
            (summary.dividendSummary.excludedProposedCount ?? 0) > 0 ||
            summary.dividendSummary.excludedCancelledCount > 0 ||
            summary.dividendSummary.excludedCurrencyMismatchCount > 0 ||
            summary.dividendSummary.excludedDeduplicatedCount > 0) && (
            <div className="text-[10px] font-mono text-slate-400 flex flex-wrap gap-3">
              <span>سجلات مستبعدة:</span>
              {summary.dividendSummary.excludedFutureCount > 0 && (
                <span className="text-amber-300">
                  بعد تاريخ التقييم: {summary.dividendSummary.excludedFutureCount}
                </span>
              )}
              {(summary.dividendSummary.excludedProposedCount ?? 0) > 0 && (
                <span className="text-amber-300">
                  مقترح (proposed): {summary.dividendSummary.excludedProposedCount}
                </span>
              )}
              {summary.dividendSummary.excludedCancelledCount > 0 && (
                <span className="text-red-300">
                  ملغاة: {summary.dividendSummary.excludedCancelledCount}
                </span>
              )}
              {summary.dividendSummary.excludedCurrencyMismatchCount > 0 && (
                <span className="text-red-300">
                  تعارض عملة: {summary.dividendSummary.excludedCurrencyMismatchCount}
                </span>
              )}
              {summary.dividendSummary.excludedDeduplicatedCount > 0 && (
                <span className="text-sky-300">
                  منع ازدواج: {summary.dividendSummary.excludedDeduplicatedCount}
                </span>
              )}
            </div>
          )}

        {summary.dividendSummary?.warningsAr && summary.dividendSummary.warningsAr.length > 0 && (
          <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg p-2.5 text-[11px] text-amber-200 space-y-1">
            {summary.dividendSummary.warningsAr.map((w, idx) => (
              <div key={idx}>• {w}</div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
