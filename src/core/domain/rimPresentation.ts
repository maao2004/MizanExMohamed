/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  RimAuditSummary,
  RimFadeYearRow,
  RimRetentionPolicy,
  RimTerminalMethod,
} from '../../types/financial';

export type RimParameterRequirementStatus = 'required' | 'optional' | 'inactive';

export interface RimParameterPresentationInfo {
  key: string;
  status: RimParameterRequirementStatus;
  requirementBadgeAr: string;
  stageLabelAr: string;
  stageEffectAr: string;
  inactiveReasonAr: string | null;
  missingRequirementAr: string | null;
}

export interface RimFadeScheduleDisplayState {
  kind: 'not_applicable' | 'unavailable' | 'empty' | 'available';
  badgeAr: string;
  descriptionAr: string;
  rows: RimFadeYearRow[];
}

export interface RimConsistencyChecksDisplayState {
  kind: 'unavailable' | 'empty' | 'available';
  badgeAr: string;
  descriptionAr: string;
  checks: string[];
}

export interface RimTerminalShareDisplayState {
  valueText: string;
  formulaAr: string;
  isHighWarning: boolean;
}

export function formatRimTerminalMethodLabel(method: number | null | undefined): string {
  if (method === 1) return '1 — بقاء الدخل المتبقي دائماً (RI₆ ÷ Ke)';
  if (method === 2) return '2 — تلاشي ROE تدريجياً نحو Ke أو RIM_Terminal_ROE';
  if (method === 3) return '3 — استمرار العائد ونمو القيمة الدفترية (g_B = ROE_term × b_term)';
  return 'غير محدد (يلزم اختيار 1 أو 2 أو 3)';
}

