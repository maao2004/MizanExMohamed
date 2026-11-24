/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as XlsxTypes from 'xlsx';
import {
  ALL_PARAMETERS_EXCEL_HEADERS,
  ALL_PARAMETERS_INSTRUCTIONS_SHEET_NAME,
  ALL_PARAMETERS_SHEET_NAME,
  ALL_PARAMETERS_TEMPLATE_INSTRUCTIONS,
  DOWNLOADABLE_ALL_PARAMETERS_TEMPLATE_ROWS,
  excelRowToAoa,
  templateRowToExcelRow,
  WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR,
  WEIGHTED_AVG_SHARES_BASIS_OPTIONS,
  WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR,
} from '../contracts';
import { loadXlsx } from './xlsxLoader';

export async function downloadQuarterlyFcffTemplate(): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const headers = [
    'الرمز', 'StockName', 'YearQuarter', 'Shares', 'IntangibleAssets', 'TotalAssets',
    'Equity', 'TotalDebtWithoutTX', 'TotalLiabilities', 'RevenueYTD', 'GrossProfitYTD',
    'EBIT_YTD', 'PBT_YTD', 'NetIncomeYTD', 'OCF_YTD', 'NetInvestingCF_YTD',
    'DividendsPaidYTD', 'Cash', 'InterestExpense_YTD', 'FinanceCosts_YTD',
    'InterestIncome_YTD', 'TaxExpense_YTD', 'InterestPaid_YTD', 'CapEx_YTD', 'DateInsertData',
    'DA_YTD', 'DeltaOperatingNWC_YTD', 'ValuationTaxRate', 'ValuationSource', 'FinancialUnit',
    'FinancialCurrency', 'NetIncomeCommon_YTD', 'NetIncomeCommon_Basis', 'NetIncomeCommon_Note',
    'EquityCommon', 'EquityCommon_Basis', 'EquityCommon_Note',
    'PeriodStartDate', 'PeriodEndDate', 'PeriodDays',
    'WeightedAvgShares_YTD', 'WeightedAvgShares_Basis',
    'ReportedEPS', 'ReportedEPS_Source',
    'ReportedEPS_PeriodType', 'ReportedEPS_FiscalYear', 'ReportedEPS_FiscalQuarter',
    'ReportedEPS_PeriodStart', 'ReportedEPS_PeriodEnd', 'ReportedEPS_Period',
    'IsCapitalActionAdjusted',
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), 'QuarterlyFinancials');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['الحقل', 'التعليمات'],
      ['المبالغ', 'تُدخل القيم المالية بقيمتها الأساسية كما هي (الافتراضي بالجنيه المصري)؛ Shares عدد الأسهم الكامل. كل تدفقات YTD تراكمية منذ بداية السنة.'],
      ['FinancialCurrency', 'عملة القوائم (اختيارية؛ الافتراضي EGP): EGP أو USD فقط.'],
      ['FinancialUnit', 'حقل وصفي اختياري للتوافق فقط (مثل base أو EGP)؛ لا يُشترط لتشغيل الحسابات.'],
      ['CapEx_YTD', 'مدفوعات الاستثمار موجبة؛ لا تُدخل صافي التدفق الاستثماري بدلاً منها.'],
      ['DA_YTD', 'الإهلاك والاستنفاد اللذان خُصما من EBIT؛ موجب أو صفر.'],
      ['DeltaOperatingNWC_YTD', 'زيادة رأس المال العامل التشغيلي منذ أول السنة موجبة؛ النقص سالب.'],
      ['ValuationTaxRate', 'كسر عشري بين 0 و1 (مثل 0.225) أو بنسبة مئوية صريحة 22.5%.'],
      ['ValuationSource', 'مرجع القوائم والفترة والصفحة/رابط المصدر.'],
      ['NetIncomeCommon_YTD', 'صافي ربح مساهمي الشركة الأم YTD (اختياري؛ مطلوب لحساب نسبة التوزيع والاحتجاز التاريخي بدقة عند وجود حقوق أقلية).'],
      ['NetIncomeCommon_Basis', 'اختياري: explicit_common (صافي ربح الشركة الأم مسجل صراحة) أو attested_net_income_equals_common (تأكيد موثق بأن NetIncomeYTD يعادل ربح المساهمين العاديين لغياب حقوق الأقلية).'],
      ['NetIncomeCommon_Note', 'ملاحظة توثيقية اختيارية لأساس NetIncomeCommon_Basis (حد أقصى 400 حرف).'],
      ['EquityCommon', 'حقوق ملكية مساهمي الشركة الأم/العاديين في نهاية الفترة (اختياري؛ يفصل حقوق المساهمين العاديين عن حقوق الأقلية عند حساب BVPS وROE).'],
      ['EquityCommon_Basis', 'اختياري: explicit_common (مسجلة صراحة للشركة الأم) أو attested_total_equals_common (إقرار موثق بأن إجمالي Equity يعادل حقوق المساهمين العاديين).'],
      ['EquityCommon_Note', 'ملاحظة توثيقية اختيارية لأساس EquityCommon_Basis (حد أقصى 400 حرف).'],
      ['PeriodStartDate / PeriodEndDate', 'تاريخ بداية ونهاية الفترة المالية بصيغة YYYY-MM-DD (اختياريان؛ يشتق المحرك عدد الأيام الفعلي PeriodDays تلقائياً).'],
      ['PeriodDays', 'عدد الأيام التقويمية للفترة المالية (1..370؛ مطلوب إذا غابت التواريخ لحساب AccountingEPS TTM).'],
      ['WeightedAvgShares_YTD', `${WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR} (اختياري؛ مطلوب لحساب AccountingEPS).`],
      [
        'WeightedAvgShares_Basis',
        `${WEIGHTED_AVG_SHARES_BASIS_OPTIONS.map((o) => `${o.code}: ${o.labelAr}`).join(' | ')}. ${WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR}`,
      ],
      ['ReportedEPS / ReportedEPS_Source', 'ربحية السهم المعلنة بالقوائم ومصدرها كما وردت دون تحويل أو سنونة.'],
      ['ReportedEPS_PeriodType', 'نوع فترة ReportedEPS (إلزامي عند تعريف الفترة): standalone_quarter (ربع مالي منفرد) | ytd (تراكمي منذ بداية السنة المالية YTD) | fy (سنة مالية كاملة FY) | ttm (آخر 12 شهراً TTM) | needs_review (غير محدد / يحتاج مراجعة).'],
      ['ReportedEPS_FiscalYear / ReportedEPS_FiscalQuarter', 'السنة المالية (1900..2200) والربع المالي (Q1..Q4 للربع المنفرد، Q1..Q3 لـ YTD؛ ويُترك الربع فارغاً لـ FY وTTM).'],
      ['ReportedEPS_PeriodStart / ReportedEPS_PeriodEnd', 'تاريخا بداية ونهاية فترة ReportedEPS بصيغة YYYY-MM-DD (مستقلان عن فترة السجل الفصلي عند الاختلاف؛ لا يُفترض 1 يناير تلقائياً).'],
      ['ReportedEPS_Period', 'وصف مشتق تلقائياً للعرض فقط عند إدخال الحقول البنيوية؛ للنصوص القديمة الغامضة يُوسم الصف للمراجعة needs_review دون تخمين.'],
      ['IsCapitalActionAdjusted', 'TRUE أو FALSE: هل تم تعديل السلسلة لأثر التجزئة/الأسهم المجانية/زيادة رأس المال.'],
      ['التوزيعات النقدية (DPS_Actual)', 'تُستورد توزيعات السهم حصرياً من قالب DPS_Actual المستقل؛ ولا يُستخدم أي حقل قديم داخل القوائم الربع سنوية.'],
      ['BLANK', 'الفراغ بيانات غير مدخلة (null)؛ الصفر قيمة فعلية.'],
    ]),
    'تعليمات FCFF'
  );
  XLSX.writeFile(wb, 'Mizan_Quarterly_FCFF_Template.xlsx');
}

