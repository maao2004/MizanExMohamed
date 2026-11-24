/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import {
  RIM_REGISTRY_KEYS,
  getValuationLabField,
  type ValuationLabFieldDefinition,
} from '../core/contracts';
import {
  classifyConsistencyChecksState,
  classifyFadeScheduleState,
  describeTerminalShareState,
  formatRimTerminalMethodLabel,
  getRimParameterRequirements,
} from '../core/domain';
import type { MacroParameter } from '../types';
import type {
  Company,
  CompanyParameterOverride,
  FinancialMetricsTTM,
  ResolvedAssumption,
  RimAuditSummary,
  RimRetentionPolicy,
  RimTerminalMethod,
  ValuationResults,
} from '../types/financial';
import { ValuationParameterCard } from './ValuationParameterCard';

export interface RimAuditSectionProps {
  company: Company;
  effectiveMetrics: FinancialMetricsTTM;
  effectiveValuation: ValuationResults;
  rimAudit: RimAuditSummary | null;
  rimRetentionPolicy: RimRetentionPolicy;
  resolved: Record<string, ResolvedAssumption>;
  companyOverridesMap: Record<string, CompanyParameterOverride>;
  paramsMap: Record<string, number>;
  macroMetaMap?: Record<
    string,
    Pick<MacroParameter, 'asOfDate' | 'source' | 'enabledInEngine' | 'rfMethodology'>
  >;
  sensitivityDrafts: Record<string, number>;
  canEditCompanyParams: boolean;
  isAdmin: boolean;
  finCurrencyLabel: string;
  isKeyBusy: (key: string) => boolean;
  onSetSensitivityDraft: (key: string, val: number | null) => void;
  onCommitCompanyOverride?: (key: string, value: number) => Promise<void>;
  onCommitDeleteCompanyOverride?: (key: string) => Promise<void>;
  onCommitGlobalMacro?: (key: string, value: number) => Promise<void>;
}

const formatPct = (val: number | null | undefined, digits = 2): string => {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'غير متاح';
  return `${(val * 100).toFixed(digits)}%`;
};

const formatNum = (val: number | null | undefined, digits = 2, suffix = ''): string => {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'غير متاح';
  return `${val.toFixed(digits)}${suffix ? ` ${suffix}` : ''}`;
};

const formatRetentionPolicyLabelAr = (policy: RimRetentionPolicy): string => {
  if (policy === 'historical_retention') return 'الاحتجاز التاريخي (1 - Payout)';
  if (policy === 'minimum') return 'الحد الأدنى min(RIM_Retention, Historical)';
  return 'معامل RIM_Retention المحفوظ';
};

