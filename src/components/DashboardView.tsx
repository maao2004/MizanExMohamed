/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  AlertTriangle,
  Scale,
  DollarSign,
  Activity,
  Layers,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertOctagon,
} from 'lucide-react';
import {
  AuditWarning,
  Company,
  FinancialMetricsTTM,
  ValuationResults,
} from '../types/financial';
import {
  classifyCompanySector,
  getSectorClassificationLabelAr,
} from '../core/domain/valuationAssumptions';
import { tryNormalizedTicker } from '../core/contracts';
import { ValuationSourcesCard } from './ValuationSourcesCard';
import { MetricAuditCard } from './MetricAuditCard';

interface DashboardViewProps {
  company: Company;
  metrics: FinancialMetricsTTM;
  valuation: ValuationResults;
  warnings: AuditWarning[];
  onNavigateToTab: (tab: string) => void;
  onOpenAuditWarnings?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  company,
  metrics,
  valuation,
  warnings,
  onNavigateToTab,
  onOpenAuditWarnings,
}) => {
  const marginPct = valuation.marginOfSafetyPct;
  const isUndervalued = marginPct !== null && marginPct > 0;
  const deepDiscount = marginPct !== null && marginPct >= 20;
  const isOvervalued = marginPct !== null && marginPct < -10;

  // فحص تنبيهات التدقيق الخاصة بهذا السهم
  const companyNormTicker =
    tryNormalizedTicker(company.ticker) ?? company.ticker.trim().toUpperCase();
  const companyWarnings = warnings.filter(
    (w) =>
      (tryNormalizedTicker(w.companyTicker) ?? w.companyTicker.trim().toUpperCase()) ===
      companyNormTicker
  );
  const criticalWarnings = companyWarnings.filter((w) => w.severity === 'critical');

  const formatBaseMarketCap = (val: number | null | undefined): string | null => {
    if (val === null || val === undefined || !Number.isFinite(val)) return null;
    if (Math.abs(val) >= 1_000_000_000) {
      return `${(val / 1_000_000_000).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} مليار`;
    }
    if (Math.abs(val) >= 1_000_000) {
      return `${(val / 1_000_000).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} مليون`;
    }
    return val.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
  };
  const marketCapFormatted = formatBaseMarketCap(metrics.marketCap);

  const finCurrency =
    valuation.engineOutputs?.financialCurrency ?? metrics.financialCurrency ?? null;
  const finCurrencyLabel =
    finCurrency === 'EGP' ? 'ج.م' : finCurrency === 'USD' ? 'USD' : '';
  const mktCurrency =
    metrics.marketPriceCurrency ?? valuation.engineOutputs?.marketPriceCurrency ?? null;
  const mktCurrencyLabel =
    mktCurrency === 'EGP' ? 'ج.م' : mktCurrency === 'USD' ? 'USD' : 'غير محددة';

  const sectorClass =
    valuation.sourcesSummary?.sectorClassification ??
    classifyCompanySector(company.sector, company.sectorClassification ?? null);
  const priceSourceLabel =
    company.marketPriceSource === 'lastPrice'
      ? 'آخر سعر'
      : company.marketPriceSource === 'closePrice'
      ? 'إقفال اليوم'
      : null;

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Health Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold text-white tracking-tight">{company.nameAr}</h1>
              <span className="font-mono text-sm px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {company.ticker}
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950/70 text-emerald-400 border border-emerald-800/80 font-medium">
                {company.sector || 'غير محدد'}
              </span>
              <span
                className={`text-[11px] px-2.5 py-0.5 rounded-lg border font-medium ${
                  sectorClass === 'non_financial'
                    ? 'bg-sky-950/60 text-sky-300 border-sky-800/70'
                    : 'bg-amber-950/50 text-amber-300 border-amber-800/70'
                }`}
              >
                {getSectorClassificationLabelAr(sectorClass)}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
              {company.description || 'شركة مقيدة في البورصة المصرية — البيانات مشتقة من Firestore.'}
            </p>
          </div>

          <div className="flex items-center gap-4 bg-slate-950/80 px-4 py-3 rounded-xl border border-slate-800 shrink-0">
            <div>
              <span className="text-[11px] text-slate-400 block">
                السعر السوقي{priceSourceLabel ? ` (${priceSourceLabel})` : ''}
              </span>
              <span className="text-2xl font-bold font-mono text-white">
                {company.marketPrice !== null ? (
                  <>
                    {company.marketPrice.toFixed(2)}{' '}
                    <span className="text-xs font-normal text-slate-400">{mktCurrencyLabel}</span>
                  </>
                ) : (
                  <span className="text-sm text-amber-300">غير متاح</span>
                )}
              </span>
              {company.latestTradeDate && (
                <span className="text-[10px] text-slate-400 font-mono block">
                  بتاريخ {company.latestTradeDate}
                </span>
              )}
            </div>
            <div className="w-px h-8 bg-slate-800" />
            <div>
              <span className="text-[11px] text-slate-400 block">القيمة السوقية</span>
              <span className="text-sm font-semibold font-mono text-slate-200">
                {marketCapFormatted !== null
                  ? `${marketCapFormatted}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}`
                  : 'غير متاح'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {valuation.currencyConsistencyBlockedReasonAr && (
        <div
          role="alert"
          className="rounded-xl p-3.5 border border-red-800/80 bg-red-950/40 text-xs text-red-200 flex items-center gap-2.5"
        >
          <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
          <span>{valuation.currencyConsistencyBlockedReasonAr}</span>
        </div>
      )}

      {/* 2. Audit Alert Notice (إذا وجدت أخطاء أو قيم شاذة) */}
      {companyWarnings.length > 0 && (
        <div
          role="button"
          tabIndex={0}
          data-testid="dashboard-audit-alert"
          onClick={() => (onOpenAuditWarnings ? onOpenAuditWarnings() : onNavigateToTab('data'))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (onOpenAuditWarnings) {
                onOpenAuditWarnings();
              } else {
                onNavigateToTab('data');
              }
            }
          }}
          className={`cursor-pointer rounded-xl p-4 border transition-all ${
            criticalWarnings.length > 0
              ? 'bg-red-950/40 border-red-800/80 hover:bg-red-950/60 text-red-200'
              : 'bg-amber-950/30 border-amber-800/80 hover:bg-amber-950/50 text-amber-200'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${
                  criticalWarnings.length > 0 ? 'bg-red-900/60 text-red-400' : 'bg-amber-900/60 text-amber-400'
                }`}
              >
                {criticalWarnings.length > 0 ? (
                  <AlertOctagon className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
              </div>
              <div>
                <h4 className="text-sm font-bold">
                  محرك التدقيق الآلي رصد {companyWarnings.length} ملاحظات محاسبية تتطلب المراجعة
                </h4>
                <p className="text-xs opacity-90 mt-0.5">
                  {companyWarnings[0].title} في {companyWarnings[0].period} — انقر هنا للانتقال مباشرة إلى قسم ملاحظات التدقيق المحاسبي.
                </p>
              </div>
            </div>
            <span className="text-xs px-3 py-1 rounded-lg bg-slate-900/80 border border-slate-700 font-semibold shrink-0">
              عرض الملاحظات ←
            </span>
          </div>
        </div>
      )}

      {/* 3. Valuation Hero Gauge vs Market Price */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Composite Fair Value & Margin of Safety */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-emerald-400" />
                <h2 className="text-lg font-bold text-white">التقييم العادل المرجح (Composite Valuation)</h2>
              </div>
              <span className="text-xs text-slate-400">مرجح بالنماذج المتاحة</span>
            </div>

            {/* Core numbers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
              {/* Fair Value Box */}
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4">
                <span className="text-xs text-slate-400 block font-medium">القيمة العادلة المرجحة</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-extrabold font-mono text-emerald-400">
                    {valuation.compositeFairValue?.toFixed(2) ?? 'غير متاح'}
                  </span>
                  {finCurrencyLabel && (
                    <span className="text-sm text-slate-400">{finCurrencyLabel} / سهم</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-400">
                  <span>السعر السوقي الحالي:</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {company.marketPrice !== null ? `${company.marketPrice.toFixed(2)} ${mktCurrencyLabel}` : 'غير متاح'}
                  </span>
                </div>
              </div>

              {/* Margin of Safety Box */}
              <div
                className={`border rounded-xl p-4 ${
                  marginPct === null
                    ? 'bg-slate-950/80 border-slate-800'
                    : deepDiscount
                    ? 'bg-emerald-950/40 border-emerald-800/80'
                    : isUndervalued
                    ? 'bg-emerald-950/20 border-emerald-900/60'
                    : isOvervalued
                    ? 'bg-red-950/40 border-red-800/80'
                    : 'bg-amber-950/30 border-amber-900/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">هامش الأمان (Margin of Safety)</span>
                  {marginPct !== null &&
                    (isUndervalued ? (
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-red-400" />
                    ))}
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span
                    className={`text-3xl font-extrabold font-mono ${
                      marginPct === null
                        ? 'text-slate-300'
                        : isUndervalued
                        ? 'text-emerald-400'
                        : isOvervalued
                        ? 'text-red-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {marginPct !== null ? `${marginPct > 0 ? '+' : ''}${marginPct.toFixed(1)}%` : 'غير متاح'}
                  </span>
                </div>
                <div className="text-xs mt-2 font-medium">
                  {valuation.compositeFairValue === null || marginPct === null ? (
                    <span className="text-amber-300">التقييم أو السعر السوقي غير متاح؛ لا يمكن تحديد الخصم أو المغالاة.</span>
                  ) : deepDiscount ? (
                    <span className="text-emerald-300">خصم عميق مغرٍ للشراء الاستثماري</span>
                  ) : isUndervalued ? (
                    <span className="text-emerald-300">يتداول السهم بأقل من قيمته العادلة</span>
                  ) : isOvervalued ? (
                    <span className="text-red-300">السهم مسعر أعلى من القيمة العادلة</span>
                  ) : (
                    <span className="text-amber-300">السهم يتداول قرب مستواه العادل</span>
                  )}
                </div>
              </div>
            </div>

            {/* Visual Comparison Bar */}
            <div className="mt-6 space-y-2">
              <div className="flex justify-between text-xs text-slate-400 font-medium">
                <span>موقع السعر السوقي من القيمة العادلة</span>
                <span className="font-mono text-slate-300">
                  العائد الصعودي المحتمل:{' '}
                  {valuation.upsidePotentialPct !== null
                    ? `${valuation.upsidePotentialPct > 0 ? '+' : ''}${valuation.upsidePotentialPct.toFixed(1)}%`
                    : 'غير متاح'}
                </span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-3 relative overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-teal-400 rounded-full transition-all duration-500"
                  style={{
                    width:
                      valuation.compositeFairValue !== null &&
                      valuation.compositeFairValue > 0 &&
                      company.marketPrice !== null
                        ? `${Math.min(100, Math.max(0, (company.marketPrice / valuation.compositeFairValue) * 65))}%`
                        : '0%',
                  }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-slate-400 font-mono pt-0.5">
                <span>0.00</span>
                <span className="text-emerald-400 font-semibold">
                  القيمة العادلة: {valuation.compositeFairValue?.toFixed(2) ?? 'غير متاح'}{finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}
                </span>
                <span>{valuation.scenarios.bull.fairValue?.toFixed(2) ?? 'غير متاح'}{finCurrencyLabel ? ` ${finCurrencyLabel}` : ''} (متفائل)</span>
              </div>
            </div>

            {valuation.modelNotes && valuation.modelNotes.length > 0 && (
              <div className="mt-4 p-3 rounded-xl bg-amber-950/30 border border-amber-800/50 text-[11px] text-amber-200 space-y-1">
                {valuation.modelNotes.map((note, idx) => (
                  <div key={idx}>• {note}</div>
                ))}
              </div>
            )}
          </div>

          {/* Quick link to sensitivity */}
          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <span className="text-slate-400">
              WACC:{' '}
              <strong className="font-mono text-slate-200">
                {metrics.wacc === null ? 'غير متاح' : `${(metrics.wacc * 100).toFixed(1)}%`}
              </strong>{' '}
              | Ke:{' '}
              <strong className="font-mono text-slate-200">
                {metrics.costOfEquity === null ? 'غير متاح' : `${(metrics.costOfEquity * 100).toFixed(1)}%`}
              </strong>
              {valuation.sourcesSummary?.rfMethodology && (
                <>
                  {' '}
                  | Rf:{' '}
                  <strong className="font-mono text-slate-300">
                    {valuation.sourcesSummary.rfResolvedKey ?? '-'} ({valuation.sourcesSummary.rfMethodology})
                  </strong>
                </>
              )}
            </span>
            <button
              onClick={() => onNavigateToTab('valuation')}
              className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors flex items-center gap-1"
            >
              <span>فتح مصفوفة الحساسية والسيناريوهات</span>
              <span>←</span>
            </button>
          </div>
        </div>

        {/* Right: 5 Valuation Models Breakdown Card */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">النماذج الخمسة والوزن المرجح</h3>
            </div>
            <span className="text-xs text-slate-400">توزيع الأوزان</span>
          </div>

          <div className="space-y-3 mt-4">
            {/* 1. DCF */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/60">
              <div>
                <span className="text-xs font-semibold text-slate-200 block">1. التدفق النقدي المخصوم (DCF)</span>
                <span className="text-[11px] text-slate-400">مبني على FCFF_TTM وافتراضات النمو المعتمدة</span>
              </div>
              <div className="text-end">
                <span className="text-sm font-bold font-mono text-emerald-400 block">
                  {valuation.dcfFairValue !== null ? `${valuation.dcfFairValue.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">الوزن: {valuation.weights.dcf.toFixed(1)}%</span>
              </div>
            </div>

            {/* 2. DDM */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/60">
              <div>
                <span className="text-xs font-semibold text-slate-200 block">2. خصم التوزيعات (DDM - Gordon)</span>
                <span className="text-[11px] text-slate-400">
                  {(() => {
                    const reg = metrics.dpsRegular ?? null;
                    const spec = metrics.dpsSpecial ?? null;
                    const regText =
                      reg === 0
                        ? `عادي 0.00${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''} (صفري مؤكد)`
                        : reg !== null
                        ? `عادي ${reg.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}`
                        : 'عادي غير متاح';
                    return spec !== null && spec > 0
                      ? `${regText} · استثنائي ${spec.toFixed(2)} (مستبعد)`
                      : regText;
                  })()}
                </span>
              </div>
              <div className="text-end">
                <span className="text-sm font-bold font-mono text-teal-400 block">
                  {valuation.ddmFairValue !== null ? `${valuation.ddmFairValue.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">الوزن: {valuation.weights.ddm.toFixed(1)}%</span>
              </div>
            </div>

            {/* 3. RIM */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/60">
              <div>
                <span className="text-xs font-semibold text-slate-200 block">3. الدخل المتبقي (RIM Model)</span>
                <span className="text-[11px] text-slate-400">
                  BVPS {metrics.bvps !== null ? `${metrics.bvps.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : '-'} | ROE{' '}
                  {metrics.roe !== null ? `${(metrics.roe * 100).toFixed(1)}%` : '-'}
                </span>
              </div>
              <div className="text-end">
                <span className="text-sm font-bold font-mono text-cyan-400 block">
                  {valuation.rimFairValue !== null ? `${valuation.rimFairValue.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">الوزن: {valuation.weights.rim.toFixed(1)}%</span>
              </div>
            </div>

            {/* 4. Relative */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/60">
              <div>
                <span className="text-xs font-semibold text-slate-200 block">4. التقييم النسبي بالمضاعفات</span>
                <span className="text-[11px] text-slate-400">
                  P/E مستهدف{' '}
                  {(valuation.resolvedAssumptions?.targetPE?.value ?? company.targetPE) !== null
                    ? `${valuation.resolvedAssumptions?.targetPE?.value ?? company.targetPE}x`
                    : 'غير متاح'}{' '}
                  | P/B{' '}
                  {(valuation.resolvedAssumptions?.targetPB?.value ?? company.targetPB) !== null
                    ? `${valuation.resolvedAssumptions?.targetPB?.value ?? company.targetPB}x`
                    : 'غير متاح'}
                </span>
              </div>
              <div className="text-end">
                <span className="text-sm font-bold font-mono text-sky-400 block">
                  {valuation.relativeFairValue !== null ? `${valuation.relativeFairValue.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">الوزن: {valuation.weights.relative.toFixed(1)}%</span>
              </div>
            </div>

            {/* 5. Graham */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/60">
              <div>
                <span className="text-xs font-semibold text-slate-200 block">5. صيغة بنجامين جراهام (Graham)</span>
                <span className="text-[11px] text-slate-400">√(22.5 × EPS_TTM × BVPS)</span>
              </div>
              <div className="text-end">
                <span className="text-sm font-bold font-mono text-indigo-400 block">
                  {valuation.grahamFairValue !== null ? `${valuation.grahamFairValue.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">الوزن: {valuation.weights.graham.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Financial KPI Metric Cards Grid */}
      <div>
        <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>المؤشرات المالية الأساسية (TTM & Balance Sheet)</span>
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Card 1: EPS TTM (Analytical) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 block font-medium">
              EPS_TTM (ربحية تحليلية)
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg font-bold font-mono text-white">
                {metrics.epsTTM !== null ? metrics.epsTTM.toFixed(2) : 'BLANK'}
              </span>
              {finCurrencyLabel && <span className="text-[10px] text-slate-400">{finCurrencyLabel}</span>}
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              P/E: {metrics.peTTM !== null ? `${metrics.peTTM.toFixed(1)}x` : '-'} · أسهم نهاية الفترة
            </span>
            {metrics.reportedEps !== null && metrics.reportedEps !== undefined && (
              <span className="text-[10px] text-emerald-300 mt-0.5 block font-mono">
                معلن: {metrics.reportedEps.toFixed(2)}
              </span>
            )}
          </div>

          {/* Card 2: FCF TTM */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 block font-medium">FCF_TTM (التدفق الحر)</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg font-bold font-mono text-emerald-400">
                {metrics.fcfTTM !== null ? `${metrics.fcfTTM.toLocaleString('ar-EG', { maximumFractionDigits: 0 })}` : 'BLANK'}
              </span>
              {finCurrencyLabel && (
                <span className="text-[10px] text-slate-400">
                  {finCurrencyLabel}
                </span>
              )}
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              OCF - CapEx التراكمي
            </span>
          </div>

          {/* Card 3: BVPS */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 block font-medium">BVPS (القيمة الدفترية)</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg font-bold font-mono text-white">
                {metrics.bvps !== null ? metrics.bvps.toFixed(2) : 'BLANK'}
              </span>
              {finCurrencyLabel && <span className="text-[10px] text-slate-400">{finCurrencyLabel}</span>}
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              مضاعف P/B: {metrics.pbTTM !== null ? `${metrics.pbTTM.toFixed(2)}x` : '-'}
              {metrics.bvpsBasis ? ` · ${metrics.bvpsBasis === 'explicit_common' || metrics.bvpsBasis === 'attested_total_equals_common' ? 'أساس عادي موثق' : 'إجمالي الملكية'}` : ''}
            </span>
          </div>

          {/* Card 4: ROE */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 block font-medium">ROE (ملكية نهاية الفترة)</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg font-bold font-mono text-teal-400">
                {metrics.roe !== null ? `${(metrics.roe * 100).toFixed(1)}%` : 'BLANK'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              {metrics.roeAverageEquity !== null && metrics.roeAverageEquity !== undefined
                ? `متوسط الملكية: ${(metrics.roeAverageEquity * 100).toFixed(1)}%`
                : 'صافي الربح / ملكية نهاية الفترة'}
            </span>
          </div>

          {/* Card 5: WACC */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 block font-medium">WACC (تكلفة رأس المال)</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg font-bold font-mono text-amber-400">
                {metrics.wacc === null ? 'غير متاح' : `${(metrics.wacc * 100).toFixed(1)}%`}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block font-mono">
              Ke: {metrics.costOfEquity === null ? 'غير متاح' : `${(metrics.costOfEquity * 100).toFixed(1)}%`}
            </span>
          </div>

          {/* Card 6: DPS Regular & Yield */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-sm">
            <span className="text-[11px] text-slate-400 block font-medium">
              DPS العادي ({metrics.dividendSummary?.source === 'dividend_records' ? 'DPS_Actual' : 'التوزيع'})
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              {(() => {
                const reg = metrics.dpsRegular ?? null;
                return (
                  <span className="text-lg font-bold font-mono text-cyan-400">
                    {reg === 0 ? '0.00' : reg !== null ? reg.toFixed(2) : 'BLANK'}
                  </span>
                );
              })()}
              {finCurrencyLabel && <span className="text-[10px] text-slate-400">{finCurrencyLabel}</span>}
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              العائد العادي:{' '}
              {(metrics.dividendYieldRegular ?? metrics.dividendYield) !== null
                ? `${(metrics.dividendYieldRegular ?? metrics.dividendYield)!.toFixed(1)}%`
                : '-'}
              {metrics.dpsSpecial !== null && metrics.dpsSpecial !== undefined && metrics.dpsSpecial > 0
                ? ` · استثنائي ${metrics.dpsSpecial.toFixed(2)}`
                : ''}
            </span>
          </div>
        </div>
      </div>

      {/* 5. Scenario Bands Summary Row */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <PieChart className="w-4 h-4 text-emerald-400" />
            <span>نطاقات السيناريوهات الثلاثة (Scenario Bands)</span>
          </h3>
          <span className="text-xs text-slate-400">متحفظ · أساسي · متفائل</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Bear */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-300">السيناريو المتحفظ (Bear)</span>
              <span className="text-[11px] text-slate-400 font-mono">
                Ke:{' '}
                {valuation.scenarios.bear.discountRate !== null
                  ? `${(valuation.scenarios.bear.discountRate * 100).toFixed(1)}%`
                  : 'غير متاح'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-xl font-bold font-mono text-slate-100">
                {valuation.scenarios.bear.fairValue?.toFixed(2) ?? 'غير متاح'}{finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}
              </span>
              <span className="text-xs font-mono text-slate-400">
                (
                {valuation.scenarios.bear.marginOfSafetyPct !== null
                  ? `${valuation.scenarios.bear.marginOfSafetyPct > 0 ? '+' : ''}${valuation.scenarios.bear.marginOfSafetyPct.toFixed(1)}%`
                  : 'غير متاح'}
                )
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              {valuation.scenarios.bear.descriptionAr}
            </p>
          </div>

          {/* Base */}
          <div className="bg-slate-950/80 border border-emerald-900/60 rounded-xl p-4 relative">
            <span className="absolute top-2 left-2 text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold">
              الأساسي
            </span>
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-emerald-400">السيناريو الأساسي (Base)</span>
              <span className="text-[11px] text-slate-400 font-mono">
                Ke:{' '}
                {valuation.scenarios.base.discountRate !== null
                  ? `${(valuation.scenarios.base.discountRate * 100).toFixed(1)}%`
                  : 'غير متاح'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-xl font-bold font-mono text-emerald-400">
                {valuation.scenarios.base.fairValue?.toFixed(2) ?? 'غير متاح'}{finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}
              </span>
              <span className="text-xs font-mono text-emerald-300">
                (
                {valuation.scenarios.base.marginOfSafetyPct !== null
                  ? `${valuation.scenarios.base.marginOfSafetyPct > 0 ? '+' : ''}${valuation.scenarios.base.marginOfSafetyPct.toFixed(1)}%`
                  : 'غير متاح'}
                )
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              {valuation.scenarios.base.descriptionAr}
            </p>
          </div>

          {/* Bull */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-300">السيناريو المتفائل (Bull)</span>
              <span className="text-[11px] text-slate-400 font-mono">
                Ke:{' '}
                {valuation.scenarios.bull.discountRate !== null
                  ? `${(valuation.scenarios.bull.discountRate * 100).toFixed(1)}%`
                  : 'غير متاح'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-xl font-bold font-mono text-teal-300">
                {valuation.scenarios.bull.fairValue?.toFixed(2) ?? 'غير متاح'}{finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}
              </span>
              <span className="text-xs font-mono text-teal-400">
                (
                {valuation.scenarios.bull.marginOfSafetyPct !== null
                  ? `${valuation.scenarios.bull.marginOfSafetyPct > 0 ? '+' : ''}${valuation.scenarios.bull.marginOfSafetyPct.toFixed(1)}%`
                  : 'غير متاح'}
                )
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              {valuation.scenarios.bull.descriptionAr}
            </p>
          </div>
        </div>
      </div>

      {/* 6. Metric Accounting Audit Card */}
      <MetricAuditCard
        metricAudit={metrics.metricAudit ?? valuation.metricAudit ?? valuation.sourcesSummary?.metricAudit}
        finCurrencyLabel={finCurrencyLabel}
      />

      {/* 7. Valuation Sources & Completeness Summary Card */}
      <ValuationSourcesCard summary={valuation.sourcesSummary} />
    </div>
  );
};
