/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as XlsxTypes from 'xlsx';
import {
  AuditWarning,
  Company,
  DailyTradingSchemaRecord,
  FinancialMetricsTTM,
  QuarterlyFinancial,
  TradeLog,
  ValuationResults,
} from '../types/financial';
import type {
  CompanyParameterOverride,
  DailyTradingRecord,
  MacroParameter,
  QuarterlyFinancialRecord,
} from '../types';
import { getSectorClassificationLabelAr } from '../core/domain/valuationAssumptions';
import {
  formatNormalizedSharePct,
  formatRawRelativeWeight,
} from '../core/domain/relativeValuationAudit';
import {
  formatDocumentaryMetadataAr,
  formatScopedAssumptionStateAr,
} from '../core/domain/assumptionSourcePresentation';
import {
  classifyConsistencyChecksState,
  classifyFadeScheduleState,
  describeTerminalShareState,
  formatRimTerminalMethodLabel,
} from '../core/domain/rimPresentation';
import {
  ALL_PARAMETERS_EXCEL_HEADERS,
  ALL_PARAMETERS_INSTRUCTIONS_SHEET_NAME,
  ALL_PARAMETERS_SHEET_NAME,
  ALL_PARAMETERS_TEMPLATE_INSTRUCTIONS,
  excelRowToAoa,
  parameterRecordToExcelRow,
  RIM_REGISTRY_KEYS,
  getValuationLabField,
} from '../core/contracts';
import {
  indexDailySchemas,
  resolveDailyCellDisplay,
  resolveUnifiedDailyColumns,
  UnifiedDailyColumn,
} from '../core/domain/dailyColumnResolver';
import { downloadQuarterlyFcffTemplate, loadXlsx } from '../core/imports';

const formatSourceAr = (src: 'company' | 'global' | 'missing'): string =>
  src === 'company' ? 'خاص بالشركة' : src === 'global' ? 'عام محفوظ' : 'غير متاح';

const formatResolvedVal = (val: number | null, unitOrFormat?: string): string | number => {
  if (val === null) return 'غير متاح';
  if (unitOrFormat === 'pct') return `${(val * 100).toFixed(2)}%`;
  if (unitOrFormat === 'multiple') return `${val.toFixed(2)}x`;
  return val;
};

/**
 * بناء مصنف Excel لتقييم الشركة بنفس افتراضات ومخرجات المحرك الموحد (مع تحميل xlsx ديناميكياً)
 */