export const RimAuditSection: React.FC<RimAuditSectionProps> = ({
  company,
  effectiveMetrics,
  effectiveValuation,
  rimAudit,
  rimRetentionPolicy,
  resolved,
  companyOverridesMap,
  paramsMap,
  macroMetaMap,
  sensitivityDrafts,
  canEditCompanyParams,
  isAdmin,
  finCurrencyLabel,
  isKeyBusy,
  onSetSensitivityDraft,
  onCommitCompanyOverride,
  onCommitDeleteCompanyOverride,
  onCommitGlobalMacro,
}) => {
  const rimFields = RIM_REGISTRY_KEYS.map((k) => getValuationLabField(k)).filter(
    (f): f is ValuationLabFieldDefinition => f !== null
  );

  const rawResolvedMethod = resolved.rimTerminalMethod?.value;
  const activeTerminalMethod: RimTerminalMethod | null =
    rimAudit?.terminalMethod ??
    (rawResolvedMethod === 1 || rawResolvedMethod === 2 || rawResolvedMethod === 3
      ? rawResolvedMethod
      : null);

  const activeTerminalRoe =
    rimAudit?.terminalRoeUsed ?? resolved.rimTerminalRoe?.value ?? null;
  const activeCostOfEquity =
    rimAudit?.costOfEquity ?? effectiveMetrics.costOfEquity ?? null;

  const requirementsByKey = getRimParameterRequirements({
    terminalMethod: activeTerminalMethod,
    terminalRoe: activeTerminalRoe,
    costOfEquity: activeCostOfEquity,
    rimRetentionPolicy,
  });

  const fadeState = classifyFadeScheduleState(rimAudit);
  const consistencyState = classifyConsistencyChecksState(rimAudit);
  const terminalShareState = describeTerminalShareState(rimAudit);

  const historicalRetention =
    rimAudit?.historicalRetentionRatio ??
    effectiveValuation.sourcesSummary?.dividendSummary?.historicalRetentionRatio ??
    null;

  const forecastRetention = rimAudit?.retentionUsed ?? null;
  const terminalRetention = rimAudit?.terminalRetentionUsed ?? null;

  const historicalRoe = rimAudit?.roeUsed ?? effectiveMetrics.roe ?? null;
  const forwardRoe = rimAudit?.forwardRoeUsed ?? null;
  const terminalRoe = rimAudit?.terminalRoeUsed ?? null;

  const isForwardRoeExplicit = rimAudit?.forwardRoeBasis === 'explicit_expected_roe';

  return (
    <div className="space-y-4">
      {/* 1. Explicit Separation: Historical vs Forward vs Terminal (ROE & Retention) */}
      <div
        className="bg-slate-950/75 border border-slate-800 rounded-xl p-4 space-y-3 text-xs"
        data-testid="rim-separation-panel"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div>
            <h5 className="font-bold text-slate-100">
              فصل المؤشرات التاريخية عن افتراضات التوقع والمرحلة النهائية في RIM
            </h5>
            <p className="text-[11px] text-slate-400 mt-0.5">
              لا يُستبدل أي افتراض مستقبلي بمؤشر تاريخي صمتاً؛ يظهر هنا كل بند بأساسه ومصدره منفصلاً.
            </p>
          </div>
          <span
            className={`text-[10px] px-2 py-1 rounded border font-semibold shrink-0 ${
              isForwardRoeExplicit
                ? 'bg-emerald-950/70 border-emerald-800/60 text-emerald-300'
                : 'bg-sky-950/70 border-sky-800/60 text-sky-200'
            }`}
          >
            {isForwardRoeExplicit
              ? 'ROE التوقع: افتراض مستقبلي صريح (RIM_Expected_ROE)'
              : 'ROE التوقع: ترحيل موثق لـ ROE التاريخي العادي'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3 space-y-1">
            <span className="text-[10px] text-slate-400 block">1) ROE التاريخي المحسوب (فعلي)</span>
            <span className="text-base font-bold font-mono tabular-nums text-slate-100 block">
              {formatPct(historicalRoe)}
            </span>
            <span className="text-[10px] text-slate-400 block">
              {rimAudit?.roeBasisLabelAr || effectiveMetrics.roeBasisLabelAr || 'غير متاح'}
            </span>
          </div>

          <div className="bg-slate-900/70 border border-cyan-800/50 rounded-lg p-3 space-y-1">
            <span className="text-[10px] text-cyan-300 block">
              2) ROE المستقبلي المتوقع (أفق التوقع Y1..Y5)
            </span>
            <span className="text-base font-bold font-mono tabular-nums text-cyan-300 block">
              {formatPct(forwardRoe)}
            </span>
            <span className="text-[10px] text-slate-400 block">
              {rimAudit?.forwardRoeBasisLabelAr || 'غير متاح'}
            </span>
          </div>

          <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3 space-y-1">
            <span className="text-[10px] text-slate-400 block">3) ROE النهائي (المرحلة النهائية)</span>
            <span className="text-base font-bold font-mono tabular-nums text-emerald-300 block">
              {activeTerminalMethod === null
                ? 'غير محدد'
                : formatPct(terminalRoe)}
            </span>
            <span className="text-[10px] text-slate-400 block">
              {activeTerminalMethod === 1
                ? 'النمط 1: يواصل استخدام ROE المستقبلي لفترة التوقع'
                : activeTerminalMethod === 2
                ? resolved.rimTerminalRoe?.value !== null && resolved.rimTerminalRoe?.value !== undefined
                  ? 'النمط 2: هدف التلاشي من RIM_Terminal_ROE'
                  : 'النمط 2: يتلاشى نحو تكلفة الملكية Ke'
                : activeTerminalMethod === 3
                ? 'النمط 3: RIM_Terminal_ROE الصريح'
                : 'اختر طريقة القيمة النهائية أولاً'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 block">الاحتجاز التاريخي (1 - Payout)</span>
            <span className="text-sm font-bold font-mono tabular-nums text-teal-300 block mt-0.5">
              {formatPct(historicalRetention, 1)}
            </span>
          </div>
          <div className="bg-slate-900/60 border border-cyan-800/40 rounded-lg p-2.5">
            <span className="text-[10px] text-cyan-300 block">احتجاز فترة التوقع (Y1..Y5)</span>
            <span className="text-sm font-bold font-mono tabular-nums text-cyan-300 block mt-0.5">
              {formatPct(forecastRetention, 1)}
            </span>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              السياسة: {formatRetentionPolicyLabelAr(rimRetentionPolicy)}
            </span>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5">
            <span className="text-[10px] text-slate-400 block">الاحتجاز النهائي (Terminal Retention)</span>
            <span className="text-sm font-bold font-mono tabular-nums text-slate-200 block mt-0.5">
              {activeTerminalMethod === 1
                ? 'غير منطبق (النمط 1)'
                : formatPct(terminalRetention, 1)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. RIM Governance Parameters Grid (Single Save Path via ValuationParameterCard) */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3 text-xs" data-testid="rim-parameters-grid">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div>
            <h5 className="font-bold text-slate-100">
              معاملات نموذج الدخل المتبقي (RIM) وحوكمة المرحلة النهائية
            </h5>
            <p className="text-[11px] text-slate-400 mt-0.5">
              التجربة المؤقتة تعيد الحساب محلياً دون كتابة؛ الحفظ للشركة يذهب إلى{' '}
              <span className="font-mono text-slate-300">company_assumptions</span> والمرجع العام إلى{' '}
              <span className="font-mono text-slate-300">macro_params</span> (للمدير فقط).
            </p>
          </div>
          <span className="text-[10px] font-mono px-2 py-1 rounded bg-slate-900 border border-slate-700 text-cyan-300 shrink-0">
            الطريقة النشطة: {formatRimTerminalMethodLabel(activeTerminalMethod)}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rimFields.map((field) => {
            const reqInfo = requirementsByKey[field.registryKey];
            const companyOverride = companyOverridesMap[field.registryKey];
            const globalMeta = macroMetaMap?.[field.registryKey];
            const isInactive = reqInfo?.status === 'inactive';

            return (
              <ValuationParameterCard
                key={field.registryKey}
                field={field}
                companyId={company.id}
                ticker={company.ticker}
                savedCompanyValue={companyOverride?.value ?? null}
                globalReferenceValue={paramsMap[field.registryKey] ?? null}
                savedCompanyMeta={
                  companyOverride
                    ? { source: companyOverride.source, asOfDate: companyOverride.asOfDate }
                    : undefined
                }
                globalMeta={
                  globalMeta
                    ? { source: globalMeta.source, asOfDate: globalMeta.asOfDate }
                    : undefined
                }
                resolved={resolved[field.resolvedKey]}
                sensitivityValue={sensitivityDrafts[field.registryKey]}
                canEditCompany={canEditCompanyParams}
                isAdmin={isAdmin}
                isBusy={isKeyBusy(field.registryKey) || isKeyBusy(`macro:${field.registryKey}`)}
                onSetSensitivityDraft={onSetSensitivityDraft}
                onSaveCompanyOverride={onCommitCompanyOverride}
                onDeleteCompanyOverride={onCommitDeleteCompanyOverride}
                onSaveGlobalMacro={onCommitGlobalMacro}
                stageLabelAr={reqInfo?.stageLabelAr}
                stageEffectAr={reqInfo?.stageEffectAr}
                requirementBadgeAr={reqInfo?.requirementBadgeAr}
                inactiveForMethod={isInactive}
                inactiveReasonAr={reqInfo?.inactiveReasonAr}
                missingRequirementAr={reqInfo?.missingRequirementAr}
                showRichDetails
              />
            );
          })}
        </div>
      </div>

      {/* 3. Exclusion Banner (if RIM is excluded) */}
      {rimAudit && !rimAudit.eligible && rimAudit.exclusionReasonAr && (
        <div
          className="bg-amber-950/35 border border-amber-800/60 rounded-xl p-3.5 text-xs text-amber-200 flex items-start gap-2.5"
          data-testid="rim-exclusion-banner"
        >
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-amber-100">نموذج RIM مستبعد حالياً من القيمة العادلة المركبة</div>
            <div>{rimAudit.exclusionReasonAr}</div>
          </div>
        </div>
      )}

      {/* 4. Core Reconciliation & Value Components Panel (Directly from Engine Outputs) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs" data-testid="rim-core-metrics">
        <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1">
          <span className="text-slate-400 block">القيمة الدفترية الافتتاحية (B₀)</span>
          <span className="text-lg font-bold font-mono tabular-nums text-white block">
            {formatNum(rimAudit?.openingBvps ?? effectiveMetrics.bvps, 2, finCurrencyLabel)}
          </span>
          <span className="text-[10px] text-slate-400 block">
            {rimAudit?.bvpsBasisLabelAr || effectiveMetrics.bvpsBasisLabelAr || 'غير متاح'}
          </span>
        </div>

        <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1">
          <span className="text-slate-400 block">عدد الأسهم المعتمد لحساب B₀</span>
          <span className="text-lg font-bold font-mono tabular-nums text-white block">
            {rimAudit?.effectiveSharesUsed !== null && rimAudit?.effectiveSharesUsed !== undefined
              ? rimAudit.effectiveSharesUsed.toLocaleString('en-US')
              : 'غير متاح'}
          </span>
          <span className="text-[10px] text-slate-400 block">
            {rimAudit?.effectiveSharesSourceLabelAr || 'غير متاح'}
          </span>
        </div>

        <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1">
          <span className="text-slate-400 block">تكلفة حقوق الملكية (Ke)</span>
          <span className="text-lg font-bold font-mono tabular-nums text-emerald-400 block">
            {formatPct(activeCostOfEquity)}
          </span>
          <span className="text-[10px] text-slate-400 block">
            {forwardRoe !== null && activeCostOfEquity !== null
              ? `فارق العائد المستقبلي عن Ke: ${((forwardRoe - activeCostOfEquity) * 100).toFixed(2)}%`
              : 'مطلوبة لخصم الدخل المتبقي وحساب عبء الملكية'}
          </span>
        </div>

        <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-1">
          <span className="text-slate-400 block">حصة القيمة النهائية (Terminal Share)</span>
          <span
            className={`text-lg font-bold font-mono tabular-nums block ${
              terminalShareState.isHighWarning ? 'text-amber-300' : 'text-cyan-300'
            }`}
          >
            {terminalShareState.valueText}
          </span>
          <span className="text-[10px] text-slate-400 block">{terminalShareState.formulaAr}</span>
        </div>
      </div>

      {/* 5. Terminal Stage Definition & Value Decomposition */}
      {rimAudit && (
        <div
          className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3 text-xs"
          data-testid="rim-terminal-summary"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h5 className="font-bold text-slate-100">تفصيل المرحلة النهائية ومكوّنات القيمة العادلة</h5>
              <div className="text-[11px] text-cyan-300 mt-0.5">
                {rimAudit.terminalMethodLabelAr || formatRimTerminalMethodLabel(rimAudit.terminalMethod)}
              </div>
              {rimAudit.terminalFormulaAr && (
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                  المعادلة: {rimAudit.terminalFormulaAr}
                </div>
              )}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-300">
              مضاعف P/B الضمني:{' '}
              <strong className="text-white">
                {rimAudit.impliedPB !== null ? `${rimAudit.impliedPB.toFixed(2)}x` : 'غير متاح'}
              </strong>{' '}
              · السوق:{' '}
              <strong className="text-slate-300">
                {effectiveMetrics.pbTTM !== null ? `${effectiveMetrics.pbTTM.toFixed(2)}x` : 'غير متاح'}
              </strong>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono tabular-nums">
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-400 font-sans block">g_B النهائي (ROE_term × b_term)</span>
              <strong className="text-slate-100">
                {rimAudit.terminalGrowthRateB !== null && rimAudit.terminalGrowthRateB !== undefined
                  ? formatPct(rimAudit.terminalGrowthRateB)
                  : activeTerminalMethod === 1
                  ? 'غير منطبق'
                  : 'غير متاح'}
              </strong>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-400 font-sans block">سنوات التلاشي (Fade Years)</span>
              <strong className="text-slate-100">
                {rimAudit.fadeYears !== null && rimAudit.fadeYears !== undefined
                  ? `${rimAudit.fadeYears} سنة`
                  : activeTerminalMethod === 1 || activeTerminalMethod === 3
                  ? 'غير منطبق'
                  : 'غير متاح'}
              </strong>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-400 font-sans block">PV(RI 1..5) + PV(Terminal)</span>
              <strong className="text-cyan-300">
                {formatNum(rimAudit.pvResidualIncome5Y, 3)} + {formatNum(rimAudit.pvTerminalRi, 3)}
              </strong>
            </div>
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5">
              <span className="text-[10px] text-slate-400 font-sans block">القيمة الخام / المعتمدة</span>
              <strong className="text-white">
                {formatNum(rimAudit.rawRimFairValue, 2)} / {formatNum(rimAudit.rimFairValue, 2)}
                {finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}
              </strong>
            </div>
          </div>

          {rimAudit.rawClippedToZero && (
            <div
              className="bg-amber-950/40 border border-amber-700/70 rounded-lg px-3 py-2 text-[11px] text-amber-200 flex items-start gap-2"
              data-testid="rim-negative-clip-banner"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                {rimAudit.rawClippedReasonAr ||
                  `الناتج الخام سالب (${formatNum(rimAudit.rawRimFairValue, 2)}) وتم ضبط القيمة النهائية عند 0.00 وفق مبدأ المسؤولية المحدودة.`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 6. 5-Year Projected Forecast Table */}
      {rimAudit && rimAudit.years.length > 0 && (
        <div
          className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3 text-xs"
          data-testid="rim-audit-schedule"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
            <div>
              <h5 className="font-bold text-slate-100">
                جدول تدقيق الفائض النظيف لمدة 5 سنوات (RIM Clean-Surplus Schedule)
              </h5>
              <div className="text-[10px] text-slate-400 mt-0.5">
                أرقام تقديرية ومستقبلية ضمنية للنموذج (ليست أرقاماً تاريخية فعلية) · المعادلة:{' '}
                <span className="font-mono text-cyan-300">RI_t = (ROE − Ke) × B_(t−1)</span> ·{' '}
                <span className="font-mono text-slate-300">B_t = B_(t−1) + E_t − D_t</span> · تحقق الفائض النظيف:{' '}
                <span
                  className={
                    rimAudit.cleanSurplusVerified ? 'text-emerald-400 font-semibold' : 'text-amber-300'
                  }
                >
                  {rimAudit.cleanSurplusVerified ? 'متطابق حسابياً' : 'يتطلب مراجعة'}
                </span>
              </div>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-cyan-300">
              PV(RI 1..5): {formatNum(rimAudit.pvResidualIncome5Y, 2)} · PV(Terminal RI):{' '}
              {formatNum(rimAudit.pvTerminalRi, 2)}
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full text-[11px] font-mono tabular-nums text-end border-collapse">
              <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 font-sans">
                <tr>
                  <th className="px-2.5 py-2 text-start">السنة (تقديري)</th>
                  <th className="px-2.5 py-2">B_(t-1) الافتتاحية</th>
                  <th className="px-2.5 py-2">EPS المتوقعة</th>
                  <th className="px-2.5 py-2">الاحتجاز</th>
                  <th className="px-2.5 py-2">DPS الضمنية</th>
                  <th className="px-2.5 py-2">عبء الملكية (Ke×B)</th>
                  <th className="px-2.5 py-2 text-cyan-300">الدخل المتبقي (RI)</th>
                  <th className="px-2.5 py-2">B_t الختامية</th>
                  <th className="px-2.5 py-2">معامل الخصم</th>
                  <th className="px-2.5 py-2 text-emerald-300">PV(RI)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {rimAudit.years.map((row) => (
                  <tr key={row.year}>
                    <td className="px-2.5 py-1.5 text-start font-bold text-slate-200">Y{row.year}</td>
                    <td className="px-2.5 py-1.5 text-slate-200">{row.openingBvps.toFixed(3)}</td>
                    <td className="px-2.5 py-1.5 text-slate-300">{row.expectedEps.toFixed(3)}</td>
                    <td className="px-2.5 py-1.5 text-slate-400">{(row.retentionRatio * 100).toFixed(1)}%</td>
                    <td className="px-2.5 py-1.5 text-slate-300">{row.impliedDps.toFixed(3)}</td>
                    <td className="px-2.5 py-1.5 text-slate-400">{row.equityCharge.toFixed(3)}</td>
                    <td
                      className={`px-2.5 py-1.5 font-semibold ${
                        row.residualIncome >= 0 ? 'text-cyan-300' : 'text-red-300'
                      }`}
                    >
                      {row.residualIncome.toFixed(3)}
                    </td>
                    <td className="px-2.5 py-1.5 text-slate-200">{row.closingBvps.toFixed(3)}</td>
                    <td className="px-2.5 py-1.5 text-slate-400">{row.discountFactor.toFixed(4)}</td>
                    <td
                      className={`px-2.5 py-1.5 font-bold ${
                        row.presentValueRi >= 0 ? 'text-emerald-300' : 'text-red-300'
                      }`}
                    >
                      {row.presentValueRi.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] font-mono tabular-nums bg-slate-900/60 border border-slate-800 rounded-lg p-2.5">
            <div>
              <span className="text-slate-400 font-sans block">B₀ (نقطة البداية)</span>
              <strong className="text-slate-100">{formatNum(rimAudit.openingBvps, 3)}</strong>
            </div>
            <div>
              <span className="text-slate-400 font-sans block">مجموع PV(RI 5Y)</span>
              <strong className="text-emerald-300">{formatNum(rimAudit.pvResidualIncome5Y, 3)}</strong>
            </div>
            <div>
              <span className="text-slate-400 font-sans block">B₅ (النهاية) / Terminal RI</span>
              <strong className="text-slate-200">
                {formatNum(rimAudit.terminalClosingBvps, 2)} / {formatNum(rimAudit.terminalRi, 2)}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 font-sans block">PV(Terminal RI)</span>
              <strong className="text-cyan-300">{formatNum(rimAudit.pvTerminalRi, 3)}</strong>
            </div>
            <div>
              <span className="text-slate-400 font-sans block">الناتج الخام / المعتمد</span>
              <strong className="text-white">
                {formatNum(rimAudit.rawRimFairValue, 2)} / {formatNum(rimAudit.rimFairValue, 2)}
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* 7. Fade Schedule Section (Strictly Distinguishes Not Applicable vs Unavailable vs Empty vs Rows) */}
      <div
        className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3 text-xs"
        data-testid="rim-fade-schedule"
        data-fade-state={fadeState.kind}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div>
            <h5 className="font-bold text-slate-100">جدول مرحلة التلاشي (Fade Schedule)</h5>
            <p className="text-[11px] text-slate-400 mt-0.5">{fadeState.descriptionAr}</p>
          </div>
          <span
            className={`text-[10px] px-2 py-0.5 rounded border font-semibold shrink-0 ${
              fadeState.kind === 'available'
                ? 'bg-emerald-950/70 border-emerald-800/60 text-emerald-300'
                : fadeState.kind === 'not_applicable'
                ? 'bg-slate-900 border-slate-700 text-slate-300'
                : 'bg-amber-950/60 border-amber-800/60 text-amber-300'
            }`}
          >
            {fadeState.badgeAr}
          </span>
        </div>

        {fadeState.kind === 'available' && (
          <>
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-[11px] font-mono tabular-nums text-end border-collapse">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 font-sans">
                  <tr>
                    <th className="px-2.5 py-2 text-start">السنة (تلاشي)</th>
                    <th className="px-2.5 py-2">B_(t-1)</th>
                    <th className="px-2.5 py-2 text-cyan-300">ROE المتلاشي</th>
                    <th className="px-2.5 py-2">EPS المتوقعة</th>
                    <th className="px-2.5 py-2">الاحتجاز</th>
                    <th className="px-2.5 py-2">DPS الضمنية</th>
                    <th className="px-2.5 py-2">عبء الملكية</th>
                    <th className="px-2.5 py-2 text-cyan-300">RI</th>
                    <th className="px-2.5 py-2">B_t الختامية</th>
                    <th className="px-2.5 py-2">معامل الخصم</th>
                    <th className="px-2.5 py-2 text-emerald-300">PV(RI)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {fadeState.rows.map((fRow) => (
                    <tr key={fRow.year}>
                      <td className="px-2.5 py-1.5 text-start font-bold text-slate-200">Y{fRow.year}</td>
                      <td className="px-2.5 py-1.5 text-slate-200">{fRow.openingBvps.toFixed(3)}</td>
                      <td className="px-2.5 py-1.5 text-cyan-300">{(fRow.roeRate * 100).toFixed(2)}%</td>
                      <td className="px-2.5 py-1.5 text-slate-300">{fRow.expectedEps.toFixed(3)}</td>
                      <td className="px-2.5 py-1.5 text-slate-400">{(fRow.retentionRatio * 100).toFixed(1)}%</td>
                      <td className="px-2.5 py-1.5 text-slate-300">{fRow.impliedDps.toFixed(3)}</td>
                      <td className="px-2.5 py-1.5 text-slate-400">{fRow.equityCharge.toFixed(3)}</td>
                      <td
                        className={`px-2.5 py-1.5 font-semibold ${
                          fRow.residualIncome >= 0 ? 'text-cyan-300' : 'text-red-300'
                        }`}
                      >
                        {fRow.residualIncome.toFixed(3)}
                      </td>
                      <td className="px-2.5 py-1.5 text-slate-200">{fRow.closingBvps.toFixed(3)}</td>
                      <td className="px-2.5 py-1.5 text-slate-400">{fRow.discountFactor.toFixed(4)}</td>
                      <td
                        className={`px-2.5 py-1.5 font-bold ${
                          fRow.presentValueRi >= 0 ? 'text-emerald-300' : 'text-red-300'
                        }`}
                      >
                        {fRow.presentValueRi.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 text-slate-300">
              <span>
                القيمة المستمرة بعد التلاشي (Post-Fade TV):{' '}
                <strong className="text-slate-100">{formatNum(rimAudit?.postFadeContinuationTv, 3)}</strong>
              </span>
              <span>
                القيمة الحالية لها عند السنة {5 + fadeState.rows.length}:{' '}
                <strong className="text-cyan-300">{formatNum(rimAudit?.pvPostFadeContinuationTv, 3)}</strong>
              </span>
            </div>
          </>
        )}
      </div>

      {/* 8. Consistency Checks & Audit Verification (Never Treats Missing as Passed) */}
      <div
        className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2.5 text-xs"
        data-testid="rim-consistency-checks"
        data-consistency-state={consistencyState.kind}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            {consistencyState.kind === 'available' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <h5 className="font-bold text-slate-100">فحوصات الاتساق الحسابي والتدقيق (Consistency Checks)</h5>
          </div>
          <span
            className={`text-[10px] px-2 py-0.5 rounded border font-semibold shrink-0 ${
              consistencyState.kind === 'available'
                ? 'bg-emerald-950/70 border-emerald-800/60 text-emerald-300'
                : 'bg-amber-950/60 border-amber-800/60 text-amber-300'
            }`}
          >
            {consistencyState.badgeAr}
          </span>
        </div>

        <p className="text-[11px] text-slate-400">{consistencyState.descriptionAr}</p>

        {consistencyState.kind === 'available' && (
          <ul className="space-y-1.5 text-[11px] text-slate-200 leading-relaxed">
            {consistencyState.checks.map((item, idx) => (
              <li
                key={idx}
                className="bg-slate-900/60 border border-slate-800/80 rounded-lg px-3 py-1.5"
              >
                • {item}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 9. Methodology Documentation */}
      <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-300 leading-relaxed flex items-start gap-2">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-white">توثيق معادلة أفق RIM: </span>
          {effectiveValuation.sourcesSummary?.rimMethodologyNoteAr ||
            'يعتمد نموذج RIM أفق 5 سنوات صريحاً متبوعاً بطريقة قيمة نهائية صريحة (1 أو 2 أو 3) مع تحقق Clean Surplus وشرط Ke > 0.'}
        </div>
      </div>
    </div>
  );
};
