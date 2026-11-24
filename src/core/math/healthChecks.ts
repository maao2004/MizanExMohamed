/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DailyTradingRecord,
  HealthCheckStatus,
  QuarterlyFinancialRecord,
  StockHealthCheckItem,
} from '../../types';
import { TerminalValueMethod } from '../../types/financial';
import { EngineOutputs } from './valuation';
import { readYtdTTM } from '../../utils/financialCalculations';
import { resolveMarketPriceFromDaily } from '../domain/valuationAssumptions';

export interface HealthCheckInputs {
  ticker: string;
  dailyRecord?: DailyTradingRecord;
  quarterlyRecords: QuarterlyFinancialRecord[];
  engineOutputs: EngineOutputs;
  terminalGrowth: number | null;
  terminalValueMethod?: TerminalValueMethod | null;
}

const formatIntegerAr = (value: number): string =>
  value.toLocaleString('ar-EG', { maximumFractionDigits: 0 });

/**
 * محرك فحص جودة واكتمال بيانات السهم الـ 9
 * يفصل بدقة بين:
 * - pass: شرط محقق ببيانات موثقة
 * - fail: مخالفة موثقة لقيمة مرصودة (سالب أو صفر حيث يلزم موجب أو خلل ميزانية)
 * - incomplete: مدخلات غير مكتملة / BLANK (لا تُوصف أبداً كقيمة سالبة أو كمخالفة موثقة)
 * - not_applicable: فحص غير منطبق وفق سياسة القطاع أو طريقة التقييم النشطة
 */