export async function buildCompanyValuationWorkbook(
  company: Company,
  financials: QuarterlyFinancial[],
  metrics: FinancialMetricsTTM,
  valuation: ValuationResults,
  auditWarnings: AuditWarning[]
): Promise<XlsxTypes.WorkBook> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const resolved = valuation.resolvedAssumptions ?? {};
  const summary = valuation.sourcesSummary;
  const rfResolved = resolved.riskFreeRate;
  const erpResolved = resolved.equityRiskPremium;
  const priorityLabel =
    (valuation.assumptionPriority ?? 'company_first') === 'global_first'
      ? 'الافتراض العام المحفوظ أولاً (Global First)'
      : 'تخصيص الشركة أولاً (Company First)';

  const sharesSourceLabel =
    summary?.sharesSource === 'quarterly_record'
      ? `سجل ربع سنوي (${summary.sharesPeriod ?? '-'})`
      : summary?.sharesSource === 'daily_listed_shares'
      ? `التداول اليومي (${summary.sharesPeriod ?? '-'})`
      : summary?.sharesSource === 'company_metadata'
      ? 'بيانات الشركة الوصفية'
      : 'غير متاح';

  const marketPriceSourceLabel =
    (summary?.marketPriceSource ?? company.marketPriceSource) === 'lastPrice'
      ? 'آخر سعر (Last Price)'
      : (summary?.marketPriceSource ?? company.marketPriceSource) === 'closePrice'
      ? 'إقفال اليوم (Close Price)'
      : 'غير متاح';

  const betaStatusLabel =
    summary?.betaStatus === 'actual'
      ? `بيتا فعلية (${summary.betaSource || 'beta_assumptions'}${summary.betaAsOfDate ? ` — ${summary.betaAsOfDate}` : ''})`
      : summary?.betaStatus === 'defaulted_missing'
      ? 'بيتا مفترضة = 1 بعد تأكيد غياب سجل بيتا'
      : 'تعذر تأكيد سجل بيتا من الخادم';

  const tvMethodLabel =
    (summary?.terminalValueMethod ?? valuation.dcfDetails?.terminalValueMethod) === 'exit_multiple'
      ? 'مضاعف الخروج النهائي (EV/EBITDA Exit Multiple)'
      : 'معدل النمو الدائم المستدام (Perpetuity Growth)';

  const activeFinCurrency =
    valuation.engineOutputs?.financialCurrency ??
    summary?.financialCurrency ??
    metrics.financialCurrency ??
    'غير محدد';
  const marketCurrency =
    valuation.engineOutputs?.marketPriceCurrency ??
    summary?.marketPriceCurrency ??
    metrics.marketPriceCurrency ??
    'غير محدد';
  const amountUnitLabel = summary?.amountUnit ?? metrics.financialUnit ?? 'قيمة أساسية (ج.م)';
  const sharesUnitLabel = summary?.sharesUnit ?? metrics.sharesUnit ?? 'shares';
  const rfMethodologyVal =
    valuation.engineOutputs?.rfMethodology ?? summary?.rfMethodology ?? 'unspecified';
  const rfResolvedKeyVal =
    valuation.engineOutputs?.rfResolvedKey ?? summary?.rfResolvedKey ?? 'غير محدد';
  const rfResolvedScopeVal =
    valuation.engineOutputs?.rfResolvedScope ?? summary?.rfResolvedScope ?? 'missing';
  const epsBasisLabel =
    metrics.epsBasisLabelAr ??
    summary?.epsBasisLabelAr ??
    'نسبة تحليلية: صافي ربح آخر 12 شهراً / عدد الأسهم المسجلة في نهاية الفترة';
  const roeBasisLabel =
    metrics.roeBasisLabelAr ??
    summary?.roeBasisLabelAr ??
    'عائد حقوق الملكية محسوب على حقوق الملكية في نهاية الفترة (EOP Equity)';

  const metricAudit =
    metrics.metricAudit ?? valuation.metricAudit ?? summary?.metricAudit ?? null;
  const rimAudit =
    valuation.rimAudit ?? summary?.rimAudit ?? valuation.engineOutputs?.rimAudit ?? null;

  const bvpsBasisLabel =
    metrics.bvpsBasisLabelAr ??
    summary?.bvpsBasisLabelAr ??
    metricAudit?.valuationBvps.basisLabelAr ??
    'حقوق المساهمين العاديين في نهاية الفترة (EquityCommon ÷ EOP Shares)';

  const comparisonSummaryLabel = metricAudit
    ? `${metricAudit.reportedVsAccountingComparison.status} — ${metricAudit.reportedVsAccountingComparison.messageAr}`
    : 'غير متاح';

  const valuationEpsVal = metrics.analyticalCommonEpsTTM ?? metrics.epsTTM;
  const consolidatedEpsRef =
    metrics.analyticalConsolidatedEpsTTM ??
    metricAudit?.analyticalEpsTTM.value ??
    null;

  // 1. ورقة ملخص التقييم والمؤشرات (Valuation Summary)
  const summaryData: any[][] = [
    ['منصة ميزان لتقييم الأسهم المصرية', ''],
    ['تقرير التقييم الشامل للشركة', ''],
    ['تاريخ التقرير', new Date().toLocaleDateString('ar-EG')],
    ['أولوية الافتراضات المفعلة', priorityLabel],
    ['طريقة القيمة النهائية (DCF)', tvMethodLabel],
    ['عدد سنوات التوقع (DCF)', valuation.dcfDetails?.forecastYears ?? summary?.forecastYears ?? 'غير متاح'],
    ['عملة القوائم المالية', activeFinCurrency],
    ['وحدة القوائم المالية', amountUnitLabel],
    ['وحدة عدد الأسهم', sharesUnitLabel],
    ['عملة السعر السوقي', marketCurrency],
    ['عملة Ke / WACC', `Ke: ${valuation.engineOutputs?.keCurrency ?? summary?.keCurrency ?? 'غير محدد'} | WACC: ${valuation.engineOutputs?.waccCurrency ?? summary?.waccCurrency ?? 'غير محدد'}`],
    ['تصنيف منهجية Rf', `${rfMethodologyVal} (المصدر: ${rfResolvedKeyVal} / ${rfResolvedScopeVal})`],
    ['منهجية EPS التقييمية المعتمدة (Common EPS)', epsBasisLabel],
    ['Valuation EPS المعتمد (Common EPS TTM ÷ EOP Shares)', valuationEpsVal != null ? valuationEpsVal : 'غير موثق / غير متاح'],
    ['Consolidated Analytical EPS (مرجعية موحدة فقط)', consolidatedEpsRef != null ? consolidatedEpsRef : 'غير متاح'],
    ['مضاعف P/E التقييمي (على Common EPS)', metrics.peTTM != null ? Number(metrics.peTTM.toFixed(2)) : 'غير متاح'],
    ['مضاعف P/E الموحّد (مرجعية فقط — Consolidated Ref)', metrics.peConsolidatedRef != null ? Number(metrics.peConsolidatedRef.toFixed(2)) : 'غير متاح'],
    ['AccountingEPS (أحدث فترة)', metrics.accountingEpsLatest != null ? `${metrics.accountingEpsLatest} (${metricAudit?.accountingEpsLatest.periodLabel ?? '-'})` : 'غير متاح'],
    ['AccountingEPS (TTM)', metrics.accountingEpsTTM != null ? `${metrics.accountingEpsTTM} (${metricAudit?.accountingEpsTTM.periodLabel ?? '-'})` : 'غير متاح'],
    ['Reported EPS (المعلن بالقوائم)', summary?.reportedEps != null ? `${summary.reportedEps} (${summary.reportedEpsSource || '-'} / ${summary.reportedEpsPeriod || '-'})` : 'غير مسجل'],
    ['مقارنة Reported vs Accounting EPS', comparisonSummaryLabel],
    ['أساس BVPS المعتمد بالتقييم (Common Equity Only)', bvpsBasisLabel],
    ['Common BVPS (المساهمين العاديين)', metrics.commonBvps != null ? metrics.commonBvps : 'غير موثق'],
    ['Total-Equity BVPS (مرجعية فقط)', metrics.totalEquityBvps ?? metricAudit?.totalEquityBvps.value ?? 'غير متاح'],
    ['Valuation BVPS (المستخدم في RIM / P/B / جراهام)', metrics.bvps != null ? metrics.bvps : 'غير متاح'],
    ['مضاعف P/B التقييمي (على Common BVPS)', metrics.pbTTM != null ? Number(metrics.pbTTM.toFixed(2)) : 'غير متاح'],
    ['مضاعف P/B على إجمالي الحقوق (مرجعية فقط)', metrics.pbTotalEquityRef != null ? Number(metrics.pbTotalEquityRef.toFixed(2)) : 'غير متاح'],
    ['منهجية ROE المعتمدة', roeBasisLabel],
    ['ROE التاريخي للأسهم العادية', metrics.roe != null ? `${(metrics.roe * 100).toFixed(2)}% (${metrics.roeBasis ?? '-'})` : 'غير متاح'],
    ['ROE المستقبلي الفعلي في RIM', rimAudit?.forwardRoeUsed != null ? `${(rimAudit.forwardRoeUsed * 100).toFixed(2)}% (${rimAudit.forwardRoeBasisLabelAr})` : 'غير متاح'],
    ['طريقة القيمة النهائية في RIM', rimAudit?.terminalMethodLabelAr ?? 'غير محددة'],
    ['ROE على متوسط حقوق الملكية (Average Equity)', metrics.roeAverageEquity != null ? `${(metrics.roeAverageEquity * 100).toFixed(2)}%` : summary?.roeAverageEquity != null ? `${(summary.roeAverageEquity * 100).toFixed(2)}%` : 'غير متاح (يتطلب زوج بداية/نهاية متطابق)'],
    ['منهجية نموذج RIM', valuation.engineOutputs?.rimMethodologyNoteAr ?? summary?.rimMethodologyNoteAr ?? 'أفق 5 سنوات + قيمة مستمرة وفق الطريقة الصريحة عند Ke > 0'],
    ['تنبيه توحيد العملات والوحدات', valuation.currencyConsistencyBlockedReasonAr ?? summary?.currencyConsistencyBlockedReasonAr ?? 'متسق وسليم'],
    ['تحذيرات معاملات عامة غير صالحة', summary?.invalidGlobalParameters && summary.invalidGlobalParameters.length > 0 ? summary.invalidGlobalParameters.map((g) => `${g.key}: ${g.reasonAr}`).join(' | ') : 'لا يوجد'],
    ['', ''],
    ['بيانات السهم الأساسية ومصادر الاكتمال', 'القيمة / المصدر'],
    ['رمز السهم (Ticker)', company.ticker],
    ['اسم الشركة بالعربية', company.nameAr],
    ['اسم الشركة بالإنجليزية', company.nameEn],
    ['القطاع الرسمي (sectorPE)', company.sector || 'غير محدد'],
    ['معرف القطاع الرسمي (sectorId)', summary?.sectorId ?? company.sectorId ?? 'غير مربوط'],
    ['مصدر ربط القطاع (sectorPE SSOT)', summary?.sectorClassificationSource ?? 'غير محدد'],
    ['حالة تحميل سجل sectorPE', `${summary?.sectorPeStatus ?? 'unknown'}${summary?.sectorPeError ? ` (${summary.sectorPeError})` : ''}`],
    [
      'تصنيف النشاط لـ DCF',
      getSectorClassificationLabelAr(summary?.sectorClassification ?? company.sectorClassification ?? 'unknown'),
    ],
    ['آخر فترة مالية متاحة', summary?.latestFinancialPeriod ?? 'غير متاح'],
    [`السعر السوقي الحالي (${marketCurrency})`, company.marketPrice ?? 'غير متاح'],
    ['تاريخ السعر السوقي', summary?.marketPriceDate ?? company.latestTradeDate ?? 'غير متاح'],
    ['نوع السعر السوقي المعتمد', marketPriceSourceLabel],
    ['عدد الأسهم المصدرة الكامل', company.sharesOutstanding ?? 'غير متاح'],
    ['مصدر وفترة الأسهم', sharesSourceLabel],
    [
      'ملاحظة الأسهم',
      summary?.sharesIsEndOfPeriodNoteAr ??
        'الأسهم المستخدمة تمثل عدد الأسهم في نهاية الفترة المسجلة وليست متوسطاً مرجحاً تاريخياً.',
    ],
    [
      `القيمة السوقية المحسوبة (السعر × الأسهم الكاملة — ${metrics.marketCap !== null ? marketCurrency : 'غير متاح'})`,
      metrics.marketCap !== null ? metrics.marketCap : 'غير متاح',
    ],
    ['بيتا الخام (Beta Raw)', valuation.betaRaw ?? summary?.betaRaw ?? company.beta ?? 'غير متاح'],
    ['بيتا المعدلة (Beta Adjusted)', valuation.betaAdjusted ?? summary?.betaAdjusted ?? 'غير متاح'],
    ['حالة ومصدر بيتا', betaStatusLabel],
    [
      'معدل الخالي من المخاطر (Rf)',
      rfResolved
        ? `${formatResolvedVal(rfResolved.value, 'pct')} (${formatSourceAr(rfResolved.source)})`
        : company.riskFreeRate !== null
        ? `${(company.riskFreeRate * 100).toFixed(2)}%`
        : 'غير متاح',
    ],
    [
      'علاوة مخاطر السوق (ERP)',
      erpResolved
        ? `${formatResolvedVal(erpResolved.value, 'pct')} (${formatSourceAr(erpResolved.source)})`
        : company.equityRiskPremium !== null
        ? `${(company.equityRiskPremium * 100).toFixed(2)}%`
        : 'غير متاح',
    ],
    ['تكلفة حقوق الملكية (Ke)', metrics.costOfEquity !== null ? `${(metrics.costOfEquity * 100).toFixed(2)}%` : 'غير متاح'],
    ['متوسط تكلفة رأس المال (WACC)', metrics.wacc === null ? 'غير متاح' : `${(metrics.wacc * 100).toFixed(2)}%`],
    ['', ''],
    ['نتائج نماذج التقييم الخمسة', `القيمة المقدرة (${activeFinCurrency})`, 'الوزن الفعلي المعاد توزيعه (%)', 'حالة النموذج / سبب الاستبعاد'],
    ...(valuation.modelStatuses
      ? valuation.modelStatuses.map((ms) => [
          ms.nameAr,
          ms.fairValue !== null ? ms.fairValue.toFixed(2) : 'غير متاح',
          `${ms.weightPct.toFixed(2)}%`,
          ms.status === 'available' ? 'متاح ومشارك' : ms.reasonAr || 'مستبعد',
        ])
      : [
          ['1. التدفق النقدي المخصوم (DCF)', valuation.dcfFairValue !== null ? valuation.dcfFairValue.toFixed(2) : 'غير منطبق', `${valuation.weights.dcf.toFixed(2)}%`, ''],
          ['2. خصم التوزيعات النقدية (DDM)', valuation.ddmFairValue !== null ? valuation.ddmFairValue.toFixed(2) : 'غير منطبق', `${valuation.weights.ddm.toFixed(2)}%`, ''],
          ['3. نموذج الدخل المتبقي (RIM)', valuation.rimFairValue !== null ? valuation.rimFairValue.toFixed(2) : 'غير منطبق', `${valuation.weights.rim.toFixed(2)}%`, ''],
          ['4. التقييم النسبي بالمضاعفات (Relative)', valuation.relativeFairValue !== null ? valuation.relativeFairValue.toFixed(2) : 'غير منطبق', `${valuation.weights.relative.toFixed(2)}%`, ''],
          ['5. نموذج بنجامين جراهام (Graham)', valuation.grahamFairValue !== null ? valuation.grahamFairValue.toFixed(2) : 'غير منطبق', `${valuation.weights.graham.toFixed(2)}%`, ''],
        ]),
    ...(valuation.configuredWeights
      ? [
          [
            'الأوزان الأساسية المحفوظة قبل إعادة التوزيع',
            `DCF ${valuation.configuredWeights.dcf.toFixed(1)}% · DDM ${valuation.configuredWeights.ddm.toFixed(1)}% · RIM ${valuation.configuredWeights.rim.toFixed(1)}% · Relative ${valuation.configuredWeights.relative.toFixed(1)}% · Graham ${valuation.configuredWeights.graham.toFixed(1)}%`,
            '100%',
            summary?.singleModelWarningAr || 'تُعاد قسمتها على النماذج المتاحة فقط',
          ],
        ]
      : []),
    ['', '', ''],
    [`القيمة العادلة المرجحة (Composite Fair Value — ${activeFinCurrency})`, valuation.compositeFairValue?.toFixed(2) ?? 'غير متاح', '100%'],
    [`السعر السوقي الحالي (${marketCurrency})`, company.marketPrice !== null ? company.marketPrice.toFixed(2) : 'غير متاح', ''],
    ['هامش الأمان (Margin of Safety %)', valuation.marginOfSafetyPct != null ? `${valuation.marginOfSafetyPct.toFixed(2)}%` : 'غير متاح', ''],
    ['العائد المستهدف الصعودي (Upside %)', valuation.upsidePotentialPct != null ? `${valuation.upsidePotentialPct.toFixed(2)}%` : 'غير متاح', ''],
    ['', '', ''],
    ['نطاقات السيناريوهات', `القيمة العادلة (${activeFinCurrency})`, 'هامش الأمان'],
    ['السيناريو المتحفظ (Bear)', valuation.scenarios.bear.fairValue?.toFixed(2) ?? 'غير متاح', valuation.scenarios.bear.marginOfSafetyPct != null ? `${valuation.scenarios.bear.marginOfSafetyPct.toFixed(1)}%` : 'غير متاح'],
    ['السيناريو الأساسي (Base)', valuation.scenarios.base.fairValue?.toFixed(2) ?? 'غير متاح', valuation.scenarios.base.marginOfSafetyPct != null ? `${valuation.scenarios.base.marginOfSafetyPct.toFixed(1)}%` : 'غير متاح'],
    ['السيناريو المتفائل (Bull)', valuation.scenarios.bull.fairValue?.toFixed(2) ?? 'غير متاح', valuation.scenarios.bull.marginOfSafetyPct != null ? `${valuation.scenarios.bull.marginOfSafetyPct.toFixed(1)}%` : 'غير متاح'],
  ];
  const divSourceLabel =
    summary?.dividendSummary?.source === 'dividend_records'
      ? `DPS_Actual (${summary.dividendSummary.targetFiscalYear ?? '-'})`
      : summary?.dividendSummary?.source === 'confirmed_no_dividend'
      ? `سنة بدون توزيعات مؤكدة (${summary.dividendSummary.targetFiscalYear ?? '-'})`
      : 'غير متاح';

  summaryData.push(['تاريخ التقييم المعتمد (Valuation Date)', summary?.valuationDate ?? 'غير محدد']);
  summaryData.push(['تاريخ جلسة التداول المعتمدة', summary?.priceSessionDate ?? company.latestTradeDate ?? 'غير محدد']);
  summaryData.push([
    'تعارض مضاعف ربحية القطاع (Sector P/E)',
    summary?.sectorPeConflictDetected
      ? `نعم — تم تعطيل ربط P/E القطاعي (${(summary.sectorPeConflictingEntries ?? []).map((e) => `${e.key}=${e.value}`).join(' | ')})`
      : 'لا يوجد',
  ]);
  summaryData.push([`FCFF_TTM (${amountUnitLabel})`, metrics.fcffTTM ?? 'غير متاح']);
  summaryData.push(['مصدر ووحدة FCFF', summary?.fcffSource ? `${summary.fcffSource} (${summary.fcffUnit ?? '-'})` : 'غير متاح']);
  summaryData.push(['NOPAT_TTM', metrics.nopatTTM ?? 'غير متاح']);
  summaryData.push(['D&A_TTM', metrics.depreciationAmortizationTTM ?? 'غير متاح']);
  summaryData.push(['ΔOperating NWC_TTM', metrics.changeOperatingNwcTTM ?? 'غير متاح']);
  summaryData.push(['مصدر التوزيعات النقدية', divSourceLabel]);
  summaryData.push([
    'حالة اكتمال توزيعات السنة',
    summary?.dividendSummary?.dividendYearStatus
      ? `${summary.dividendSummary.dividendYearStatus}${summary.dividendSummary.dividendYearStatusSource ? ` (${summary.dividendSummary.dividendYearStatusSource})` : ''}`
      : 'unknown',
  ]);
  summaryData.push(['التوزيع المنتظم للسهم (Regular DPS — يدخل DDM)', metrics.dpsRegular ?? 'غير متاح']);
  summaryData.push(['التوزيع الاستثنائي للسهم (Special DPS — مستبعد من DDM)', metrics.dpsSpecial ?? 'غير متاح']);
  summaryData.push(['التوزيع المدفوع فعلياً للسهم (Paid Total DPS)', metrics.paidTotalDps ?? summary?.dividendSummary?.paidTotalDps ?? 'غير متاح']);
  summaryData.push(['عدد سجلات التوزيع المدفوعة فعلياً', summary?.dividendSummary?.paidRecordsCount ?? 0]);
  summaryData.push(['إجمالي التوزيعات النقدية المنسوبة (المعتمد + المدفوع)', metrics.totalAttributableDividends ?? 'غير متاح']);
  summaryData.push(['إجمالي التوزيعات المدفوعة فعلياً (Paid Attributable)', metrics.paidAttributableDividends ?? summary?.dividendSummary?.paidAttributableDividends ?? 'غير متاح']);
  summaryData.push([
    'أساس بسط المقام للربح السنوي (Common NI)',
    summary?.dividendSummary?.fiscalYearIncomeSource
      ? `${summary.dividendSummary.fiscalYearIncomeSource}${summary.dividendSummary.payoutUnavailableReasonAr ? ` (${summary.dividendSummary.payoutUnavailableReasonAr})` : ''}`
      : 'غير متاح',
  ]);
  summaryData.push(['نسبة التوزيع التاريخية الرسمية (Historical Payout)', metrics.historicalPayoutRatio != null ? `${(metrics.historicalPayoutRatio * 100).toFixed(2)}%` : 'غير متاح']);
  summaryData.push(['نسبة الاحتجاز التاريخية الرسمية (1 - Payout)', metrics.historicalRetentionRatio != null ? `${(metrics.historicalRetentionRatio * 100).toFixed(2)}%` : 'غير متاح']);
  summaryData.push(['نسبة التوزيع الجزئية (للتدقيق فقط — لا تدخل التقييم)', metrics.partialPayoutRatio != null ? `${(metrics.partialPayoutRatio * 100).toFixed(2)}%` : 'غير متاح']);
  summaryData.push(['نسبة الاحتجاز الجزئية (للتدقيق فقط)', metrics.partialRetentionRatio != null ? `${(metrics.partialRetentionRatio * 100).toFixed(2)}%` : 'غير متاح']);
  summaryData.push([
    'صلاحية الاحتجاز التاريخي لنموذج RIM',
    summary?.historicalRetentionSuitableForRim === false
      ? `غير مناسب: ${summary.historicalRetentionRimBlockReasonAr || 'موقوف'}`
      : summary?.historicalRetentionSuitableForRim === true
      ? 'مناسب ومعتمد'
      : 'غير محدد',
  ]);
  summaryData.push([
    'سياسة احتجاز RIM المفعلة للشركة',
    `${summary?.rimRetentionPolicy ?? company.rimRetentionPolicy ?? valuation.rimRetentionPolicy ?? 'rim_parameter'} (${summary?.activeRimRetentionUsed != null ? `${(summary.activeRimRetentionUsed * 100).toFixed(2)}%` : 'غير متاح'})`,
  ]);
  if (summary?.rimRetentionSelectionRuleNoteAr) {
    summaryData.push(['ملاحظة قاعدة اختيار الاحتجاز في RIM', summary.rimRetentionSelectionRuleNoteAr]);
  }
  if (summary?.dividendDatePolicyNoteAr) {
    summaryData.push(['سياسة تواريخ التوزيعات', summary.dividendDatePolicyNoteAr]);
  }
  if (summary?.historicalRestatementLimitationAr) {
    summaryData.push(['حدود التقييم التاريخي (تعديل القوائم)', summary.historicalRestatementLimitationAr]);
  }

  if (valuation.dcfDetails) {
    const d = valuation.dcfDetails;
    const rows: any[][] = [
      ['Terminal Value Method', d.terminalValueMethod],
      ['Terminal Inputs Summary', d.terminalInputsSummary],
      ['Forecast Years', d.forecastYears],
      ['Year', 'Growth (FCFF)', 'FCFF', 'Discount factor', 'Present value'],
      ...d.years.map((y) => [y.year, y.growth, y.fcff, y.discountFactor, y.presentValue]),
      ['PV Forecast Flows', d.pvForecastFlows],
      ['Projected Terminal EBITDA', d.projectedTerminalEbitda ?? 'N/A'],
      ['Terminal Value', d.terminalValue],
      ['PV terminal', d.presentTerminalValue],
      ['Terminal Share of EV (%)', d.terminalShareOfEvPct != null ? Number(d.terminalShareOfEvPct.toFixed(2)) : 'N/A'],
      ['Enterprise value', d.enterpriseValue],
      ['Net debt', d.netDebt],
      ['Equity value', d.equityValue],
      ['Per share', valuation.dcfFairValue],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'DCF_Audit');
  }

  const ddmAudit = valuation.ddmAudit ?? summary?.ddmAudit ?? valuation.engineOutputs?.ddmAudit ?? null;
  const relativeAuditForFlags =
    valuation.relativeAudit ?? summary?.relativeAudit ?? valuation.engineOutputs?.relativeAudit ?? null;
  const exportCompanyOverridesConfirmed =
    ddmAudit?.companyOverridesConfirmed ??
    relativeAuditForFlags?.companyOverridesConfirmed ??
    summary?.companyOverridesConfirmed ??
    true;
  const exportMacroParamsConfirmed =
    ddmAudit?.macroParamsConfirmed ??
    relativeAuditForFlags?.macroParamsConfirmed ??
    summary?.macroParamsConfirmed ??
    true;

  if (ddmAudit) {
    const ddmGrowthResolved = resolved.ddmGrowth;
    const ddmCompanyConfirmed = ddmAudit.companyOverridesConfirmed ?? exportCompanyOverridesConfirmed;
    const ddmMacroConfirmed = ddmAudit.macroParamsConfirmed ?? exportMacroParamsConfirmed;
    const ddmGrowthSourceText =
      ddmAudit.growthSourceLabelAr ??
      (ddmGrowthResolved
        ? ddmGrowthResolved.source === 'missing' && (!ddmCompanyConfirmed || !ddmMacroConfirmed)
          ? 'قيد تأكيد التحميل من الخادم'
          : formatSourceAr(ddmGrowthResolved.source)
        : 'غير متاح');
    const formatDdmPct = (v: number) => `${(v * 100).toFixed(2)}%`;
    const ddmCompanyScopePres = formatScopedAssumptionStateAr({
      value: ddmAudit.growthCompanyValue,
      scopeConfirmed: ddmCompanyConfirmed,
      formatValue: formatDdmPct,
      documentarySource:
        ddmAudit.growthCompanyDocumentarySource ?? ddmGrowthResolved?.companyParameterSource,
      asOfDate: ddmAudit.growthCompanyAsOfDate ?? ddmGrowthResolved?.companyAsOfDate,
      includeMissingDocumentaryNote: true,
    });
    const ddmGlobalScopePres = formatScopedAssumptionStateAr({
      value: ddmAudit.growthGlobalValue,
      scopeConfirmed: ddmMacroConfirmed,
      formatValue: formatDdmPct,
      documentarySource:
        ddmAudit.growthGlobalDocumentarySource ?? ddmGrowthResolved?.globalParameterSource,
      asOfDate: ddmAudit.growthGlobalAsOfDate ?? ddmGrowthResolved?.globalAsOfDate,
      includeMissingDocumentaryNote: true,
    });
    const ddmDocMetaText = formatDocumentaryMetadataAr({
      hasEffectiveValue: ddmAudit.growth !== null && ddmAudit.growth !== undefined,
      loadingUnconfirmed: ddmAudit.growthSource === 'loading_unconfirmed',
      documentarySource: ddmAudit.growthDocumentarySource ?? ddmGrowthResolved?.parameterSource,
      asOfDate: ddmAudit.growthAsOfDate ?? ddmGrowthResolved?.asOfDate,
      isSensitivityDraft:
        Boolean(ddmAudit.isSensitivityDraft) || ddmAudit.growthSource === 'sensitivity_draft',
    });

    summaryData.push(['أهلية نموذج DDM', ddmAudit.eligible ? 'مؤهل' : `مستبعد (${ddmAudit.basisStatus})`]);
    summaryData.push(['D0 (توزيع السهم العادي الأساسي)', ddmAudit.d0 ?? 'غير متاح']);
    summaryData.push(['D1 = D0 × (1 + g)', ddmAudit.d1 ?? 'غير متاح']);
    summaryData.push([
      'معدل نمو التوزيعات g (DDM_Growth)',
      ddmAudit.growth != null
        ? `${(ddmAudit.growth * 100).toFixed(2)}% (${ddmGrowthSourceText})`
        : ddmAudit.growthSource === 'loading_unconfirmed'
        ? 'قيد تأكيد التحميل'
        : 'غير محفوظ (غياب مؤكد)',
    ]);
    summaryData.push(['هامش خصم جوردون (Ke - g)', ddmAudit.keMinusG != null ? `${(ddmAudit.keMinusG * 100).toFixed(2)}%` : 'غير متاح']);
    summaryData.push(['سنة أساس DDM المعتمدة', ddmAudit.basisFiscalYear ?? 'غير متاح']);
    summaryData.push(['أحدث سنة أحداث توزيع ظاهرة', ddmAudit.displayLatestEventsYear ?? 'غير متاح']);
    if (ddmAudit.stabilityWarningAr) {
      summaryData.push(['تنبيه استقرار التوزيعات (DDM)', ddmAudit.stabilityWarningAr]);
    }

    const ddmRows: any[][] = [
      ['الحقل / البند', 'القيمة / البيان'],
      ['أهلية التقييم بـ DDM', ddmAudit.eligible ? 'مؤهل' : 'مستبعد'],
      ['حالة أساس DDM (basisStatus)', ddmAudit.basisStatus],
      ['سبب الاستبعاد إن وُجد', ddmAudit.exclusionReasonAr ?? 'لا يوجد'],
      ['خطوة الاستكمال المقترحة', ddmAudit.remediationAr ?? 'لا يوجد'],
      ['D0 (توزيع السهم العادي الأساسي)', ddmAudit.d0 ?? 'غير متاح'],
      ['D1 = D0 × (1 + g)', ddmAudit.d1 ?? 'غير متاح'],
      [
        'معدل النمو المستدام للتوزيعات g (DDM_Growth)',
        ddmAudit.growth != null
          ? `${(ddmAudit.growth * 100).toFixed(2)}%`
          : ddmAudit.growthSource === 'loading_unconfirmed'
          ? 'قيد تأكيد التحميل'
          : 'غير محفوظ (غياب مؤكد)',
      ],
      ['نطاق ومصدر DDM_Growth المعتمد', ddmGrowthSourceText],
      ['تخصيص الشركة لـ DDM_Growth', ddmCompanyScopePres.fullTextAr],
      ['المرجع العام لـ DDM_Growth (macro_params)', ddmGlobalScopePres.fullTextAr],
      ['تاريخ ومصدر توثيق DDM_Growth', ddmDocMetaText],
      ['تكلفة حقوق الملكية المشتقة (Ke)', ddmAudit.costOfEquity != null ? `${(ddmAudit.costOfEquity * 100).toFixed(2)}%` : 'غير متاح'],
      ['نمط ومعادلة Ke النشطة', `${ddmAudit.keModeLabelAr ?? '-'} | ${ddmAudit.keFormulaAr ?? '-'}`],
      ['Ke − g', ddmAudit.keMinusG != null ? `${(ddmAudit.keMinusG * 100).toFixed(2)}%` : 'غير متاح'],
      [`القيمة العادلة للسهم (DDM — ${activeFinCurrency})`, ddmAudit.ddmFairValue ?? 'غير متاح'],
      ['سنة أساس DDM المعتمدة (basisFiscalYear)', ddmAudit.basisFiscalYear ?? 'غير متاح'],
      ['أحدث سنة أحداث ظاهرة (displayLatestEventsYear)', ddmAudit.displayLatestEventsYear ?? 'غير متاح'],
      ['أحدث سنة توزيع موجب (latestPositiveDividendYear)', ddmAudit.latestPositiveDividendYear ?? 'غير متاح'],
      ['مصدر التوزيعات', ddmAudit.source],
      ['حالة اكتمال السنة', ddmAudit.completenessStatus],
      ['أسلوب الإدخال (inputMethod)', ddmAudit.inputMethod ?? 'غير محدد'],
      ['ملاحظة حساب السهم (D0)', ddmAudit.perShareNoteAr],
      ['بيان اكتمال البيانات', ddmAudit.dataCompletenessNoteAr],
      ['تحذير استقرار التوزيعات', ddmAudit.stabilityWarningAr ?? 'لا يوجد'],
      ['بيان الملاءمة مقابل الاكتمال', ddmAudit.suitabilityNoteAr],
    ];
    if (ddmAudit.sensitivityMatrix.length > 0 && ddmAudit.sensitivityGrowthAxis.length > 0) {
      ddmRows.push(['', '']);
      ddmRows.push([
        'جدول الحساسية الموضعية (Ke \\ g)',
        ...ddmAudit.sensitivityGrowthAxis.map((gVal) => `g=${(gVal * 100).toFixed(2)}%`),
      ]);
      ddmAudit.sensitivityMatrix.forEach((row, idx) => {
        const keVal = ddmAudit.sensitivityKeAxis[idx];
        ddmRows.push([
          `Ke=${(keVal * 100).toFixed(2)}%`,
          ...row.map((cell) =>
            cell.isValid && cell.fairValue !== null
              ? Number(cell.fairValue.toFixed(2))
              : cell.invalidReasonAr || 'غير صالح'
          ),
        ]);
      });
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ddmRows), 'DDM_Audit');
  }

  if (rimAudit) {
    const fadeState = classifyFadeScheduleState(rimAudit);
    const consistencyState = classifyConsistencyChecksState(rimAudit);
    const terminalShareState = describeTerminalShareState(rimAudit);

    const consistencyChecksText =
      consistencyState.kind === 'available'
        ? consistencyState.checks.join(' | ')
        : consistencyState.descriptionAr;

    const rimParamSummaryRows: any[][] = [
      ['', ''],
      [
        'معاملات RIM ومصادرها المعتمدة',
        'القيمة المعتمدة',
        'المصدر المعتمد',
        'تخصيص الشركة',
        'المرجع العام',
        'تاريخ السريان',
        'مرجع المصدر',
      ],
      ...RIM_REGISTRY_KEYS.map((paramKey) => {
        const fieldDef = getValuationLabField(paramKey);
        const resolvedEntry = fieldDef ? resolved[fieldDef.resolvedKey] : undefined;
        const unitOrFormat = resolvedEntry?.unitOrFormat;
        return [
          `${paramKey} — ${fieldDef?.labelAr ?? paramKey}`,
          resolvedEntry ? formatResolvedVal(resolvedEntry.value, unitOrFormat) : 'غير متاح',
          resolvedEntry ? formatSourceAr(resolvedEntry.source) : 'غير متاح',
          resolvedEntry ? formatResolvedVal(resolvedEntry.companyValue, unitOrFormat) : 'غير متاح',
          resolvedEntry ? formatResolvedVal(resolvedEntry.globalValue, unitOrFormat) : 'غير متاح',
          resolvedEntry?.asOfDate || '-',
          resolvedEntry?.parameterSource || '-',
        ];
      }),
    ];

    const fadeScheduleSectionRows: any[][] =
      fadeState.kind === 'available'
        ? [
            ['', ''],
            ['جدول مرحلة التلاشي (Fade Schedule — تقديري)', fadeState.badgeAr],
            [
              'Year',
              'Opening BVPS',
              'Fade ROE',
              'Expected EPS',
              'Retention Ratio',
              'Implied DPS',
              'Equity Charge',
              'Residual Income',
              'Closing BVPS',
              'Discount Factor',
              'PV of RI',
            ],
            ...fadeState.rows.map((fRow) => [
              fRow.year,
              fRow.openingBvps,
              fRow.roeRate,
              fRow.expectedEps,
              fRow.retentionRatio,
              fRow.impliedDps,
              fRow.equityCharge,
              fRow.residualIncome,
              fRow.closingBvps,
              fRow.discountFactor,
              fRow.presentValueRi,
            ]),
            [
              'القيمة المستمرة بعد التلاشي (Post-Fade Continuation TV)',
              rimAudit.postFadeContinuationTv ?? 'غير متاح',
            ],
            [
              'القيمة الحالية للقيمة المستمرة بعد التلاشي (PV Post-Fade TV)',
              rimAudit.pvPostFadeContinuationTv ?? 'غير متاح',
            ],
          ]
        : [
            ['', ''],
            ['جدول مرحلة التلاشي (Fade Schedule)', fadeState.descriptionAr],
          ];

    const historicalRetentionVal =
      rimAudit.historicalRetentionRatio ??
      summary?.dividendSummary?.historicalRetentionRatio ??
      metrics.historicalRetentionRatio ??
      null;

    const rimRows: any[][] = [
      ['الحقل / البند', 'القيمة / البيان'],
      ['أهلية التقييم بـ RIM', rimAudit.eligible ? 'مؤهل' : 'مستبعد'],
      ['سبب الاستبعاد إن وُجد', rimAudit.exclusionReasonAr ?? 'لا يوجد'],
      ['القيمة الدفترية الافتتاحية B0', rimAudit.openingBvps ?? 'غير متاح'],
      ['رمز أساس BVPS (bvpsBasis)', rimAudit.bvpsBasis],
      ['وصف أساس BVPS (bvpsBasisLabelAr)', rimAudit.bvpsBasisLabelAr],
      ['عدد الأسهم المعتمد لحساب B0', rimAudit.effectiveSharesUsed ?? 'غير متاح'],
      ['مصدر عدد الأسهم', rimAudit.effectiveSharesSourceLabelAr ?? sharesSourceLabel],
      ['ROE التاريخي العادي المرجعي (roeUsed)', rimAudit.roeUsed != null ? `${(rimAudit.roeUsed * 100).toFixed(2)}%` : 'غير متاح'],
      ['رمز أساس ROE التاريخي (roeBasis)', rimAudit.roeBasis],
      ['وصف أساس ROE (roeBasisLabelAr)', rimAudit.roeBasisLabelAr],
      ['ROE المستقبلي المستخدم في الإسقاط (forwardRoeUsed)', rimAudit.forwardRoeUsed != null ? `${(rimAudit.forwardRoeUsed * 100).toFixed(2)}%` : 'غير متاح'],
      ['أساس ROE المستقبلي (forwardRoeBasisLabelAr)', rimAudit.forwardRoeBasisLabelAr ?? 'غير متاح'],
      ['تكلفة حقوق الملكية (Ke)', rimAudit.costOfEquity != null ? `${(rimAudit.costOfEquity * 100).toFixed(2)}%` : 'غير متاح'],
      ['سياسة الاحتجاز (retentionPolicy)', rimAudit.retentionPolicy],
      ['نسبة الاحتجاز التاريخية (1 - Payout)', historicalRetentionVal != null ? `${(historicalRetentionVal * 100).toFixed(2)}%` : 'غير متاح'],
      ['نسبة الاحتجاز المستخدمة لفترة التوقع (retentionUsed)', rimAudit.retentionUsed != null ? `${(rimAudit.retentionUsed * 100).toFixed(2)}%` : 'غير متاح'],
      ['طريقة القيمة النهائية (RIM_Terminal_Method)', rimAudit.terminalMethod ?? 'غير محدد'],
      ['وصف طريقة القيمة النهائية', rimAudit.terminalMethodLabelAr ?? formatRimTerminalMethodLabel(rimAudit.terminalMethod)],
      ['معادلة المرحلة النهائية', rimAudit.terminalFormulaAr ?? 'غير متاح'],
      ['العائد النهائي المستخدم (terminalRoeUsed)', rimAudit.terminalRoeUsed != null ? `${(rimAudit.terminalRoeUsed * 100).toFixed(2)}%` : 'غير منطبق'],
      ['نسبة الاحتجاز النهائية (terminalRetentionUsed)', rimAudit.terminalRetentionUsed != null ? `${(rimAudit.terminalRetentionUsed * 100).toFixed(2)}%` : rimAudit.terminalMethod === 1 ? 'غير منطبق' : 'غير متاح'],
      ['معدل نمو القيمة الدفترية النهائي g_B', rimAudit.terminalGrowthRateB != null ? `${(rimAudit.terminalGrowthRateB * 100).toFixed(2)}%` : rimAudit.terminalMethod === 1 ? 'غير منطبق' : 'غير متاح'],
      ['عدد سنوات التلاشي (fadeYears)', rimAudit.fadeYears ?? (rimAudit.terminalMethod === 1 || rimAudit.terminalMethod === 3 ? 'غير منطبق' : 'غير متاح')],
      ['حصة القيمة النهائية من إجمالي RIM (%)', terminalShareState.valueText],
      ['معادلة وتفسير حصة القيمة النهائية', terminalShareState.formulaAr],
      ['تطابق Clean Surplus (B_t = B_{t-1} + E_t - D_t)', rimAudit.cleanSurplusVerified ? 'متحقق بدقة' : 'غير متحقق / غير مؤهل'],
      ...rimParamSummaryRows,
      ['', ''],
      ['جدول التوقع لـ 5 سنوات (تقديرات مستقبلية وضمنية — ليست أرقاماً تاريخية فعلية)', ''],
      [
        'Year',
        'Opening BVPS',
        'Expected EPS',
        'Retention Ratio',
        'Implied DPS',
        'Equity Charge',
        'Residual Income',
        'Closing BVPS',
        'Discount Factor',
        'PV of RI',
      ],
      ...rimAudit.years.map((row) => [
        row.year,
        row.openingBvps,
        row.expectedEps,
        row.retentionRatio,
        row.impliedDps,
        row.equityCharge,
        row.residualIncome,
        row.closingBvps,
        row.discountFactor,
        row.presentValueRi,
      ]),
      ...fadeScheduleSectionRows,
      ['', ''],
      ['مجموع القيمة الحالية للدخل المتبقي (5 سنوات)', rimAudit.pvResidualIncome5Y ?? 'غير متاح'],
      ['القيمة الدفترية الختامية نهاية السنة 5 (Terminal Closing BVPS)', rimAudit.terminalClosingBvps ?? 'غير متاح'],
      ['القيمة المستمرة للدخل المتبقي (Terminal RI)', rimAudit.terminalRi ?? 'غير متاح'],
      ['القيمة الحالية للقيمة المستمرة (PV Terminal RI)', rimAudit.pvTerminalRi ?? 'غير متاح'],
      ['القيمة الخام قبل الحد الصفري (Raw RIM Fair Value)', rimAudit.rawRimFairValue ?? 'غير متاح'],
      [`القيمة العادلة للسهم (RIM — ${activeFinCurrency})`, rimAudit.rimFairValue ?? 'غير متاح'],
      ['حالة القص الصفري للقيمة السالبة', rimAudit.rawClippedToZero ? (rimAudit.rawClippedReasonAr ?? 'تم القص إلى 0.00 لأن القيمة الخام سالبة') : 'لا يوجد قص صفري'],
      ['مضاعف P/B الضمني عند القيمة العادلة (Implied P/B)', rimAudit.impliedPB ?? 'غير متاح'],
      ['حالة فحوصات الاتساق الحسابي', consistencyState.badgeAr],
      ['فحوصات الاتساق الحسابي (consistencyChecksAr)', consistencyChecksText],
      ['ملاحظات منهجية Clean Surplus', rimAudit.methodologyNotesAr.join(' | ') || 'لا يوجد'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rimRows), 'RIM_Audit');
  }

  if (metricAudit) {
    const auditedItems = [
      metricAudit.reportedEps,
      metricAudit.accountingEpsLatest,
      metricAudit.accountingEpsTTM,
      metricAudit.analyticalEpsTTM,
      metricAudit.analyticalCommonEpsTTM,
      metricAudit.valuationEps,
      metricAudit.commonBvps,
      metricAudit.totalEquityBvps,
      metricAudit.valuationBvps,
      metricAudit.roeCommonEop,
      metricAudit.roeTotalEop,
      metricAudit.roeAverageEquity,
      metricAudit.valuationRoe,
    ];
    const cmp = metricAudit.reportedVsAccountingComparison;
    const policy = metricAudit.epsSelectionPolicy;
    const metricAuditRows: any[][] = [
      ['ملخص تدقيق المقامات والأساس المحاسبي', 'القيمة / البيان'],
      ['أحدث فترة مالية متاحة', metricAudit.latestPeriod ?? 'غير متاح'],
      ['الأسهم التحليلية المعتمدة (Effective Analytical Shares)', metricAudit.effectiveAnalyticalShares ?? 'غير متاح'],
      ['مصدر الأسهم التحليلية', metricAudit.effectiveAnalyticalSharesSource],
      ['أسهم نهاية الفترة الفصلية (Quarterly EOP Shares)', metricAudit.quarterlyEopShares != null ? `${metricAudit.quarterlyEopShares} (${metricAudit.quarterlyEopSharesPeriod ?? '-'})` : 'غير متاح'],
      ['الأسهم المدرجة يومياً (Daily Listed Shares)', metricAudit.dailyListedShares != null ? `${metricAudit.dailyListedShares} (${metricAudit.dailyListedSharesDate ?? '-'})` : 'غير متاح'],
      ['حالة تطابق الأسهم عبر المصادر (sharesAlignmentStatus)', metricAudit.sharesAlignmentStatus],
      ['ملاحظة تطابق الأسهم', metricAudit.sharesAlignmentNoteAr ?? 'لا يوجد'],
      ['صافي الربح الموحّد آخر 12 شهراً (NetIncome TTM)', metricAudit.netIncomeTTM ?? 'غير متاح'],
      ['صافي ربح المساهمين العاديين (أحدث فترة)', metricAudit.netIncomeCommonLatestPeriod ?? 'غير متاح'],
      ['أساس صافي ربح العاديين (أحدث فترة)', metricAudit.netIncomeCommonLatestBasis],
      ['صافي ربح المساهمين العاديين (TTM)', metricAudit.netIncomeCommonTTM ?? 'غير متاح'],
      ['أساس صافي ربح العاديين (TTM)', metricAudit.netIncomeCommonTtmBasis],
      ['سبب حجب NetIncomeCommon TTM إن وُجد', metricAudit.netIncomeCommonTtmUnavailableReasonAr ?? 'لا يوجد'],
      ['أساس حقوق الملكية للتقييم (equityBasisForValuation)', metricAudit.equityBasisForValuation],
      ['حقوق المساهمين العاديين (أحدث فترة)', metricAudit.commonEquityLatest ?? 'غير متاح'],
      ['إجمالي حقوق الملكية (أحدث فترة)', metricAudit.totalEquityLatest ?? 'غير متاح'],
      ['سياسة EPS للتقييم (Valuation EPS Policy)', policy?.valuationEpsBasisLabelAr ?? 'غير متاح'],
      ['EPS التقييمي المعتمد (Valuation EPS)', policy?.valuationEpsValue ?? 'غير متاح'],
      ['EPS الموحّد المرجعي (Consolidated Analytical Ref)', policy?.consolidatedAnalyticalEpsRef ?? 'غير متاح'],
      ['', ''],
      ['سياسة اختيار EPS حسب النموذج', 'المصدر المعتمد', 'الفترة', 'نطاق الدخل', 'أساس الأسهم', 'القيمة', 'مؤهل؟', 'السبب / الحقول الناقصة'],
      ...(policy
        ? [policy.perModel.targetPE, policy.perModel.graham, policy.perModel.marketPE].map((entry) => [
            entry.nameAr,
            entry.source,
            entry.period ?? '-',
            entry.incomeScope,
            entry.sharesBasis,
            entry.selectedValue ?? 'غير متاح',
            entry.eligible ? 'نعم' : 'لا',
            entry.missingFields.length > 0 ? `${entry.reasonAr} (ناقص: ${entry.missingFields.join('، ')})` : entry.reasonAr,
          ])
        : []),
      ...(metricAudit.missingCommonFields.length > 0
        ? [
            ['', ''],
            ['حقول الأسهم العادية الناقصة (Missing Common Fields)', 'الفترة', 'العمود المطلوب', 'النماذج المتأثرة', 'السبب'],
            ...metricAudit.missingCommonFields.map((mf) => [
              mf.labelAr,
              mf.period,
              mf.excelColumn,
              mf.affectedModels.join(' | '),
              mf.reasonAr,
            ]),
          ]
        : []),
      ...(metricAudit.missingAccountingEpsFields && metricAudit.missingAccountingEpsFields.length > 0
        ? [
            ['', ''],
            [
              'حقول AccountingEPS الناقصة أو المحجوبة (Missing AccountingEPS Fields)',
              'الفترة',
              'العمود المطلوب',
              'النماذج المتأثرة',
              'السبب',
              'خطوة الاستكمال',
            ],
            ...metricAudit.missingAccountingEpsFields.map((mf) => [
              mf.labelAr,
              mf.period,
              mf.excelColumn,
              mf.affectedModels.join(' | '),
              mf.reasonAr,
              mf.remediationAr ?? '-',
            ]),
          ]
        : []),
      ['', ''],
      ['قرار أهلية AccountingEPS المركزي وأساس المتوسط المرجح', 'أحدث فترة', 'TTM (آخر 12 شهراً)'],
      [
        'قرار الأهلية (decision)',
        metricAudit.accountingEpsLatestEligibility?.eligible ? 'مقبول (eligible)' : 'محجوب (blocked)',
        metricAudit.accountingEpsTtmEligibility?.eligible ? 'مقبول (eligible)' : 'محجوب (blocked)',
      ],
      [
        'قيمة AccountingEPS',
        metricAudit.accountingEpsLatest.value ?? 'غير متاح',
        metricAudit.accountingEpsTTM.value ?? 'غير متاح',
      ],
      [
        'الأساس الأصلي المحفوظ (originalSharesBasis)',
        metricAudit.accountingEpsLatest.originalSharesBasis ?? 'غير محدد (BLANK)',
        metricAudit.accountingEpsTTM.originalSharesBasis ?? 'غير محدد (BLANK)',
      ],
      [
        'وصف الأساس الأصلي المحفوظ',
        metricAudit.accountingEpsLatest.originalSharesBasisLabelAr ?? 'غير محدد (BLANK)',
        metricAudit.accountingEpsTTM.originalSharesBasisLabelAr ?? 'غير محدد (BLANK)',
      ],
      [
        'الأساس الفعلي للحساب (effectiveSharesBasis)',
        metricAudit.accountingEpsLatest.effectiveSharesBasis ?? 'محجوب',
        metricAudit.accountingEpsTTM.effectiveSharesBasis ?? 'محجوب',
      ],
      [
        'وصف الأساس الفعلي للحساب',
        metricAudit.accountingEpsLatest.effectiveSharesBasisLabelAr ?? 'محجوب',
        metricAudit.accountingEpsTTM.effectiveSharesBasisLabelAr ?? 'محجوب',
      ],
      [
        'اعتماد تكافؤ Q1 الموثق دون تغيير الرمز المحفوظ',
        metricAudit.accountingEpsLatest.usedQ1DocumentedEquivalence ? 'نعم' : 'لا',
        metricAudit.accountingEpsTTM.usedQ1DocumentedEquivalence ? 'نعم' : 'لا',
      ],
      [
        'السبب التدقيقي (reasonAr)',
        metricAudit.accountingEpsLatestEligibility?.reasonAr ??
          metricAudit.accountingEpsLatest.unavailableReasonAr ??
          '-',
        metricAudit.accountingEpsTtmEligibility?.reasonAr ??
          metricAudit.accountingEpsTTM.unavailableReasonAr ??
          '-',
      ],
      [
        'المدخل الناقص (missingExcelColumn)',
        metricAudit.accountingEpsLatestEligibility?.missingExcelColumn ?? 'لا يوجد',
        metricAudit.accountingEpsTtmEligibility?.missingExcelColumn ?? 'لا يوجد',
      ],
      [
        'خطوة الاستكمال (remediationAr)',
        metricAudit.accountingEpsLatestEligibility?.remediationAr ?? 'لا يوجد',
        metricAudit.accountingEpsTtmEligibility?.remediationAr ?? 'لا يوجد',
      ],
      ['', ''],
      ['مقارنة ReportedEPS مقابل AccountingEPS', 'البيان'],
      ['ReportedEPS', cmp.reportedEps ?? 'غير مسجل'],
      ['نوع فترة ReportedEPS', cmp.reportedEpsPeriodType ?? 'غير محدد'],
      ['فترة ReportedEPS', cmp.reportedEpsPeriod ?? 'غير محدد'],
      ['حدود فترة ReportedEPS', cmp.reportedEpsPeriodStart && cmp.reportedEpsPeriodEnd ? `${cmp.reportedEpsPeriodStart} → ${cmp.reportedEpsPeriodEnd}` : 'غير موثق'],
      ['مصدر ReportedEPS', cmp.reportedEpsSource ?? 'غير محدد'],
      ['AccountingEPS المقارن', cmp.accountingEps ?? 'غير متاح'],
      ['فترة AccountingEPS المقارن', cmp.accountingEpsPeriod ?? 'غير محدد'],
      ['حدود فترة AccountingEPS المقارن', cmp.accountingEpsPeriodStart && cmp.accountingEpsPeriodEnd ? `${cmp.accountingEpsPeriodStart} → ${cmp.accountingEpsPeriodEnd}` : 'غير موثق'],
      ['حالة المقارنة (status)', cmp.status],
      ['الفرق المطلق (absoluteDifference)', cmp.absoluteDifference ?? 'غير متاح'],
      ['الفرق النسبي (%) (relativeDifferencePct)', cmp.relativeDifferencePct != null ? Number(cmp.relativeDifferencePct.toFixed(4)) : 'غير متاح'],
      ['رسالة المقارنة التدقيقية', cmp.messageAr],
      ['إجراء المعالجة المقترح', cmp.remediationAr ?? 'لا يوجد'],
      ['', ''],
      [
        'المفتاح (Key)',
        'اسم المؤشر',
        'القيمة',
        'البسط',
        'قيمة البسط',
        'المقام',
        'قيمة المقام',
        'المعادلة',
        'رمز الأساس',
        'توصيف الأساس',
        'الأساس الأصلي المحفوظ للأسهم',
        'الأساس الفعلي للحساب',
        'الفترة',
        'حالة الاكتمال',
        'النماذج المستخدمة',
        'سبب الحجب / ملاحظات',
        'خطوة الاستكمال',
      ],
      ...auditedItems.map((item) => [
        item.key,
        item.nameAr,
        item.value ?? 'غير متاح',
        item.numeratorLabelAr,
        item.numeratorValue ?? 'غير متاح',
        item.denominatorLabelAr,
        item.denominatorValue ?? 'غير متاح',
        item.equationAr,
        item.basisCode,
        item.basisLabelAr,
        item.originalSharesBasis ?? '-',
        item.effectiveSharesBasis ?? '-',
        item.periodLabel ?? '-',
        item.completenessStatus,
        item.usedByModels.join(' | ') || '-',
        item.unavailableReasonAr || item.notesAr.join(' | ') || '-',
        item.remediationAr ?? '-',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metricAuditRows), 'Metric_Audit');
  }

  const relativeAudit =
    valuation.relativeAudit ??
    summary?.relativeAudit ??
    valuation.engineOutputs?.relativeAudit ??
    null;

  if (relativeAudit) {
    summaryData.push(['', '']);
    summaryData.push([
      'تفاصيل أوزان دمج التقييم النسبي ومصادرها (Relative Valuation Blending)',
      relativeAudit.statusLabelAr,
      relativeAudit.priorityLabelAr,
      relativeAudit.formulaNoteAr,
    ]);
    summaryData.push([
      'السعر الضمني وفق P/E',
      relativeAudit.peImplied !== null ? relativeAudit.peImplied.toFixed(2) : 'غير متاح',
      'السعر الضمني وفق P/B',
      relativeAudit.pbImplied !== null ? relativeAudit.pbImplied.toFixed(2) : 'غير متاح',
    ]);
    summaryData.push([
      'مجموع الوزنين الخام المستخدم في التطبيع',
      relativeAudit.blendingApplied && relativeAudit.weightsSum !== null
        ? formatRawRelativeWeight(relativeAudit.weightsSum)
        : 'غير منطبق',
      'تفعيل الدمج الثنائي',
      relativeAudit.blendingApplied ? 'نعم (دمج نشط)' : 'لا (غير منطبق أو معلّق)',
    ]);
    summaryData.push([
      'وزن الدمج والمفتاح التقني',
      'الوزن الرقمي الخام المعتمد',
      'حصة الدمج المطبّعة (%)',
      'النطاق المعتمد | المصدر التوثيقي | تاريخ السريان | قيم النطاقين',
    ]);
    for (const w of [relativeAudit.peWeight, relativeAudit.pbWeight]) {
      const companyPres = formatScopedAssumptionStateAr({
        value: w.companyValue,
        scopeConfirmed: relativeAudit.companyOverridesConfirmed,
        formatValue: formatRawRelativeWeight,
        documentarySource: w.companyDocumentarySource,
        asOfDate: w.companyAsOfDate,
        includeMissingDocumentaryNote: true,
      });
      const globalPres = formatScopedAssumptionStateAr({
        value: w.globalValue,
        scopeConfirmed: relativeAudit.macroParamsConfirmed,
        formatValue: formatRawRelativeWeight,
        documentarySource: w.globalDocumentarySource,
        asOfDate: w.globalAsOfDate,
        includeMissingDocumentaryNote: true,
      });
      const docSourceText =
        w.rawValue !== null
          ? w.documentarySource ?? 'المصدر التوثيقي غير موثق (القيمة متاحة)'
          : w.scope === 'loading_unconfirmed'
          ? 'قيد تأكيد التحميل'
          : 'لا توجد قيمة معتمدة (غياب مؤكد)';
      const scopeDetails = [
        `النطاق المعتمد: ${w.scopeLabelAr}`,
        `المصدر التوثيقي: ${docSourceText}`,
        `تاريخ السريان: ${w.asOfDate ?? 'غير محدد'}`,
        `تخصيص الشركة: ${companyPres.fullTextAr}`,
        `المتغيرات الكلية: ${globalPres.fullTextAr}`,
        `أولوية نشطة: ${relativeAudit.priorityLabelAr}`,
      ].join(' | ');
      summaryData.push([
        `${w.shortLabelAr} (${w.registryKey})`,
        w.scope === 'loading_unconfirmed'
          ? 'قيد تأكيد التحميل'
          : formatRawRelativeWeight(w.rawValue),
        relativeAudit.blendingApplied && w.normalizedSharePct !== null
          ? formatNormalizedSharePct(w.normalizedSharePct)
          : 'غير منطبق',
        scopeDetails,
      ]);
    }
    if (relativeAudit.blockingReasonAr) {
      summaryData.push([
        'سبب تعليق التقييم النسبي',
        relativeAudit.blockingReasonAr,
        'خطوة الاستكمال',
        relativeAudit.remediationAr ?? '-',
      ]);
    }
  }

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص التقييم');

  // ورقة الافتراضات والمصادر المعتمدة
  const resolvedList = Object.values(resolved);
  if (resolvedList.length > 0) {
    const assumptionRows = [
      [
        'المتغير',
        'المفتاح التقني',
        'التسمية',
        'القيمة المعتمدة',
        'النطاق المعتمد',
        'أولوية الافتراضات النشطة',
        'تخصيص الشركة',
        'القيمة العامة المحفوظة',
        'تجاوزته الأولوية؟',
        'تاريخ السريان',
        'المصدر التوثيقي',
        'الوحدة / العملة',
        'منهجية Rf',
        'أفق التوقع',
        'الحالة الحسابية',
      ],
      ...resolvedList.map((a) => {
        const companyCell =
          a.companyValue !== null && a.companyValue !== undefined && Number.isFinite(a.companyValue)
            ? formatResolvedVal(a.companyValue, a.unitOrFormat)
            : exportCompanyOverridesConfirmed
            ? 'غير محفوظ (غياب مؤكد)'
            : 'قيد تأكيد التحميل';
        const globalCell =
          a.globalValue !== null && a.globalValue !== undefined && Number.isFinite(a.globalValue)
            ? formatResolvedVal(a.globalValue, a.unitOrFormat)
            : exportMacroParamsConfirmed
            ? 'غير محفوظ (غياب مؤكد)'
            : 'قيد تأكيد التحميل';
        const missingUnconfirmed =
          a.source === 'missing' && (!exportCompanyOverridesConfirmed || !exportMacroParamsConfirmed);
        const activeValCell =
          a.value !== null && a.value !== undefined && Number.isFinite(a.value)
            ? formatResolvedVal(a.value, a.unitOrFormat)
            : missingUnconfirmed
            ? 'قيد تأكيد التحميل'
            : 'غير محفوظ (غياب مؤكد)';
        const activeScopeCell = missingUnconfirmed ? 'قيد تأكيد التحميل' : formatSourceAr(a.source);
        const activeDocSourceCell =
          a.value !== null && a.value !== undefined && Number.isFinite(a.value)
            ? a.parameterSource || 'المصدر التوثيقي غير موثق (القيمة متاحة)'
            : missingUnconfirmed
            ? 'قيد تأكيد التحميل'
            : 'لا توجد قيمة معتمدة';

        return [
          a.key,
          a.registryKey || a.key,
          a.labelAr,
          activeValCell,
          activeScopeCell,
          priorityLabel,
          companyCell,
          globalCell,
          a.isOverriddenByPriority ? 'نعم' : 'لا',
          a.asOfDate || 'غير محدد',
          activeDocSourceCell,
          [a.unit, a.currency].filter(Boolean).join(' / ') || '-',
          a.rfMethodology || '-',
          a.forecastHorizonYears ?? '-',
          a.enabledInEngine === false ? 'غير مفعّل حسابياً' : 'مفعّل',
        ];
      }),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(assumptionRows), 'الافتراضات_والمصادر');
  }

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Year', 'Quarter', 'EBIT_YTD', 'DA_YTD', 'CapEx_YTD', 'DeltaOperatingNWC_YTD', 'ValuationTaxRate', 'ValuationSource', 'FinancialUnit'],
      ...financials.map((f) => [
        f.year,
        f.quarter,
        f.operatingProfitYTD,
        f.depreciationAmortizationYTD ?? null,
        f.capexYTD,
        f.changeOperatingNwcYTD ?? null,
        f.valuationTaxRate ?? null,
        f.valuationSource ?? null,
        f.financialUnit ?? null,
      ]),
    ]),
    'FCFF_Inputs'
  );

  // 2. ورقة القوائم المالية الربع سنوية التراكمية (Quarterly Financials YTD)
  const headers = [
    'السنة',
    'الربع',
    'التاريخ',
    'الإيرادات YTD',
    'مجمل الربح YTD',
    'الربح التشغيلي EBIT YTD',
    'صافي الربح YTD',
    'التدفق النقدي التشغيلي OCF YTD',
    'الإنفاق الاستثماري CapEx YTD',
    'التوزيعات المدفوعة YTD',
    'إجمالي الأصول',
    'إجمالي الديون',
    'النقدية وما في حكمها',
    'حقوق الملكية',
    'عدد الأسهم في نهاية الفترة',
    'مراجعة معتمدة؟',
    'ملاحظات',
  ];

  const quarterlyRows = financials.map((q) => [
    q.year,
    q.quarter,
    q.periodDate,
    q.revenueYTD !== null ? q.revenueYTD : '',
    q.grossProfitYTD !== null ? q.grossProfitYTD : '',
    q.operatingProfitYTD !== null ? q.operatingProfitYTD : '',
    q.netProfitYTD !== null ? q.netProfitYTD : '',
    q.operatingCashFlowYTD !== null ? q.operatingCashFlowYTD : '',
    q.capexYTD !== null ? q.capexYTD : '',
    q.dividendsPaidYTD !== null ? q.dividendsPaidYTD : '',
    q.totalAssets !== null ? q.totalAssets : '',
    q.totalDebt !== null ? q.totalDebt : '',
    q.cashAndEquivalents !== null ? q.cashAndEquivalents : '',
    q.totalEquity !== null ? q.totalEquity : '',
    q.sharesCount !== null ? q.sharesCount : '',
    q.isAudited ? 'نعم' : 'لا',
    q.notes || '',
  ]);

  const wsFinancials = XLSX.utils.aoa_to_sheet([headers, ...quarterlyRows]);
  XLSX.utils.book_append_sheet(wb, wsFinancials, 'البيانات المالية الربع سنوية');

  // 3. ورقة تقرير التدقيق المحاسبي الذكي (Audit Findings)
  const auditHeaders = ['رمز التنبيه', 'نوع الفحص', 'مستوى الخطورة', 'الفترة المالية', 'سبب الاشتباه المحاسبي', 'الإجراء المطلوب للمراجعة'];
  const auditRows = auditWarnings.map((w) => [
    w.id,
    w.title,
    w.severity === 'critical' ? 'حرج' : w.severity === 'warning' ? 'تحذير' : 'ملاحظة',
    w.period,
    w.reasonAr,
    w.reviewActionAr,
  ]);
  const wsAudit = XLSX.utils.aoa_to_sheet([auditHeaders, ...auditRows]);
  XLSX.utils.book_append_sheet(wb, wsAudit, 'تقرير تدقيق البيانات');

  const exportMetaRows = [
    ['الحقل', 'القيمة'],
    ['نطاق التصدير', `${company.ticker} — ${company.nameAr}`],
    ['تاريخ التقييم المعتمد', summary?.valuationDate ?? 'غير محدد'],
    ['تاريخ آخر جلسة تداول', summary?.priceSessionDate ?? company.latestTradeDate ?? 'غير محدد'],
    ['القطاع ومعرف القطاع', `${company.sector || 'غير محدد'} (${summary?.sectorId ?? company.sectorId ?? 'غير مربوط'})`],
    ['مصدر ربط القطاع (sectorPE)', summary?.sectorClassificationSource ?? company.sectorSource ?? 'غير محدد'],
    ['حالة مجموعة sectorPE', `${summary?.sectorPeStatus ?? 'unknown'}${summary?.sectorPeError ? ` (${summary.sectorPeError})` : ''}`],
    ['تعارض مضاعف ربحية القطاع', summary?.sectorPeConflictDetected ? 'نعم' : 'لا'],
    ['حالة اكتمال توزيعات السنة', summary?.dividendSummary?.dividendYearStatus ?? 'unknown'],
    ['سياسة احتجاز RIM للشركة', summary?.rimRetentionPolicy ?? company.rimRetentionPolicy ?? 'rim_parameter'],
    ['سياسة تواريخ التوزيعات', summary?.dividendDatePolicyNoteAr ?? 'لا يوجد'],
    ['حدود التقييم التاريخي', summary?.historicalRestatementLimitationAr ?? 'لا يوجد'],
    ['عدد الفترات الفصلية المصدرة', financials.length],
    ['تاريخ ووقت التصدير', new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(exportMetaRows), 'Export_Metadata');

  return wb;
}

