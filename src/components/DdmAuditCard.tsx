/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, FlaskConical, Info, XCircle } from 'lucide-react';
import type { DdmAuditSummary } from '../types/financial';

interface DdmAuditCardProps {
  ddmAudit: DdmAuditSummary | null | undefined;
  finCurrencyLabel?: string | null;
  onOpenDividendRecords?: () => void;
}

const fmtCurrencyVal = (val: number | null | undefined, currency?: string | null): string => {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'غير متاح';
  return `${val.toFixed(2)}${currency ? ` ${currency}` : ''}`;
};

const fmtPct = (val: number | null | undefined, digits = 2): string => {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'غير متاح';
  return `${(val * 100).toFixed(digits)}%`;
};

const translateSourceAr = (source: DdmAuditSummary['source']): string => {
  if (source === 'dividend_records') return 'DPS_Actual (التوزيعات الفعلية المعتمدة)';
  if (source === 'confirmed_no_dividend') return 'سنة مؤكدة بدون توزيع نقدي';
  return 'غير متاح';
};

export const DdmAuditCard: React.FC<DdmAuditCardProps> = ({
  ddmAudit,
  finCurrencyLabel,
  onOpenDividendRecords,
}) => {
  if (!ddmAudit) return null;

  const hasSensitivity =
    ddmAudit.sensitivityMatrix.length > 0 &&
    ddmAudit.sensitivityKeAxis.length > 0 &&
    ddmAudit.sensitivityGrowthAxis.length > 0;

  const isSensitivityDraft =
    Boolean(ddmAudit.isSensitivityDraft) || ddmAudit.growthSource === 'sensitivity_draft';

  return (
    <div
      className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-4 text-xs"
      data-testid="ddm-audit-card"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {ddmAudit.eligible ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <h5 className="font-bold text-slate-100 text-sm">
            بطاقة تدقيق نموذج خصم التوزيعات (DDM_Audit)
          </h5>
          <span
            className={`text-[10px] px-2 py-0.5 rounded border font-mono ${
              ddmAudit.eligible
                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                : 'bg-amber-950/70 text-amber-300 border-amber-800/60'
            }`}
          >
            {ddmAudit.eligible ? 'مؤهل للتقييم' : `مستبعد (${ddmAudit.basisStatus})`}
          </span>
          {isSensitivityDraft && (
            <span
              data-testid="ddm-audit-sensitivity-badge"
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-semibold bg-purple-950/70 text-purple-200 border-purple-700/70"
            >
              <FlaskConical className="w-3 h-3" />
              <span>مسودة حساسية مؤقتة — غير محفوظة</span>
            </span>
          )}
        </div>
        <div className="text-[11px] font-mono text-slate-400">
          القيمة العادلة DDM:{' '}
          <strong className={ddmAudit.ddmFairValue !== null ? 'text-teal-300' : 'text-amber-300'}>
            {fmtCurrencyVal(ddmAudit.ddmFairValue, finCurrencyLabel)}
          </strong>
        </div>
      </div>

      {isSensitivityDraft && (
        <div
          data-testid="ddm-audit-sensitivity-notice"
          className="p-2.5 rounded-lg bg-purple-950/35 border border-purple-700/60 text-purple-200 flex items-start gap-2 text-[11px] leading-relaxed"
        >
          <FlaskConical className="w-4 h-4 text-purple-300 shrink-0 mt-0.5" />
          <span>
            مخرجات هذا التدقيق تعكس <strong>مسودة حساسية مؤقتة في الذاكرة فقط</strong> لقيمة{' '}
            <span className="font-mono">DDM_Growth</span> وليست افتراضاً محفوظاً في{' '}
            <span className="font-mono">company_assumptions</span> أو{' '}
            <span className="font-mono">macro_params</span>.
          </span>
        </div>
      )}

      {/* Gordon Growth Parameters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
          <span className="text-[10px] text-slate-400 block">D0 (توزيع السهم الأساسي)</span>
          <span className="font-mono font-bold text-slate-100 mt-0.5 block">
            {fmtCurrencyVal(ddmAudit.d0, finCurrencyLabel)}
          </span>
        </div>
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
          <span className="text-[10px] text-slate-400 block">D1 = D0 × (1 + g)</span>
          <span className="font-mono font-bold text-emerald-300 mt-0.5 block">
            {fmtCurrencyVal(ddmAudit.d1, finCurrencyLabel)}
          </span>
        </div>
        <div
          className={`rounded-lg p-2.5 border ${
            isSensitivityDraft
              ? 'bg-purple-950/30 border-purple-700/70'
              : 'bg-slate-900/90 border-slate-800'
          }`}
        >
          <span className="text-[10px] text-slate-400 block">معدل النمو (g)</span>
          <span className="font-mono font-bold text-slate-200 mt-0.5 block">
            {ddmAudit.growthSource === 'loading_unconfirmed'
              ? 'قيد تأكيد التحميل'
              : fmtPct(ddmAudit.growth)}
          </span>
          {ddmAudit.growthSourceLabelAr && (
            <span
              data-testid="ddm-audit-growth-source"
              className={`text-[9px] block mt-0.5 leading-snug ${
                isSensitivityDraft ? 'text-purple-200 font-semibold' : 'text-slate-400'
              }`}
            >
              {ddmAudit.growthSourceLabelAr}
              {!isSensitivityDraft && ddmAudit.growthAsOfDate ? ` · ${ddmAudit.growthAsOfDate}` : ''}
            </span>
          )}
        </div>
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
          <span className="text-[10px] text-slate-400 block">تكلفة حقوق الملكية (Ke)</span>
          <span className="font-mono font-bold text-amber-300 mt-0.5 block">
            {fmtPct(ddmAudit.costOfEquity)}
          </span>
          {ddmAudit.keMode != null && (
            <span className="text-[9px] text-slate-400 block mt-0.5 font-mono">
              مشتقة (r_Mode={ddmAudit.keMode})
            </span>
          )}
        </div>
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
          <span className="text-[10px] text-slate-400 block">الهامش (Ke − g)</span>
          <span
            className={`font-mono font-bold mt-0.5 block ${
              ddmAudit.keMinusG !== null && ddmAudit.keMinusG > 0
                ? 'text-teal-300'
                : 'text-red-300'
            }`}
          >
            {fmtPct(ddmAudit.keMinusG)}
          </span>
        </div>
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2.5">
          <span className="text-[10px] text-slate-400 block">DDM = D1 / (Ke − g)</span>
          <span className="font-mono font-bold text-cyan-300 mt-0.5 block">
            {fmtCurrencyVal(ddmAudit.ddmFairValue, finCurrencyLabel)}
          </span>
        </div>
      </div>

      {/* Fiscal Year & Provenance Metadata */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          <span>
            سنة أساس DDM المعتمدة:{' '}
            <strong className="font-mono text-emerald-300">
              {ddmAudit.basisFiscalYear ?? 'غير متاحة'}
            </strong>
          </span>
          <span>
            أحدث سنة أحداث معروضة:{' '}
            <strong className="font-mono text-slate-100">
              {ddmAudit.displayLatestEventsYear ?? 'غير متاحة'}
            </strong>
          </span>
          <span>
            أحدث سنة توزيع موجب:{' '}
            <strong className="font-mono text-sky-300">
              {ddmAudit.latestPositiveDividendYear ?? 'غير متاحة'}
            </strong>
          </span>
          <span>
            المصدر: <strong className="text-slate-100">{translateSourceAr(ddmAudit.source)}</strong>
          </span>
          <span>
            حالة الاكتمال: <strong className="font-mono">{ddmAudit.completenessStatus}</strong>
          </span>
          <span>
            أسلوب الإدخال:{' '}
            <strong className="font-mono">{ddmAudit.inputMethod ?? 'غير محدد'}</strong>
          </span>
        </div>
        {onOpenDividendRecords && (
          <button
            type="button"
            data-testid="ddm-audit-open-dividends-btn"
            onClick={onOpenDividendRecords}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-300 text-[11px] font-semibold transition-colors shrink-0"
          >
            <ExternalLink className="w-3 h-3" />
            <span>فتح سجل التوزيعات الفعلية (DPS_Actual)</span>
          </button>
        )}
      </div>

      {/* Exclusion Reason or Governance Notes */}
      {ddmAudit.exclusionReasonAr && (
        <div className="p-3 rounded-lg bg-amber-950/35 border border-amber-800/60 text-amber-200 space-y-1.5 leading-relaxed">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{ddmAudit.exclusionReasonAr}</span>
          </div>
          {ddmAudit.remediationAr && (
            <div className="text-[11px] text-amber-100/90 pr-6">
              <strong>خطوة الاستكمال:</strong> {ddmAudit.remediationAr}
            </div>
          )}
        </div>
      )}

      {ddmAudit.stabilityWarningAr && (
        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-700/60 text-amber-200 flex items-start gap-2 leading-relaxed">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{ddmAudit.stabilityWarningAr}</span>
        </div>
      )}

      {ddmAudit.ddmVsRetentionDifferenceReasonAr && (
        <div className="p-3 rounded-lg bg-sky-950/30 border border-sky-800/60 text-sky-200 flex items-start gap-2 leading-relaxed">
          <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <span>{ddmAudit.ddmVsRetentionDifferenceReasonAr}</span>
        </div>
      )}

      <div className="space-y-1 text-[11px] text-slate-400 bg-slate-900/50 border border-slate-800/80 rounded-lg p-3 leading-relaxed">
        <div className="flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
          <span>{ddmAudit.perShareNoteAr}</span>
        </div>
        <div>• {ddmAudit.dataCompletenessNoteAr}</div>
        <div>• {ddmAudit.suitabilityNoteAr}</div>
      </div>

      {/* Read-only Local Sensitivity Table (Ke × g) */}
      {hasSensitivity && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-300">
            جدول الحساسية الموضعية لنموذج جوردون (Ke × g — للقراءة والتدقيق فقط)
          </div>
          <div className="overflow-x-auto border border-slate-800 rounded-lg">
            <table className="w-full text-[11px] font-mono tabular-nums text-center">
              <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-2 text-start font-sans border-l border-slate-800">Ke \ g</th>
                  {ddmAudit.sensitivityGrowthAxis.map((gVal, gIdx) => {
                    const isBaseG = gIdx === 2;
                    return (
                      <th
                        key={`g-${gIdx}`}
                        className={`p-2 ${isBaseG ? 'text-emerald-300 font-bold' : ''}`}
                      >
                        {(gVal * 100).toFixed(2)}%
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {ddmAudit.sensitivityMatrix.map((row, keIdx) => {
                  const keVal = ddmAudit.sensitivityKeAxis[keIdx];
                  const isBaseKe = keIdx === 2;
                  return (
                    <tr key={`ke-${keIdx}`}>
                      <td
                        className={`p-2 text-start border-l border-slate-800 bg-slate-900/60 ${
                          isBaseKe ? 'text-amber-300 font-bold' : 'text-slate-300'
                        }`}
                      >
                        {(keVal * 100).toFixed(2)}%
                      </td>
                      {row.map((cell, gIdx) => {
                        const isBaseCell = isBaseKe && gIdx === 2;
                        if (!cell.isValid || cell.fairValue === null) {
                          return (
                            <td
                              key={`cell-${keIdx}-${gIdx}`}
                              className="p-2 bg-red-950/30 text-red-300/90 text-[10px] font-sans"
                              title={cell.invalidReasonAr || 'غير صالح'}
                            >
                              {cell.invalidReasonAr || 'غير صالح'}
                            </td>
                          );
                        }
                        return (
                          <td
                            key={`cell-${keIdx}-${gIdx}`}
                            className={`p-2 ${
                              isBaseCell
                                ? 'bg-emerald-950/50 text-emerald-300 font-bold'
                                : 'text-slate-200'
                            }`}
                          >
                            {cell.fairValue.toFixed(2)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
