import React from 'react';
import type { QuarterlyFinancialRecord } from '../types';

export function FcffInputs({
  record,
  onChange,
}: {
  record: QuarterlyFinancialRecord;
  onChange: (updates: Partial<QuarterlyFinancialRecord>) => void;
}) {
  const numberField = (
    key: keyof QuarterlyFinancialRecord,
    label: string,
    min?: number,
    max?: number
  ) => (
    <label className="block text-xs text-slate-300">
      {label}
      <input
        data-field={String(key)}
        aria-label={label}
        type="number"
        step="any"
        min={min}
        max={max}
        value={record[key] == null ? '' : String(record[key])}
        onChange={(e) =>
          onChange({ [key]: e.target.value.trim() === '' ? null : Number(e.target.value) })
        }
        className="block w-full bg-slate-950 border border-slate-700 rounded p-2 mt-1 text-slate-100 font-mono"
      />
    </label>
  );

  return (
    <fieldset className="p-4 border border-teal-800 rounded-xl space-y-3" dir="rtl">
      <legend className="text-xs font-bold text-teal-300 px-2">
        مدخلات FCFF الموثقة — اختيارية
      </legend>
      <p className="text-xs text-slate-400">
        القيم تراكمية منذ بداية السنة. CapEx والإهلاك موجبان. زيادة رأس المال العامل التشغيلي موجبة وتستهلك نقداً؛ النقص سالب. استبعد النقد والديون من رأس المال العامل. لا تضع صفراً مكان بيانات مفقودة.
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        {numberField('depreciationAmortizationYTD', 'الإهلاك والاستنفاد YTD (قيمة أساسية)', 0)}
        {numberField('changeOperatingNwcYTD', 'زيادة رأس المال العامل التشغيلي YTD (قيمة أساسية)')}
        {numberField('valuationTaxRate', 'ضريبة التقييم على EBIT — كسر عشري من 0 إلى 1', 0, 1)}
      </div>
      <label className="block text-xs text-slate-300">
        مرجع المصدر والفترة / الصفحة
        <input
          data-field="valuationSource"
          aria-label="مرجع تسوية FCFF"
          maxLength={1000}
          value={record.valuationSource ?? ''}
          onChange={(e) => onChange({ valuationSource: e.target.value || null })}
          className="block w-full bg-slate-950 border border-slate-700 rounded p-2 mt-1 text-slate-100"
        />
      </label>
      <p className="text-xs text-amber-300">
        ضريبة التقييم افتراض على EBIT وليست مصروف الضريبة ÷ صافي الربح. أثر الخسائر الضريبية يحتاج تسوية مستقلة.
      </p>
    </fieldset>
  );
}
