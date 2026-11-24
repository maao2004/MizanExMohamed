/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getParameterDefinition, type ParameterScope, type ParameterValueType } from './parameterRegistry';

export type ValuationLabSaveDestination =
  | 'company_assumptions'
  | 'macro_params'
  | 'beta_assumptions';

export type ValuationLabAuthoritativeSource =
  | 'company_assumptions_or_macro_params'
  | 'company_assumptions_or_sectorPE'
  | 'company_assumptions'
  | 'beta_assumptions'
  | 'macro_params';

export type ValuationLabPriorityMethod =
  | 'company_first_vs_global_first'
  | 'company_first_vs_sectorPE'
  | 'beta_assumptions_strict'
  | 'company_override_only'
  | 'global_only';

export type ValuationLabLegacyCompanyField =
  | 'riskFreeRate'
  | 'equityRiskPremium'
  | 'costOfDebt'
  | 'taxRate'
  | 'sustainableGrowthRate'
  | 'targetPE'
  | 'targetPB'
  | 'beta';

export interface ValuationLabFieldDefinition {
  key: string;
  registryKey: string;
  resolvedKey: string;
  labelAr: string;
  descriptionAr: string;
  type: ParameterValueType;
  scale: number;
  step: string;
  unit: string;
  unitSuffix: string;
  min: number;
  max: number;
  placeholder: string;
  authoritativeSource: ValuationLabAuthoritativeSource;
  saveDestination: ValuationLabSaveDestination;
  allowedScopes: ParameterScope[];
  validationRules: {
    min: number;
    max: number;
    integerOnly?: boolean;
    allowedValues?: number[];
    requiresSource: boolean;
    requiresAsOfDate: boolean;
  };
  priorityResolutionMethod: ValuationLabPriorityMethod;
  supportsSensitivityDraft: boolean;
  legacyCompanyField: ValuationLabLegacyCompanyField | null;
  modeOptions?: Array<{
    value: number;
    labelAr: string;
    shortLabelAr: string;
    formulaAr?: string;
  }>;
}

