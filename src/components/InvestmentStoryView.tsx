/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  BookOpen,
  Shield,
  Zap,
  AlertTriangle,
  Award,
  Edit3,
  Save,
  CheckCircle2,
} from 'lucide-react';
import { Company, InvestmentStory } from '../types/financial';

interface InvestmentStoryViewProps {
  company: Company;
  story: InvestmentStory | null;
  canEdit?: boolean;
  onUpdateStory: (updatedStory: InvestmentStory) => void;
}

const createEmptyStory = (company: Company): InvestmentStory => ({
  companyId: company.id,
  ticker: company.ticker,
  businessOverview: '',
  economicMoat: {
    rating: 'منعدم (None)',
    description: '',
    advantages: [],
  },
  investmentThesis: '',
  catalysts: [],
  risks: [],
  analystVerdict: '',
  updatedAt: new Date().toISOString().split('T')[0],
});

export const InvestmentStoryView: React.FC<InvestmentStoryViewProps> = ({
  company,
  story,
  canEdit = false,
  onUpdateStory,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedStory, setEditedStory] = useState<InvestmentStory>(() => story ?? createEmptyStory(company));
  const [savedSuccess, setSavedSuccess] = useState(false);

  // تحديث الحالة المحلية إذا تغيرت الشركة المختارة أو القصة من Firestore
  React.useEffect(() => {
    setEditedStory(story ?? createEmptyStory(company));
    setIsEditing(false);
  }, [story, company.id, company.ticker]);

  const handleSave = () => {
    onUpdateStory({
      ...editedStory,
      companyId: company.id,
      ticker: company.ticker,
      updatedAt: new Date().toISOString().split('T')[0],
    });
    setIsEditing(false);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  if (!story && !isEditing) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-slate-800 text-slate-400 flex items-center justify-center mx-auto">
          <BookOpen className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-white">
            لا توجد قصة استثمارية محفوظة لهذا السهم في Firestore ({company.ticker})
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            تُعرض هنا القصة الاستثمارية والميزة التنافسية الفعلية فقط عند توثيقها وحفظها في قاعدة البيانات دون توليد نصوص افتراضية.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setEditedStory(createEmptyStory(company));
              setIsEditing(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>إنشاء قصة استثمارية</span>
          </button>
        )}
      </div>
    );
  }

  const displayStory = isEditing ? editedStory : story!;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white">
                قصة الاستثمار والميزة التنافسية (Investment Story & Moat)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              التحليل النوعي، الخندق الاقتصادي، ومحفزات ومخاطر سهم <strong className="text-slate-200">{company.nameAr} ({company.ticker})</strong>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {savedSuccess && (
              <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                تم الحفظ بنجاح
              </span>
            )}
            {canEdit && (isEditing ? (
              <button
                onClick={handleSave}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                حفظ التعديلات
              </button>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5 text-emerald-400" />
                تعديل القصة التحليلية
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 1. Business Overview Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
          <span>نموذج الأعمال والتموضع في السوق المصري</span>
        </h3>
        {isEditing ? (
          <textarea
            value={editedStory.businessOverview}
            onChange={(e) => setEditedStory({ ...editedStory, businessOverview: e.target.value })}
            rows={4}
            placeholder="أدخل وصف نموذج الأعمال الفعلي..."
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed font-sans"
          />
        ) : (
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            {displayStory.businessOverview || 'لم يُدخل وصف نموذج الأعمال بعد.'}
          </p>
        )}
      </div>

      {/* 2. Economic Moat (الخندق الاقتصادي) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">الخندق الاقتصادي (Economic Moat)</h3>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 font-semibold">
            {displayStory.economicMoat.rating}
          </span>
        </div>

        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-4">
          {displayStory.economicMoat.description || 'لم يُدخل وصف الخندق الاقتصادي بعد.'}
        </p>

        {displayStory.economicMoat.advantages.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-400 mb-2">المزايا الهيكلية الحامية للمركز التنافسي:</h4>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {displayStory.economicMoat.advantages.map((adv, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 text-slate-200"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                  <span>{adv}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 3. Investment Thesis (أطروحة الاستثمار الرئيسية) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
          <span>أطروحة الاستثمار الرئيسية (Investment Thesis)</span>
        </h3>
        {isEditing ? (
          <textarea
            value={editedStory.investmentThesis}
            onChange={(e) => setEditedStory({ ...editedStory, investmentThesis: e.target.value })}
            rows={4}
            placeholder="أدخل أطروحة الاستثمار..."
            className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed font-sans"
          />
        ) : (
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            {displayStory.investmentThesis || 'لم تُدخل أطروحة الاستثمار بعد.'}
          </p>
        )}
      </div>

      {/* 4. Catalysts vs Risks Split Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Catalysts (المحفزات) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">محفزات النمو وإعادة التسعير (Catalysts)</h3>
          </div>
          {displayStory.catalysts.length === 0 ? (
            <p className="text-xs text-slate-400">لا توجد محفزات مسجلة بعد.</p>
          ) : (
            <div className="space-y-2.5">
              {displayStory.catalysts.map((cat, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950/80 border border-emerald-950 p-3 rounded-xl text-xs text-slate-200 flex items-start gap-2.5"
                >
                  <span className="text-emerald-400 font-bold shrink-0 font-mono">0{idx + 1}.</span>
                  <span className="leading-relaxed">{cat}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Risks (المخاطر) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">المخاطر التشغيلية والماكرو (Key Risks)</h3>
          </div>
          {displayStory.risks.length === 0 ? (
            <p className="text-xs text-slate-400">لا توجد مخاطر مسجلة بعد.</p>
          ) : (
            <div className="space-y-2.5">
              {displayStory.risks.map((risk, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950/80 border border-amber-950 p-3 rounded-xl text-xs text-slate-200 flex items-start gap-2.5"
                >
                  <span className="text-amber-400 font-bold shrink-0 font-mono">!{idx + 1}.</span>
                  <span className="leading-relaxed">{risk}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 5. Analyst Summary Verdict */}
      <div className="bg-slate-900 border border-emerald-900/40 rounded-2xl p-5 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-9 h-9 rounded-xl bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center justify-center shrink-0">
            <Award className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <span className="text-[11px] text-slate-400 block font-medium">خلاصة تقييم المحلل المالي:</span>
            {isEditing ? (
              <input
                type="text"
                value={editedStory.analystVerdict}
                onChange={(e) => setEditedStory({ ...editedStory, analystVerdict: e.target.value })}
                placeholder="خلاصة المحلل..."
                className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
              />
            ) : (
              <p className="text-xs sm:text-sm font-semibold text-slate-200 mt-0.5">
                {displayStory.analystVerdict || 'لم تُدخل خلاصة المحلل بعد.'}
              </p>
            )}
          </div>
        </div>
        <span className="text-[11px] font-mono text-slate-400 shrink-0">
          آخر تحديث: {displayStory.updatedAt}
        </span>
      </div>
    </div>
  );
};