export async function downloadBetaAssumptionsTemplate(): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const rows = [
    ['Ticker', 'Beta', 'AsOfDate', 'Source'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Beta_Assumptions');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['العمود', 'التعليمات'],
      ['Ticker', 'رمز السهم في البورصة المصرية بدون أو مع .CA (يُوحّد تلقائياً).'],
      ['Beta', 'بيتا الخام التاريخية (رقم منتهٍ؛ يُقبل الصفر والسالب).'],
      ['AsOfDate', 'تاريخ السريان بصيغة YYYY-MM-DD (مطلوب).'],
      ['Source', 'مرجع حساب بيتا وفترة القياس (مطلوب).'],
    ]),
    'تعليمات Beta'
  );
  XLSX.writeFile(wb, 'Beta_Assumptions_Template.xlsx');
}

export async function buildAllParametersTemplateWorkbook(): Promise<XlsxTypes.WorkBook> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const headers = [...ALL_PARAMETERS_EXCEL_HEADERS];
  const dataRows = DOWNLOADABLE_ALL_PARAMETERS_TEMPLATE_ROWS.map((r) =>
    excelRowToAoa(templateRowToExcelRow(r))
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([headers, ...dataRows]),
    ALL_PARAMETERS_SHEET_NAME
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(ALL_PARAMETERS_TEMPLATE_INSTRUCTIONS.map(([k, v]) => [k, v])),
    ALL_PARAMETERS_INSTRUCTIONS_SHEET_NAME
  );
  return wb;
}