export function getRimParameterRequirements(params: {
  terminalMethod: RimTerminalMethod | null;
  terminalRoe: number | null;
  costOfEquity: number | null;
  rimRetentionPolicy: RimRetentionPolicy;
}): Record<string, RimParameterPresentationInfo> {
  const { terminalMethod, terminalRoe, costOfEquity, rimRetentionPolicy } = params;

  const method2NeedsTerminalRetention =
    terminalMethod === 2 &&
    terminalRoe !== null &&
    costOfEquity !== null &&
    Math.abs(terminalRoe - costOfEquity) > 1e-12;

  const retentionStatus: RimParameterRequirementStatus =
    rimRetentionPolicy === 'historical_retention' ? 'inactive' : 'required';

  const fadeYearsInfo: RimParameterPresentationInfo =
    terminalMethod === 2
      ? {
          key: 'RIM_Fade_Years',
          status: 'required',
          requirementBadgeAr: 'مطلوب للنمط 2',
          stageLabelAr: 'المرحلة النهائية (التلاشي)',
          stageEffectAr: 'يحدد عدد سنوات التلاشي الخطي للعائد بعد السنة الخامسة (Y6..Y5+N).',
          inactiveReasonAr: null,
          missingRequirementAr:
            'مطلوب إدخال عدد صحيح بين 1 و20 لتشغيل نمط التلاشي (RIM_Terminal_Method = 2).',
        }
      : {
          key: 'RIM_Fade_Years',
          status: 'inactive',
          requirementBadgeAr: 'غير مستخدم بالنمط الحالي',
          stageLabelAr: 'المرحلة النهائية (النمط 2 فقط)',
          stageEffectAr: 'لا يدخل في الحساب إلا عند اختيار نمط التلاشي (RIM_Terminal_Method = 2).',
          inactiveReasonAr:
            terminalMethod === null
              ? 'اختر طريقة القيمة النهائية أولاً؛ يُستخدم هذا الحقل فقط في النمط 2 وتبقى أي قيمة محفوظة له دون مسح.'
              : `لا يُستخدم في النمط ${terminalMethod}؛ وتبقى أي قيمة محفوظة له سليمة دون تعديل أو حذف.`,
          missingRequirementAr: null,
        };

  const terminalRoeInfo: RimParameterPresentationInfo =
    terminalMethod === 3
      ? {
          key: 'RIM_Terminal_ROE',
          status: 'required',
          requirementBadgeAr: 'مطلوب للنمط 3',
          stageLabelAr: 'المرحلة النهائية',
          stageEffectAr: 'يحدد العائد الدائم بعد السنة الخامسة ومعدل نمو القيمة الدفترية g_B = ROE_term × b_term.',
          inactiveReasonAr: null,
          missingRequirementAr:
            'مطلوب إدخال RIM_Terminal_ROE صراحةً لتشغيل نمط استمرار العائد (النمط 3).',
        }
      : terminalMethod === 2
      ? {
          key: 'RIM_Terminal_ROE',
          status: 'optional',
          requirementBadgeAr: 'اختياري للنمط 2',
          stageLabelAr: 'المرحلة النهائية (نهاية التلاشي)',
          stageEffectAr:
            'يحدد الهدف النهائي لتلاشي العائد؛ عند تركه فارغاً يتلاشى ROE تدريجياً نحو Ke حتى ينعدم الدخل المتبقي بعد التلاشي.',
          inactiveReasonAr: null,
          missingRequirementAr:
            'غير محفوظ؛ يتلاشى العائد تلقائياً نحو تكلفة حقوق الملكية Ke وفق معادلة النمط 2.',
        }
      : {
          key: 'RIM_Terminal_ROE',
          status: 'inactive',
          requirementBadgeAr: 'غير مستخدم بالنمط الحالي',
          stageLabelAr: 'المرحلة النهائية (النمطان 2 و3)',
          stageEffectAr: 'يُستخدم في النمط 2 (هدف التلاشي) أو النمط 3 (العائد المستدام).',
          inactiveReasonAr:
            terminalMethod === 1
              ? 'النمط 1 يعتمد استمرار الدخل المتبقي باستخدام العائد المستقبلي لفترة التوقع؛ تبقى القيمة المحفوظة هنا دون مسح.'
              : 'اختر طريقة القيمة النهائية أولاً؛ تبقى أي قيمة محفوظة هنا دون مسح.',
          missingRequirementAr: null,
        };

  const terminalRetentionInfo: RimParameterPresentationInfo =
    terminalMethod === 3
      ? {
          key: 'RIM_Terminal_Retention',
          status: 'required',
          requirementBadgeAr: 'مطلوب للنمط 3',
          stageLabelAr: 'المرحلة النهائية',
          stageEffectAr: 'يحدد نسبة الاحتجاز النهائية لحساب g_B = RIM_Terminal_ROE × RIM_Terminal_Retention (بشرط g_B < Ke).',
          inactiveReasonAr: null,
          missingRequirementAr:
            'مطلوب إدخال RIM_Terminal_Retention (0% إلى 100%) لتشغيل النمط 3 دون افتراض صامت.',
        }
      : terminalMethod === 2
      ? {
          key: 'RIM_Terminal_Retention',
          status: method2NeedsTerminalRetention ? 'required' : 'optional',
          requirementBadgeAr: method2NeedsTerminalRetention
            ? 'مطلوب لاختلاف ROE_term عن Ke'
            : 'اختياري في النمط 2',
          stageLabelAr: 'المرحلة النهائية (التلاشي وما بعدها)',
          stageEffectAr: method2NeedsTerminalRetention
            ? 'مطلوب لحساب معدل النمو المستمر بعد التلاشي g_B = ROE_term × b_term لأن RIM_Terminal_ROE يختلف عن Ke.'
            : 'يُستخدم خلال سنوات التلاشي (وعند تركه فارغاً ومع تساوي العائد النهائي مع Ke يُستخدم احتجاز فترة التوقع).',
          inactiveReasonAr: null,
          missingRequirementAr: method2NeedsTerminalRetention
            ? 'مطلوب إدخال RIM_Terminal_Retention لأن RIM_Terminal_ROE يختلف عن Ke في النمط 2.'
            : 'غير محفوظ؛ يُستخدم احتجاز فترة التوقع خلال سنوات التلاشي عند تلاشي العائد نحو Ke.',
        }
      : {
          key: 'RIM_Terminal_Retention',
          status: 'inactive',
          requirementBadgeAr: 'غير مستخدم بالنمط الحالي',
          stageLabelAr: 'المرحلة النهائية (النمطان 2 و3)',
          stageEffectAr: 'يُستخدم في النمط 3 وفي النمط 2 لحساب نمو القيمة الدفترية النهائية g_B.',
          inactiveReasonAr:
            terminalMethod === 1
              ? 'النمط 1 لا يستخدم نسبة احتجاز نهائية منفصلة؛ تبقى القيمة المحفوظة هنا دون مسح.'
              : 'اختر طريقة القيمة النهائية أولاً؛ تبقى أي قيمة محفوظة هنا دون مسح.',
          missingRequirementAr: null,
        };

  return {
    RIM_Terminal_Method: {
      key: 'RIM_Terminal_Method',
      status: 'required',
      requirementBadgeAr: 'مطلوب دائماً',
      stageLabelAr: 'المرحلة النهائية',
      stageEffectAr: 'يحدد معادلة القيمة النهائية للدخل المتبقي بعد السنة الخامسة دون اختيار افتراضي صامت.',
      inactiveReasonAr: null,
      missingRequirementAr:
        'يلزم اختيار طريقة القيمة النهائية (1 أو 2 أو 3) لتأهيل نموذج RIM.',
    },
    RIM_Expected_ROE: {
      key: 'RIM_Expected_ROE',
      status: 'optional',
      requirementBadgeAr: 'اختياري (تقدير مستقبلي)',
      stageLabelAr: 'مرحلة التوقع (Y1..Y5)',
      stageEffectAr:
        'يحدد العائد المستقبلي المتوقع خلال سنوات التوقع الخمس؛ منفصل صراحةً عن ROE التاريخي المحسوب.',
      inactiveReasonAr: null,
      missingRequirementAr:
        'غير محفوظ؛ عند غيابه يُرحّل ROE التاريخي للأسهم العادية مع إظهار ذلك صراحةً كمصدر تقدير.',
    },
    RIM_Retention: {
      key: 'RIM_Retention',
      status: retentionStatus,
      requirementBadgeAr:
        rimRetentionPolicy === 'historical_retention'
          ? 'غير مستخدم بسياسة الاحتجاز التاريخي'
          : rimRetentionPolicy === 'minimum'
          ? 'مطلوب لسياسة الحد الأدنى'
          : 'مطلوب لفترة التوقع',
      stageLabelAr: 'مرحلة التوقع (Y1..Y5)',
      stageEffectAr:
        'يحدد نسبة الأرباح المحتجزة خلال السنوات 1 إلى 5 لحساب DPS الضمنية ونمو القيمة الدفترية (Clean Surplus).',
      inactiveReasonAr:
        rimRetentionPolicy === 'historical_retention'
          ? 'السياسة الحالية للشركة تستخدم الاحتجاز التاريخي (1 - Payout)؛ تبقى قيمة RIM_Retention المحفوظة دون مسح.'
          : null,
      missingRequirementAr:
        rimRetentionPolicy === 'historical_retention'
          ? null
          : 'لا توجد قيمة فعالة لـ RIM_Retention في المصادر المعتمدة؛ احفظ نسبة (0% إلى 100%) في تخصيص الشركة (company_assumptions) أو المرجع العام (macro_params) لاستكمال احتجاز فترة التوقع وفق السياسة المختارة.',
    },
    RIM_Fade_Years: fadeYearsInfo,
    RIM_Terminal_ROE: terminalRoeInfo,
    RIM_Terminal_Retention: terminalRetentionInfo,
  };
}