export async function exportCompanyValuationToExcel(
  company: Company,
  financials: QuarterlyFinancial[],
  metrics: FinancialMetricsTTM,
  valuation: ValuationResults,
  auditWarnings: AuditWarning[]
): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = await buildCompanyValuationWorkbook(company, financials, metrics, valuation, auditWarnings);
  XLSX.writeFile(wb, `Mizan_${company.ticker}_Valuation_Report.xlsx`);
}

export async function downloadExcelTemplate(): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  const instructions = [
    ['إرشادات إدخال البيانات في نموذج ميزان:', ''],
    ['1. قاعدة BLANK:', 'اترك الخانة فارغة تماماً إذا لم تكن القيمة معلنة بعد. لا تكتب صفراً إلا إذا كان البند صفراً فعلياً.'],
    ['2. الإيرادات والأرباح والتدفقات:', 'يجب إدخال الأرقام التراكمية (YTD) من أول العام حتى نهاية الربع كما تصدر في تقارير البورصة المصرية.'],
    ['3. DividendsPaidYTD:', 'التوزيعات النقدية المدفوعة التراكمية، ولا تُجمع عبر الأرباع.'],
    ['4. التوزيعات النقدية للسهم:', 'تُستورد التوزيعات النقدية للسهم حصرياً عبر قالب DPS_Actual المستقل.'],
    ['5. المبالغ والأسهم:', 'تُدخل المبالغ المالية بقيمتها الأساسية كما هي (الافتراضي بالجنيه المصري) وعدد الأسهم كعدد أسهم كامل.'],
  ];

  const headers = [
    'رمز السهم (Ticker)',
    'السنة (Year)',
    'الربع (Quarter: Q1/Q2/Q3/FY)',
    'تاريخ الفترة (YYYY-MM-DD)',
    'الإيرادات التراكمية Revenue YTD',
    'مجمل الربح Gross Profit YTD',
    'الربح التشغيلي EBIT YTD',
    'صافي الربح Net Profit YTD',
    'التدفق النقدي التشغيلي OCF YTD',
    'الإنفاق الاستثماري CapEx YTD',
    'التوزيعات التراكمية Dividends Paid YTD',
    'إجمالي الأصول Total Assets',
    'إجمالي الديون Total Debt',
    'النقدية وما في حكمها Cash',
    'حقوق الملكية Total Equity',
    'عدد الأسهم المصدرة Shares',
    'مراجعة معتمدة (TRUE/FALSE)',
    'ملاحظات Notes',
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instructions), 'تعليمات');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers]), 'البيانات المالية');
  XLSX.writeFile(wb, 'Mizan_Financial_Data_Template.xlsx');
}

