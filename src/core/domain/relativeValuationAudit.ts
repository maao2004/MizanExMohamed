/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AssumptionPriority,
  RelativeValuationAudit,
  RelativeValuationBlendingStatus,
  RelativeWeightDiagnostic,
  RelativeWeightScopeState,
  RelativeWeightValidity,
  ResolvedAssumption,
} from '../../types/financial';
import { getParameterDefinition } from '../contracts/parameterRegistry';

const RELATIVE_BLENDING_MEANING_NOTE_AR =
  'وزنا دمج التقييم النسبي (Relative_PE_Weight وRelative_PB_Weight) هما أوزان رقمية لدمج القيمة الضمنية المستخرجة من مضاعف P/E مع القيمة الضمنية المستخرجة من مضاعف P/B داخل نموذج التقييم النسبي فقط؛ وليسا المضاعفين نفسيهما (Target_PE / Target_PB) ولا وزن نموذج التقييم النسبي في القيمة العادلة المركبة (Weight_Relative). يُطبَّع الوزنان تلقائياً بالقسمة على مجموعهما دون اشتراط أن يساوي المجموع 1 أو 100 (فمثلاً 60 و40 يكافئان تماماً 0.6 و0.4 بحصة دمج 60% / 40%).';

function cleanOptionalText(val: string | null | undefined): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatRelativePriorityLabelAr(priority: AssumptionPriority): string {
  return priority === 'global_first'
    ? 'الافتراض العام أولاً (global_first)'
    : 'تخصيص الشركة أولاً (company_first)';
}

export function formatRelativeScopeLabelAr(scope: RelativeWeightScopeState): string {
  switch (scope) {
    case 'company':
      return 'تخصيص الشركة (company_assumptions)';
    case 'global':
      return 'المتغيرات الكلية (macro_params)';
    case 'loading_unconfirmed':
      return 'قيد تأكيد التحميل (لم يكتمل تأكيد المصادر بعد)';
    case 'missing':
    default:
      return 'غير متاح في النطاقين المؤكدين';
  }
}

export function formatRawRelativeWeight(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'غير متاح';
  return `${Number(val.toFixed(4))}`;
}

export function formatNormalizedSharePct(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'غير منطبق';
  return `${val.toFixed(1)}%`;
}

export function getRelativeWeightShortLabelAr(
  registryKey: 'Relative_PE_Weight' | 'Relative_PB_Weight'
): string {
  return registryKey === 'Relative_PE_Weight'
    ? 'وزن دمج قيمة P/E'
    : 'وزن دمج قيمة P/B';
}

