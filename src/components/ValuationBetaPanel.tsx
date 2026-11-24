/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Check, FlaskConical, RotateCcw, Trash2 } from 'lucide-react';
import type { BetaAssumptionRecord, CompanyParameterOverride } from '../types/financial';
import type { BetaStatus } from '../types/financial';
import { describeBetaEffectiveSource } from '../core/domain';

export interface ValuationBetaPanelProps {
  ticker: string;
  companyId: string;
  betaRecord: BetaAssumptionRecord | null;
  analyticalOverride: CompanyParameterOverride | null;
  betaRaw: number | null;
  betaAdjusted: number | null;
  effectiveBetaForKe: number | null;
  betaStatus?: BetaStatus;
  betaSourceNoteAr?: string;
  betaPolicyConflictAr?: string | null;
  betaRawWeight: number | null;
  betaAnchor: number | null;
  betaConfirmed?: boolean;
  betaError?: boolean;
  draftBeta?: number;
  draftAnalyticalBeta?: number;
  canEdit: boolean;
  isBusy?: boolean;
  onSetDraftBeta: (val: number | null) => void;
  onSetDraftAnalyticalBeta: (val: number | null) => void;
  onSaveBetaAssumption?: (record: BetaAssumptionRecord) => Promise<void>;
  onDeleteBetaAssumption?: (ticker: string) => Promise<void>;
  onSaveAnalyticalBeta?: (input: { value: number; source: string; asOfDate: string }) => Promise<void>;
  onDeleteAnalyticalBeta?: () => Promise<void>;
}