export async function parseFinancialsExcelFile(
  file: File,
  companyId: string
): Promise<QuarterlyFinancial[]> {
  const XLSX = await loadXlsx();
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const firstSheetName = workbook.SheetNames.includes('البيانات المالية')
    ? 'البيانات المالية'
    : workbook.SheetNames[0];

  const worksheet = workbook.Sheets[firstSheetName];
  const jsonRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  if (jsonRows.length < 2) return [];

  const headerLabels = (jsonRows[0] ?? []).map((cell) => String(cell ?? '').toLowerCase());
  const hasLegacyDpsCol =
    headerLabels.some((h) => h.includes('dps')) && jsonRows[0]?.length >= 19;
  const shift = hasLegacyDpsCol ? 1 : 0;

  const parseVal = (v: any): number | null => {
    if (v === undefined || v === null || v === '' || v === 'BLANK' || v === 'blank') return null;
    const num = Number(v);
    return isNaN(num) ? null : num;
  };

  const results: QuarterlyFinancial[] = [];

  for (let i = 1; i < jsonRows.length; i++) {
    const row = jsonRows[i];
    if (!row || row.length === 0) continue;

    const yearVal = Number(row[1]);
    const quarterVal = String(row[2] || '').trim().toUpperCase();

    if (!yearVal || !['Q1', 'Q2', 'Q3', 'FY', 'Q4'].includes(quarterVal)) {
      continue;
    }

    const quarter = quarterVal === 'Q4' ? 'FY' : (quarterVal as 'Q1' | 'Q2' | 'Q3' | 'FY');
    const periodDate = String(row[3] || `${yearVal}-12-31`).trim();

    results.push({
      id: `${companyId}_${yearVal}_${quarter.toLowerCase()}_${Date.now()}_${i}`,
      companyId,
      year: yearVal,
      quarter,
      periodDate,
      revenueYTD: parseVal(row[4]),
      grossProfitYTD: parseVal(row[5]),
      operatingProfitYTD: parseVal(row[6]),
      netProfitYTD: parseVal(row[7]),
      operatingCashFlowYTD: parseVal(row[8]),
      capexYTD: parseVal(row[9]),
      dividendsPaidYTD: parseVal(row[10]),
      totalAssets: parseVal(row[11 + shift]),
      totalDebt: parseVal(row[12 + shift]),
      cashAndEquivalents: parseVal(row[13 + shift]),
      totalEquity: parseVal(row[14 + shift]),
      sharesCount: parseVal(row[15 + shift]),
      isAudited: String(row[16 + shift]).toUpperCase() === 'TRUE' || String(row[16 + shift]) === 'نعم',
      notes: row[17 + shift] ? String(row[17 + shift]) : '',
    });
  }

  return results;
}