function buildSingleWeightDiagnostic(params: {
  registryKey: 'Relative_PE_Weight' | 'Relative_PB_Weight';
  resolvedKey: 'relativePeWeight' | 'relativePbWeight';
  resolved: ResolvedAssumption | undefined;
  priority: AssumptionPriority;
  normalizedSharePct: number | null;
  companyOverridesConfirmed: boolean;
  macroParamsConfirmed: boolean;
}): RelativeWeightDiagnostic {
  const {
    registryKey,
    resolvedKey,
    resolved,
    priority,
    normalizedSharePct,
    companyOverridesConfirmed,
    macroParamsConfirmed,
  } = params;

  const regDef = getParameterDefinition(registryKey);
  const shortLabelAr = getRelativeWeightShortLabelAr(registryKey);
  const labelAr = regDef?.nameAr ?? `${shortLabelAr} (${registryKey})`;
  const meaningAr =
    regDef?.descriptionAr ??
    'وزن رقمي لدمج القيمتين الضمنيتين من P/E وP/B داخل نموذج التقييم النسبي.';

  const rawValue =
    resolved && typeof resolved.value === 'number' && Number.isFinite(resolved.value)
      ? resolved.value
      : null;

  const companyValue =
    resolved && typeof resolved.companyValue === 'number' && Number.isFinite(resolved.companyValue)
      ? resolved.companyValue
      : null;
  const globalValue =
    resolved && typeof resolved.globalValue === 'number' && Number.isFinite(resolved.globalValue)
      ? resolved.globalValue
      : null;

  const companyDocumentarySource = cleanOptionalText(
    resolved?.companyParameterSource ??
      (resolved?.source === 'company' ? resolved.parameterSource : null)
  );
  const companyAsOfDate = cleanOptionalText(
    resolved?.companyAsOfDate ??
      (resolved?.source === 'company' ? resolved.asOfDate : null)
  );
  const globalDocumentarySource = cleanOptionalText(
    resolved?.globalParameterSource ??
      (resolved?.source === 'global' ? resolved.parameterSource : null)
  );
  const globalAsOfDate = cleanOptionalText(
    resolved?.globalAsOfDate ??
      (resolved?.source === 'global' ? resolved.asOfDate : null)
  );

  const loadingIncomplete = !companyOverridesConfirmed || !macroParamsConfirmed;

  let scope: RelativeWeightScopeState;
  if (rawValue !== null && resolved?.source === 'company') {
    scope = 'company';
  } else if (rawValue !== null && resolved?.source === 'global') {
    scope = 'global';
  } else if (rawValue === null && loadingIncomplete) {
    scope = 'loading_unconfirmed';
  } else {
    scope = 'missing';
  }

  const documentarySource =
    scope === 'company'
      ? companyDocumentarySource
      : scope === 'global'
      ? globalDocumentarySource
      : null;
  const asOfDate =
    scope === 'company'
      ? companyAsOfDate
      : scope === 'global'
      ? globalAsOfDate
      : null;

  let validity: RelativeWeightValidity;
  let issueAr: string | null = null;
  if (rawValue === null) {
    if (loadingIncomplete) {
      validity = 'loading_unconfirmed';
      issueAr = `${shortLabelAr} (${registryKey}): لم يكتمل تأكيد تحميل المصادر من الخادم بعد.`;
    } else {
      validity = 'missing';
      issueAr = `${shortLabelAr} (${registryKey}) غير محفوظ في تخصيص الشركة (company_assumptions) أو المتغيرات الكلية (macro_params).`;
    }
  } else if (rawValue < 0) {
    validity = 'negative';
    issueAr = `${shortLabelAr} (${registryKey}) يحتوي قيمة سالبة غير صالحة (${formatRawRelativeWeight(rawValue)})؛ يجب أن يكون الوزن عدداً غير سالب (≥ 0).`;
  } else {
    validity = 'valid';
  }

  const isOverriddenByPriority = Boolean(resolved?.isOverriddenByPriority);
  let priorityExplanationAr: string | null = null;
  if (companyValue !== null && globalValue !== null) {
    if (priority === 'company_first') {
      priorityExplanationAr = `تم اعتماد تخصيص الشركة (${formatRawRelativeWeight(companyValue)}) وتقديمه على القيمة العامة (${formatRawRelativeWeight(globalValue)}) وفق أولوية تخصيص الشركة أولاً (company_first).`;
    } else {
      priorityExplanationAr =
        companyValue !== globalValue
          ? `تم اعتماد القيمة العامة (${formatRawRelativeWeight(globalValue)}) وتجاوز تخصيص الشركة المحفوظ (${formatRawRelativeWeight(companyValue)}) وفق أولوية الافتراض العام أولاً (global_first).`
          : `تتطابق قيمة تخصيص الشركة والقيمة العامة (${formatRawRelativeWeight(globalValue)})، وتم الاعتماد من المرجع العام وفق أولوية (global_first).`;
    }
  }

  return {
    registryKey,
    resolvedKey,
    shortLabelAr,
    labelAr,
    meaningAr,
    rawValue,
    normalizedSharePct,
    scope,
    scopeLabelAr: formatRelativeScopeLabelAr(scope),
    documentarySource,
    asOfDate,
    companyValue,
    companyDocumentarySource,
    companyAsOfDate,
    globalValue,
    globalDocumentarySource,
    globalAsOfDate,
    isOverriddenByPriority,
    priorityExplanationAr,
    validity,
    issueAr,
  };
}

