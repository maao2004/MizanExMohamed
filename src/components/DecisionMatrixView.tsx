/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Target,
  Scale,
  Clock,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  PlusCircle,
  HelpCircle,
  ShieldAlert,
} from 'lucide-react';
import {
  Company,
  DecisionItem,
  FinalDecision,
  FundamentalVerdict,
  TimingVerdict,
  ValuationResults,
} from '../types/financial';

interface DecisionMatrixViewProps {
  company: Company;
  valuation: ValuationResults;
  decision: DecisionItem | null;
  canEdit?: boolean;
  onUpdateDecision: (updated: DecisionItem) => void;
  onCreateTradeFromDecision: (decision: DecisionItem) => void;
}

const createEmptyDecision = (company: Company): DecisionItem => ({
  companyId: company.id,
  ticker: company.ticker,
  fundamentalVerdict: 'قريب من القيمة العادلة',
  valuationReasonAr: '',
  timingVerdict: 'حيادي / انتظار محفز',
  timingReasonAr: '',
  finalDecision: 'مراقبة لصيقة',
  targetEntryRange: '',
  stopLossPrice: 0,
  targetExitPrice: 0,
  riskRewardRatio: 0,
  notes: '',
  updatedAt: new Date().toISOString().split('T')[0],
});

export const DecisionMatrixView: React.FC<DecisionMatrixViewProps> = ({
  company,
  valuation,
  decision,
  canEdit = false,
  onUpdateDecision,
  onCreateTradeFromDecision,
}) => {
  const [formData, setFormData] = useState<DecisionItem>(() => decision ?? createEmptyDecision(company));
  const [isEditing, setIsEditing] = useState(false);
  const [successNotice, setSuccessNotice] = useState(false);

  React.useEffect(() => {
    setFormData(decision ?? createEmptyDecision(company));
    setIsEditing(false);
  }, [decision, company.id, company.ticker]);

  const handleSave = () => {
    onUpdateDecision({
      ...formData,
      companyId: company.id,
      ticker: company.ticker,
      updatedAt: new Date().toISOString().split('T')[0],
    });
    setIsEditing(false);
    setSuccessNotice(true);
    setTimeout(() => setSuccessNotice(false), 3000);
  };

  // ألوان وتنسيقات الأحكام الأساسية
  const getFundamentalBadge = (verdict: FundamentalVerdict) => {
    switch (verdict) {
      case 'شراء قوي (خصم عميق)':
        return 'bg-emerald-950 text-emerald-300 border-emerald-800';
      case 'أقل من القيمة العادلة':
        return 'bg-teal-950 text-teal-300 border-teal-800';
      case 'قريب من القيمة العادلة':
        return 'bg-amber-950 text-amber-300 border-amber-800';
      case 'مبالغ في تقييمه':
        return 'bg-red-950 text-red-300 border-red-800';
    }
  };

  const getTimingBadge = (verdict: TimingVerdict) => {
    switch (verdict) {
      case 'إشارة دخول نشطة / زخم إيجابي':
        return 'bg-emerald-950 text-emerald-300 border-emerald-800';
      case 'قريب من قاع سعري / تجميع':
        return 'bg-sky-950 text-sky-300 border-sky-800';
      case 'حيادي / انتظار محفز':
        return 'bg-amber-950 text-amber-300 border-amber-800';
      case 'تشبع شرائي / تصحيح متوقع':
        return 'bg-red-950 text-red-300 border-red-800';
    }
  };

  const getFinalDecisionColor = (finalDec: FinalDecision) => {
    switch (finalDec) {
      case 'شراء تراكمي':
      case 'شراء حذر':
      case 'شراء جزئي':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-800';
      case 'مراقبة لصيقة':
      case 'احتفاظ':
        return 'text-amber-400 bg-amber-950/60 border-amber-800';
      case 'تخفيف / جني أرباح':
      case 'تجنب':
        return 'text-red-400 bg-red-950/60 border-red-800';
    }
  };

  if (!decision && !isEditing) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 text-slate-400 flex items-center justify-center mx-auto">
          <Target className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-white">
            لا توجد مصفوفة قرار محفوظة لهذا السهم في Firestore ({company.ticker})
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            لا تُنشأ نقاط دخول أو وقف خسارة تلقائية عند غياب سجل القرار في قاعدة البيانات.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setFormData(createEmptyDecision(company));
              setIsEditing(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>إنشاء مصفوفة قرار</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white">
                مصفوفة القرار الاستثماري (Decision Matrix)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              الفصل المحاسبي الصارم بين <strong className="text-slate-200">التقييم المالي الأساسي</strong> (هل السهم رخيص أم غالٍ؟) وبين <strong className="text-slate-200">توقيت الدخول الفني والسوقي</strong> (هل اللحظة مناسبة للشراء أم يجب الانتظار؟) دون خلط بينهما.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {successNotice && (
              <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                تم الحفظ
              </span>
            )}
            {canEdit && (isEditing ? (
              <button
                onClick={handleSave}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                حفظ مصفوفة القرار
              </button>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                تعديل عناصر القرار
              </button>
            ))}

            <button
              onClick={() => onCreateTradeFromDecision(formData)}
              disabled={valuation.compositeFairValue === null}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors disabled:opacity-50"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              ترحيل إلى سجل الصفقات
            </button>
          </div>
        </div>
      </div>

      {/* 1. Final Actionable Verdict Hero Box */}
      <div className={`p-6 rounded-2xl border ${getFinalDecisionColor(formData.finalDecision)} shadow-sm`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-medium opacity-80 block">الحكم الاستثماري النهائي المركب:</span>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-3xl font-extrabold font-mono tracking-tight">
                {formData.finalDecision}
              </span>
              <span className="text-xs font-mono text-slate-300">
                السعر الحالي: {company.marketPrice !== null ? `${company.marketPrice.toFixed(2)} ج.م` : 'غير متاح'} · القيمة العادلة:{' '}
                {valuation.compositeFairValue?.toFixed(2) ?? 'غير متاح'} ج.م
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 shrink-0">
            <div>
              <span className="text-[11px] text-slate-400 block font-medium">نطاق الشراء المستهدف</span>
              <span className="text-sm font-bold font-mono text-slate-100">
                {formData.targetEntryRange || 'غير محدد'}
              </span>
            </div>
            <div className="w-px h-8 bg-slate-800" />
            <div>
              <span className="text-[11px] text-slate-400 block font-medium">العائد إلى المخاطرة</span>
              <span className="text-sm font-bold font-mono text-emerald-400">
                {formData.riskRewardRatio}x
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. The Two Independent Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pillar 1: Fundamental Valuation (التقييم الأساسي) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">العمود الأول: حكم التقييم المالي (Valuation)</h3>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full border font-bold ${getFundamentalBadge(formData.fundamentalVerdict)}`}>
                {formData.fundamentalVerdict}
              </span>
            </div>

            <div className="space-y-3">
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 text-xs">
                <span className="text-slate-400 block font-medium mb-1">بيانات التقييم المالي المرجحة:</span>
                <div className="grid grid-cols-2 gap-2 font-mono text-slate-300">
                  <div>القيمة العادلة: {valuation.compositeFairValue?.toFixed(2) ?? 'غير متاح'} ج.م</div>
                  <div>هامش الأمان: {valuation.marginOfSafetyPct?.toFixed(1) ?? 'غير متاح'}%</div>
                  <div>مضاعف الربحية P/E: {company.targetPE !== null ? `${company.targetPE}x` : 'غير متاح'}</div>
                  <div>مضاعف الدفترية P/B: {company.targetPB !== null ? `${company.targetPB}x` : 'غير متاح'}</div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  أسباب الحكم المالي (لماذا السهم رخيص أو غالٍ):
                </label>
                {isEditing ? (
                  <textarea
                    value={formData.valuationReasonAr}
                    onChange={(e) => setFormData({ ...formData, valuationReasonAr: e.target.value })}
                    rows={3}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
                  />
                ) : (
                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/40 p-3 rounded-xl border border-slate-800/50">
                    {formData.valuationReasonAr || 'لم يُدخل تبرير التقييم المالي بعد.'}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400">
            يركز على الأصول والتدفقات دون الالتفات إلى اتجاه السهم اللحظي.
          </div>
        </div>

        {/* Pillar 2: Market Timing & Triggers (توقيت الدخول والسوق) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-teal-400" />
                <h3 className="text-sm font-bold text-white">العمود الثاني: توقيت الدخول والزخم (Timing & Trigger)</h3>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full border font-bold ${getTimingBadge(formData.timingVerdict)}`}>
                {formData.timingVerdict}
              </span>
            </div>

            <div className="space-y-3">
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/80 text-xs">
                <span className="text-slate-400 block font-medium mb-1">مستويات التنفيذ والمخاطرة:</span>
                <div className="grid grid-cols-2 gap-2 font-mono text-slate-300">
                  <div>وقف الخسارة: {formData.stopLossPrice.toFixed(2)} ج.م</div>
                  <div>المستهدف السعري: {formData.targetExitPrice.toFixed(2)} ج.م</div>
                  <div>نطاق الدخول: {formData.targetEntryRange || 'غير محدد'}</div>
                  <div>نسبة R:R: {formData.riskRewardRatio}x</div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  مبررات التوقيت والمحفزات الفنية الحالية:
                </label>
                {isEditing ? (
                  <textarea
                    value={formData.timingReasonAr}
                    onChange={(e) => setFormData({ ...formData, timingReasonAr: e.target.value })}
                    rows={3}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-sans"
                  />
                ) : (
                  <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/40 p-3 rounded-xl border border-slate-800/50">
                    {formData.timingReasonAr || 'لم يُدخل تبرير التوقيت بعد.'}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400">
            يركز على تأكيد قاع السعر ومحفزات السيولة لحماية رأس المال من الشراء في سكين هابط.
          </div>
        </div>
      </div>

      {/* 3. Editing Fields when isEditing */}
      {isEditing && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <h4 className="text-xs font-bold text-slate-300">تعديل قيم المعايير التنفيذية:</h4>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">الحكم الأساسي</label>
              <select
                value={formData.fundamentalVerdict}
                onChange={(e) => setFormData({ ...formData, fundamentalVerdict: e.target.value as FundamentalVerdict })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
              >
                <option value="شراء قوي (خصم عميق)">شراء قوي (خصم عميق)</option>
                <option value="أقل من القيمة العادلة">أقل من القيمة العادلة</option>
                <option value="قريب من القيمة العادلة">قريب من القيمة العادلة</option>
                <option value="مبالغ في تقييمه">مبالغ في تقييمه</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">حكم التوقيت</label>
              <select
                value={formData.timingVerdict}
                onChange={(e) => setFormData({ ...formData, timingVerdict: e.target.value as TimingVerdict })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
              >
                <option value="إشارة دخول نشطة / زخم إيجابي">إشارة دخول نشطة / زخم إيجابي</option>
                <option value="قريب من قاع سعري / تجميع">قريب من قاع سعري / تجميع</option>
                <option value="حيادي / انتظار محفز">حيادي / انتظار محفز</option>
                <option value="تشبع شرائي / تصحيح متوقع">تشبع شرائي / تصحيح متوقع</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">القرار النهائي</label>
              <select
                value={formData.finalDecision}
                onChange={(e) => setFormData({ ...formData, finalDecision: e.target.value as FinalDecision })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
              >
                <option value="شراء تراكمي">شراء تراكمي</option>
                <option value="شراء حذر">شراء حذر</option>
                <option value="مراقبة لصيقة">مراقبة لصيقة</option>
                <option value="احتفاظ">احتفاظ</option>
                <option value="تخفيف / جني أرباح">تخفيف / جني أرباح</option>
                <option value="تجنب">تجنب</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">نطاق الدخول المستهدف</label>
              <input
                type="text"
                value={formData.targetEntryRange}
                onChange={(e) => setFormData({ ...formData, targetEntryRange: e.target.value })}
                placeholder="مثال: 65 - 70 ج.م"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">وقف الخسارة (ج.م)</label>
              <input
                type="number"
                step="0.5"
                value={formData.stopLossPrice}
                onChange={(e) => setFormData({ ...formData, stopLossPrice: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">المستهدف السعري (ج.م)</label>
              <input
                type="number"
                step="0.5"
                value={formData.targetExitPrice}
                onChange={(e) => setFormData({ ...formData, targetExitPrice: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">نسبة العائد للمخاطرة (R:R)</label>
              <input
                type="number"
                step="0.1"
                value={formData.riskRewardRatio}
                onChange={(e) => setFormData({ ...formData, riskRewardRatio: parseFloat(e.target.value) || 0 })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
              />
            </div>
          </div>
        </div>
      )}

      {/* 4. Strategic Rules Callout */}
      <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed">
          <strong className="text-slate-200 block">قاعدة ميزان الذهبية في إدارة الصفقات:</strong>
          <span>
            "كون السهم يتداول بأقل من قيمته العادلة بنسبة 40% هو مبرر كافٍ للبحث والدراسة، لكنه ليس مبرراً كافياً للتنفيذ الفوري. لا يتم الضغط على زر الشراء إلا عندما يجتمع الخصم المالي مع إشارة توقيت تمنع حبس السيولة لشهور في مسار هابط."
          </span>
        </div>
      </div>
    </div>
  );
};