export async function exportTradeLogToExcel(trades: TradeLog[]): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  const headers = [
    'رقم الصفقة',
    'رمز السهم',
    'اسم الشركة',
    'نوع الإجراء',
    'سعر الدخول المخطط (ج.م)',
    'سعر التنفيذ الفعلي (ج.م)',
    'القيمة العادلة المستهدفة (ج.م)',
    'وقف الخسارة (ج.م)',
    'الوزن من المحفظة (%)',
    'الحالة',
    'تاريخ الدخول',
    'تاريخ الخروج',
    'العائد المحقق (%)',
    'ملاحظات',
  ];

  const rows = trades.map((t) => [
    t.id,
    t.ticker,
    t.companyName,
    t.action,
    t.plannedEntryPrice,
    t.executedPrice ?? '',
    t.targetFairValue,
    t.stopLoss,
    `${t.portfolioWeightPct}%`,
    t.status,
    t.entryDate,
    t.exitDate ?? '',
    t.returnPct ? `${t.returnPct}%` : '',
    t.notes,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'سجل الصفقات');
  XLSX.writeFile(wb, 'Mizan_Trade_Log.xlsx');
}

const STANDARD_DAILY_EXPORT_COLUMNS: Array<{
  field: keyof DailyTradingRecord;
  headerName: string;
}> = [
  { field: 'ticker', headerName: 'الرمز' },
  { field: 'shortName', headerName: 'الإسم المختصر' },
  { field: 'lastPrice', headerName: 'أخر' },
  { field: 'changePct', headerName: 'التغير%' },
  { field: 'tradesCount', headerName: 'الصفقات' },
  { field: 'openPrice', headerName: 'فتح' },
  { field: 'closePrice', headerName: 'إقفال اليوم' },
  { field: 'prevClose', headerName: 'إقفال سابق' },
  { field: 'turnoverValue', headerName: 'قيمة التداول' },
  { field: 'netLiquidity', headerName: 'صافي السيولة' },
  { field: 'volume', headerName: 'حجم التداول' },
  { field: 'avgVolume5D', headerName: 'متوسط الحجم 5 أيام' },
  { field: 'avgVolume30D', headerName: 'متوسط حجم التداول خلال 30 يوم' },
  { field: 'avgVolume90D', headerName: 'متوسط حجم التداول خلال 90 يوم' },
  { field: 'lowPrice', headerName: 'الأدنى' },
  { field: 'highPrice', headerName: 'أعلى' },
  { field: 'sector', headerName: 'القطاع' },
  { field: 'totalBids', headerName: 'اجمالي الطلبات' },
  { field: 'bidsCount', headerName: 'عدد الطلبات' },
  { field: 'offersCount', headerName: 'عدد العروض' },
  { field: 'totalOffers', headerName: 'اجمالي العروض' },
  { field: 'avgVolume', headerName: 'متوسط حجم التدول' },
  { field: 'high52W', headerName: 'الأعلى خلال 52 أسبوع' },
  { field: 'low52W', headerName: 'الأدنى خلال 52 أسبوع' },
  { field: 'marketCapThousands', headerName: 'رأس مال السوق بالألأف' },
  { field: 'vwap', headerName: 'متوسط السعر المرجح' },
  { field: 'peRatio', headerName: 'مضاعف ربحية السهم' },
  { field: 'pbRatio', headerName: 'مضاعف القيمة الدفترية' },
  { field: 'listedShares', headerName: 'الأسهم المدرجة' },
  { field: 'isinCode', headerName: 'الكود الدولي' },
  { field: 'inflowOrders', headerName: 'أوامر السيولة الداخلة' },
  { field: 'inflowVolume', headerName: 'حجم السيولة الداخلة' },
  { field: 'inflowLiquidity', headerName: 'السيولة الداخلة' },
  { field: 'askTrades', headerName: 'صفقات العرض' },
  { field: 'askTradesVolume', headerName: 'حجم صفقات العرض' },
  { field: 'outflowLiquidity', headerName: 'السيولة الخارجة' },
  { field: 'fullName', headerName: 'الاسم' },
  { field: 'market', headerName: 'السوق' },
  { field: 'volChange5DPct', headerName: '% التغير في حجم التداول لـ 5 أيام' },
  { field: 'volChange30DPct', headerName: 'تغير الحجم 30 يوم %' },
  { field: 'volChange90DPct', headerName: 'تغير الحجم 90 يوم %' },
];

