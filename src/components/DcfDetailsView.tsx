import React from 'react';
import type { FinancialMetricsTTM, ValuationResults } from '../types/financial';

const formatNum = (v: number | null | undefined, digits = 2) =>
  v == null ? 'غير متاح' : v.toFixed(digits);

export function DcfDetailsView({
  metrics,
  valuation,
}: {
  metrics: FinancialMetricsTTM;
  valuation: ValuationResults;
}) {
  const details = valuation.dcfDetails;
  const finCur = valuation.engineOutputs?.financialCurrency ?? metrics.financialCurrency ?? null;
  const perShareUnit = finCur === 'EGP' ? 'ج.م' : finCur === 'USD' ? 'USD' : '';
  const baseUnitLabel =
    finCur === 'EGP' ? 'بالجنيه المصري (قيمة أساسية)' : finCur === 'USD' ? 'بالدولار الأمريكي (قيمة أساسية)' : 'وفق عملة القوائم (قيمة أساسية)';
  const rows: [string, number | null | undefined][] = [
    ['NOPAT_TTM', metrics.nopatTTM],
    ['+ D&A_TTM', metrics.depreciationAmortizationTTM],
    ['− CapEx_TTM', metrics.capexTTM],
    ['− ΔOperating NWC_TTM', metrics.changeOperatingNwcTTM],
    ['= FCFF_TTM', metrics.fcffTTM],
  ];

  return (
    <div className="space-y-4" dir="rtl">
      <h4 className="font-bold text-white">تسوية FCFF والتقييم بـ DCF</h4>
      <p className="text-xs text-slate-400">
        FCFF = EBIT × (1 − ضريبة التقييم) + D&A − CapEx − ΔNWC. الحسابات {baseUnitLabel}، والناتج لكل سهم {perShareUnit ? `(${perShareUnit})` : 'بنفس العملة'}. يختلف FCFF عن OCF − CapEx.
      </p>
      <div className="overflow-x-auto border border-slate-800 rounded-xl">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 font-mono">
            {rows.map(([label, val]) => (
              <tr key={label}>
                <th className="text-start p-2.5 text-slate-300 font-medium" dir="ltr">
                  {label}
                </th>
                <td className="p-2.5 text-end text-slate-100">{formatNum(val)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {metrics.fcffNotes?.map((note) => (
        <p key={note} className="text-xs text-amber-300">
          {note}
        </p>
      ))}
      {!details ? (
        <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/60 rounded-xl p-3">
          جدول DCF غير متاح؛ راجع اكتمال FCFF وصافي الدين وWACC وملاءمة القطاع واتساق العملة والأفق.
        </p>
      ) : (
        <div className="space-y-3 text-xs">
          <p className="text-slate-300 font-mono">
            WACC: {formatNum(details.wacc * 100)}% · سنوات التوقع: {details.forecastYears} ·{' '}
            {details.terminalInputsSummary} · صافي الدين: {formatNum(details.netDebt)}
          </p>
          {details.projectedTerminalEbitda != null && (
            <p className="text-slate-400 font-mono">
              EBITDA النهائية المعتمدة: {formatNum(details.projectedTerminalEbitda)} · مضاعف الخروج: {formatNum(details.exitMultiple)}x
            </p>
          )}
          <div className="overflow-x-auto border border-slate-800 rounded-xl">
            <table className="w-full text-sm text-start">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  {['السنة', 'النمو', 'FCFF', 'معامل الخصم', 'القيمة الحالية'].map((title) => (
                    <th key={title} className="p-2.5 text-end first:text-start">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 font-mono">
                {details.years.map((y) => (
                  <tr key={y.year}>
                    <td className="p-2.5 text-start text-slate-200">{y.year}</td>
                    <td className="p-2.5 text-end text-slate-300">{formatNum(y.growth * 100)}%</td>
                    <td className="p-2.5 text-end text-slate-200">{formatNum(y.fcff)}</td>
                    <td className="p-2.5 text-end text-slate-400">{formatNum(y.discountFactor, 4)}</td>
                    <td className="p-2.5 text-end text-emerald-400">{formatNum(y.presentValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-slate-300 font-mono">
            PV التدفقات المتوقعة: {formatNum(details.pvForecastFlows)} · PV القيمة النهائية: {formatNum(details.presentTerminalValue)} (
            {details.terminalShareOfEvPct != null ? `${formatNum(details.terminalShareOfEvPct, 1)}%` : 'غير متاح'} من EV) · قيمة المنشأة: {formatNum(details.enterpriseValue)} · حقوق الملكية: {formatNum(details.equityValue)}
          </p>
          <p className="text-sm font-bold font-mono text-teal-300">
            قيمة السهم: {formatNum(valuation.dcfFairValue)}{perShareUnit ? ` ${perShareUnit}` : ''}
          </p>
          <p className="text-xs text-amber-300 leading-relaxed">
            الجدول من نفس محرك القيمة المعروضة. النمو توقع مدخل وليس نمواً مضموناً؛ الدين المسجل تقريب للدين في أوزان WACC، ولا يعادل بالضرورة قيمته السوقية.
          </p>
        </div>
      )}
    </div>
  );
}
