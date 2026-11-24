/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BetaStatus } from '../../types/financial';

export type AssumptionScopeLoadState = 'available' | 'confirmed_missing' | 'loading_unconfirmed';

export interface ScopedAssumptionPresentation {
  state: AssumptionScopeLoadState;
  valueTextAr: string;
  fullTextAr: string;
  documentaryNoteAr: string | null;
}

function cleanOptionalText(val: string | null | undefined): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * تصنيف حالة نطاق واحد (company_assumptions أو macro_params) بشكل مستقل تماماً:
 * - القيمة الرقمية المنتهية (بما فيها الصفر 0) تُعامل كقيمة متاحة دائماً.
 * - غياب القيمة مع عدم تأكيد التحميل يُعرض كـ loading_unconfirmed لا كغياب مؤكد.
 * - غياب القيمة مع تأكيد التحميل يُعرض كـ confirmed_missing.
 */
export function classifyScopedAssumptionState(
  value: number | null | undefined,
  scopeConfirmed: boolean
): AssumptionScopeLoadState {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return 'available';
  }
  return scopeConfirmed ? 'confirmed_missing' : 'loading_unconfirmed';
}

/**
 * دالة عرض مشتركة بين الواجهة وتصدير Excel لتمثيل حالة نطاق افتراض (شركة أو عام)
 * مع الفصل الصريح بين القيمة المتاحة (بما فيها 0)، والغياب المؤكد، والتحميل غير المؤكد،
 * وفصل غياب المصدر التوثيقي عن غياب القيمة.
 */
export function formatScopedAssumptionStateAr(params: {
  value: number | null | undefined;
  scopeConfirmed: boolean;
  formatValue: (val: number) => string;
  documentarySource?: string | null;
  asOfDate?: string | null;
  includeMissingDocumentaryNote?: boolean;
}): ScopedAssumptionPresentation {
  const {
    value,
    scopeConfirmed,
    formatValue,
    documentarySource,
    asOfDate,
    includeMissingDocumentaryNote = false,
  } = params;

  const state = classifyScopedAssumptionState(value, scopeConfirmed);
  if (state === 'loading_unconfirmed') {
    const label = 'قيد تأكيد التحميل (لم يكتمل التأكيد من الخادم)';
    return {
      state,
      valueTextAr: label,
      fullTextAr: label,
      documentaryNoteAr: null,
    };
  }
  if (state === 'confirmed_missing') {
    const label = 'غير محفوظ (غياب مؤكد)';
    return {
      state,
      valueTextAr: label,
      fullTextAr: label,
      documentaryNoteAr: null,
    };
  }

  const formattedVal = formatValue(value as number);
  const cleanSource = cleanOptionalText(documentarySource);
  const cleanDate = cleanOptionalText(asOfDate);
  const metaParts = [cleanSource, cleanDate].filter(Boolean) as string[];

  if (metaParts.length > 0) {
    const docNote = metaParts.join(' · ');
    return {
      state,
      valueTextAr: formattedVal,
      fullTextAr: `${formattedVal} (${docNote})`,
      documentaryNoteAr: docNote,
    };
  }

  if (includeMissingDocumentaryNote) {
    const docNote = 'المصدر التوثيقي غير موثق';
    return {
      state,
      valueTextAr: formattedVal,
      fullTextAr: `${formattedVal} (${docNote})`,
      documentaryNoteAr: docNote,
    };
  }

  return {
    state,
    valueTextAr: formattedVal,
    fullTextAr: formattedVal,
    documentaryNoteAr: null,
  };
}

/**
 * وصف مستقل لسطر التوثيق (المصدر والتاريخ) يفصل غياب المصدر التوثيقي عن غياب القيمة أو عدم تأكيد التحميل.
 */
export function formatDocumentaryMetadataAr(params: {
  hasEffectiveValue: boolean;
  loadingUnconfirmed: boolean;
  documentarySource?: string | null;
  asOfDate?: string | null;
  isSensitivityDraft?: boolean;
}): string {
  if (params.isSensitivityDraft) {
    return 'مسودة حساسية مؤقتة (محلي في الذاكرة — بدون حفظ أو تاريخ سريان)';
  }
  if (!params.hasEffectiveValue) {
    return params.loadingUnconfirmed
      ? 'قيد تأكيد التحميل من الخادم'
      : 'لا توجد قيمة معتمدة (غياب مؤكد)';
  }
  const cleanSource = cleanOptionalText(params.documentarySource);
  const cleanDate = cleanOptionalText(params.asOfDate);
  const sourceText = cleanSource ?? 'المصدر التوثيقي غير موثق (القيمة متاحة)';
  const dateText = cleanDate ?? 'تاريخ السريان غير محدد';
  return `${sourceText} · ${dateText}`;
}

export type EffectiveBetaSourceKind =
  | 'sensitivity_draft_analytical'
  | 'analytical_override'
  | 'sensitivity_draft_historical'
  | 'historical_actual'
  | 'defaulted_missing'
  | 'unavailable_unconfirmed';

export interface BetaEffectiveSourcePresentation {
  kind: EffectiveBetaSourceKind;
  shortBadgeAr: string;
  labelAr: string;
  explanationAr: string;
  badgeTone: 'purple' | 'emerald' | 'amber' | 'red';
  isSensitivityDraft: boolean;
}

/**
 * دالة عرض مركزية مشتركة لوصف مصدر معامل بيتا الفعال في Ke (تستخدمها لوحة حوكمة بيتا ولوحة Ke داخل DDM)
 * استناداً حصرياً إلى حالات المحرك (betaStatus وbetaSourceNoteAr) وحالة مسودة الحساسية المحلية
 * دون تغيير سياسة بيتا أو أولوياتها أو وجهات حفظها.
 */