export interface ResolvedDailyExportColumn {
  colId: string;
  index: number;
  colLetter: string;
  headerName: string;
  mappedField: keyof DailyTradingRecord | null;
  unifiedColumn?: UnifiedDailyColumn;
}

export function resolveDailyExportColumns(
  records: DailyTradingRecord[],
  dailySchemas?: Record<string, DailyTradingSchemaRecord>
): ResolvedDailyExportColumn[] {
  const indexedSchemas = indexDailySchemas(dailySchemas);
  const { columns } = resolveUnifiedDailyColumns(records, indexedSchemas);

  return columns.map((col) => ({
    colId: col.colId ?? col.key,
    index: col.orderIndex,
    colLetter: col.colLetter ?? String(col.orderIndex + 1),
    headerName: col.rawHeaderName ?? col.headerName,
    mappedField: (col.mappedField as keyof DailyTradingRecord) ?? null,
    unifiedColumn: col,
  }));
}

const INTERNAL_EXPORT_IGNORED_KEYS = new Set([
  'id',
  'contentHash',
  'serverUpdatedAt',
  'updatedBy',
  'importId',
  'sourceFile',
  'sourceSheet',
  'sourceRow',
  'schemaVersion',
  'isDeleted',
  'rawCells',
  'extendedFields',
  'originalValues',
  'manualCorrections',
  'rawRowHeadersMissingCount',
  'formulaMissingCachedCount',
  'schemaId',
]);