export function runStockHealthChecks(inputs: HealthCheckInputs): StockHealthCheckItem[] {
  const { dailyRecord, quarterlyRecords, engineOutputs, terminalGrowth } = inputs;

  const checks: StockHealthCheckItem[] = [];

  // ترتيب الأرباع وتحديد أحدث ربع
  const sortedQuarters = [...quarterlyRecords].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    const order: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, FY: 4 };
    return (order[a.quarter] || 0) - (order[b.quarter] || 0);
  });
  const latestQuarter = sortedQuarters[sortedQuarters.length - 1];

  // حساب OCF_TTM و FCF_TTM لأحدث 4 أرباع
  const last4 = sortedQuarters.slice(-4);
  const quartersCount = last4.length;

  const ocfTTM = readYtdTTM(sortedQuarters, (q) => q.ocfYTD);
  const capexTTM = readYtdTTM(sortedQuarters, (q) => q.capexYTD);
  const fcfTTM = ocfTTM !== null && capexTTM !== null ? ocfTTM - capexTTM : null;

  // 1. OCF_TTM موجب (البعد: السلامة)
  let ocfStatus: HealthCheckStatus;
  let ocfActual: string;
  let ocfDetails: string;
  if (ocfTTM === null) {
    ocfStatus = 'incomplete';
    ocfActual = 'BLANK';
    ocfDetails =
      'مدخلات التدفق النقدي التشغيلي (OCF_TTM) غير مكتملة لتغطية اثني عشر شهراً؛ تعذر تقييم الشرط ولا يعني ذلك أن التدفق التشغيلي سالب.';
  } else if (ocfTTM > 0) {
    ocfStatus = 'pass';
    ocfActual = formatIntegerAr(ocfTTM);
    ocfDetails =
      'التدفق النقدي التشغيلي للاثني عشر شهراً (OCF_TTM) موجب وفق القيم المسجلة؛ ولا تكفي إيجابية OCF وحدها لإثبات جودة الأرباح دون مراجعة بقية القوائم والبنود.';
  } else if (ocfTTM === 0) {
    ocfStatus = 'fail';
    ocfActual = formatIntegerAr(0);
    ocfDetails =
      'التدفق النقدي التشغيلي السنوي المسجل يساوي صفراً (0)، وهو لا يحقق شرط الإيجابية الصارم (OCF_TTM > 0).';
  } else {
    ocfStatus = 'fail';
    ocfActual = formatIntegerAr(ocfTTM);
    ocfDetails =
      'التدفق النقدي التشغيلي السنوي سالب فعلياً وفق القيم المسجلة، مما يستدعي مراجعة أسباب الاستنزاف النقدي التشغيلي ورأس المال العامل.';
  }
  checks.push({
    id: 'ocf_positive',
    name: 'OCF_TTM موجب',
    category: 'السلامة',
    order: 1,
    status: ocfStatus,
    actualValue: ocfActual,
    expectedRule: '[OCF_TTM] > 0',
    detailsAr: ocfDetails,
  });

  // 2. FCF_TTM موجب (البعد: السلامة)
  let fcfStatus: HealthCheckStatus;
  let fcfActual: string;
  let fcfDetails: string;
  if (fcfTTM === null) {
    fcfStatus = 'incomplete';
    fcfActual = 'BLANK';
    const missingParts: string[] = [];
    if (ocfTTM === null) missingParts.push('OCF_TTM');
    if (capexTTM === null) missingParts.push('CapEx_TTM');
    fcfDetails = `مدخلات حساب التدفق النقدي الحر غير مكتملة (${missingParts.join(' و')})؛ تعذر تقييم الشرط ولا يُعد ذلك قيمة سالبة.`;
  } else if (fcfTTM > 0) {
    fcfStatus = 'pass';
    fcfActual = formatIntegerAr(fcfTTM);
    fcfDetails =
      'التدفق النقدي الحر (OCF_TTM − CapEx_TTM) موجب وفق القيم المسجلة بعد خصم النفقات الرأسمالية.';
  } else if (fcfTTM === 0) {
    fcfStatus = 'fail';
    fcfActual = formatIntegerAr(0);
    fcfDetails =
      'التدفق النقدي الحر المحسوب يساوي صفراً (0)، وهو لا يحقق شرط الإيجابية الصارم (FCF_TTM > 0).';
  } else {
    fcfStatus = 'fail';
    fcfActual = formatIntegerAr(fcfTTM);
    fcfDetails =
      'التدفق النقدي الحر سالب فعلياً وفق القيم المسجلة، ما يعني أن النفقات الرأسمالية تفوق التدفق التشغيلي أو أن التدفق التشغيلي سالب.';
  }
  checks.push({
    id: 'fcf_positive',
    name: 'FCF_TTM موجب',
    category: 'السلامة',
    order: 2,
    status: fcfStatus,
    actualValue: fcfActual,
    expectedRule: '[FCF_TTM] > 0',
    detailsAr: fcfDetails,
  });

  // 3. تغطية TTM موثقة (البعد: الاكتمال)
  const isFourQuarters = ocfTTM !== null && capexTTM !== null;
  checks.push({
    id: 'ttm_four_quarters',
    name: 'تغطية TTM موثقة',
    category: 'الاكتمال',
    order: 3,
    status: isFourQuarters ? 'pass' : 'incomplete',
    actualValue: `${quartersCount} أرباع متاحة`,
    expectedRule: 'FY أو YTD + FY السابق - YTD المقارن',
    detailsAr: isFourQuarters
      ? 'تتوفر القيم التراكمية اللازمة لحساب اثني عشر شهراً دون تعميم تقديري.'
      : 'المدخلات اللازمة لحساب TTM (لـ OCF وCapEx) غير مكتملة؛ لا يُجرى تحويل تقديري إلى سنة.',
  });

  // 4. Equity ≤ TotalAssets (البعد: الاتساق)
  const latestEquity = latestQuarter?.equity ?? null;
  const latestAssets = latestQuarter?.totalAssets ?? null;
  let equityStatus: HealthCheckStatus;
  let equityActual: string;
  let equityDetails: string;
  if (latestEquity === null || latestAssets === null) {
    equityStatus = 'incomplete';
    equityActual = 'بيانات غير مكتملة';
    const missingBalanceFields: string[] = [];
    if (latestEquity === null) missingBalanceFields.push('حقوق الملكية (Equity)');
    if (latestAssets === null) missingBalanceFields.push('إجمالي الأصول (TotalAssets)');
    equityDetails = `تعذر التحقق من اتساق الميزانية لنقص ${missingBalanceFields.join(' و')} في أحدث سجل مالي؛ لا يعني ذلك أن حقوق الملكية تتجاوز الأصول.`;
  } else if (latestEquity <= latestAssets) {
    equityStatus = 'pass';
    equityActual = `حقوق الملكية: ${latestEquity.toLocaleString('ar-EG')} | الأصول: ${latestAssets.toLocaleString('ar-EG')}`;
    equityDetails =
      'المعادلة المحاسبية متسقة وفق القيم المسجلة: حقوق الملكية لا تتجاوز إجمالي الأصول.';
  } else {
    equityStatus = 'fail';
    equityActual = `حقوق الملكية: ${latestEquity.toLocaleString('ar-EG')} | الأصول: ${latestAssets.toLocaleString('ar-EG')}`;
    equityDetails =
      'مخالفة شرط مسجلة تتطلب المراجعة: حقوق الملكية المسجلة أكبر من إجمالي أصول الشركة؛ يُرجى التحقق من القيم ومصادرها ووحدة الإدخال.';
  }
  checks.push({
    id: 'equity_assets_consistent',
    name: 'Equity ≤ TotalAssets',
    category: 'الاتساق',
    order: 4,
    status: equityStatus,
    actualValue: equityActual,
    expectedRule: '[Equity_Latest] <= [TotalAssets_Latest]',
    detailsAr: equityDetails,
  });

  // 5. Shares > 0 (البعد: السلامة)
  const latestShares =
    latestQuarter?.shares ??
    (dailyRecord?.listedShares !== null && dailyRecord?.listedShares !== undefined
      ? dailyRecord.listedShares
      : null);
  let sharesStatus: HealthCheckStatus;
  let sharesActual: string;
  let sharesDetails: string;
  if (latestShares === null) {
    sharesStatus = 'incomplete';
    sharesActual = 'BLANK';
    sharesDetails =
      'عدد الأسهم غير مسجل (فارغ / BLANK) في أحدث قائمة مالية أو سجل التداول اليومي؛ تعذر تقييم الشرط.';
  } else if (latestShares > 0) {
    sharesStatus = 'pass';
    sharesActual = `${latestShares.toLocaleString('ar-EG')} سهم`;
    sharesDetails =
      'عدد الأسهم المسجل موجب، ما يسمح بحساب المؤشرات لكل سهم وفق البيانات المدخلة.';
  } else if (latestShares === 0) {
    sharesStatus = 'fail';
    sharesActual = `${(0).toLocaleString('ar-EG')} سهم`;
    sharesDetails =
      'عدد الأسهم المسجل يساوي صفراً (0)، وهو يخالف الشرط (Shares > 0) ويعطل حساب نصيب السهم.';
  } else {
    sharesStatus = 'fail';
    sharesActual = `${latestShares.toLocaleString('ar-EG')} سهم`;
    sharesDetails =
      'عدد الأسهم المسجل سالب، وهو يخالف الشرط (Shares > 0) ويتطلب مراجعة الإدخال.';
  }
  checks.push({
    id: 'shares_positive',
    name: 'Shares > 0',
    category: 'السلامة',
    order: 5,
    status: sharesStatus,
    actualValue: sharesActual,
    expectedRule: '[Shares_Latest] > 0',
    detailsAr: sharesDetails,
  });

  // 6. WACC > g (البعد: المنطق — يعتمد على طريقة القيمة النهائية النشطة لا على dcfDetails وحدها)
  const dcfModelStatus = engineOutputs.modelStatuses?.find((m) => m.model === 'dcf') ?? null;
  const isFinancialSector = engineOutputs.sectorClassification === 'financial';
  const activeTerminalValueMethod: TerminalValueMethod =
    inputs.terminalValueMethod ??
    engineOutputs.dcfDetails?.terminalValueMethod ??
    'perpetuity_growth';
  const isExitMultipleDcf = activeTerminalValueMethod === 'exit_multiple';

  let waccStatus: HealthCheckStatus;
  let waccActual: string;
  let waccDetails: string;
  if (isFinancialSector) {
    waccStatus = 'not_applicable';
    waccActual = 'غير منطبق (قطاع مالي)';
    waccDetails =
      'نموذج DCF مستبعد للبنوك والقطاع المالي وفق سياسة التقييم، لذا لا ينطبق شرط النمو الأبدي (WACC > g) على هذا السهم.';
  } else if (isExitMultipleDcf) {
    waccStatus = 'not_applicable';
    const waccDisplay =
      engineOutputs.wacc === null ? 'غير متاح' : `${(engineOutputs.wacc * 100).toFixed(1)}%`;
    waccActual = `غير منطبق (مضاعف الخروج) | WACC: ${waccDisplay}`;
    waccDetails =
      engineOutputs.wacc === null
        ? 'طريقة القيمة النهائية المختارة هي مضاعف الخروج (exit_multiple)، لذا لا ينطبق شرط النمو الأبدي (WACC > g) حتى عند غياب نتائج DCF. لا يعفي ذلك نموذج DCF من الحاجة إلى معدل خصم (WACC) صالح لخصم التدفقات والقيمة النهائية (وWACC غير متاح حالياً).'
        : 'طريقة القيمة النهائية المختارة هي مضاعف الخروج (exit_multiple)، لذا لا ينطبق شرط النمو الأبدي (WACC > g) حتى عند غياب نتائج DCF. ولا يعفي ذلك نموذج DCF من الحاجة إلى معدل خصم (WACC) صالح لخصم التدفقات والقيمة النهائية.';
  } else if (engineOutputs.wacc === null || terminalGrowth === null) {
    waccStatus = 'incomplete';
    waccActual = `WACC: ${engineOutputs.wacc === null ? 'غير متاح' : (engineOutputs.wacc * 100).toFixed(1) + '%'} | g: ${terminalGrowth === null ? 'غير متاح' : (terminalGrowth * 100).toFixed(1) + '%'}`;
    const missingWaccParts: string[] = [];
    if (engineOutputs.wacc === null) missingWaccParts.push('WACC');
    if (terminalGrowth === null) missingWaccParts.push('معدل النمو النهائي g');
    waccDetails = `تعذر تقييم الشرط الرياضي لطريقة النمو الأبدي (perpetuity_growth) لنقص ${missingWaccParts.join(' و')}؛ لا يُعد ذلك مخالفة موثقة لشرط WACC > g.`;
  } else if (engineOutputs.wacc > terminalGrowth) {
    waccStatus = 'pass';
    waccActual = `WACC: ${(engineOutputs.wacc * 100).toFixed(1)}% | g: ${(terminalGrowth * 100).toFixed(1)}%`;
    waccDetails =
      'الشرط الرياضي لطريقة النمو الأبدي (perpetuity_growth) محقق: تكلفة رأس المال (WACC) أعلى من معدل النمو النهائي المستدام (g).';
  } else {
    waccStatus = 'fail';
    waccActual = `WACC: ${(engineOutputs.wacc * 100).toFixed(1)}% | g: ${(terminalGrowth * 100).toFixed(1)}%`;
    waccDetails =
      engineOutputs.wacc === terminalGrowth
        ? 'مخالفة شرط رياضي لطريقة النمو الأبدي (perpetuity_growth): تكلفة رأس المال (WACC) تساوي معدل النمو النهائي (g)، مما يجعل مقام القيمة النهائية صفراً.'
        : 'مخالفة شرط رياضي لطريقة النمو الأبدي (perpetuity_growth): تكلفة رأس المال (WACC) أقل من معدل النمو النهائي المستدام (g).';
  }
  checks.push({
    id: 'wacc_greater_than_g',
    name: 'WACC > g',
    category: 'المنطق',
    order: 6,
    status: waccStatus,
    actualValue: waccActual,
    expectedRule: '[WACC_Values] > [P_Terminal_Growth_g]',
    detailsAr: waccDetails,
  });

  // 7. PE_Ratio > 0 (البعد: التقييم — فصل صارم بين P/E المحسوب من EPS المعتمد وP/E المستورد من التداول)
  const resolvedDailyPrice = resolveMarketPriceFromDaily(dailyRecord);
  const importedDailyPe =
    typeof dailyRecord?.peRatio === 'number' && Number.isFinite(dailyRecord.peRatio)
      ? dailyRecord.peRatio
      : null;
  const importedPeTradeDate = dailyRecord?.tradeDate ?? resolvedDailyPrice.tradeDate ?? null;

  const attestedCommonEps =
    typeof engineOutputs.epsTTM === 'number' && Number.isFinite(engineOutputs.epsTTM)
      ? engineOutputs.epsTTM
      : null;
  const computedCommonPe =
    resolvedDailyPrice.price !== null &&
    attestedCommonEps !== null &&
    attestedCommonEps !== 0
      ? resolvedDailyPrice.price / attestedCommonEps
      : null;

  const consolidatedEpsRef = engineOutputs.metricAudit?.analyticalEpsTTM?.value ?? null;
  const peConsolidatedRef =
    attestedCommonEps === null &&
    consolidatedEpsRef !== null &&
    consolidatedEpsRef > 0 &&
    resolvedDailyPrice.price !== null
      ? resolvedDailyPrice.price / consolidatedEpsRef
      : null;

  const importedRefTag =
    importedDailyPe !== null
      ? `مرجع التداول المستورد: ${importedDailyPe.toFixed(2)}x${importedPeTradeDate ? ` (${importedPeTradeDate})` : ''}`
      : null;
  const importedRefFootnote =
    importedDailyPe !== null
      ? `المضاعف المستورد من ملف التداول اليومي (${importedDailyPe.toFixed(2)}x${importedPeTradeDate ? ` بتاريخ ${importedPeTradeDate}` : ''}) يُعرض كمرجع فقط؛ مصدره ملف التداول ولا يُعرف أساس ربحيته ولا يُعد دليلاً على توثيق NetIncomeCommon أو EPS داخل التطبيق.`
      : null;

  let peStatus: HealthCheckStatus;
  let peActual: string;
  let peDetails: string;

  if (resolvedDailyPrice.price !== null && attestedCommonEps !== null) {
    if (attestedCommonEps > 0 && computedCommonPe !== null) {
      peStatus = 'pass';
      peActual = importedRefTag
        ? `محسوب (EPS معتمد): ${computedCommonPe.toFixed(2)}x | ${importedRefTag}`
        : `محسوب (EPS معتمد): ${computedCommonPe.toFixed(2)}x`;

      if (importedDailyPe !== null) {
        const hasDivergence = Math.abs(importedDailyPe - computedCommonPe) >= 0.01;
        peDetails = hasDivergence
          ? `مضاعف P/E المحسوب من السعر وربحية الأسهم العادية المعتمدة (EPS_TTM) موجب (${computedCommonPe.toFixed(2)}x)، ويختلف عن المضاعف المستورد من التداول اليومي (${importedDailyPe.toFixed(2)}x${importedPeTradeDate ? ` بتاريخ ${importedPeTradeDate}` : ''})؛ يُعرض المصدران معاً للمقارنة دون استبدال صامت أو تعديل بيانات التداول، ولا يُعرف أساس ربحية الرقم المستورد داخل التطبيق.`
          : `مضاعف P/E المحسوب من السعر وربحية الأسهم العادية المعتمدة (EPS_TTM) موجب (${computedCommonPe.toFixed(2)}x)، ويتوافق عددياً مع المرجع المستورد من التداول (${importedDailyPe.toFixed(2)}x${importedPeTradeDate ? ` بتاريخ ${importedPeTradeDate}` : ''}) مع بقاء الاعتماد على المصدر المحسوب داخلياً.`;
      } else {
        peDetails = `مضاعف P/E المحسوب من السعر السوقي وربحية الأسهم العادية المعتمدة (EPS_TTM) موجب (${computedCommonPe.toFixed(2)}x).`;
      }
    } else if (attestedCommonEps === 0) {
      peStatus = 'fail';
      peActual = importedRefTag
        ? `محسوب: غير معرّف (EPS_TTM = 0) | ${importedRefTag}`
        : 'محسوب: غير معرّف (EPS_TTM = 0)';
      peDetails = [
        'ربحية السهم العادي المعتمدة (EPS_TTM) تساوي صفراً (0)، ما يمنع احتساب مضاعف P/E موجب.',
        importedRefFootnote,
      ]
        .filter(Boolean)
        .join(' ');
    } else {
      peStatus = 'fail';
      const negPeStr = computedCommonPe !== null ? `${computedCommonPe.toFixed(2)}x` : 'سالب';
      peActual = importedRefTag
        ? `محسوب (EPS معتمد): ${negPeStr} | ${importedRefTag}`
        : `محسوب (EPS معتمد): ${negPeStr}`;
      peDetails = [
        `مضاعف P/E المحسوب من ربحية الأسهم العادية المعتمدة سالب فعلياً (${negPeStr}) لأن EPS_TTM سالبة، وهو يخالف الشرط (PE > 0).`,
        importedRefFootnote,
      ]
        .filter(Boolean)
        .join(' ');
    }
  } else {
    // غياب EPS المعتمد أو السعر الصالح -> غير مكتمل دائماً، حتى لو وُجد peRatio مستورد موجب!
    peStatus = 'incomplete';
    let baseActual: string;
    let baseDetails: string;

    if (attestedCommonEps === null && peConsolidatedRef !== null) {
      baseActual = `محسوب: غير موثّق (الموحّد المرجعي ${peConsolidatedRef.toFixed(2)}x)`;
      baseDetails = `مضاعف P/E المبني على الأسهم العادية غير مكتمل لغياب توثيق NetIncomeCommon_YTD/Basis داخل التطبيق (الموحّد المرجعي ${peConsolidatedRef.toFixed(2)}x للعرض فقط ولا يثبت ربحية الأسهم العادية ولا يعني أن الربحية سالبة).`;
    } else if (attestedCommonEps === null && resolvedDailyPrice.price === null) {
      baseActual = 'محسوب: BLANK';
      baseDetails =
        'تعذر احتساب مضاعف P/E المبني على الأسهم العادية لغياب السعر السوقي الصالح ونقص توثيق EPS_TTM للأسهم العادية داخل التطبيق؛ لا يعني ذلك أن الربحية سالبة.';
    } else if (attestedCommonEps === null) {
      baseActual = 'محسوب: BLANK (EPS معتمد غير متاح)';
      baseDetails =
        'تعذر احتساب مضاعف P/E المبني على الأسهم العادية لغياب توثيق NetIncomeCommon / EPS_TTM داخل التطبيق؛ ولا يعني ذلك أن الربحية سالبة.';
    } else {
      baseActual = 'محسوب: BLANK (السعر غير متاح)';
      baseDetails =
        'تعذر احتساب مضاعف P/E المبني على الأسهم العادية لغياب سعر تداول صالح؛ تعذر تقييم الشرط رغم توفر EPS_TTM المعتمدة.';
    }

    peActual = importedRefTag ? `${baseActual} | ${importedRefTag}` : baseActual;
    peDetails = [baseDetails, importedRefFootnote].filter(Boolean).join(' ');
  }

  checks.push({
    id: 'pe_ratio_positive',
    name: 'PE_Ratio > 0',
    category: 'التقييم',
    order: 7,
    status: peStatus,
    actualValue: peActual,
    expectedRule: '[PE_Ratio_Common] > 0',
    detailsAr: peDetails,
  });

  // 8. DCF_Price > 0 (البعد: التقييم)
  let dcfStatus: HealthCheckStatus;
  let dcfActual: string;
  let dcfDetails: string;
  if (isFinancialSector) {
    dcfStatus = 'not_applicable';
    dcfActual = 'غير منطبق (قطاع مالي)';
    dcfDetails =
      dcfModelStatus?.reasonAr ||
      'نموذج DCF غير منطبق ومستبعد للبنوك والقطاع المالي وفق سياسة التقييم.';
  } else if (engineOutputs.dcfValue === null) {
    dcfStatus = 'incomplete';
    dcfActual = 'BLANK';
    dcfDetails = dcfModelStatus?.reasonAr
      ? `نموذج DCF غير متاح لعدم اكتمال المدخلات أو شروط الاحتساب: ${dcfModelStatus.reasonAr}`
      : 'قيمة DCF غير متاحة لعدم اكتمال مدخلات FCFF أو WACC؛ تعذر تقييم الشرط ولا يعني ذلك أن القيمة سالبة.';
  } else if (engineOutputs.dcfValue > 0) {
    dcfStatus = 'pass';
    dcfActual = `${engineOutputs.dcfValue.toFixed(2)} ج.م`;
    dcfDetails =
      'نموذج التدفقات النقدية المخصومة أنتج قيمة عادلة موجبة وفق الافتراضات المدخلة.';
  } else if (engineOutputs.dcfValue === 0) {
    dcfStatus = 'fail';
    dcfActual = '0.00 ج.م';
    dcfDetails =
      'القيمة العادلة المحسوبة من DCF تساوي صفراً (0)، وهي لا تحقق شرط الإيجابية الصارم (DCF > 0).';
  } else {
    dcfStatus = 'fail';
    dcfActual = `${engineOutputs.dcfValue.toFixed(2)} ج.م`;
    dcfDetails =
      'القيمة العادلة المحسوبة من DCF سالبة فعلياً، مما يعكس تفوق صافي الدين أو سلبية التدفقات النقدية المخصومة.';
  }
  checks.push({
    id: 'dcf_price_positive',
    name: 'DCF_Price > 0',
    category: 'التقييم',
    order: 8,
    status: dcfStatus,
    actualValue: dcfActual,
    expectedRule: '[DCF_Intrinsic_Price] > 0',
    detailsAr: dcfDetails,
  });

  // 9. بيانات يومية نظيفة (البعد: الاكتمال)
  const rawDailyPrice =
    dailyRecord?.lastPrice !== null && dailyRecord?.lastPrice !== undefined
      ? dailyRecord.lastPrice
      : dailyRecord?.closePrice !== null && dailyRecord?.closePrice !== undefined
      ? dailyRecord.closePrice
      : null;

  let dailyStatus: HealthCheckStatus;
  let dailyActual: string;
  let dailyDetails: string;
  if (!dailyRecord) {
    dailyStatus = 'incomplete';
    dailyActual = 'BLANK (لا يوجد سجل تداول يومي)';
    dailyDetails =
      'لا يوجد سجل تداول يومي محمّل لهذا السهم؛ يرجى استيراد ملف التداول اليومي عبر مركز إدارة البيانات (Data Hub).';
  } else if (resolvedDailyPrice.price !== null) {
    dailyStatus = 'pass';
    dailyActual = `تاريخ السجل: ${dailyRecord.tradeDate} (سعر ${resolvedDailyPrice.source === 'closePrice' ? 'إقفال' : 'آخر'}: ${resolvedDailyPrice.price.toFixed(2)} ج.م)`;
    dailyDetails =
      'يتوفر سجل تداول يومي محمّل بسعر صالح موجب لتاريخ التداول المبيّن؛ ولا يثبت ذلك بذاته حداثة البيانات أو مطابقتها الخارجية مع شاشة البورصة دون تحقق مستقل.';
  } else if (rawDailyPrice !== null && rawDailyPrice <= 0) {
    dailyStatus = 'fail';
    dailyActual = `${rawDailyPrice.toFixed(2)} ج.م`;
    dailyDetails =
      rawDailyPrice === 0
        ? 'سعر التداول المسجل في السجل اليومي يساوي صفراً (0)، وهو يخالف شرط السعر الموجب (> 0).'
        : 'سعر التداول المسجل في السجل اليومي سالب، وهو يخالف شرط السعر الموجب (> 0).';
  } else {
    dailyStatus = 'incomplete';
    dailyActual = 'BLANK (السعر غير مسجل)';
    dailyDetails =
      'سجل التداول اليومي موجود لكنه يفتقر إلى سعر إقفال أو آخر سعر صالح؛ يرجى استكمال بيانات السعر.';
  }
  checks.push({
    id: 'clean_daily_data',
    name: 'بيانات يومية نظيفة',
    category: 'الاكتمال',
    order: 9,
    status: dailyStatus,
    actualValue: dailyActual,
    expectedRule: 'وجود سجل تداول يومي محمّل بسعر صالح (آخر أو إقفال اليوم > 0)',
    detailsAr: dailyDetails,
  });

  return checks;
}