export function classifyFadeScheduleState(
  rimAudit: RimAuditSummary | null | undefined
): RimFadeScheduleDisplayState {
  if (!rimAudit) {
    return {
      kind: 'unavailable',
      badgeAr: 'غير متاح',
      descriptionAr: 'غير متاح (ملخص تدقيق RIM غير مرفق).',
      rows: [],
    };
  }

  if (
    rimAudit.fadeScheduleStatus === 'not_applicable' ||
    rimAudit.terminalMethod === 1 ||
    rimAudit.terminalMethod === 3
  ) {
    return {
      kind: 'not_applicable',
      badgeAr: 'غير منطبق',
      descriptionAr:
        'غير منطبق (طريقة القيمة النهائية الحالية لا تستخدم مرحلة تلاشي؛ يظهر جدول التلاشي فقط في النمط 2).',
      rows: [],
    };
  }

  if (!Array.isArray(rimAudit.fadeSchedule) || rimAudit.fadeScheduleStatus === 'unavailable') {
    return {
      kind: 'unavailable',
      badgeAr: 'غير متاح',
      descriptionAr:
        rimAudit.terminalMethod === 2 && !rimAudit.eligible
          ? 'غير متاح (تعذر بناء جدول التلاشي بسبب استبعاد النموذج أو نقص مدخلات النمط 2).'
          : 'غير متاح (بيانات جدول التلاشي غير مرفقة).',
      rows: [],
    };
  }

  if (rimAudit.fadeSchedule.length === 0) {
    return {
      kind: 'empty',
      badgeAr: 'قائمة فارغة',
      descriptionAr:
        rimAudit.terminalMethod === 2
          ? 'قائمة فارغة (لا توجد سنوات تلاشي مسجلة في مخرجات النمط 2).'
          : 'غير متاح (لم تُحدد طريقة قيمة نهائية بنمط التلاشي بعد).',
      rows: [],
    };
  }

  return {
    kind: 'available',
    badgeAr: `متاح (${rimAudit.fadeSchedule.length} سنوات)`,
    descriptionAr: `جدول التلاشي الخطي لـ ${rimAudit.fadeSchedule.length} سنوات بعد السنة الخامسة (Y6..Y${5 + rimAudit.fadeSchedule.length}).`,
    rows: rimAudit.fadeSchedule,
  };
}