function serializeExportValue(val: unknown): string | number | boolean | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 'غير صالح (قيمة غير منتهية)';
  }
  if (typeof val === 'string' || typeof val === 'boolean') return val;
  return JSON.stringify(val);
}

function appendManualCorrectionsSheet(
  wb: XlsxTypes.WorkBook,
  XLSX: typeof XlsxTypes,
  entries: Array<{
    ticker: string;
    periodOrDate: string;
    manualCorrections?: Record<string, { field: string; originalValue: unknown; correctedValue: unknown; editedAt: string; reasonAr?: string }>;
  }>
): number {
  const rows: Array<Array<string | number | boolean | null>> = [];
  for (const item of entries) {
    if (!item.manualCorrections || typeof item.manualCorrections !== 'object') continue;
    for (const [key, correction] of Object.entries(item.manualCorrections)) {
      if (!correction || typeof correction !== 'object' || Array.isArray(correction)) continue;
      rows.push([
        item.ticker,
        item.periodOrDate,
        correction.field || key,
        serializeExportValue(correction.originalValue),
        serializeExportValue(correction.correctedValue),
        correction.editedAt || '',
        correction.reasonAr || '',
      ]);
    }
  }
  if (rows.length > 0) {
    const header = ['Ticker', 'PeriodOrDate', 'Field', 'OriginalValue', 'CorrectedValue', 'EditedAt', 'ReasonAr'];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Manual_Corrections');
  }
  return rows.length;
}

function getDailyCellExportValue(
  rec: DailyTradingRecord,
  col: ResolvedDailyExportColumn,
  indexedSchemas: ReturnType<typeof indexDailySchemas>
): string | number | boolean | null {
  if (col.unifiedColumn) {
    const resolved = resolveDailyCellDisplay(rec, col.unifiedColumn, indexedSchemas);
    if (resolved.formulaMissingCachedResult) {
      return resolved.rawCell?.f
        ? `صيغة دون نتيجة مخبأة (${resolved.rawCell.f})`
        : 'صيغة دون نتيجة مخبأة';
    }
    if (resolved.rawCell?.t === 'e' || resolved.kind === 'invalid') {
      const errToken = resolved.rawCell?.w ?? resolved.rawCell?.v ?? resolved.displayText ?? 'خطأ Excel';
      return `غير صالح (${String(errToken)})`;
    }
    if (resolved.value === null || resolved.value === undefined) return null;
    if (resolved.rawCell?.t === 's') {
      return String(resolved.value);
    }
    if (
      (col.mappedField === 'ticker' || col.mappedField === 'isinCode') &&
      typeof resolved.rawCell?.w === 'string' &&
      resolved.rawCell.w.trim() !== ''
    ) {
      return resolved.rawCell.w.trim();
    }
    return serializeExportValue(resolved.value);
  }

  if (!col.mappedField) return null;
  return serializeExportValue(rec[col.mappedField]);
}

