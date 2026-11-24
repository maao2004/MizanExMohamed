/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuditWarning, Company, QuarterlyFinancial } from '../types/financial';

const QUARTER_ORDER: Record<string, number> = {
  Q1: 1,
  Q2: 2,
  Q3: 3,
  FY: 4,
};

const QUARTER_NAMES_AR: Record<string, string> = {
  Q1: 'الربع الأول',
  Q2: 'الربع الثاني',
  Q3: 'الربع الثالث',
  FY: 'نهاية العام (الرابع)',
};

/**
 * محرك التدقيق الآلي لجودة البيانات المحاسبية
 * يفحص التناقضات والقيم الشاذة ويصدر تقارير وإنذارات تفصيلية باللغة العربية
 * مع مراجع منظّمة للسجلات والحقول المعنية ودون تعديل البيانات تلقائياً.
 */
export function runDataQualityAudit(
  company: Company,
  financials: QuarterlyFinancial[]
): AuditWarning[] {
  const warnings: AuditWarning[] = [];

  // تصفية السجلات التابعة للشركة المعنية وترتيبها زمنياً
  const companyRecords = financials
    .filter((f) => f.companyId === company.id)
    .sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return (QUARTER_ORDER[a.quarter] || 0) - (QUARTER_ORDER[b.quarter] || 0);
    });

  if (companyRecords.length === 0) return warnings;

  // 1. تجميع السجلات حسب السنة المالية لفحص التغيرات التراكمية (YTD)
  const recordsByYear: Record<number, QuarterlyFinancial[]> = {};
  for (const record of companyRecords) {
    if (!recordsByYear[record.year]) recordsByYear[record.year] = [];
    recordsByYear[record.year].push(record);
  }

  // فحص كل سنة مالية على حدة
  for (const [yearStr, yearRecords] of Object.entries(recordsByYear)) {
    const year = Number(yearStr);

    // ترتيب الأرباع في نفس السنة
    yearRecords.sort(
      (a, b) => (QUARTER_ORDER[a.quarter] || 0) - (QUARTER_ORDER[b.quarter] || 0)
    );

    for (let i = 0; i < yearRecords.length; i++) {
      const current = yearRecords[i];
      const prev = i > 0 ? yearRecords[i - 1] : null;
      const currentPeriodName = `${QUARTER_NAMES_AR[current.quarter] || current.quarter} ${year}`;
      const prevPeriodName = prev
        ? `${QUARTER_NAMES_AR[prev.quarter] || prev.quarter} ${year}`
        : '';

      // --- الفحص 1: انخفاض الإيرادات التراكمية بين الأرباع (Cumulative Revenue Drop) ---
      // قاعدة: الإيرادات التراكمية YTD يجب ألا تنقص عن الربع السابق داخل نفس السنة المالية
      if (
        prev &&
        current.revenueYTD !== null &&
        prev.revenueYTD !== null &&
        current.revenueYTD < prev.revenueYTD
      ) {
        const dropAmount = (prev.revenueYTD - current.revenueYTD).toFixed(2);
        const currentRevFormatted = `${current.revenueYTD.toLocaleString('ar-EG')} ج.م`;
        const prevRevFormatted = `${prev.revenueYTD.toLocaleString('ar-EG')} ج.م`;
        warnings.push({
          id: `rev_drop_${company.ticker}_${year}_${current.quarter}`,
          type: 'revenue_drop',
          title: 'انخفاض غير منطقي في الإيرادات التراكمية (YTD)',
          severity: 'critical',
          period: currentPeriodName,
          companyTicker: company.ticker,
          detectedValues: {
            currentPeriod: currentPeriodName,
            currentRevenueYTD: currentRevFormatted,
            prevPeriod: prevPeriodName,
            prevRevenueYTD: prevRevFormatted,
            dropAmount: `${dropAmount} ج.م`,
          },
          detectedFields: [
            { labelAr: `الإيرادات التراكمية — ${currentPeriodName}`, value: currentRevFormatted },
            { labelAr: `الإيرادات التراكمية — ${prevPeriodName}`, value: prevRevFormatted },
            { labelAr: 'مقدار التراجع', value: `${dropAmount} ج.م` },
          ],
          relatedRecords: [
            {
              ticker: company.ticker,
              year,
              quarter: current.quarter,
              periodLabelAr: currentPeriodName,
              field: 'revenueYTD',
              fieldLabelAr: 'الإيرادات التراكمية (Revenue YTD)',
              roleAr: 'الفترة الحالية',
            },
            {
              ticker: company.ticker,
              year,
              quarter: prev.quarter,
              periodLabelAr: prevPeriodName,
              field: 'revenueYTD',
              fieldLabelAr: 'الإيرادات التراكمية (Revenue YTD)',
              roleAr: 'الفترة السابقة المقارنة',
            },
          ],
          reasonAr: `سجلت الإيرادات التراكمية (${currentRevFormatted}) تراجعاً مقارنة بـ (${prevRevFormatted}) في ${prevPeriodName} بمقدار ${dropAmount} ج.م داخل نفس السنة المالية ${year}. محاسبياً، الأرقام التراكمية تزيد أو تثبت ولا تتراجع إلا إذا حدث استرداد مبيعات استثنائي ضخم أو تصويب خطأ جوهري.`,
          reviewActionAr: `يرجى مراجعة القوائم المالية الربع سنوية المعتمدة المنشورة على شاشة البورصة المصرية والتأكد من عدم إدخال إيراد الربع منفرداً بدلاً من الرقم التراكمي (YTD) أو التحقق من وجود إيضاحات محاسبية مرفقة.`,
          createdAt: new Date().toISOString(),
        });
      }

      // --- الفحص 2: تراجع الإنفاق الاستثماري التراكمي (Cumulative CapEx Drop) ---
      if (
        prev &&
        current.capexYTD !== null &&
        prev.capexYTD !== null &&
        current.capexYTD < prev.capexYTD
      ) {
        const dropAmount = (prev.capexYTD - current.capexYTD).toFixed(2);
        const currentCapexFormatted = `${current.capexYTD.toLocaleString('ar-EG')} ج.م`;
        const prevCapexFormatted = `${prev.capexYTD.toLocaleString('ar-EG')} ج.م`;
        warnings.push({
          id: `capex_drop_${company.ticker}_${year}_${current.quarter}`,
          type: 'capex_drop',
          title: 'تراجع غير معتاد في الإنفاق الاستثماري التراكمي (CapEx YTD)',
          severity: 'warning',
          period: currentPeriodName,
          companyTicker: company.ticker,
          detectedValues: {
            currentPeriod: currentPeriodName,
            currentCapExYTD: currentCapexFormatted,
            prevPeriod: prevPeriodName,
            prevCapExYTD: prevCapexFormatted,
            dropAmount: `${dropAmount} ج.م`,
          },
          detectedFields: [
            { labelAr: `CapEx YTD — ${currentPeriodName}`, value: currentCapexFormatted },
            { labelAr: `CapEx YTD — ${prevPeriodName}`, value: prevCapexFormatted },
            { labelAr: 'مقدار التراجع', value: `${dropAmount} ج.م` },
          ],
          relatedRecords: [
            {
              ticker: company.ticker,
              year,
              quarter: current.quarter,
              periodLabelAr: currentPeriodName,
              field: 'capexYTD',
              fieldLabelAr: 'الإنفاق الاستثماري التراكمي (CapEx YTD)',
              roleAr: 'الفترة الحالية',
            },
            {
              ticker: company.ticker,
              year,
              quarter: prev.quarter,
              periodLabelAr: prevPeriodName,
              field: 'capexYTD',
              fieldLabelAr: 'الإنفاق الاستثماري التراكمي (CapEx YTD)',
              roleAr: 'الفترة السابقة المقارنة',
            },
          ],
          reasonAr: `انخفض إجمالي الإنفاق الاستثماري الرأسمالي التراكمي من ${prev.capexYTD.toLocaleString('ar-EG')} إلى ${current.capexYTD.toLocaleString('ar-EG')} ج.م. الإنفاق الرأسمالي التراكمي هو تدفق نقدي خارج متراكم؛ وتراجعه قد يشير إلى استبعاد أصول أو بيع أصول رأسمالية تم خصمها خطأً من التدفق التراكمي أو إدخال ربع منفرد.`,
          reviewActionAr: `راجع قائمة التدفقات النقدية - بند التدفقات النقدية المستخدمة في الأنشطة الاستثمارية (شراء أصول ثابتة ومشاريع تحت التنفيذ) وتأكد من استخدام الرقم التراكمي من بداية العام حتى نهاية الربع.`,
          createdAt: new Date().toISOString(),
        });
      }

      // --- الفحص 3: ربح يتجاوز الإيرادات (Profit Exceeding Revenue) ---
      if (
        current.netProfitYTD !== null &&
        current.revenueYTD !== null &&
        current.revenueYTD > 0 &&
        current.netProfitYTD > current.revenueYTD
      ) {
        const excess = (current.netProfitYTD - current.revenueYTD).toFixed(2);
        const profitFormatted = `${current.netProfitYTD.toLocaleString('ar-EG')} ج.م`;
        const revFormatted = `${current.revenueYTD.toLocaleString('ar-EG')} ج.م`;
        const marginPct = `${((current.netProfitYTD / current.revenueYTD) * 100).toFixed(1)}%`;
        warnings.push({
          id: `profit_exceed_${company.ticker}_${year}_${current.quarter}`,
          type: 'profit_exceeds_revenue',
          title: 'صافي الربح التراكمي يتجاوز إجمالي الإيرادات',
          severity: 'warning',
          period: currentPeriodName,
          companyTicker: company.ticker,
          detectedValues: {
            period: currentPeriodName,
            netProfitYTD: profitFormatted,
            revenueYTD: revFormatted,
            profitMargin: marginPct,
          },
          detectedFields: [
            { labelAr: 'صافي الربح التراكمي (Net Income YTD)', value: profitFormatted },
            { labelAr: 'الإيرادات التراكمية (Revenue YTD)', value: revFormatted },
            { labelAr: 'نسبة صافي الربح للإيرادات', value: marginPct },
          ],
          relatedRecords: [
            {
              ticker: company.ticker,
              year,
              quarter: current.quarter,
              periodLabelAr: currentPeriodName,
              field: 'netIncomeYTD',
              fieldLabelAr: 'صافي الربح التراكمي (Net Income YTD)',
              roleAr: 'بند صافي الربح',
            },
            {
              ticker: company.ticker,
              year,
              quarter: current.quarter,
              periodLabelAr: currentPeriodName,
              field: 'revenueYTD',
              fieldLabelAr: 'الإيرادات التراكمية (Revenue YTD)',
              roleAr: 'بند الإيرادات',
            },
          ],
          reasonAr: `بلغ صافي الربح (${profitFormatted}) متجاوزاً إجمالي الإيرادات (${revFormatted}) بفارق ${excess} ج.م. هذا الوضع غير معتاد في العمليات التشغيلية الاعتيادية للشركات، إلا إذا كانت هناك أرباح رأسمالية استثنائية (مثل بيع أرض، أو تخارج من شركة تابعة، أو فروق عملة تقييمية دائنة هائلة).`,
          reviewActionAr: `افحص إيضاح "الإيرادات / الأرباح الأخرى" في قائمة الدخل للتحقق من أسباب ارتفاع صافي الربح فوق المبيعات والتأكد من استبعاد الأرباح غير المتكررة عند تقييم التدفقات النقدية التشغيلية المستدامة.`,
          createdAt: new Date().toISOString(),
        });
      }

      // --- الفحص 4: مراجعة القيمة الصفرية مقابل البيان غير المتوفر (Blank vs Zero) ---
      // الإيراد الصفري لا يثبت تلقائياً توقف النشاط، لكنه يستدعي مراجعة المصدر مع الحفاظ على الصفر إذا كان فعلياً
      if (current.revenueYTD === 0) {
        warnings.push({
          id: `zero_blank_rev_${company.ticker}_${year}_${current.quarter}`,
          type: 'blank_zero_confusion',
          title: 'مراجعة القيمة الصفرية للإيرادات مقابل البيان غير المتوفر (BLANK)',
          severity: 'info',
          period: currentPeriodName,
          companyTicker: company.ticker,
          detectedValues: {
            field: 'إيرادات النشاط YTD',
            enteredValue: 0,
            status: 'مسجل بصفر (0) للمراجعة',
          },
          detectedFields: [
            { labelAr: 'الحقل المرصود', value: 'إيرادات النشاط (Revenue YTD)' },
            { labelAr: 'القيمة المسجلة', value: '0 (محفوظ كصفر للمراجعة)' },
          ],
          relatedRecords: [
            {
              ticker: company.ticker,
              year,
              quarter: current.quarter,
              periodLabelAr: currentPeriodName,
              field: 'revenueYTD',
              fieldLabelAr: 'الإيرادات التراكمية (Revenue YTD)',
              roleAr: 'الحقل المسجل بصفر',
            },
          ],
          reasonAr: `تم تسجيل قيمة الإيرادات التراكمية بصفر (0). الإيراد الصفري لا يعني تلقائياً توقف نشاط الشركة؛ بل يمثّل حالة اشتباه تتطلب مراجعة المصدر للتأكد من أن الصفر رقم فعلي في القوائم وليس بديلاً عن بيان غير متاح (BLANK).`,
          reviewActionAr: `راجع القوائم المالية المعتمدة ومصدر الإدخال: أبقِ القيمة الصفرية (0) محفوظة كما هي إذا كانت هي الرقم الفعلي المعلن، واترك الخانة فارغة (BLANK) فقط إذا كانت البيانات لم تُعلن بعد أو غير متوفرة.`,
          createdAt: new Date().toISOString(),
        });
      }

      // --- الفحص 5: تباين ملحوظ بين صافي الربح والتدفق النقدي التشغيلي (Cashflow Divergence) ---
      if (
        current.netProfitYTD !== null &&
        current.operatingCashFlowYTD !== null &&
        current.netProfitYTD > 0 &&
        current.operatingCashFlowYTD < 0 &&
        Math.abs(current.operatingCashFlowYTD) >= current.netProfitYTD * 0.2
      ) {
        const profitFormatted = `${current.netProfitYTD.toLocaleString('ar-EG')} ج.م`;
        const ocfFormatted = `${current.operatingCashFlowYTD.toLocaleString('ar-EG')} ج.م`;
        warnings.push({
          id: `cf_diverge_${company.ticker}_${year}_${current.quarter}`,
          type: 'cashflow_divergence',
          title: 'تباين ملحوظ بين صافي الربح المسجل والتدفق النقدي التشغيلي (للمراجعة)',
          severity: 'warning',
          period: currentPeriodName,
          companyTicker: company.ticker,
          detectedValues: {
            period: currentPeriodName,
            netProfitYTD: profitFormatted,
            operatingCashFlowYTD: ocfFormatted,
          },
          detectedFields: [
            { labelAr: 'صافي الربح التراكمي (Net Income YTD)', value: profitFormatted },
            { labelAr: 'التدفق النقدي التشغيلي (OCF YTD)', value: ocfFormatted },
          ],
          relatedRecords: [
            {
              ticker: company.ticker,
              year,
              quarter: current.quarter,
              periodLabelAr: currentPeriodName,
              field: 'ocfYTD',
              fieldLabelAr: 'التدفق النقدي التشغيلي (OCF YTD)',
              roleAr: 'بند التدفق التشغيلي',
            },
            {
              ticker: company.ticker,
              year,
              quarter: current.quarter,
              periodLabelAr: currentPeriodName,
              field: 'netIncomeYTD',
              fieldLabelAr: 'صافي الربح التراكمي (Net Income YTD)',
              roleAr: 'بند صافي الربح',
            },
          ],
          reasonAr: `الشركة تسجل أرباحاً دفترية تبلغ ${profitFormatted} بينما التدفق النقدي من الأنشطة التشغيلية سالب (${ocfFormatted}). هذا التباعد قد يعكس تراكم عملاء وأرصدة مدينة لم يتم تحصيلها أو تضخم في المخزون.`,
          reviewActionAr: `راجع قائمة التدفقات النقدية وتحولات رأس المال العامل (حسابات العملاء، المدينون، المخزون) للتأكد من قدرة الشركة على تحويل أرباحها إلى سيولة فعلية.`,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  // --- الفحص 6: رصد التكرار غير المعتاد للبيانات (Unusual Repetition / Copy-Paste Anomaly) ---
  // مقارنة القيم عبر جميع الأرباع لرصد الأرقام المعقدة المتكررة حرفياً
  for (let i = 0; i < companyRecords.length; i++) {
    for (let j = i + 1; j < companyRecords.length; j++) {
      const recA = companyRecords[i];
      const recB = companyRecords[j];

      // إذا كانت أرقام الإيرادات متطابقة لأرباع في سنتين مختلفتين
      if (
        recA.revenueYTD !== null &&
        recB.revenueYTD !== null &&
        recA.revenueYTD > 50 &&
        recA.revenueYTD === recB.revenueYTD &&
        recA.year !== recB.year
      ) {
        const periodAName = `${QUARTER_NAMES_AR[recA.quarter] || recA.quarter} ${recA.year}`;
        const periodBName = `${QUARTER_NAMES_AR[recB.quarter] || recB.quarter} ${recB.year}`;
        const repeatedFormatted = `${recA.revenueYTD.toLocaleString('ar-EG')} ج.م`;
        warnings.push({
          id: `unusual_rep_${company.ticker}_${recA.id}_${recB.id}`,
          type: 'unusual_repetition',
          title: 'اشتباه تكرار غير مقصود للبيانات (نسخ ولصق)',
          severity: 'warning',
          period: `${recA.quarter} ${recA.year} مع ${recB.quarter} ${recB.year}`,
          companyTicker: company.ticker,
          detectedValues: {
            periodA: `${recA.quarter} ${recA.year}`,
            periodB: `${recB.quarter} ${recB.year}`,
            repeatedRevenue: repeatedFormatted,
          },
          detectedFields: [
            { labelAr: 'الفترة الأولى', value: `${recA.quarter} ${recA.year}` },
            { labelAr: 'الفترة الثانية', value: `${recB.quarter} ${recB.year}` },
            { labelAr: 'الإيرادات التراكمية المتكررة', value: repeatedFormatted },
          ],
          relatedRecords: [
            {
              ticker: company.ticker,
              year: recA.year,
              quarter: recA.quarter,
              periodLabelAr: periodAName,
              field: 'revenueYTD',
              fieldLabelAr: 'الإيرادات التراكمية (Revenue YTD)',
              roleAr: 'السجل الأول',
            },
            {
              ticker: company.ticker,
              year: recB.year,
              quarter: recB.quarter,
              periodLabelAr: periodBName,
              field: 'revenueYTD',
              fieldLabelAr: 'الإيرادات التراكمية (Revenue YTD)',
              roleAr: 'السجل الثاني',
            },
          ],
          reasonAr: `تم رصد نفس رقم الإيرادات التراكمية بالضبط (${repeatedFormatted}) بين الفترتين (${recA.quarter} ${recA.year}) و(${recB.quarter} ${recB.year}). احتمالية تكرار نفس الرقم الدقيق نادرة جداً في الشركات الكبرى وغالباً ما تنتج عن خطأ نسخ عند إدخال البيانات.`,
          reviewActionAr: `تأكد من مراجعة القوائم المالية لكل فترة بشكل مستقل والتحقق من أن بيانات إحدى الفترتين لم تُنسخ سهواً في الأخرى.`,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return warnings;
}