export async function downloadAllParametersTemplate(): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = await buildAllParametersTemplateWorkbook();
  XLSX.writeFile(wb, 'All_Parameters_Template.xlsx');
}

export async function downloadDpsActualTemplate(): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const headers = [
    'Ticker',
    'FiscalYear',
    'CashDPS',
    'AsOfDate',
    'DistributionId',
    'RecordType',
    'ApprovalStatus',
    'Semantics',
    'ExDividendDate',
    'PaymentDate',
    'RecordDate',
    'TotalDistributionAmount',
    'EligibleSharesCount',
    'Currency',
    'Source',
    'ParentAnnouncementId',
    'Notes',
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), 'DPS_Actual');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['العمود', 'التعليمات والضوابط'],
      ['Ticker', 'رمز السهم في البورصة المصرية (بدون أو مع .CA؛ يُوحّد تلقائياً) — لا يُنشئ أسهماً جديدة خارج القوائم المالية.'],
      ['FiscalYear', 'السنة المالية المستحق عنها التوزيع (رقم صحيح بين 1900 و2200).'],
      ['CashDPS', 'التوزيع النقدي للسهم بالقيمة الأساسية (مطلوب >= 0؛ الصفر 0 يعني عدم التوزيع المؤكد).'],
      ['AsOfDate', 'تاريخ الإعلان/الاعتماد المرجعي بصيغة YYYY-MM-DD (مطلوب؛ يُستخدم لضبط تاريخ القطع AsOfDate <= تاريخ التقييم).'],
      ['DistributionId', 'معرّف التوزيع الفريد داخل السنة والنوع (مثل FY2025_FINAL أو T1) لمنع التكرار.'],
      ['RecordType', 'نوع التوزيع: regular (توزيع عادي يدخل في DDM) أو special (توزيع استثنائي يُستبعد من DDM). الافتراضي regular.'],
      ['ApprovalStatus', 'حالة الاعتماد: proposed | approved | paid | cancelled (السجلات الملغاة cancelled والمقترحة proposed تُستبعد من الحسابات المعتمدة).'],
      ['Semantics', 'دلالة الصف: annual_total (إجمالي سنوي) | standalone_event (حدث منفرد) | installment (قسط/دفعة).'],
      ['ExDividendDate / PaymentDate / RecordDate', 'تواريخ اختيارية بصيغة YYYY-MM-DD للعرض والتدقيق وفصل المدفوع فعلياً؛ شمول التوزيع المعتمد يعتمد على AsOfDate حتى تاريخ التقييم.'],
      ['TotalDistributionAmount', 'إجمالي مبلغ التوزيع النقدي الفعلي بالقيمة الأساسية (اختياري؛ وإلا يُشتق من CashDPS × الأسهم).'],
      ['EligibleSharesCount', 'عدد الأسهم المستحقة للتوزيع كعدد كامل (اختياري).'],
      ['Currency', 'عملة التوزيع (اختيارية): EGP أو USD فقط؛ يجب أن تطابق عملة القوائم للدخول في DDM/العائد.'],
      ['ParentAnnouncementId', 'اختياري عند Semantics=installment لربط القسط بالإعلان الأب ومنع الازدواج.'],
      ['قاعدة الـ 0 والفراغ', 'لا تُزرع أمثلة؛ القيمة 0 تعني توزيعاً صفرياً مؤكداً، بينما غياب السجل يعني بيانات غير متاحة.'],
    ]),
    'تعليمات DPS_Actual'
  );
  XLSX.writeFile(wb, 'DPS_Actual_Template.xlsx');
}