export async function buildDailyTradingWorkbook(
  records: DailyTradingRecord[],
  dailySchemas?: Record<string, DailyTradingSchemaRecord>
): Promise<XlsxTypes.WorkBook> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const indexedSchemas = indexDailySchemas(dailySchemas);
  const resolvedMeta = resolveUnifiedDailyColumns(records, indexedSchemas);
  const columns = resolveDailyExportColumns(records, dailySchemas);

  const knownDailyFields = new Set<string>([
    ...STANDARD_DAILY_EXPORT_COLUMNS.map((c) => String(c.field)),
    'tradeDate',
    'updatedAt',
  ]);
  const extraTopLevelKeys = Array.from(
    new Set(
      records.flatMap((r) =>
        Object.keys(r).filter(
          (k) =>
            !knownDailyFields.has(k) &&
            !INTERNAL_EXPORT_IGNORED_KEYS.has(k) &&
            (r as unknown as Record<string, unknown>)[k] !== undefined
        )
      )
    )
  ).sort((a, b) => a.localeCompare(b));
  const hasOriginalValues = records.some(
    (r) => r.originalValues && Object.keys(r.originalValues).length > 0
  );

  const headers = [
    ...columns.map((c) => c.headerName),
    'تاريخ التداول (TradeDate)',
    ...extraTopLevelKeys.map((k) => `extra.${k}`),
    ...(hasOriginalValues ? ['originalValues (القيم الأصلية)'] : []),
  ];

  const rows = records.map((rec) => [
    ...columns.map((col) => getDailyCellExportValue(rec, col, indexedSchemas)),
    rec.tradeDate,
    ...extraTopLevelKeys.map((k) => serializeExportValue((rec as unknown as Record<string, unknown>)[k])),
    ...(hasOriginalValues
      ? [rec.originalValues && Object.keys(rec.originalValues).length > 0 ? JSON.stringify(rec.originalValues) : null]
      : []),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Daily_Trading');

  const manualCorrectionsCount = appendManualCorrectionsSheet(
    wb,
    XLSX,
    records.map((r) => ({
      ticker: r.ticker,
      periodOrDate: r.tradeDate,
      manualCorrections: r.manualCorrections,
    }))
  );

  const tickers = Array.from(new Set(records.map((r) => r.ticker))).sort();
  const dates = records.map((r) => r.tradeDate).filter(Boolean).sort();
  const metaRows = [
    ['الحقل', 'القيمة'],
    ['نطاق الأسهم المصدرة', tickers.join(', ') || 'لا يوجد'],
    ['نطاق التواريخ', dates.length > 0 ? `${dates[0]} -> ${dates[dates.length - 1]}` : 'غير متاح'],
    ['عدد السجلات', records.length],
    ['عدد الأعمدة الموحدة', columns.length],
    ['عدد الحقول الإضافية العليا (extra)', extraTopLevelKeys.length],
    ['عدد المخططات المرجعية', resolvedMeta.schemaCount],
    ['سجلات بمخطط مفقود', resolvedMeta.missingSchemaRecordCount],
    ['إجمالي التعديلات اليدوية الموثقة', manualCorrectionsCount],
    ['تاريخ ووقت التصدير', new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaRows), 'Export_Metadata');

  return wb;
}

export async function exportDailyTradingToExcel(
  records: DailyTradingRecord[],
  dailySchemas?: Record<string, DailyTradingSchemaRecord>,
  fileNameSuffix?: string
): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = await buildDailyTradingWorkbook(records, dailySchemas);
  const cleanSuffix = fileNameSuffix ? `_${fileNameSuffix.replace(/[^A-Za-z0-9_-]+/g, '_')}` : '';
  XLSX.writeFile(wb, `Mizan_Daily_Trading${cleanSuffix}.xlsx`);
}

export async function buildQuarterlyRecordsWorkbook(
  records: QuarterlyFinancialRecord[]
): Promise<XlsxTypes.WorkBook> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  const coreFields: Array<{ key: keyof QuarterlyFinancialRecord; header: string }> = [
    { key: 'ticker', header: 'Ticker' },
    { key: 'stockName', header: 'StockName' },
    { key: 'year', header: 'Year' },
    { key: 'quarter', header: 'Quarter' },
    { key: 'yearQuarter', header: 'YearQuarter' },
    { key: 'periodStartDate', header: 'PeriodStartDate' },
    { key: 'periodEndDate', header: 'PeriodEndDate' },
    { key: 'periodDays', header: 'PeriodDays' },
    { key: 'shares', header: 'Shares' },
    { key: 'revenueYTD', header: 'RevenueYTD' },
    { key: 'grossProfitYTD', header: 'GrossProfitYTD' },
    { key: 'ebitYTD', header: 'EBIT_YTD' },
    { key: 'pbtYTD', header: 'PBT_YTD' },
    { key: 'netIncomeYTD', header: 'NetIncomeYTD' },
    { key: 'netIncomeCommonYTD', header: 'NetIncomeCommon_YTD' },
    { key: 'netIncomeCommonBasis', header: 'NetIncomeCommon_Basis' },
    { key: 'netIncomeCommonNote', header: 'NetIncomeCommon_Note' },
    { key: 'weightedAvgSharesYTD', header: 'WeightedAvgShares_YTD' },
    { key: 'weightedAvgSharesBasis', header: 'WeightedAvgShares_Basis' },
    { key: 'reportedEps', header: 'ReportedEPS' },
    { key: 'reportedEpsSource', header: 'ReportedEPS_Source' },
    { key: 'reportedEpsPeriodType', header: 'ReportedEPS_PeriodType' },
    { key: 'reportedEpsFiscalYear', header: 'ReportedEPS_FiscalYear' },
    { key: 'reportedEpsFiscalQuarter', header: 'ReportedEPS_FiscalQuarter' },
    { key: 'reportedEpsPeriodStart', header: 'ReportedEPS_PeriodStart' },
    { key: 'reportedEpsPeriodEnd', header: 'ReportedEPS_PeriodEnd' },
    { key: 'reportedEpsPeriod', header: 'ReportedEPS_Period' },
    { key: 'isCapitalActionAdjusted', header: 'IsCapitalActionAdjusted' },
    { key: 'ocfYTD', header: 'OCF_YTD' },
    { key: 'capexYTD', header: 'CapEx_YTD' },
    { key: 'netInvestingCfYTD', header: 'NetInvestingCF_YTD' },
    { key: 'depreciationAmortizationYTD', header: 'DA_YTD' },
    { key: 'changeOperatingNwcYTD', header: 'DeltaOperatingNWC_YTD' },
    { key: 'valuationTaxRate', header: 'ValuationTaxRate' },
    { key: 'valuationSource', header: 'ValuationSource' },
    { key: 'financialCurrency', header: 'FinancialCurrency' },
    { key: 'financialUnit', header: 'FinancialUnit' },
    { key: 'dividendsPaidYTD', header: 'DividendsPaidYTD' },
    { key: 'cash', header: 'Cash' },
    { key: 'equity', header: 'Equity' },
    { key: 'equityCommon', header: 'EquityCommon' },
    { key: 'equityCommonBasis', header: 'EquityCommon_Basis' },
    { key: 'equityCommonNote', header: 'EquityCommon_Note' },
    { key: 'totalAssets', header: 'TotalAssets' },
    { key: 'totalDebtWithoutTX', header: 'TotalDebtWithoutTX' },
    { key: 'totalLiabilities', header: 'TotalLiabilities' },
    { key: 'intangibleAssets', header: 'IntangibleAssets' },
    { key: 'financeCostsYTD', header: 'FinanceCosts_YTD' },
    { key: 'interestExpenseYTD', header: 'InterestExpense_YTD' },
    { key: 'interestIncomeYTD', header: 'InterestIncome_YTD' },
    { key: 'taxExpenseYTD', header: 'TaxExpense_YTD' },
    { key: 'interestPaidYTD', header: 'InterestPaid_YTD' },
    { key: 'dateInsertData', header: 'DateInsertData' },
    { key: 'updatedAt', header: 'updatedAt' },
  ];

  const coreKeySet = new Set<string>(coreFields.map((c) => String(c.key)));
  const extKeys = Array.from(
    new Set(records.flatMap((r) => (r.extendedFields ? Object.keys(r.extendedFields) : [])))
  ).sort((a, b) => a.localeCompare(b));

  const extraTopLevelKeys = Array.from(
    new Set(
      records.flatMap((r) =>
        Object.keys(r).filter(
          (k) =>
            !coreKeySet.has(k) &&
            !INTERNAL_EXPORT_IGNORED_KEYS.has(k) &&
            (r as unknown as Record<string, unknown>)[k] !== undefined
        )
      )
    )
  ).sort((a, b) => a.localeCompare(b));

  const hasOriginalValues = records.some(
    (r) => r.originalValues && Object.keys(r.originalValues).length > 0
  );

  const headers = [
    ...coreFields.map((c) => c.header),
    ...extKeys.map((k) => `extendedFields.${k}`),
    ...extraTopLevelKeys.map((k) => `extra.${k}`),
    ...(hasOriginalValues ? ['originalValues (القيم الأصلية)'] : []),
  ];

  const rows = records.map((r) => [
    ...coreFields.map((c) =>
      c.key === 'yearQuarter'
        ? serializeExportValue(r.yearQuarter || `${r.year}${r.quarter}`)
        : serializeExportValue(r[c.key])
    ),
    ...extKeys.map((k) => serializeExportValue(r.extendedFields?.[k])),
    ...extraTopLevelKeys.map((k) => serializeExportValue((r as unknown as Record<string, unknown>)[k])),
    ...(hasOriginalValues
      ? [r.originalValues && Object.keys(r.originalValues).length > 0 ? JSON.stringify(r.originalValues) : null]
      : []),
  ]);

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Quarterly_Financials');

  const manualCorrectionsCount = appendManualCorrectionsSheet(
    wb,
    XLSX,
    records.map((r) => ({
      ticker: r.ticker,
      periodOrDate: r.yearQuarter || `${r.year}${r.quarter}`,
      manualCorrections: r.manualCorrections,
    }))
  );

  const tickers = Array.from(new Set(records.map((r) => r.ticker))).sort();
  const metaRows = [
    ['الحقل', 'القيمة'],
    ['نطاق الأسهم المصدرة', tickers.join(', ') || 'لا يوجد'],
    ['عدد السجلات الفصلية', records.length],
    ['عدد الحقول الإضافية الممتدة', extKeys.length],
    ['عدد الحقول الإضافية العليا (extra)', extraTopLevelKeys.length],
    ['إجمالي التعديلات اليدوية الموثقة', manualCorrectionsCount],
    ['تاريخ ووقت التصدير', new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaRows), 'Export_Metadata');

  return wb;
}

export async function exportQuarterlyRecordsToExcel(
  records: QuarterlyFinancialRecord[],
  fileNameSuffix?: string
): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = await buildQuarterlyRecordsWorkbook(records);
  const cleanSuffix = fileNameSuffix ? `_${fileNameSuffix.replace(/[^A-Za-z0-9_-]+/g, '_')}` : '';
  XLSX.writeFile(wb, `Mizan_Quarterly_Records${cleanSuffix}.xlsx`);
}

/**
 * تصدير المعاملات العامة وتخصيصات الشركات بنفس العقد المركزي الموحد لأعمدة `All_Parameters.xlsx`
 * بحيث تحافظ إعادة الاستيراد على المفتاح والاسم والقيمة المخزنة الدقيقة والنوع والوحدة والمصدر والتاريخ والنطاق.
 */
export async function buildAllParametersExportWorkbook(params: {
  macroParams?: MacroParameter[];
  companyOverrides?: CompanyParameterOverride[];
}): Promise<XlsxTypes.WorkBook> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  const headers = [...ALL_PARAMETERS_EXCEL_HEADERS];

  const globalRows = (params.macroParams ?? [])
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) =>
      excelRowToAoa(
        parameterRecordToExcelRow({
          key: p.key,
          nameAr: p.nameAr,
          value: p.value,
          valueType: p.valueType,
          isPercentage: p.isPercentage,
          description: p.descriptionAr,
          scope: 'global',
          ticker: null,
          unit: p.unit,
          asOfDate: p.asOfDate,
          source: p.source,
          rfMethodology: p.rfMethodology,
          currency: p.currency ?? null,
          forecastHorizonYears: p.forecastHorizonYears ?? null,
        })
      )
    );

  const companyRows = (params.companyOverrides ?? [])
    .slice()
    .sort((a, b) => `${a.ticker}__${a.key}`.localeCompare(`${b.ticker}__${b.key}`))
    .map((ov) =>
      excelRowToAoa(
        parameterRecordToExcelRow({
          key: ov.key,
          nameAr: ov.nameAr,
          value: ov.value,
          valueType: ov.valueType,
          isPercentage: ov.isPercentage,
          description: ov.description,
          scope: 'company',
          ticker: ov.ticker,
          unit: ov.unit,
          asOfDate: ov.asOfDate,
          source: ov.source,
          rfMethodology: ov.rfMethodology,
          currency: ov.currency ?? null,
          forecastHorizonYears: ov.forecastHorizonYears ?? null,
        })
      )
    );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([headers, ...globalRows, ...companyRows]),
    ALL_PARAMETERS_SHEET_NAME
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(ALL_PARAMETERS_TEMPLATE_INSTRUCTIONS.map(([k, v]) => [k, v])),
    ALL_PARAMETERS_INSTRUCTIONS_SHEET_NAME
  );
  return wb;
}

export async function exportAllParametersToExcel(params: {
  macroParams?: MacroParameter[];
  companyOverrides?: CompanyParameterOverride[];
  fileName?: string;
}): Promise<void> {
  const XLSX = await loadXlsx();
  const wb = await buildAllParametersExportWorkbook(params);
  XLSX.writeFile(wb, params.fileName || 'All_Parameters_Export.xlsx');
}

export { downloadQuarterlyFcffTemplate };