export function describeBetaEffectiveSource(params: {
  betaStatus?: BetaStatus;
  betaSourceNoteAr?: string | null;
  effectiveBetaForKe?: number | null;
  savedAnalyticalBetaValue?: number | null;
  draftBeta?: number;
  draftAnalyticalBeta?: number;
  betaConfirmed?: boolean;
  betaError?: boolean;
}): BetaEffectiveSourcePresentation {
  const {
    betaStatus,
    betaSourceNoteAr,
    effectiveBetaForKe,
    savedAnalyticalBetaValue,
    draftBeta,
    draftAnalyticalBeta,
    betaConfirmed = true,
    betaError = false,
  } = params;

  const cleanNote = cleanOptionalText(betaSourceNoteAr);

  if (draftAnalyticalBeta !== undefined && Number.isFinite(draftAnalyticalBeta)) {
    return {
      kind: 'sensitivity_draft_analytical',
      shortBadgeAr: 'مسودة حساسية مؤقتة (Beta_Analytical)',
      labelAr: 'مسودة حساسية مؤقتة لـ Beta_Analytical (محلي في الذاكرة — غير محفوظة)',
      explanationAr:
        'قيمة تجريبية محلية مؤقتة تتقدم مؤقتاً على بيتا التاريخية داخل هذه الجلسة فقط دون أي كتابة في company_assumptions أو beta_assumptions.',
      badgeTone: 'purple',
      isSensitivityDraft: true,
    };
  }

  if (
    savedAnalyticalBetaValue !== null &&
    savedAnalyticalBetaValue !== undefined &&
    Number.isFinite(savedAnalyticalBetaValue)
  ) {
    return {
      kind: 'analytical_override',
      shortBadgeAr: 'Beta_Analytical (تخصيص تحليلي)',
      labelAr: 'تخصيص تحليلي محفوظ — Beta_Analytical (company_assumptions)',
      explanationAr:
        'يُعتمد التقدير التحليلي مباشرة في Ke مع إبقاء سجل بيتا التاريخية (beta_assumptions) منفصلاً تماماً دون تعديل.',
      badgeTone: 'emerald',
      isSensitivityDraft: false,
    };
  }

  if (draftBeta !== undefined && Number.isFinite(draftBeta)) {
    return {
      kind: 'sensitivity_draft_historical',
      shortBadgeAr: 'مسودة حساسية مؤقتة (Beta)',
      labelAr: 'مسودة حساسية مؤقتة لبيتا التاريخية (محلي في الذاكرة — غير محفوظة)',
      explanationAr:
        'قيمة تجريبية محلية تمر عبر تعديل Blume داخل هذه الجلسة فقط دون أي كتابة في beta_assumptions.',
      badgeTone: 'purple',
      isSensitivityDraft: true,
    };
  }

  if (betaStatus === 'actual') {
    return {
      kind: 'historical_actual',
      shortBadgeAr: 'beta_assumptions (فعلي)',
      labelAr: 'بيتا تاريخية فعلية من سجل beta_assumptions (معدلة بـ Blume)',
      explanationAr:
        cleanNote ?? 'بيتا فعلية موثقة في سجل beta_assumptions ومعدلة بمعادلة Blume.',
      badgeTone: 'emerald',
      isSensitivityDraft: false,
    };
  }

  if (betaStatus === 'defaulted_missing') {
    return {
      kind: 'defaulted_missing',
      shortBadgeAr: 'سياسة غياب السجل المؤكد = 1.00',
      labelAr: 'بيتا افتراضية = 1.00 بعد غياب سجل مؤكد (ليست سجلاً تاريخياً)',
      explanationAr:
        cleanNote ??
        'تم تأكيد غياب سجل السهم في beta_assumptions؛ تُعتمد القيمة الافتراضية 1.00 وفق السياسة الموثقة دون نسبتها لسجل تاريخي أو حفظها تلقائياً.',
      badgeTone: 'amber',
      isSensitivityDraft: false,
    };
  }

  if (betaError) {
    return {
      kind: 'unavailable_unconfirmed',
      shortBadgeAr: 'فشل تأكيد سجل بيتا',
      labelAr: 'غير متاحة: تعذر تأكيد سجل beta_assumptions من الخادم',
      explanationAr:
        cleanNote ?? 'فشل تأكيد تحميل سجل بيتا من الخادم؛ لا تُفترض قيمة تاريخية أو افتراضية قبل التأكيد.',
      badgeTone: 'red',
      isSensitivityDraft: false,
    };
  }

  if (betaConfirmed === false) {
    return {
      kind: 'unavailable_unconfirmed',
      shortBadgeAr: 'قيد تأكيد تحميل بيتا',
      labelAr: 'غير متاحة حالياً: تحميل سجل beta_assumptions غير مؤكد بعد',
      explanationAr:
        cleanNote ?? 'بانتظار تأكيد تحميل سجل بيتا من الخادم قبل اعتماد قيمة تاريخية أو تطبيق سياسة الغياب.',
      badgeTone: 'amber',
      isSensitivityDraft: false,
    };
  }

  return {
    kind: 'unavailable_unconfirmed',
    shortBadgeAr: effectiveBetaForKe === null ? 'بيتا غير متاحة' : 'تعذر تأكيد السجل',
    labelAr: 'بيتا غير متاحة: تعذر تأكيد سجل beta_assumptions أو نقص معاملات Blume',
    explanationAr:
      cleanNote ?? 'سجل بيتا غير مؤكد من الخادم أو تعذر حساب بيتا المعدلة لغياب معاملات Blume.',
    badgeTone: 'red',
    isSensitivityDraft: false,
  };
}