export function classifyConsistencyChecksState(
  rimAudit: RimAuditSummary | null | undefined
): RimConsistencyChecksDisplayState {
  if (!rimAudit || !Array.isArray(rimAudit.consistencyChecksAr)) {
    return {
      kind: 'unavailable',
      badgeAr: 'غير متاح',
      descriptionAr:
        'غير متاح (لم تُرفق نتائج فحوصات الاتساق الحسابي — لا يُعدّ غيابها دليلاً على نجاح الفحص).',
      checks: [],
    };
  }

  if (rimAudit.consistencyChecksAr.length === 0) {
    return {
      kind: 'empty',
      badgeAr: 'لا توجد فحوصات مسجلة',
      descriptionAr:
        'قائمة فارغة (لم تُسجل نتائج فحص اتساق لهذا التقييم — لا يُعدّ ذلك نجاحاً للفحوصات).',
      checks: [],
    };
  }

  return {
    kind: 'available',
    badgeAr: `تم التحقق (${rimAudit.consistencyChecksAr.length} فحوصات)`,
    descriptionAr: 'نتائج فحوصات الاتساق الحسابي الفعلية الصادرة من محرك التقييم:',
    checks: rimAudit.consistencyChecksAr,
  };
}

export function describeTerminalShareState(
  rimAudit: RimAuditSummary | null | undefined
): RimTerminalShareDisplayState {
  if (!rimAudit) {
    return {
      valueText: 'غير متاح',
      formulaAr: 'PV(Terminal RI) ÷ Raw RIM Fair Value × 100',
      isHighWarning: false,
    };
  }

  if (
    rimAudit.terminalShareOfRimPct !== null &&
    rimAudit.terminalShareOfRimPct !== undefined &&
    Number.isFinite(rimAudit.terminalShareOfRimPct)
  ) {
    return {
      valueText: `${rimAudit.terminalShareOfRimPct.toFixed(2)}%`,
      formulaAr:
        rimAudit.terminalShareFormulaAr || 'PV(Terminal RI) ÷ Raw RIM Fair Value × 100',
      isHighWarning: rimAudit.terminalShareOfRimPct > 70,
    };
  }

  if (rimAudit.rawRimFairValue !== null && rimAudit.rawRimFairValue <= 0) {
    return {
      valueText: 'غير متاح (مقام غير موجب)',
      formulaAr:
        rimAudit.terminalShareFormulaAr ||
        'تعذر حساب النسبة لأن المقام (القيمة الخام لـ RIM) يساوي صفراً أو سالباً.',
      isHighWarning: false,
    };
  }

  return {
    valueText: 'غير متاح',
    formulaAr:
      rimAudit.terminalShareFormulaAr || 'PV(Terminal RI) ÷ Raw RIM Fair Value × 100',
    isHighWarning: false,
  };
}