export const VALUATION_LAB_FIELD_REGISTRY: ValuationLabFieldDefinition[] = [
  {
    key: 'Rf_Egypt_10Y',
    registryKey: 'Rf_Egypt_10Y',
    resolvedKey: 'riskFreeRate',
    labelAr: 'العائد الخالي من المخاطر — الجنيه (Rf_Egypt_10Y)',
    descriptionAr:
      'العائد الخالي من المخاطر للجنيه المصري؛ يُحفظ تخصيص الشركة في company_assumptions والمرجع العام في macro_params.',
    type: 'pct',
    scale: 100,
    step: '0.1',
    unit: 'decimal',
    unitSuffix: '%',
    min: 0,
    max: 1,
    placeholder: 'بلا تخصيص (مثل 24.0)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: 0, max: 1, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: 'riskFreeRate',
  },
  {
    key: 'ERP_Developed',
    registryKey: 'ERP_Developed',
    resolvedKey: 'equityRiskPremium',
    labelAr: 'علاوة مخاطر السوق المرجعية (ERP_Developed)',
    descriptionAr: 'علاوة مخاطر السوق؛ يُحفظ تخصيص الشركة في company_assumptions والمرجع العام في macro_params.',
    type: 'pct',
    scale: 100,
    step: '0.1',
    unit: 'decimal',
    unitSuffix: '%',
    min: 0,
    max: 1,
    placeholder: 'بلا تخصيص (مثل 5.0)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: 0, max: 1, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: 'equityRiskPremium',
  },
  {
    key: 'Cost_of_Debt',
    registryKey: 'Cost_of_Debt',
    resolvedKey: 'costOfDebt',
    labelAr: 'تكلفة الدين قبل الضريبة (Cost_of_Debt)',
    descriptionAr: 'تكلفة الاقتراض للشركة قبل الضريبة في حساب WACC.',
    type: 'pct',
    scale: 100,
    step: '0.1',
    unit: 'decimal',
    unitSuffix: '%',
    min: 0,
    max: 1,
    placeholder: 'بلا تخصيص (مثل 18.0)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: 0, max: 1, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: 'costOfDebt',
  },
  {
    key: 'TaxRate',
    registryKey: 'TaxRate',
    resolvedKey: 'taxRate',
    labelAr: 'معدل الضريبة الهامشي (TaxRate)',
    descriptionAr: 'معدل الضريبة المستخدم في الدرع الضريبي وتكلفة الدين بعد الضريبة.',
    type: 'pct',
    scale: 100,
    step: '0.1',
    unit: 'decimal',
    unitSuffix: '%',
    min: 0,
    max: 1,
    placeholder: 'بلا تخصيص (مثل 22.5)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: 0, max: 1, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: 'taxRate',
  },
  {
    key: 'Terminal_Growth',
    registryKey: 'Terminal_Growth',
    resolvedKey: 'terminalGrowth',
    labelAr: 'معدل النمو الدائم المستدام (Terminal_Growth)',
    descriptionAr: 'معدل النمو النهائي المستدام في نموذج DCF.',
    type: 'pct',
    scale: 100,
    step: '0.1',
    unit: 'decimal',
    unitSuffix: '%',
    min: -0.5,
    max: 0.99,
    placeholder: 'بلا تخصيص (مثل 5.0)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: -0.5, max: 0.99, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: 'sustainableGrowthRate',
  },
  {
    key: 'Target_PE',
    registryKey: 'Target_PE',
    resolvedKey: 'targetPE',
    labelAr: 'مضاعف الربحية المستهدف (Target_PE)',
    descriptionAr: 'مضاعف الربحية المستهدف في التقييم النسبي؛ يقارن مع sectorPE عند تفعيل الأولوية العامة.',
    type: 'multiple',
    scale: 1,
    step: '0.1',
    unit: 'multiple',
    unitSuffix: 'x',
    min: 0.1,
    max: 500,
    placeholder: 'بلا تخصيص (مثل 8.5)',
    authoritativeSource: 'company_assumptions_or_sectorPE',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company'],
    validationRules: { min: 0.1, max: 500, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_sectorPE',
    supportsSensitivityDraft: true,
    legacyCompanyField: 'targetPE',
  },
  {
    key: 'Target_PB',
    registryKey: 'Target_PB',
    resolvedKey: 'targetPB',
    labelAr: 'مضاعف القيمة الدفترية المستهدف (Target_PB)',
    descriptionAr: 'مضاعف القيمة الدفترية المستهدف للشركة في نموذج التقييم النسبي.',
    type: 'multiple',
    scale: 1,
    step: '0.05',
    unit: 'multiple',
    unitSuffix: 'x',
    min: 0.05,
    max: 100,
    placeholder: 'بلا تخصيص (مثل 1.5)',
    authoritativeSource: 'company_assumptions',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company'],
    validationRules: { min: 0.05, max: 100, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_override_only',
    supportsSensitivityDraft: true,
    legacyCompanyField: 'targetPB',
  },
  {
    key: 'Relative_PE_Weight',
    registryKey: 'Relative_PE_Weight',
    resolvedKey: 'relativePeWeight',
    labelAr:
      getParameterDefinition('Relative_PE_Weight')?.nameAr ??
      'وزن دمج قيمة P/E في التقييم النسبي (Relative_PE_Weight)',
    descriptionAr:
      getParameterDefinition('Relative_PE_Weight')?.descriptionAr ??
      'وزن رقمي لدمج القيمة الضمنية من P/E مع القيمة الضمنية من P/B داخل التقييم النسبي.',
    type: 'number',
    scale: 1,
    step: '0.05',
    unit: 'ratio',
    unitSuffix: '',
    min: 0,
    max: 100,
    placeholder: 'وزن رقمي غير سالب (مثل 60 أو 0.6)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: 0, max: 100, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: null,
  },
  {
    key: 'Relative_PB_Weight',
    registryKey: 'Relative_PB_Weight',
    resolvedKey: 'relativePbWeight',
    labelAr:
      getParameterDefinition('Relative_PB_Weight')?.nameAr ??
      'وزن دمج قيمة P/B في التقييم النسبي (Relative_PB_Weight)',
    descriptionAr:
      getParameterDefinition('Relative_PB_Weight')?.descriptionAr ??
      'وزن رقمي لدمج القيمة الضمنية من P/B مع القيمة الضمنية من P/E داخل التقييم النسبي.',
    type: 'number',
    scale: 1,
    step: '0.05',
    unit: 'ratio',
    unitSuffix: '',
    min: 0,
    max: 100,
    placeholder: 'وزن رقمي غير سالب (مثل 40 أو 0.4)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: 0, max: 100, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: null,
  },
  {
    key: 'Beta',
    registryKey: 'Beta',
    resolvedKey: 'beta',
    labelAr: 'بيتا التاريخية الخام المعتمدة (Beta_Assumptions)',
    descriptionAr:
      'سجل بيتا التاريخية الخام في مجموعة beta_assumptions/{Ticker}؛ يُطلب المصدر وتاريخ القياس، وتُحتسب بيتا المعدلة (Blume) للقراءة فقط.',
    type: 'number',
    scale: 1,
    step: '0.01',
    unit: 'ratio',
    unitSuffix: '',
    min: -10,
    max: 10,
    placeholder: 'أدخل بيتا التاريخية (مثل 1.05)',
    authoritativeSource: 'beta_assumptions',
    saveDestination: 'beta_assumptions',
    allowedScopes: ['company'],
    validationRules: { min: -10, max: 10, requiresSource: true, requiresAsOfDate: true },
    priorityResolutionMethod: 'beta_assumptions_strict',
    supportsSensitivityDraft: true,
    legacyCompanyField: 'beta',
  },
  {
    key: 'Beta_Analytical',
    registryKey: 'Beta_Analytical',
    resolvedKey: 'betaAnalytical',
    labelAr: 'تقدير بيتا التحليلي الاختياري للشركة (Beta_Analytical)',
    descriptionAr:
      'مسار تحليلي اختياري مستقل عن بيتا التاريخية في beta_assumptions؛ لا يستبدل السجل التاريخي ولا يُعد تعديلاً يدوياً على السجل المستورد.',
    type: 'number',
    scale: 1,
    step: '0.01',
    unit: 'ratio',
    unitSuffix: '',
    min: -10,
    max: 10,
    placeholder: 'اختياري: بيتا تحليلية مخصصة',
    authoritativeSource: 'company_assumptions',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company'],
    validationRules: { min: -10, max: 10, requiresSource: true, requiresAsOfDate: true },
    priorityResolutionMethod: 'company_override_only',
    supportsSensitivityDraft: true,
    legacyCompanyField: null,
  },
  {
    key: 'CRP_Egypt',
    registryKey: 'CRP_Egypt',
    resolvedKey: 'countryRiskPremium',
    labelAr: 'علاوة مخاطر الدولة لمصر (CRP_Egypt)',
    descriptionAr: 'علاوة مخاطر الدولة المضافة عند تفعيل أنماط CRP.',
    type: 'pct',
    scale: 100,
    step: '0.1',
    unit: 'decimal',
    unitSuffix: '%',
    min: 0,
    max: 1,
    placeholder: 'بلا تخصيص (مثل 6.0)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: 0, max: 1, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: false,
    legacyCompanyField: null,
  },
  {
    key: 'DDM_Growth',
    registryKey: 'DDM_Growth',
    resolvedKey: 'ddmGrowth',
    labelAr: 'معدل نمو التوزيعات (DDM_Growth)',
    descriptionAr: 'معدل النمو السنوي المستخدم في نموذج خصم التوزيعات DDM.',
    type: 'pct',
    scale: 100,
    step: '0.1',
    unit: 'decimal',
    unitSuffix: '%',
    min: -0.5,
    max: 0.99,
    placeholder: 'بلا تخصيص (مثل 5.0)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: -0.5, max: 0.99, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: null,
  },
  {
    key: 'RIM_Retention',
    registryKey: 'RIM_Retention',
    resolvedKey: 'rimRetention',
    labelAr: 'نسبة احتجاز الأرباح في RIM (RIM_Retention)',
    descriptionAr: 'نسبة الأرباح المحتجزة في نموذج الدخل المتبقي RIM.',
    type: 'pct',
    scale: 100,
    step: '0.5',
    unit: 'decimal',
    unitSuffix: '%',
    min: 0,
    max: 1,
    placeholder: 'بلا تخصيص (مثل 50.0)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: 0, max: 1, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: null,
  },
  {
    key: 'RIM_Expected_ROE',
    registryKey: 'RIM_Expected_ROE',
    resolvedKey: 'rimExpectedRoe',
    labelAr: 'العائد المستقبلي المتوقع ROE في RIM (RIM_Expected_ROE)',
    descriptionAr:
      'العائد المستقبلي المتوقع على حقوق المساهمين العاديين خلال أفق التوقع الخماسي في RIM؛ مستقل عن ROE التاريخي.',
    type: 'pct',
    scale: 100,
    step: '0.5',
    unit: 'decimal',
    unitSuffix: '%',
    min: -2,
    max: 5,
    placeholder: 'اختياري (تلقائي من ROE التاريخي الموثق)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: -2, max: 5, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: null,
  },
  {
    key: 'RIM_Terminal_Method',
    registryKey: 'RIM_Terminal_Method',
    resolvedKey: 'rimTerminalMethod',
    labelAr: 'طريقة القيمة النهائية في RIM (RIM_Terminal_Method)',
    descriptionAr:
      '1 = بقاء الدخل المتبقي دائماً | 2 = تلاشي ROE تدريجياً نحو Ke أو RIM_Terminal_ROE | 3 = استمرار العائد ونمو القيمة الدفترية (g_B = ROE_term × b_term).',
    type: 'mode',
    scale: 1,
    step: '1',
    unit: 'code',
    unitSuffix: '',
    min: 1,
    max: 3,
    placeholder: 'اختر 1 أو 2 أو 3',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: {
      min: 1,
      max: 3,
      integerOnly: true,
      allowedValues: [1, 2, 3],
      requiresSource: false,
      requiresAsOfDate: false,
    },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: null,
    modeOptions: [
      {
        value: 1,
        shortLabelAr: '1 — بقاء الدخل المتبقي دائماً',
        labelAr: '1 — بقاء الدخل المتبقي دائماً (RI₆ ÷ Ke)',
        formulaAr: 'PV_TV = ((ROE_proj − Ke) × B₅ ÷ Ke) ÷ (1 + Ke)⁵',
      },
      {
        value: 2,
        shortLabelAr: '2 — تلاشي ROE تدريجياً',
        labelAr: '2 — تلاشي ROE تدريجياً نحو Ke أو RIM_Terminal_ROE',
        formulaAr: 'تلاشي خطي لـ ROE خلال RIM_Fade_Years سنة ثم قيمة مستمرة عند B_(5+N) مخصومة بـ (1+Ke)^(5+N)',
      },
      {
        value: 3,
        shortLabelAr: '3 — استمرار العائد ونمو القيمة الدفترية',
        labelAr: '3 — استمرار العائد ونمو القيمة الدفترية (g_B = ROE_term × b_term)',
        formulaAr: 'PV_TV = ((ROE_term − Ke) × B₅ ÷ (Ke − g_B)) ÷ (1 + Ke)⁵ (يشترط g_B < Ke)',
      },
    ],
  },
  {
    key: 'RIM_Terminal_ROE',
    registryKey: 'RIM_Terminal_ROE',
    resolvedKey: 'rimTerminalRoe',
    labelAr: 'العائد النهائي المستدام في RIM (RIM_Terminal_ROE)',
    descriptionAr:
      'العائد النهائي المستدام على حقوق المساهمين للنمط 2 (اختياري؛ وإلا يتلاشى نحو Ke) أو النمط 3 (إلزامي لحساب القيمة المستمرة).',
    type: 'pct',
    scale: 100,
    step: '0.5',
    unit: 'decimal',
    unitSuffix: '%',
    min: -2,
    max: 5,
    placeholder: 'مطلوب للنمط 3 واختياري للنمط 2',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: -2, max: 5, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: null,
  },
  {
    key: 'RIM_Terminal_Retention',
    registryKey: 'RIM_Terminal_Retention',
    resolvedKey: 'rimTerminalRetention',
    labelAr: 'نسبة الاحتجاز النهائية في RIM (RIM_Terminal_Retention)',
    descriptionAr:
      'نسبة احتجاز الأرباح النهائية لحساب g_B = ROE_term × b_term؛ مطلوبة في النمط 3، ومطلوبة في النمط 2 فقط إذا اختلف RIM_Terminal_ROE عن Ke.',
    type: 'pct',
    scale: 100,
    step: '0.5',
    unit: 'decimal',
    unitSuffix: '%',
    min: 0,
    max: 1,
    placeholder: 'مطلوب للنمط 3 وللنمط 2 عند اختلاف العائد عن Ke',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: { min: 0, max: 1, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: null,
  },
  {
    key: 'RIM_Fade_Years',
    registryKey: 'RIM_Fade_Years',
    resolvedKey: 'rimFadeYears',
    labelAr: 'سنوات تلاشي العائد في RIM (RIM_Fade_Years)',
    descriptionAr: 'عدد سنوات التلاشي الخطي للعائد بعد السنة الخامسة عند اختيار النمط 2 (عدد صحيح بين 1 و20).',
    type: 'integer',
    scale: 1,
    step: '1',
    unit: 'years',
    unitSuffix: ' سنة',
    min: 1,
    max: 20,
    placeholder: 'مطلوب للنمط 2 (1..20)',
    authoritativeSource: 'company_assumptions_or_macro_params',
    saveDestination: 'company_assumptions',
    allowedScopes: ['company', 'global'],
    validationRules: {
      min: 1,
      max: 20,
      integerOnly: true,
      requiresSource: false,
      requiresAsOfDate: false,
    },
    priorityResolutionMethod: 'company_first_vs_global_first',
    supportsSensitivityDraft: true,
    legacyCompanyField: null,
  },
  {
    key: 'Rf_USD_10Y',
    registryKey: 'Rf_USD_10Y',
    resolvedKey: 'riskFreeRateUSD',
    labelAr: 'عائد سندات الخزانة الأمريكية 10 سنوات (Rf_USD_10Y)',
    descriptionAr: 'معامل كلي عام للنطاق global فقط (macro_params) ولا يقبل تخصيصاً فردياً للشركة.',
    type: 'pct',
    scale: 100,
    step: '0.1',
    unit: 'decimal',
    unitSuffix: '%',
    min: 0,
    max: 1,
    placeholder: 'للمدير فقط (مثل 4.5)',
    authoritativeSource: 'macro_params',
    saveDestination: 'macro_params',
    allowedScopes: ['global'],
    validationRules: { min: 0, max: 1, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'global_only',
    supportsSensitivityDraft: false,
    legacyCompanyField: null,
  },
  {
    key: 'Beta_Default',
    registryKey: 'Beta_Default',
    resolvedKey: 'betaDefault',
    labelAr: 'سياسة بيتا المرجعية عند تأكيد غياب السجل (Beta_Default)',
    descriptionAr:
      'معامل كلي عام للمدير فقط (macro_params). السياسة القياسية للمنصة هي 1.00 عند تأكيد الخادم غياب سجل بيتا.',
    type: 'number',
    scale: 1,
    step: '0.05',
    unit: 'ratio',
    unitSuffix: '',
    min: 0,
    max: 5,
    placeholder: '1.00',
    authoritativeSource: 'macro_params',
    saveDestination: 'macro_params',
    allowedScopes: ['global'],
    validationRules: { min: 0, max: 5, requiresSource: false, requiresAsOfDate: false },
    priorityResolutionMethod: 'global_only',
    supportsSensitivityDraft: false,
    legacyCompanyField: null,
  },
];

export const RIM_REGISTRY_KEYS = [
  'RIM_Terminal_Method',
  'RIM_Expected_ROE',
  'RIM_Retention',
  'RIM_Fade_Years',
  'RIM_Terminal_ROE',
  'RIM_Terminal_Retention',
] as const;

export const RELATIVE_WEIGHT_REGISTRY_KEYS = [
  'Relative_PE_Weight',
  'Relative_PB_Weight',
] as const;

export function getValuationLabField(key: string): ValuationLabFieldDefinition | null {
  return (
    VALUATION_LAB_FIELD_REGISTRY.find(
      (f) => f.key === key || f.registryKey === key || f.resolvedKey === key
    ) ?? null
  );
}

export function validateValuationLabFieldValue(
  key: string,
  storedValue: number
): { valid: boolean; reasonAr: string | null } {
  if (typeof storedValue !== 'number' || !Number.isFinite(storedValue)) {
    return { valid: false, reasonAr: 'أدخل قيمة رقمية منتهية صالحة.' };
  }
  const fieldDef = getValuationLabField(key);
  const regDef = getParameterDefinition(fieldDef?.registryKey ?? key);
  const minVal = fieldDef?.validationRules.min ?? regDef?.min;
  const maxVal = fieldDef?.validationRules.max ?? regDef?.max;
  const allowedValues = fieldDef?.validationRules.allowedValues ?? regDef?.allowedValues;
  const scale = fieldDef?.scale ?? (regDef?.isPercentage ? 100 : 1);

  if (
    fieldDef?.validationRules.integerOnly ||
    regDef?.valueType === 'integer' ||
    regDef?.valueType === 'mode'
  ) {
    if (!Number.isInteger(storedValue)) {
      return { valid: false, reasonAr: `الحقل ${key} يتطلب عدداً صحيحاً.` };
    }
  }
  if (allowedValues && !allowedValues.includes(storedValue)) {
    return {
      valid: false,
      reasonAr: `الحقل ${key} يقبل القيم: ${allowedValues.join(', ')}.`,
    };
  }
  if (minVal !== undefined && storedValue < minVal) {
    return {
      valid: false,
      reasonAr:
        scale === 100
          ? `النطاق المسموح يبدأ من ${(minVal * 100).toFixed(1)}%.`
          : `النطاق المسموح يبدأ من ${minVal}.`,
    };
  }
  if (maxVal !== undefined && storedValue > maxVal) {
    return {
      valid: false,
      reasonAr:
        scale === 100
          ? `النطاق المسموح ينتهي عند ${(maxVal * 100).toFixed(1)}%.`
          : `النطاق المسموح ينتهي عند ${maxVal}.`,
    };
  }
  return { valid: true, reasonAr: null };
}