export function buildRelativeValuationAudit(params: {
  resolvedPeWeight: ResolvedAssumption | undefined;
  resolvedPbWeight: ResolvedAssumption | undefined;
  priority: AssumptionPriority;
  peImplied: number | null;
  pbImplied: number | null;
  relativeFairValue: number | null;
  finCurrencyValid: boolean;
  currencyConsistencyBlockedReasonAr: string | null;
  companyOverridesConfirmed?: boolean;
  macroParamsConfirmed?: boolean;
  unavailableReasonAr?: string | null;
}): RelativeValuationAudit {
  const companyOverridesConfirmed = params.companyOverridesConfirmed ?? true;
  const macroParamsConfirmed = params.macroParamsConfirmed ?? true;
  const loadingUnconfirmedScopes: Array<'company_assumptions' | 'macro_params'> = [];
  if (!companyOverridesConfirmed) loadingUnconfirmedScopes.push('company_assumptions');
  if (!macroParamsConfirmed) loadingUnconfirmedScopes.push('macro_params');

  const peVal =
    params.resolvedPeWeight &&
    typeof params.resolvedPeWeight.value === 'number' &&
    Number.isFinite(params.resolvedPeWeight.value)
      ? params.resolvedPeWeight.value
      : null;
  const pbVal =
    params.resolvedPbWeight &&
    typeof params.resolvedPbWeight.value === 'number' &&
    Number.isFinite(params.resolvedPbWeight.value)
      ? params.resolvedPbWeight.value
      : null;

  const bothBranchesAvailable = params.peImplied !== null && params.pbImplied !== null;
  const weightsValidAndPositiveSum =
    peVal !== null && pbVal !== null && peVal >= 0 && pbVal >= 0 && peVal + pbVal > 0;
  const weightsSum =
    peVal !== null && pbVal !== null && peVal >= 0 && pbVal >= 0 ? peVal + pbVal : null;

  const currencyBlocked = !params.finCurrencyValid || Boolean(params.currencyConsistencyBlockedReasonAr);
  const blendingApplied =
    !currencyBlocked &&
    bothBranchesAvailable &&
    weightsValidAndPositiveSum &&
    params.relativeFairValue !== null;

  const peNormalizedSharePct =
    blendingApplied && peVal !== null && weightsSum !== null && weightsSum > 0
      ? (peVal / weightsSum) * 100
      : null;
  const pbNormalizedSharePct =
    blendingApplied && pbVal !== null && weightsSum !== null && weightsSum > 0
      ? (pbVal / weightsSum) * 100
      : null;

  const peWeight = buildSingleWeightDiagnostic({
    registryKey: 'Relative_PE_Weight',
    resolvedKey: 'relativePeWeight',
    resolved: params.resolvedPeWeight,
    priority: params.priority,
    normalizedSharePct: peNormalizedSharePct,
    companyOverridesConfirmed,
    macroParamsConfirmed,
  });

  const pbWeight = buildSingleWeightDiagnostic({
    registryKey: 'Relative_PB_Weight',
    resolvedKey: 'relativePbWeight',
    resolved: params.resolvedPbWeight,
    priority: params.priority,
    normalizedSharePct: pbNormalizedSharePct,
    companyOverridesConfirmed,
    macroParamsConfirmed,
  });

  let status: RelativeValuationBlendingStatus;
  let statusLabelAr: string;
  let formulaNoteAr: string;
  let blockingReasonAr: string | null = null;
  let remediationAr: string | null = null;

  if (currencyBlocked) {
    status = 'blocked_currency';
    statusLabelAr = 'مستبعد لتضارب أو عدم دعم العملة';
    blockingReasonAr =
      params.currencyConsistencyBlockedReasonAr ||
      'التقييم النسبي مستبعد: عملة القوائم المالية غير مدعومة أو متضاربة.';
    formulaNoteAr = 'تم تعليق التقييم النسبي قبل خطوة دمج القيمتين بسبب قيد اتساق العملة.';
  } else if (bothBranchesAvailable) {
    if (blendingApplied && peNormalizedSharePct !== null && pbNormalizedSharePct !== null && weightsSum !== null) {
      status = 'blended_both';
      statusLabelAr = 'دمج نشط لقيمتي P/E وP/B';
      formulaNoteAr = `القيمة النسبية = (قيمة P/E × ${formatRawRelativeWeight(peVal)} + قيمة P/B × ${formatRawRelativeWeight(pbVal)}) ÷ ${formatRawRelativeWeight(weightsSum)} — حصة الدمج المطبّعة: ${peNormalizedSharePct.toFixed(1)}% لقيمة P/E و${pbNormalizedSharePct.toFixed(1)}% لقيمة P/B.`;
    } else if (peWeight.validity === 'negative' || pbWeight.validity === 'negative') {
      status = 'blocked_weights';
      statusLabelAr = 'معلّق: وزن دمج سالب غير صالح';
      const invalidLabels: string[] = [];
      if (peWeight.validity === 'negative') {
        invalidLabels.push(
          `${peWeight.shortLabelAr} (Relative_PE_Weight = ${formatRawRelativeWeight(peWeight.rawValue)})`
        );
      }
      if (pbWeight.validity === 'negative') {
        invalidLabels.push(
          `${pbWeight.shortLabelAr} (Relative_PB_Weight = ${formatRawRelativeWeight(pbWeight.rawValue)})`
        );
      }
      blockingReasonAr = `التقييم النسبي مستبعد: عند توفر قيمتي P/E وP/B معاً، يجب أن تكون أوزان الدمج غير سالبة؛ القيمة السالبة المرصودة في ${invalidLabels.join(' و')}.`;
      remediationAr =
        'خطوة الاستكمال: عدّل الوزن السالب إلى عدد غير سالب (≥ 0 مع مجموع أكبر من صفر) عبر تخصيص الشركة (company_assumptions) أو المتغيرات الكلية (macro_params).';
      formulaNoteAr = 'تعذر دمج قيمتي P/E وP/B لوجود وزن سالب؛ لا تُعرض حصص دمج مطبّعة.';
    } else if (
      (peVal === null || pbVal === null) &&
      loadingUnconfirmedScopes.length > 0
    ) {
      status = 'loading_unconfirmed';
      statusLabelAr = 'بانتظار تأكيد تحميل مصادر الأوزان';
      const missingWeightNames: string[] = [];
      if (peVal === null) missingWeightNames.push('وزن دمج قيمة P/E (Relative_PE_Weight)');
      if (pbVal === null) missingWeightNames.push('وزن دمج قيمة P/B (Relative_PB_Weight)');
      const unconfirmedScopesAr = loadingUnconfirmedScopes
        .map((s) =>
          s === 'company_assumptions'
            ? 'تخصيص الشركة (company_assumptions)'
            : 'المتغيرات الكلية (macro_params)'
        )
        .join(' و');
      blockingReasonAr = `التقييم النسبي معلّق مؤقتاً: لم يكتمل تأكيد تحميل ${unconfirmedScopesAr} من الخادم للتحقق من ${missingWeightNames.join(' و')}؛ لا يُستنتج غياب الأوزان قبل اكتمال التحميل المؤكد.`;
      remediationAr =
        'خطوة الاستكمال: انتظر اكتمال المزامنة المؤكدة مع الخادم أو اضغط تحديث البيانات قبل الحكم بغياب Relative_PE_Weight أو Relative_PB_Weight.';
      formulaNoteAr = 'بانتظار تأكيد تحميل المصادر قبل تقييم توفر أوزان الدمج.';
    } else if (peVal === null || pbVal === null) {
      status = 'blocked_weights';
      statusLabelAr = 'معلّق: نقص أوزان دمج التقييم النسبي';
      const missingParts: string[] = [];
      if (peVal === null) missingParts.push('وزن دمج قيمة P/E (Relative_PE_Weight)');
      if (pbVal === null) missingParts.push('وزن دمج قيمة P/B (Relative_PB_Weight)');
      const presentParts: string[] = [];
      if (peVal !== null) {
        presentParts.push(
          `Relative_PE_Weight متاح = ${formatRawRelativeWeight(peVal)} (${peWeight.scopeLabelAr})`
        );
      }
      if (pbVal !== null) {
        presentParts.push(
          `Relative_PB_Weight متاح = ${formatRawRelativeWeight(pbVal)} (${pbWeight.scopeLabelAr})`
        );
      }
      blockingReasonAr = `التقييم النسبي مستبعد: عند توفر قيمتي P/E وP/B معاً يلزم توفر وزني الدمج دون افتراض صامت؛ الغائب حالياً: ${missingParts.join(' و')}${presentParts.length > 0 ? ` (بينما ${presentParts.join('، ')})` : ''}. يمكن حفظ الأوزان في تخصيص الشركة (company_assumptions) أو في المتغيرات الكلية (macro_params).`;
      remediationAr = `خطوة الاستكمال: احفظ ${missingParts.join(' و')} كأرقام غير سالبة بمجموع أكبر من صفر (لا يشترط أن يساوي المجموع 1 أو 100) في تخصيص الشركة (company_assumptions) أو المتغيرات الكلية (macro_params).`;
      formulaNoteAr = 'تعذر الدمج لغياب أحد وزني الدمج أو كليهما؛ لا توجد أوزان افتراضية صامتة.';
    } else {
      // Both present and >= 0, but sum === 0
      status = 'blocked_weights';
      statusLabelAr = 'معلّق: مجموع وزني الدمج يساوي صفراً';
      blockingReasonAr =
        'التقييم النسبي مستبعد: مجموع وزني الدمج يساوي صفراً (Relative_PE_Weight = 0 وRelative_PB_Weight = 0)، ولا يمكن القسمة على صفر لدمج قيمتي P/E وP/B.';
      remediationAr =
        'خطوة الاستكمال: اجعل أحد الوزنين على الأقل أكبر من صفر (مثل 1 و0 لاعتماد فرع واحد، أو 60 و40 للدمج) في تخصيص الشركة (company_assumptions) أو المتغيرات الكلية (macro_params).';
      formulaNoteAr = 'مجموع وزني الدمج يساوي صفراً؛ لا تُحتسب حصص دمج.';
    }
  } else if (params.peImplied !== null && params.pbImplied === null) {
    status = 'single_pe_only';
    statusLabelAr = 'فرع P/E فقط متاح (لا ينطبق الدمج)';
    formulaNoteAr =
      'القيمة الضمنية من مضاعف P/E فقط متاحة حالياً؛ تُعتمد مباشرة وفق السياسة الحالية ولا ينطبق دمج الفرعين ولا تُطلب أوزان الدمج (Relative_PE_Weight / Relative_PB_Weight).';
  } else if (params.pbImplied !== null && params.peImplied === null) {
    status = 'single_pb_only';
    statusLabelAr = 'فرع P/B فقط متاح (لا ينطبق الدمج)';
    formulaNoteAr =
      'القيمة الضمنية من مضاعف P/B فقط متاحة حالياً؛ تُعتمد مباشرة وفق السياسة الحالية ولا ينطبق دمج الفرعين ولا تُطلب أوزان الدمج (Relative_PE_Weight / Relative_PB_Weight).';
  } else {
    status = 'unavailable';
    statusLabelAr = 'غير متاح لعدم توفر أي فرع صالح';
    blockingReasonAr =
      params.unavailableReasonAr ??
      'التقييم النسبي غير متاح: مضاعف القطاع أو السهم المستهدف (P/E أو P/B) غير محفوظ أو الأساس المحاسبي العادي غير موجب.';
    formulaNoteAr = 'لا تتوفر قيمة ضمنية صالحة من P/E أو P/B؛ لا ينطبق الدمج.';
  }

  return {
    status,
    statusLabelAr,
    priority: params.priority,
    priorityLabelAr: formatRelativePriorityLabelAr(params.priority),
    peImplied: params.peImplied,
    pbImplied: params.pbImplied,
    relativeFairValue: params.relativeFairValue,
    blendingApplied,
    blendingRequired: !currencyBlocked && bothBranchesAvailable,
    weightsSum: blendingApplied ? weightsSum : null,
    formulaNoteAr,
    meaningNoteAr: RELATIVE_BLENDING_MEANING_NOTE_AR,
    peWeight,
    pbWeight,
    companyOverridesConfirmed,
    macroParamsConfirmed,
    loadingUnconfirmedScopes,
    blockingReasonAr,
    remediationAr,
  };
}