export const ValuationBetaPanel: React.FC<ValuationBetaPanelProps> = ({
  ticker,
  companyId,
  betaRecord,
  analyticalOverride,
  betaRaw,
  betaAdjusted,
  effectiveBetaForKe,
  betaStatus,
  betaSourceNoteAr,
  betaPolicyConflictAr,
  betaRawWeight,
  betaAnchor,
  betaConfirmed = true,
  betaError = false,
  draftBeta,
  draftAnalyticalBeta,
  canEdit,
  isBusy = false,
  onSetDraftBeta,
  onSetDraftAnalyticalBeta,
  onSaveBetaAssumption,
  onDeleteBetaAssumption,
  onSaveAnalyticalBeta,
  onDeleteAnalyticalBeta,
}) => {
  const todayIso = new Date().toISOString().slice(0, 10);

  // Historical beta_assumptions form state (never auto-filled with 1 for persistence)
  const [histVal, setHistVal] = useState<string>(() =>
    draftBeta !== undefined ? String(draftBeta) : betaRecord ? String(betaRecord.beta) : ''
  );
  const [histSource, setHistSource] = useState<string>(() => betaRecord?.source || '');
  const [histDate, setHistDate] = useState<string>(() => betaRecord?.asOfDate || todayIso);
  const [histError, setHistError] = useState<string | null>(null);

  // Optional Beta_Analytical form state (company_assumptions/{TK}/parameters/Beta_Analytical)
  const [anaVal, setAnaVal] = useState<string>(() =>
    draftAnalyticalBeta !== undefined
      ? String(draftAnalyticalBeta)
      : analyticalOverride
      ? String(analyticalOverride.value)
      : ''
  );
  const [anaSource, setAnaSource] = useState<string>(() => analyticalOverride?.source || 'تقدير تحليلي مستقل');
  const [anaDate, setAnaDate] = useState<string>(() => analyticalOverride?.asOfDate || todayIso);
  const [anaError, setAnaError] = useState<string | null>(null);

  useEffect(() => {
    setHistVal(draftBeta !== undefined ? String(draftBeta) : betaRecord ? String(betaRecord.beta) : '');
    setHistSource(betaRecord?.source || '');
    setHistDate(betaRecord?.asOfDate || todayIso);
    setHistError(null);
  }, [companyId, betaRecord, draftBeta]);

  useEffect(() => {
    setAnaVal(
      draftAnalyticalBeta !== undefined
        ? String(draftAnalyticalBeta)
        : analyticalOverride
        ? String(analyticalOverride.value)
        : ''
    );
    setAnaSource(analyticalOverride?.source || 'تقدير تحليلي مستقل');
    setAnaDate(analyticalOverride?.asOfDate || todayIso);
    setAnaError(null);
  }, [companyId, analyticalOverride, draftAnalyticalBeta]);

  const parseBetaNum = (raw: string, setErr: (m: string | null) => void): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setErr('أدخل قيمة بيتا رقمية منتهية ضمن [-10, 10].');
      return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < -10 || parsed > 10) {
      setErr('قيمة بيتا يجب أن تكون رقماً منتهياً بين -10 و 10.');
      return null;
    }
    setErr(null);
    return parsed;
  };

  const effectiveBetaPresentation = describeBetaEffectiveSource({
    betaStatus,
    betaSourceNoteAr,
    effectiveBetaForKe,
    savedAnalyticalBetaValue: analyticalOverride?.value ?? null,
    draftBeta,
    draftAnalyticalBeta,
    betaConfirmed,
    betaError,
  });

  const badgeCls =
    effectiveBetaPresentation.badgeTone === 'purple'
      ? 'bg-purple-950/70 text-purple-300 border-purple-800/60'
      : effectiveBetaPresentation.badgeTone === 'emerald'
      ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
      : effectiveBetaPresentation.badgeTone === 'amber'
      ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
      : 'bg-red-950/60 text-red-300 border-red-800/60';

  return (
    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Activity className="w-4 h-4 text-sky-400" />
          <h4 className="font-bold text-slate-100">
            حوكمة معامل بيتا (Beta التاريخية الخام ← Blume المعدلة ← Beta_Analytical الاختياري)
          </h4>
          <span
            data-testid="beta-panel-effective-source-badge"
            className={`text-[10px] px-2 py-0.5 rounded border font-mono ${badgeCls}`}
          >
            {effectiveBetaPresentation.shortBadgeAr}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
          <span>
            بيتا الخام:{' '}
            <strong className="text-slate-100">{betaRaw !== null ? betaRaw.toFixed(3) : 'غير متاح'}</strong>
          </span>
          <span className="text-slate-600">|</span>
          <span>
            بيتا المعدلة (Blume):{' '}
            <strong className="text-sky-300">{betaAdjusted !== null ? betaAdjusted.toFixed(3) : 'غير متاح'}</strong>
          </span>
          <span className="text-slate-600">|</span>
          <span>
            المطبقة في Ke:{' '}
            <strong className="text-emerald-400">
              {effectiveBetaForKe !== null ? effectiveBetaForKe.toFixed(3) : 'غير متاح'}
            </strong>
          </span>
        </div>
      </div>

      {betaPolicyConflictAr && (
        <div
          role="alert"
          className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/70 text-amber-200 flex items-start gap-2 text-[11px]"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{betaPolicyConflictAr}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1. Authoritative Historical Beta (beta_assumptions/{Ticker}) */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-bold text-slate-100">
                1. سجل بيتا التاريخية الخام (<span className="font-mono text-sky-300">beta_assumptions/{ticker}</span>)
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {betaSourceNoteAr || 'تُقرأ من beta_assumptions؛ لا تُحفظ القيمة 1.00 تلقائياً عند غياب السجل.'}
              </div>
            </div>
            {betaRecord && canEdit && onDeleteBetaAssumption && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void onDeleteBetaAssumption(ticker)}
                className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-red-300 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                <span>حذف السجل</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">قيمة بيتا الخام</label>
              <input
                type="number"
                step="0.01"
                disabled={isBusy}
                value={histVal}
                placeholder="مثل 1.05"
                aria-label="قيمة بيتا التاريخية الخام"
                onChange={(e) => {
                  setHistVal(e.target.value);
                  if (histError) setHistError(null);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">تاريخ القياس (إلزامي)*</label>
              <input
                type="date"
                disabled={isBusy}
                value={histDate}
                aria-label="تاريخ قياس بيتا التاريخية"
                onChange={(e) => {
                  setHistDate(e.target.value);
                  if (histError) setHistError(null);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 font-mono text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">المصدر الموثق (إلزامي)*</label>
              <input
                type="text"
                disabled={isBusy}
                value={histSource}
                placeholder="مثال: EGX Beta 5Y Weekly"
                aria-label="مصدر بيتا التاريخية"
                onChange={(e) => {
                  setHistSource(e.target.value);
                  if (histError) setHistError(null);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="text-[10px] text-slate-400 font-mono">
              Blume = ({betaRawWeight ?? '-'} × خام) + ({betaRawWeight !== null ? Number((1 - betaRawWeight).toFixed(3)) : '-'} × {betaAnchor ?? '-'})
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  const num = parseBetaNum(histVal, setHistError);
                  if (num !== null) onSetDraftBeta(num);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-950/80 hover:bg-purple-900 border border-purple-700/70 text-purple-200 text-[10px] font-semibold"
              >
                <FlaskConical className="w-3 h-3" />
                <span>تجربة مؤقتة</span>
              </button>
              {draftBeta !== undefined && (
                <button
                  type="button"
                  onClick={() => onSetDraftBeta(null)}
                  className="inline-flex items-center gap-1 text-[10px] text-purple-300 hover:text-purple-200"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>إلغاء</span>
                </button>
              )}
              {canEdit && onSaveBetaAssumption && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    const num = parseBetaNum(histVal, setHistError);
                    if (num === null) return;
                    if (!histSource.trim()) {
                      setHistError('المصدر إلزامي قبل حفظ سجل beta_assumptions.');
                      return;
                    }
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(histDate.trim())) {
                      setHistError('تاريخ القياس (YYYY-MM-DD) إلزامي قبل الحفظ.');
                      return;
                    }
                    void onSaveBetaAssumption({
                      ticker,
                      beta: num,
                      source: histSource.trim(),
                      asOfDate: histDate.trim(),
                    });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-semibold disabled:opacity-50"
                >
                  <Check className="w-3 h-3" />
                  <span>حفظ في beta_assumptions</span>
                </button>
              )}
            </div>
          </div>

          {histError && <div className="text-[10px] text-red-400">{histError}</div>}
        </div>

        {/* 2. Optional Analytical Beta Override (company_assumptions/{Ticker}/parameters/Beta_Analytical) */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-bold text-slate-100">
                2. تقدير بيتا التحليلي الاختياري (<span className="font-mono text-emerald-300">Beta_Analytical</span>)
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                مسار تحليلي للشركة منفصل عن بيتا التاريخية؛ لا يعدل سجل beta_assumptions وعند تفعيله يُستخدم مباشرة في حساب Ke.
              </div>
            </div>
            {analyticalOverride && canEdit && onDeleteAnalyticalBeta && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void onDeleteAnalyticalBeta()}
                className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-amber-300 disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                <span>مسح التقدير</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">Beta_Analytical</label>
              <input
                type="number"
                step="0.01"
                disabled={isBusy}
                value={anaVal}
                placeholder="بلا تخصيص تحليلي"
                aria-label="قيمة Beta_Analytical التحليلية"
                onChange={(e) => {
                  setAnaVal(e.target.value);
                  if (anaError) setAnaError(null);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">تاريخ التقدير*</label>
              <input
                type="date"
                disabled={isBusy}
                value={anaDate}
                aria-label="تاريخ تقدير Beta_Analytical"
                onChange={(e) => {
                  setAnaDate(e.target.value);
                  if (anaError) setAnaError(null);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-400 mb-1">سبب / مصدر التقدير*</label>
              <input
                type="text"
                disabled={isBusy}
                value={anaSource}
                placeholder="مثال: Bottom-up Peer Beta"
                aria-label="مصدر Beta_Analytical"
                onChange={(e) => {
                  setAnaSource(e.target.value);
                  if (anaError) setAnaError(null);
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="text-[10px] text-slate-400">
              {analyticalOverride
                ? `محفوظ حالياً: ${analyticalOverride.value.toFixed(3)} (${analyticalOverride.source || '-'})`
                : 'غير مخصص — يستخدم Ke قيمة بيتا المعدلة (Blume).'}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  const num = parseBetaNum(anaVal, setAnaError);
                  if (num !== null) onSetDraftAnalyticalBeta(num);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-950/80 hover:bg-purple-900 border border-purple-700/70 text-purple-200 text-[10px] font-semibold"
              >
                <FlaskConical className="w-3 h-3" />
                <span>تجربة مؤقتة</span>
              </button>
              {draftAnalyticalBeta !== undefined && (
                <button
                  type="button"
                  onClick={() => onSetDraftAnalyticalBeta(null)}
                  className="inline-flex items-center gap-1 text-[10px] text-purple-300 hover:text-purple-200"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>إلغاء</span>
                </button>
              )}
              {canEdit && onSaveAnalyticalBeta && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    const num = parseBetaNum(anaVal, setAnaError);
                    if (num === null) return;
                    if (!anaSource.trim()) {
                      setAnaError('أدخل مصدر أو مبرر التقدير التحليلي.');
                      return;
                    }
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(anaDate.trim())) {
                      setAnaError('أدخل تاريخاً صالحاً بصيغة YYYY-MM-DD.');
                      return;
                    }
                    void onSaveAnalyticalBeta({
                      value: num,
                      source: anaSource.trim(),
                      asOfDate: anaDate.trim(),
                    });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold disabled:opacity-50"
                >
                  <Check className="w-3 h-3" />
                  <span>حفظ Beta_Analytical</span>
                </button>
              )}
            </div>
          </div>

          {anaError && <div className="text-[10px] text-red-400">{anaError}</div>}
        </div>
      </div>
    </div>
  );
};
