/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuditedMetricItem,
  CommonEquityBasis,
  Company,
  EpsPeriodKind,
  EpsSelectionPolicySummary,
  MetricAuditBundle,
  MissingAccountingEpsFieldItem,
  MissingCommonFieldItem,
  NetIncomeCommonBasis,
  QuarterlyFinancial,
  ReportedVsAccountingEpsComparison,
} from '../../types/financial';
import { DailyTradingRecord } from '../../types';
import {
  AccountingPeriodTarget,
  classifyLegacyReportedEpsPeriod,
  evaluateReportedEpsPeriodAlignment,
  ReportedEpsFiscalQuarter,
  ReportedEpsPeriodType,
  resolveCanonicalReportedEpsPeriod,
} from '../contracts';
import {
  evaluateAccountingEpsEligibility,
  evaluateAccountingEpsTtmEligibility,
  evaluatePeriodSharesBasisEligibility,
  resolveQuarterlyPeriodDays,
} from './accountingEpsEligibility';

const QUARTER_ORDER: Record<string, number> = {
  Q1: 1,
  Q2: 2,
  Q3: 3,
  FY: 4,
};

export const REPORTED_VS_ACCOUNTING_EPS_TOLERANCE = 0.01;

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const fmtNum = (val: number | null, digits = 2, suffix = ''): string => {
  if (val === null || !Number.isFinite(val)) return 'غير متاح';
  return `${val.toFixed(digits)}${suffix ? ` ${suffix}` : ''}`;
};

const fmtPct = (val: number | null, digits = 2): string => {
  if (val === null || !Number.isFinite(val)) return 'غير متاح';
  return `${(val * 100).toFixed(digits)}%`;
};

export function resolveRecordPeriodDays(
  rec: Pick<QuarterlyFinancial, 'year' | 'quarter' | 'periodStartDate' | 'periodEndDate' | 'periodDays'>
): {
  days: number | null;
  source: 'dates' | 'period_days' | 'missing';
  hasDates: boolean;
  reasonAr: string | null;
} {
  const resolved = resolveQuarterlyPeriodDays(rec);
  return {
    days: resolved.days,
    source: resolved.source,
    hasDates: resolved.hasDates,
    reasonAr: resolved.reasonAr,
  };
}

export function resolvePeriodCommonNetIncome(
  rec: Pick<QuarterlyFinancial, 'year' | 'quarter' | 'netProfitYTD' | 'netIncomeCommonYTD' | 'netIncomeCommonBasis'>
): {
  value: number | null;
  basis: NetIncomeCommonBasis | 'unavailable';
  unavailableReasonAr: string | null;
} {
  if (isFiniteNum(rec.netIncomeCommonYTD)) {
    return {
      value: rec.netIncomeCommonYTD,
      basis: 'explicit_common',
      unavailableReasonAr: null,
    };
  }
  if (
    rec.netIncomeCommonBasis === 'attested_net_income_equals_common' &&
    isFiniteNum(rec.netProfitYTD)
  ) {
    return {
      value: rec.netProfitYTD,
      basis: 'attested_net_income_equals_common',
      unavailableReasonAr: null,
    };
  }
  if (isFiniteNum(rec.netProfitYTD)) {
    return {
      value: null,
      basis: 'unavailable',
      unavailableReasonAr: `الفترة ${rec.quarter} ${rec.year} تفتقد صافي ربح المساهمين العاديين (NetIncomeCommon_YTD) أو إقرار تطابقه مع صافي الربح (attested_net_income_equals_common).`,
    };
  }
  return {
    value: null,
    basis: 'unavailable',
    unavailableReasonAr: `صافي الربح وصافي ربح المساهمين العاديين للفترة ${rec.quarter} ${rec.year} غير متاحين.`,
  };
}

export function resolvePeriodCommonEquity(
  rec: Pick<QuarterlyFinancial, 'year' | 'quarter' | 'totalEquity' | 'commonEquity' | 'commonEquityBasis'>
): {
  value: number | null;
  basis: CommonEquityBasis | 'unavailable';
  unavailableReasonAr: string | null;
} {
  if (isFiniteNum(rec.commonEquity)) {
    return {
      value: rec.commonEquity,
      basis: 'explicit_common',
      unavailableReasonAr: null,
    };
  }
  if (
    rec.commonEquityBasis === 'attested_total_equals_common' &&
    isFiniteNum(rec.totalEquity)
  ) {
    return {
      value: rec.totalEquity,
      basis: 'attested_total_equals_common',
      unavailableReasonAr: null,
    };
  }
  if (isFiniteNum(rec.totalEquity)) {
    return {
      value: null,
      basis: 'unavailable',
      unavailableReasonAr: `الفترة ${rec.quarter} ${rec.year} تفتقد فصل حقوق المساهمين العاديين (EquityCommon) أو إقرار تطابق إجمالي حقوق الملكية معها.`,
    };
  }
  return {
    value: null,
    basis: 'unavailable',
    unavailableReasonAr: `حقوق الملكية للفترة ${rec.quarter} ${rec.year} غير متاحة.`,
  };
}

function mapReportedPeriodTypeToEpsKind(
  periodType: ReportedEpsPeriodType | null
): EpsPeriodKind {
  switch (periodType) {
    case 'standalone_quarter':
      return 'standalone_quarter';
    case 'ytd':
      return 'YTD';
    case 'fy':
      return 'FY';
    case 'ttm':
      return 'TTM';
    case 'needs_review':
      return 'needs_review';
    default:
      return 'unknown';
  }
}

export function parseReportedEpsPeriodMeta(rawPeriod: string | null | undefined): {
  kind: EpsPeriodKind;
  periodType: ReportedEpsPeriodType | null;
  year: number | null;
  quarterToken: ReportedEpsFiscalQuarter | 'FY' | null;
  needsReview: boolean;
} {
  const clean = typeof rawPeriod === 'string' ? rawPeriod.trim() : '';
  if (!clean) {
    return {
      kind: 'unknown',
      periodType: null,
      year: null,
      quarterToken: null,
      needsReview: false,
    };
  }

  const classified = classifyLegacyReportedEpsPeriod(clean, null);
  const upper = clean.toUpperCase();
  const yearMatch = upper.match(/\b(19\d{2}|20\d{2}|21\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const qMatch = upper.match(/\b(Q[1-4])\b/);
  const parsedQuarter = qMatch ? (qMatch[1] as ReportedEpsFiscalQuarter) : null;

  if (classified.detectedIntent === 'standalone_quarter') {
    return {
      kind: 'standalone_quarter',
      periodType: 'standalone_quarter',
      year,
      quarterToken: parsedQuarter,
      needsReview: true,
    };
  }
  if (classified.detectedIntent === 'ytd') {
    const inferredQ =
      parsedQuarter && parsedQuarter !== 'Q4'
        ? parsedQuarter
        : /\b6M\b|\bH1\b/.test(upper)
        ? 'Q2'
        : /\b9M\b/.test(upper)
        ? 'Q3'
        : null;
    return {
      kind: 'YTD',
      periodType: 'ytd',
      year,
      quarterToken: inferredQ,
      needsReview: true,
    };
  }
  if (classified.detectedIntent === 'fy') {
    return {
      kind: 'FY',
      periodType: 'fy',
      year,
      quarterToken: 'FY',
      needsReview: true,
    };
  }
  if (classified.detectedIntent === 'ttm') {
    return {
      kind: 'TTM',
      periodType: 'ttm',
      year,
      quarterToken: null,
      needsReview: true,
    };
  }

  return {
    kind: 'needs_review',
    periodType: 'needs_review',
    year,
    quarterToken: null,
    needsReview: true,
  };
}

function checkCapitalActionCompatibility(periods: QuarterlyFinancial[]): {
  compatible: boolean;
  adjustedFlag: boolean | null;
  reasonAr: string | null;
} {
  const explicitFlags = periods
    .map((p) => p.isCapitalActionAdjusted)
    .filter((v): v is boolean => v === true || v === false);

  if (explicitFlags.includes(true) && explicitFlags.includes(false)) {
    return {
      compatible: false,
      adjustedFlag: null,
      reasonAr:
        'تضارب في حقل IsCapitalActionAdjusted عبر الفترات المكونة لـ TTM (خلط فترات معدلة رأسمالياً بأخرى غير معدلة).',
    };
  }
  if (explicitFlags.length === periods.length && periods.length > 0) {
    return { compatible: true, adjustedFlag: explicitFlags[0], reasonAr: null };
  }
  if (explicitFlags.length > 0) {
    return { compatible: true, adjustedFlag: explicitFlags[0], reasonAr: null };
  }
  return { compatible: true, adjustedFlag: null, reasonAr: null };
}

export function resolveMetricAuditBundle(params: {
  company: Company;
  financials: QuarterlyFinancial[];
  latestDaily?: DailyTradingRecord;
  netIncomeTTM: number | null;
  finCurrencyAllowed: boolean;
  currencySuffix?: string;
}): MetricAuditBundle {
  const { company, financials, latestDaily, netIncomeTTM, finCurrencyAllowed, currencySuffix = '' } = params;

  const sorted = [...financials]
    .filter((f) => f.companyId === company.id)
    .sort((a, b) => a.year - b.year || (QUARTER_ORDER[a.quarter] || 0) - (QUARTER_ORDER[b.quarter] || 0));

  const latest = sorted[sorted.length - 1] ?? null;
  const previousFY = latest
    ? sorted.find((f) => f.year === latest.year - 1 && f.quarter === 'FY') ?? null
    : null;
  const previousComparable = latest
    ? sorted.find((f) => f.year === latest.year - 1 && f.quarter === latest.quarter) ?? null
    : null;

  const latestPeriod = latest ? `${latest.quarter} ${latest.year}` : null;

  // 1. Share Count Alignment Audit (Quarterly Balance Sheet EOP vs Daily Listed Shares vs Analytical Effective)
  const latestQuarterlySharesRec = [...sorted]
    .reverse()
    .find((r) => isFiniteNum(r.sharesCount) && r.sharesCount > 0) ?? null;
  const quarterlyEopShares = latestQuarterlySharesRec?.sharesCount ?? null;
  const quarterlyEopSharesPeriod = latestQuarterlySharesRec
    ? `${latestQuarterlySharesRec.quarter} ${latestQuarterlySharesRec.year}`
    : null;
  const dailyListedShares =
    latestDaily && isFiniteNum(latestDaily.listedShares) && latestDaily.listedShares > 0
      ? latestDaily.listedShares
      : null;
  const dailyListedSharesDate = latestDaily?.tradeDate ?? null;

  const effectiveAnalyticalShares =
    isFiniteNum(company.sharesOutstanding) && company.sharesOutstanding > 0
      ? company.sharesOutstanding
      : null;
  const effectiveAnalyticalSharesSource: MetricAuditBundle['effectiveAnalyticalSharesSource'] =
    company.sharesSource ??
    (quarterlyEopShares !== null
      ? 'quarterly_record'
      : effectiveAnalyticalShares !== null
      ? dailyListedShares !== null
        ? 'daily_listed_shares'
        : 'company_metadata'
      : 'missing');

  let sharesAlignmentStatus: MetricAuditBundle['sharesAlignmentStatus'] = 'unavailable';
  let sharesAlignmentNoteAr: string | null = null;
  if (quarterlyEopShares !== null && dailyListedShares !== null) {
    const relDiff = Math.abs(quarterlyEopShares - dailyListedShares) / Math.max(quarterlyEopShares, dailyListedShares);
    if (relDiff > 0.005) {
      sharesAlignmentStatus = 'cross_source_mismatch';
      sharesAlignmentNoteAr = `اختلاف بين أسهم نهاية الفترة الفصلية (${quarterlyEopShares.toLocaleString('en-US')} في ${quarterlyEopSharesPeriod}) والأسهم المدرجة يومياً (${dailyListedShares.toLocaleString('en-US')} في ${dailyListedSharesDate ?? '-'}) بنسبة ${(relDiff * 100).toFixed(2)}% — قد يعكس اختلاف تاريخ أو تعديل رأس مال.`;
    } else {
      sharesAlignmentStatus = 'aligned';
      sharesAlignmentNoteAr = `أسهم نهاية الفترة الفصلية (${quarterlyEopSharesPeriod}) متطابقة مع الأسهم المدرجة يومياً.`;
    }
  } else if (effectiveAnalyticalShares !== null) {
    sharesAlignmentStatus = 'aligned';
    sharesAlignmentNoteAr =
      effectiveAnalyticalSharesSource === 'quarterly_record'
        ? `الأسهم مأخوذة من قائمة المركز المالي في نهاية الفترة (${quarterlyEopSharesPeriod ?? latestPeriod ?? '-'}).`
        : effectiveAnalyticalSharesSource === 'daily_listed_shares'
        ? `تعتمد الأسهم على الأسهم المدرجة بالتداول اليومي (${dailyListedSharesDate ?? '-'}) لغياب حقل Shares الفصلي.`
        : 'الأسهم مأخوذة من بيانات الشركة الوصفية.';
  } else {
    sharesAlignmentStatus = 'unavailable';
    sharesAlignmentNoteAr = 'عدد الأسهم في نهاية الفترة غير متاح.';
  }

  // 2. NetIncomeCommon (Latest Period + TTM)
  const commonLatestRes = latest
    ? resolvePeriodCommonNetIncome(latest)
    : { value: null, basis: 'unavailable' as const, unavailableReasonAr: 'لا توجد سجلات مالية فصلية.' };

  let netIncomeCommonTTM: number | null = null;
  let netIncomeCommonTtmBasis: MetricAuditBundle['netIncomeCommonTtmBasis'] = 'unavailable';
  let netIncomeCommonTtmUnavailableReasonAr: string | null = null;

  if (!finCurrencyAllowed) {
    netIncomeCommonTtmUnavailableReasonAr = 'عملة القوائم المالية غير مدعومة أو متضاربة.';
  } else if (!latest) {
    netIncomeCommonTtmUnavailableReasonAr = 'لا توجد سجلات مالية فصلية.';
  } else if (latest.quarter === 'FY') {
    if (commonLatestRes.value !== null && commonLatestRes.basis !== 'unavailable') {
      netIncomeCommonTTM = commonLatestRes.value;
      netIncomeCommonTtmBasis = commonLatestRes.basis;
    } else {
      netIncomeCommonTtmUnavailableReasonAr = commonLatestRes.unavailableReasonAr;
    }
  } else if (!previousFY || !previousComparable) {
    netIncomeCommonTtmUnavailableReasonAr = `يتعذر حساب NetIncomeCommon_TTM لأن الفترة المقارنة (${!previousFY ? `FY ${latest.year - 1}` : ''}${!previousFY && !previousComparable ? ' و' : ''}${!previousComparable ? `${latest.quarter} ${latest.year - 1}` : ''}) غير متوفرة.`;
  } else {
    const capCheck = checkCapitalActionCompatibility([latest, previousFY, previousComparable]);
    const rCurr = resolvePeriodCommonNetIncome(latest);
    const rFy = resolvePeriodCommonNetIncome(previousFY);
    const rComp = resolvePeriodCommonNetIncome(previousComparable);
    if (!capCheck.compatible) {
      netIncomeCommonTtmUnavailableReasonAr = capCheck.reasonAr;
    } else if (rCurr.value === null || rFy.value === null || rComp.value === null) {
      netIncomeCommonTtmUnavailableReasonAr =
        rCurr.unavailableReasonAr || rFy.unavailableReasonAr || rComp.unavailableReasonAr;
    } else {
      netIncomeCommonTTM = rCurr.value + rFy.value - rComp.value;
      const bases = new Set([rCurr.basis, rFy.basis, rComp.basis]);
      netIncomeCommonTtmBasis =
        bases.size === 1
          ? (rCurr.basis as NetIncomeCommonBasis)
          : 'mixed_common';
    }
  }

  // 3. Common Equity vs Total Equity
  const totalEquityLatest = latest && isFiniteNum(latest.totalEquity) ? latest.totalEquity : null;
  const commonEqLatestRes = latest
    ? resolvePeriodCommonEquity(latest)
    : { value: null, basis: 'unavailable' as const, unavailableReasonAr: 'لا توجد سجلات مالية فصلية.' };

  const equityBasisForValuation: MetricAuditBundle['equityBasisForValuation'] =
    commonEqLatestRes.basis !== 'unavailable' && commonEqLatestRes.value !== null
      ? commonEqLatestRes.basis
      : totalEquityLatest !== null
      ? 'total_equity_unattested'
      : 'unavailable';

  // 4. ReportedEPS (Resolved strictly via central ReportedEPS period contract)
  const reportedEpsVal = latest && isFiniteNum(latest.reportedEps) ? latest.reportedEps : null;
  const reportedPeriodResolution = latest
    ? resolveCanonicalReportedEpsPeriod({
        reportedEps: latest.reportedEps,
        reportedEpsPeriodType: latest.reportedEpsPeriodType,
        reportedEpsFiscalYear: latest.reportedEpsFiscalYear,
        reportedEpsFiscalQuarter: latest.reportedEpsFiscalQuarter,
        reportedEpsPeriodStart: latest.reportedEpsPeriodStart,
        reportedEpsPeriodEnd: latest.reportedEpsPeriodEnd,
        reportedEpsPeriod: latest.reportedEpsPeriod,
        year: latest.year,
        quarter: latest.quarter,
        periodStartDate: latest.periodStartDate,
        periodEndDate: latest.periodEndDate,
      })
    : resolveCanonicalReportedEpsPeriod({});

  const reportedPeriodDisplay =
    reportedPeriodResolution.displayLabel ?? latest?.reportedEpsPeriod ?? null;
  const reportedPeriodKind = mapReportedPeriodTypeToEpsKind(
    reportedPeriodResolution.periodType
  );
  const reportedEpsNotes: string[] = [];
  if (reportedPeriodResolution.periodType === 'standalone_quarter') {
    reportedEpsNotes.push(
      `القيمة تمثل ربعاً مالياً منفرداً (${reportedPeriodDisplay}) ولا تُقارن بالأرقام التراكمية YTD أو السنوية FY إلا في Q1 عند تطابق حدود التواريخ الموثقة دون تغيير تصنيفها.`
    );
  } else if (reportedPeriodResolution.periodType === 'ytd') {
    reportedEpsNotes.push(
      `القيمة تعبر عن فترة تراكمية مرحلية (${reportedPeriodDisplay}) ولا يجوز نسبها تلقائياً إلى TTM.`
    );
  } else if (reportedEpsVal !== null && reportedPeriodResolution.status !== 'valid') {
    reportedEpsNotes.push(
      reportedPeriodResolution.reasonAr ||
        'فترة ReportedEPS غير موثقة بالكامل وتحتاج مراجعة لتفعيل مطابقة AccountingEPS.'
    );
  }
  if (reportedEpsVal !== null && reportedEpsVal < 0) {
    reportedEpsNotes.push('قيمة EPS المعلنة سالبة (خسارة للسهم) وتُحفظ كما هي دون استبدال بالصفر.');
  }

  const reportedEpsItem: AuditedMetricItem = {
    key: 'reportedEps',
    nameAr: 'ربحية السهم المعلنة (ReportedEPS)',
    value: finCurrencyAllowed ? reportedEpsVal : null,
    formattedValue: finCurrencyAllowed && reportedEpsVal !== null ? fmtNum(reportedEpsVal, 2, currencySuffix) : 'غير متاح',
    equationAr: 'قيمة مرجعية مأخوذة نصاً من القوائم المالية دون جمع أو تحويل أو سنونة',
    numeratorLabelAr: 'القيمة المعلنة بالقوائم',
    numeratorValue: reportedEpsVal,
    denominatorLabelAr: 'حسب أساس الإفصاح بالقائمة',
    denominatorValue: null,
    basisCode:
      reportedEpsVal === null
        ? 'unavailable'
        : reportedPeriodResolution.status === 'valid'
        ? `reported_statement_eps_${reportedPeriodResolution.periodType}`
        : 'reported_statement_eps_needs_review',
    basisLabelAr:
      reportedEpsVal !== null
        ? `معلنة لفترة (${reportedPeriodDisplay || 'غير محددة / يحتاج مراجعة'}) — مصدر: ${latest?.reportedEpsSource || 'غير موثق'}`
        : 'غير مسجلة في أحدث قائمة مالية',
    periodLabel: reportedPeriodDisplay,
    periodKind: reportedPeriodKind,
    completenessStatus:
      reportedEpsVal === null
        ? 'unavailable'
        : reportedPeriodResolution.status === 'valid'
        ? 'complete'
        : 'partial',
    isActionAdjusted: latest?.isCapitalActionAdjusted ?? null,
    usedByModels: ['مرجعية تدقيقية ومقارنة مع AccountingEPS فقط (لا يُفترض كـ TTM تلقائياً)'],
    notesAr: reportedEpsNotes,
    unavailableReasonAr:
      !finCurrencyAllowed
        ? 'عملة القوائم المالية غير مدعومة أو متضاربة.'
        : reportedEpsVal === null
        ? 'لم يُسجل حقل ReportedEPS في أحدث فترة مالية.'
        : null,
  };

  // 5. AccountingEPS (Latest Single Period YTD / FY) — Resolved via centralized eligibility decision
  const latestDaysInfo = latest ? resolveRecordPeriodDays(latest) : null;
  const sameYearRecordsForLatest = latest
    ? sorted.filter((f) => f.year === latest.year && f.quarter !== latest.quarter)
    : [];
  const accountingEpsLatestEligibility = evaluateAccountingEpsEligibility({
    finCurrencyAllowed,
    record: latest,
    commonNetIncome: commonLatestRes,
    previousFY,
    sameYearRecords: sameYearRecordsForLatest,
  });

  const accountingEpsLatestItem: AuditedMetricItem = {
    key: 'accountingEpsLatest',
    nameAr: `ربحية السهم المحاسبية للفترة (${latestPeriod ?? '-'})`,
    value: accountingEpsLatestEligibility.accountingEpsValue,
    formattedValue: fmtNum(accountingEpsLatestEligibility.accountingEpsValue, 2, currencySuffix),
    equationAr: 'NetIncomeCommon_Period ÷ WeightedAvgShares_YTD',
    numeratorLabelAr: 'صافي ربح المساهمين العاديين للفترة',
    numeratorValue: accountingEpsLatestEligibility.numeratorValue,
    denominatorLabelAr: accountingEpsLatestEligibility.usedQ1DocumentedEquivalence
      ? 'المتوسط المرجح للأسهم (تكافؤ Q1 موثق — الأصل: standalone_quarter)'
      : 'المتوسط المرجح للأسهم التراكمي / السنوي (ytd_weighted_avg)',
    denominatorValue: accountingEpsLatestEligibility.denominatorValue,
    basisCode: accountingEpsLatestEligibility.eligible
      ? accountingEpsLatestEligibility.usedQ1DocumentedEquivalence
        ? `${commonLatestRes.basis}__q1_standalone_equivalent_to_ytd`
        : commonLatestRes.basis
      : 'unavailable',
    basisLabelAr: accountingEpsLatestEligibility.eligible
      ? accountingEpsLatestEligibility.usedQ1DocumentedEquivalence
        ? `محسوبة على الأساس المحاسبي (${commonLatestRes.basis}) ÷ WeightedAvgShares_YTD بتكافؤ Q1 موثق (الأساس الأصلي المحفوظ: standalone_quarter ← الفعلي: q1_standalone_equivalent_to_ytd) للفترة ${latestPeriod}`
        : `محسوبة على الأساس المحاسبي (${commonLatestRes.basis}) ÷ WeightedAvgShares_YTD الموثق (ytd_weighted_avg) للفترة ${latestPeriod}`
      : 'غير مكتملة المدخلات أو محجوبة وفق قرار أهلية AccountingEPS المركزي',
    periodLabel: latestPeriod,
    periodKind: latest?.quarter === 'FY' ? 'FY' : latest ? 'YTD' : 'unknown',
    completenessStatus: accountingEpsLatestEligibility.eligible ? 'complete' : 'unavailable',
    isActionAdjusted: accountingEpsLatestEligibility.isActionAdjusted,
    originalSharesBasis: accountingEpsLatestEligibility.originalSharesBasis,
    originalSharesBasisLabelAr: accountingEpsLatestEligibility.originalSharesBasisLabelAr,
    effectiveSharesBasis: accountingEpsLatestEligibility.effectiveSharesBasis,
    effectiveSharesBasisLabelAr: accountingEpsLatestEligibility.effectiveSharesBasisLabelAr,
    usedQ1DocumentedEquivalence: accountingEpsLatestEligibility.usedQ1DocumentedEquivalence,
    remediationAr: accountingEpsLatestEligibility.remediationAr,
    usedByModels: ['تدقيق ومطابقة ReportedEPS للفترة المماثلة'],
    notesAr: accountingEpsLatestEligibility.notesAr,
    unavailableReasonAr: accountingEpsLatestEligibility.eligible
      ? null
      : accountingEpsLatestEligibility.reasonAr,
  };

  // 6. AccountingEPS TTM — Centralized Eligibility Decision with Strict Calendar Days (360..370) & Contiguous Boundaries
  const previousPrevFY = previousComparable
    ? sorted.find((f) => f.year === previousComparable.year - 1 && f.quarter === 'FY') ?? null
    : null;
  const sameYearRecordsForPrevComp = previousComparable
    ? sorted.filter((f) => f.year === previousComparable.year && f.quarter !== previousComparable.quarter)
    : [];
  const ttmCapCheck =
    latest && previousFY && previousComparable
      ? checkCapitalActionCompatibility([latest, previousFY, previousComparable])
      : { compatible: true, adjustedFlag: latest?.isCapitalActionAdjusted ?? null, reasonAr: null };

  const accountingEpsTtmEligibility = evaluateAccountingEpsTtmEligibility({
    finCurrencyAllowed,
    latest,
    previousFY,
    previousComparable,
    previousPrevFY,
    sameYearRecordsForLatest,
    sameYearRecordsForPrevComp,
    netIncomeCommonTTM,
    netIncomeCommonTtmBasis,
    netIncomeCommonTtmUnavailableReasonAr,
    latestPeriodDecision: accountingEpsLatestEligibility,
    capitalActionCheck: ttmCapCheck,
  });

  const accountingTtmPeriodStart = accountingEpsTtmEligibility.periodStartDate;
  const accountingTtmPeriodEnd = accountingEpsTtmEligibility.periodEndDate;

  const accountingEpsTtmItem: AuditedMetricItem = {
    key: 'accountingEpsTTM',
    nameAr: 'ربحية السهم المحاسبية آخر 12 شهراً (AccountingEPS TTM)',
    value: accountingEpsTtmEligibility.accountingEpsValue,
    formattedValue: fmtNum(accountingEpsTtmEligibility.accountingEpsValue, 2, currencySuffix),
    equationAr: 'NetIncomeCommon_TTM ÷ WeightedAvgShares_12M_CalendarWeighted',
    numeratorLabelAr: 'صافي ربح المساهمين العاديين TTM',
    numeratorValue: accountingEpsTtmEligibility.numeratorValue,
    denominatorLabelAr: accountingEpsTtmEligibility.usedQ1DocumentedEquivalence
      ? 'المتوسط المرجح بالأيام الفعلية (يتضمن تكافؤ Q1 موثق)'
      : 'المتوسط المرجح بالأيام الفعلية (ytd_weighted_avg)',
    denominatorValue: accountingEpsTtmEligibility.denominatorValue,
    basisCode: accountingEpsTtmEligibility.eligible
      ? accountingEpsTtmEligibility.usedQ1DocumentedEquivalence
        ? 'accounting_ttm_weighted_shares_q1_equiv'
        : 'accounting_ttm_weighted_shares'
      : 'unavailable',
    basisLabelAr: accountingEpsTtmEligibility.eligible
      ? accountingEpsTtmEligibility.usedQ1DocumentedEquivalence
        ? `TTM محاسبي (${netIncomeCommonTtmBasis}) ÷ متوسط مرجح بالأيام التقويمية الفعلية (بمشاركة تكافؤ Q1 موثق دون تغيير الرمز المحفوظ)`
        : `TTM محاسبي (${netIncomeCommonTtmBasis}) ÷ متوسط مرجح بالأيام التقويمية الفعلية`
      : 'غير متاح أو محجوب وفق قرار أهلية AccountingEPS TTM المركزي',
    periodLabel: accountingEpsTtmEligibility.periodLabel,
    periodKind: 'TTM',
    completenessStatus: accountingEpsTtmEligibility.eligible ? 'complete' : 'unavailable',
    isActionAdjusted: accountingEpsTtmEligibility.isActionAdjusted,
    originalSharesBasis: accountingEpsTtmEligibility.originalSharesBasis,
    originalSharesBasisLabelAr: accountingEpsTtmEligibility.originalSharesBasisLabelAr,
    effectiveSharesBasis: accountingEpsTtmEligibility.effectiveSharesBasis,
    effectiveSharesBasisLabelAr: accountingEpsTtmEligibility.effectiveSharesBasisLabelAr,
    usedQ1DocumentedEquivalence: accountingEpsTtmEligibility.usedQ1DocumentedEquivalence,
    remediationAr: accountingEpsTtmEligibility.remediationAr,
    usedByModels: ['مقياس GAAP/IAS 33 التدقيقي المنفصل عن EPS التقييمي'],
    notesAr: accountingEpsTtmEligibility.notesAr,
    unavailableReasonAr: accountingEpsTtmEligibility.eligible
      ? null
      : accountingEpsTtmEligibility.reasonAr,
  };

  // 7A. Analytical Consolidated EPS TTM (Reference Only — NEVER feeds Target_PE / Graham / Valuation P/E)
  const analyticalEpsVal =
    finCurrencyAllowed && netIncomeTTM !== null && effectiveAnalyticalShares !== null
      ? netIncomeTTM / effectiveAnalyticalShares
      : null;

  const analyticalNotes: string[] = [
    'مرجعية تحليلية على صافي الربح الموحّد (قبل فصل حقوق الأقلية إن وجدت) ÷ أسهم نهاية الفترة؛ لا يدخل تلقائياً في Target_PE أو جراهام أو P/E التقييمي.',
  ];
  if (netIncomeCommonTTM !== null && netIncomeTTM !== null && Math.abs(netIncomeCommonTTM - netIncomeTTM) > 1e-6) {
    analyticalNotes.push(
      `فارق حقوق أقلية: صافي الربح الموحد TTM (${netIncomeTTM.toLocaleString('en-US')}) يختلف عن صافي ربح العاديين TTM (${netIncomeCommonTTM.toLocaleString('en-US')}).`
    );
  }

  const analyticalEpsItem: AuditedMetricItem = {
    key: 'analyticalEpsTTM',
    nameAr: 'ربحية السهم الموحّدة (مرجعية فقط — Consolidated Ref)',
    value: analyticalEpsVal,
    formattedValue: fmtNum(analyticalEpsVal, 2, currencySuffix),
    equationAr: 'NetIncome_Consolidated_TTM ÷ Current_EOP_Shares',
    numeratorLabelAr: 'صافي الربح الموحّد TTM (مرجعي)',
    numeratorValue: netIncomeTTM,
    denominatorLabelAr: 'أسهم نهاية الفترة الحالية',
    denominatorValue: effectiveAnalyticalShares,
    basisCode: analyticalEpsVal !== null ? 'analytical_net_income_eop_shares' : 'unavailable',
    basisLabelAr: 'ربحية موحّدة مرجعية فقط (غير مفصولة عن حقوق الأقلية ما لم يُوثّق NetIncomeCommon)',
    periodLabel: latestPeriod ? `TTM حتى ${latestPeriod}` : null,
    periodKind: 'TTM',
    completenessStatus:
      analyticalEpsVal === null
        ? 'unavailable'
        : netIncomeCommonTTM !== null
        ? 'complete'
        : 'unattested',
    usedByModels: ['مرجعية تحليلية موحدة فقط (لا يدخل في Target_PE أو جراهام أو مضاعف P/E التقييمي)'],
    notesAr: analyticalNotes,
    unavailableReasonAr:
      !finCurrencyAllowed
        ? 'عملة القوائم المالية غير مدعومة أو متضاربة.'
        : netIncomeTTM === null
        ? 'صافي الربح الموحد TTM غير متاح لاكتمال فترات المقارنة.'
        : effectiveAnalyticalShares === null
        ? 'عدد الأسهم في نهاية الفترة غير متاح.'
        : null,
  };

  // 7B. Analytical Common EPS TTM & Strict Valuation EPS (SSOT for Target_PE / Graham / Market P/E)
  const analyticalCommonEpsVal =
    finCurrencyAllowed && netIncomeCommonTTM !== null && effectiveAnalyticalShares !== null
      ? netIncomeCommonTTM / effectiveAnalyticalShares
      : null;

  const analyticalCommonNotes: string[] = [
    'المقياس التقييمي المعتمد للأسهم العادية: صافي ربح المساهمين العاديين TTM الموثق ÷ أسهم نهاية الفترة الحالية.',
  ];
  if (analyticalCommonEpsVal !== null && analyticalCommonEpsVal <= 0) {
    analyticalCommonNotes.push('القيمة غير موجبة (<= 0): تُحفظ كما هي وتُستبعد من مضاعف P/E وصيغة جراهام.');
  }

  const analyticalCommonEpsItem: AuditedMetricItem = {
    key: 'analyticalCommonEpsTTM',
    nameAr: 'ربحية السهم العاديين التقييمية (Attested Common EPS TTM)',
    value: analyticalCommonEpsVal,
    formattedValue: fmtNum(analyticalCommonEpsVal, 2, currencySuffix),
    equationAr: 'NetIncomeCommon_TTM ÷ Current_EOP_Shares',
    numeratorLabelAr: 'صافي ربح المساهمين العاديين TTM الموثق',
    numeratorValue: netIncomeCommonTTM,
    denominatorLabelAr: 'أسهم نهاية الفترة الحالية',
    denominatorValue: effectiveAnalyticalShares,
    basisCode:
      analyticalCommonEpsVal !== null
        ? netIncomeCommonTtmBasis === 'explicit_common'
          ? 'analytical_common_ni_eop_shares'
          : netIncomeCommonTtmBasis
        : 'unavailable',
    basisLabelAr:
      analyticalCommonEpsVal !== null
        ? `صافي ربح المساهمين العاديين TTM (${netIncomeCommonTtmBasis}) ÷ أسهم نهاية الفترة الحالية`
        : 'محجوب: يفتقد توثيق صافي ربح المساهمين العاديين NetIncomeCommon_TTM',
    periodLabel: latestPeriod ? `TTM حتى ${latestPeriod}` : null,
    periodKind: 'TTM',
    completenessStatus:
      analyticalCommonEpsVal !== null
        ? 'complete'
        : netIncomeTTM !== null
        ? 'unattested'
        : 'unavailable',
    usedByModels:
      analyticalCommonEpsVal !== null
        ? ['التقييم النسبي (Target_PE)', 'صيغة جراهام (Graham)', 'مضاعف P/E التقييمي']
        : [],
    notesAr: analyticalCommonNotes,
    unavailableReasonAr:
      !finCurrencyAllowed
        ? 'عملة القوائم المالية غير مدعومة أو متضاربة.'
        : netIncomeCommonTTM === null
        ? netIncomeCommonTtmUnavailableReasonAr || 'صافي ربح المساهمين العاديين TTM غير موثق.'
        : effectiveAnalyticalShares === null
        ? 'عدد الأسهم في نهاية الفترة غير متاح.'
        : null,
  };

  const valuationEpsItem: AuditedMetricItem = {
    ...analyticalCommonEpsItem,
    key: 'valuationEps',
    nameAr: 'ربحية السهم المعتمدة للتقييم (Valuation EPS)',
  };

  const epsMissingFields: string[] = [];
  if (netIncomeCommonTTM === null) {
    epsMissingFields.push('NetIncomeCommon_YTD / NetIncomeCommon_Basis عبر فترات TTM');
  }
  if (effectiveAnalyticalShares === null) {
    epsMissingFields.push('Shares (أسهم نهاية الفترة)');
  }

  const epsPolicyReasonAr =
    analyticalCommonEpsVal !== null
      ? `معتمد من صافي ربح المساهمين العاديين TTM (${netIncomeCommonTtmBasis}) ÷ أسهم نهاية الفترة (${quarterlyEopSharesPeriod ?? effectiveAnalyticalSharesSource}).`
      : analyticalCommonEpsItem.unavailableReasonAr ||
        'يفتقد توثيق صافي ربح المساهمين العاديين (NetIncomeCommon_YTD / NetIncomeCommon_Basis).';

  const epsSelectionPolicy: EpsSelectionPolicySummary = {
    valuationEpsValue: analyticalCommonEpsVal,
    valuationEpsBasisLabelAr: valuationEpsItem.basisLabelAr,
    consolidatedAnalyticalEpsRef: analyticalEpsVal,
    perModel: {
      targetPE: {
        model: 'targetPE',
        nameAr: 'التقييم النسبي بالمضاعف (Target_PE)',
        source: analyticalCommonEpsVal !== null ? 'Analytical Common EPS TTM' : 'unavailable',
        period: latestPeriod ? `TTM حتى ${latestPeriod}` : null,
        incomeScope: analyticalCommonEpsVal !== null ? 'net_income_common_ttm' : 'unavailable',
        sharesBasis: analyticalCommonEpsVal !== null ? 'current_eop_shares' : 'unavailable',
        selectedValue: analyticalCommonEpsVal,
        eligible: analyticalCommonEpsVal !== null && analyticalCommonEpsVal > 0,
        reasonAr: epsPolicyReasonAr,
        missingFields: epsMissingFields,
      },
      graham: {
        model: 'graham',
        nameAr: 'صيغة جراهام (Graham)',
        source: analyticalCommonEpsVal !== null ? 'Analytical Common EPS TTM' : 'unavailable',
        period: latestPeriod ? `TTM حتى ${latestPeriod}` : null,
        incomeScope: analyticalCommonEpsVal !== null ? 'net_income_common_ttm' : 'unavailable',
        sharesBasis: analyticalCommonEpsVal !== null ? 'current_eop_shares' : 'unavailable',
        selectedValue: analyticalCommonEpsVal,
        eligible: analyticalCommonEpsVal !== null && analyticalCommonEpsVal > 0,
        reasonAr: epsPolicyReasonAr,
        missingFields: epsMissingFields,
      },
      marketPE: {
        model: 'marketPE',
        nameAr: 'مضاعف الربحية السوقي (P/E TTM)',
        source: analyticalCommonEpsVal !== null ? 'Analytical Common EPS TTM' : 'unavailable',
        period: latestPeriod ? `TTM حتى ${latestPeriod}` : null,
        incomeScope: analyticalCommonEpsVal !== null ? 'net_income_common_ttm' : 'unavailable',
        sharesBasis: analyticalCommonEpsVal !== null ? 'current_eop_shares' : 'unavailable',
        selectedValue: analyticalCommonEpsVal,
        eligible: analyticalCommonEpsVal !== null && analyticalCommonEpsVal > 0,
        reasonAr: epsPolicyReasonAr,
        missingFields: epsMissingFields,
      },
    },
  };

  // 8. Reported vs Accounting EPS Comparison (Strict Period Boundaries & Action-Adjustment Guard)
  const latestAccountingTarget: AccountingPeriodTarget | null = latest
    ? {
        kind: latest.quarter === 'FY' ? 'fy' : 'ytd',
        label: latestPeriod,
        fiscalYear: latest.year,
        fiscalQuarter: latest.quarter === 'FY' ? null : latest.quarter,
        periodStart: latestDaysInfo?.hasDates ? latest.periodStartDate ?? null : null,
        periodEnd: latestDaysInfo?.hasDates ? latest.periodEndDate ?? null : null,
        isCompleteBoundaries: Boolean(
          latestDaysInfo?.hasDates && latest.periodStartDate && latest.periodEndDate
        ),
      }
    : null;

  const ttmAccountingTarget: AccountingPeriodTarget | null = latest
    ? {
        kind: 'ttm',
        label: accountingEpsTtmItem.periodLabel,
        fiscalYear: latest.year,
        fiscalQuarter: null,
        periodStart: accountingTtmPeriodStart,
        periodEnd: accountingTtmPeriodEnd,
        isCompleteBoundaries: Boolean(accountingTtmPeriodStart && accountingTtmPeriodEnd),
      }
    : null;

  let comparison: ReportedVsAccountingEpsComparison;
  if (reportedEpsVal === null || !finCurrencyAllowed) {
    comparison = {
      status: 'unavailable',
      reportedEps: reportedEpsVal,
      reportedEpsPeriod: reportedPeriodDisplay,
      reportedEpsPeriodType: reportedPeriodResolution.periodType,
      reportedEpsPeriodStart: reportedPeriodResolution.period?.periodStart ?? null,
      reportedEpsPeriodEnd: reportedPeriodResolution.period?.periodEnd ?? null,
      reportedEpsSource: latest?.reportedEpsSource ?? null,
      reportedEpsAdjusted: latest?.isCapitalActionAdjusted ?? null,
      accountingEps: accountingEpsLatestItem.value,
      accountingEpsPeriod: accountingEpsLatestItem.periodLabel,
      accountingEpsPeriodStart: latestAccountingTarget?.periodStart ?? null,
      accountingEpsPeriodEnd: latestAccountingTarget?.periodEnd ?? null,
      accountingEpsAdjusted: accountingEpsLatestItem.isActionAdjusted ?? null,
      q1BoundaryOverlap: false,
      tolerance: REPORTED_VS_ACCOUNTING_EPS_TOLERANCE,
      absoluteDifference: null,
      relativeDifferencePct: null,
      messageAr: 'لا تتوفر قيمة ReportedEPS في أحدث فترة للمقارنة مع AccountingEPS.',
      remediationAr: null,
    };
  } else {
    const alignment = evaluateReportedEpsPeriodAlignment({
      resolution: reportedPeriodResolution,
      latestAccountingTarget,
      ttmAccountingTarget,
    });

    if (!alignment.matched || !alignment.target) {
      comparison = {
        status: 'withheld_period_or_basis_mismatch',
        reportedEps: reportedEpsVal,
        reportedEpsPeriod: reportedPeriodDisplay,
        reportedEpsPeriodType: alignment.reportedPeriodType,
        reportedEpsPeriodStart: alignment.reportedPeriodStart,
        reportedEpsPeriodEnd: alignment.reportedPeriodEnd,
        reportedEpsSource: latest?.reportedEpsSource ?? null,
        reportedEpsAdjusted: latest?.isCapitalActionAdjusted ?? null,
        accountingEps: accountingEpsLatestItem.value,
        accountingEpsPeriod: alignment.accountingPeriodLabel ?? accountingEpsLatestItem.periodLabel,
        accountingEpsPeriodStart: alignment.accountingPeriodStart,
        accountingEpsPeriodEnd: alignment.accountingPeriodEnd,
        accountingEpsAdjusted: accountingEpsLatestItem.isActionAdjusted ?? null,
        q1BoundaryOverlap: false,
        tolerance: REPORTED_VS_ACCOUNTING_EPS_TOLERANCE,
        absoluteDifference: null,
        relativeDifferencePct: null,
        messageAr: alignment.reasonAr,
        remediationAr: alignment.remediationAr,
      };
    } else {
      const targetAccounting =
        alignment.target === 'ttm' ? accountingEpsTtmItem : accountingEpsLatestItem;

      if (
        latest?.isCapitalActionAdjusted !== undefined &&
        latest?.isCapitalActionAdjusted !== null &&
        targetAccounting.isActionAdjusted !== undefined &&
        targetAccounting.isActionAdjusted !== null &&
        latest.isCapitalActionAdjusted !== targetAccounting.isActionAdjusted
      ) {
        comparison = {
          status: 'withheld_period_or_basis_mismatch',
          reportedEps: reportedEpsVal,
          reportedEpsPeriod: reportedPeriodDisplay,
          reportedEpsPeriodType: alignment.reportedPeriodType,
          reportedEpsPeriodStart: alignment.reportedPeriodStart,
          reportedEpsPeriodEnd: alignment.reportedPeriodEnd,
          reportedEpsSource: latest?.reportedEpsSource ?? null,
          reportedEpsAdjusted: latest?.isCapitalActionAdjusted ?? null,
          accountingEps: targetAccounting.value,
          accountingEpsPeriod: targetAccounting.periodLabel,
          accountingEpsPeriodStart: alignment.accountingPeriodStart,
          accountingEpsPeriodEnd: alignment.accountingPeriodEnd,
          accountingEpsAdjusted: targetAccounting.isActionAdjusted ?? null,
          q1BoundaryOverlap: alignment.q1BoundaryOverlap,
          tolerance: REPORTED_VS_ACCOUNTING_EPS_TOLERANCE,
          absoluteDifference: null,
          relativeDifferencePct: null,
          messageAr: 'تم حجب المقارنة المباشرة لتباين حالة التعديل لأحداث رأس المال (IsCapitalActionAdjusted) بين ReportedEPS وAccountingEPS.',
          remediationAr: 'تحقق من توحيد حالة IsCapitalActionAdjusted بين ReportedEPS والسجلات المكونة لـ AccountingEPS.',
        };
      } else if (targetAccounting.value === null) {
        comparison = {
          status: 'unavailable',
          reportedEps: reportedEpsVal,
          reportedEpsPeriod: reportedPeriodDisplay,
          reportedEpsPeriodType: alignment.reportedPeriodType,
          reportedEpsPeriodStart: alignment.reportedPeriodStart,
          reportedEpsPeriodEnd: alignment.reportedPeriodEnd,
          reportedEpsSource: latest?.reportedEpsSource ?? null,
          reportedEpsAdjusted: latest?.isCapitalActionAdjusted ?? null,
          accountingEps: null,
          accountingEpsPeriod: targetAccounting.periodLabel,
          accountingEpsPeriodStart: alignment.accountingPeriodStart,
          accountingEpsPeriodEnd: alignment.accountingPeriodEnd,
          accountingEpsAdjusted: targetAccounting.isActionAdjusted ?? null,
          q1BoundaryOverlap: alignment.q1BoundaryOverlap,
          tolerance: REPORTED_VS_ACCOUNTING_EPS_TOLERANCE,
          absoluteDifference: null,
          relativeDifferencePct: null,
          messageAr:
            targetAccounting.unavailableReasonAr ||
            `يتعذر التحقق من مطابقة ReportedEPS لعدم اكتمال مدخلات AccountingEPS للفترة (${targetAccounting.periodLabel ?? '-'}).`,
          remediationAr:
            targetAccounting.remediationAr ||
            'استكمل مدخلات AccountingEPS (المتوسط المرجح للأسهم وأساسه وصافي ربح العاديين) في السجل.',
        };
      } else {
        const absDiff = Math.abs(reportedEpsVal - targetAccounting.value);
        const denom = Math.max(Math.abs(targetAccounting.value), Math.abs(reportedEpsVal));
        const relDiffPct = denom > 0 ? (absDiff / denom) * 100 : 0;
        const q1OverlapSuffix = alignment.q1BoundaryOverlap
          ? ' (تطابق حدود Q1 المنفرد مع Q1 التراكمي الموثق دون تغيير تصنيف الفترة).'
          : '';
        if (absDiff <= REPORTED_VS_ACCOUNTING_EPS_TOLERANCE) {
          comparison = {
            status: 'aligned',
            reportedEps: reportedEpsVal,
            reportedEpsPeriod: reportedPeriodDisplay,
            reportedEpsPeriodType: alignment.reportedPeriodType,
            reportedEpsPeriodStart: alignment.reportedPeriodStart,
            reportedEpsPeriodEnd: alignment.reportedPeriodEnd,
            reportedEpsSource: latest?.reportedEpsSource ?? null,
            reportedEpsAdjusted: latest?.isCapitalActionAdjusted ?? null,
            accountingEps: targetAccounting.value,
            accountingEpsPeriod: targetAccounting.periodLabel,
            accountingEpsPeriodStart: alignment.accountingPeriodStart,
            accountingEpsPeriodEnd: alignment.accountingPeriodEnd,
            accountingEpsAdjusted: targetAccounting.isActionAdjusted ?? null,
            q1BoundaryOverlap: alignment.q1BoundaryOverlap,
            tolerance: REPORTED_VS_ACCOUNTING_EPS_TOLERANCE,
            absoluteDifference: absDiff,
            relativeDifferencePct: relDiffPct,
            messageAr: `تتطابق ReportedEPS (${reportedEpsVal.toFixed(2)}) مع AccountingEPS (${targetAccounting.value.toFixed(2)}) ضمن حد التقريب (±${REPORTED_VS_ACCOUNTING_EPS_TOLERANCE}) لنفس الفترة الموثقة (${alignment.reportedPeriodStart} → ${alignment.reportedPeriodEnd}).${q1OverlapSuffix}`,
            remediationAr: null,
          };
        } else {
          comparison = {
            status: 'discrepancy',
            reportedEps: reportedEpsVal,
            reportedEpsPeriod: reportedPeriodDisplay,
            reportedEpsPeriodType: alignment.reportedPeriodType,
            reportedEpsPeriodStart: alignment.reportedPeriodStart,
            reportedEpsPeriodEnd: alignment.reportedPeriodEnd,
            reportedEpsSource: latest?.reportedEpsSource ?? null,
            reportedEpsAdjusted: latest?.isCapitalActionAdjusted ?? null,
            accountingEps: targetAccounting.value,
            accountingEpsPeriod: targetAccounting.periodLabel,
            accountingEpsPeriodStart: alignment.accountingPeriodStart,
            accountingEpsPeriodEnd: alignment.accountingPeriodEnd,
            accountingEpsAdjusted: targetAccounting.isActionAdjusted ?? null,
            q1BoundaryOverlap: alignment.q1BoundaryOverlap,
            tolerance: REPORTED_VS_ACCOUNTING_EPS_TOLERANCE,
            absoluteDifference: absDiff,
            relativeDifferencePct: relDiffPct,
            messageAr: `تنبيه فرق تدقيقي: ReportedEPS (${reportedEpsVal.toFixed(2)}) يختلف عن AccountingEPS (${targetAccounting.value.toFixed(2)}) بفارق ${absDiff.toFixed(4)} (${relDiffPct.toFixed(2)}%) لنفس الفترة الموثقة (${alignment.reportedPeriodStart} → ${alignment.reportedPeriodEnd}) دون تعديل الأرقام المخزنة.${q1OverlapSuffix}`,
            remediationAr: 'راجع أساس الإفصاح في القوائم المالية (أساسي مقابل مخفض أو تعديلات رأس المال) دون تعديل تلقائي.',
          };
        }
      }
    }
  }

  // 9. BVPS (Common BVPS vs Total-Equity BVPS + Valuation BVPS)
  const commonBvpsVal =
    finCurrencyAllowed &&
    commonEqLatestRes.value !== null &&
    effectiveAnalyticalShares !== null
      ? commonEqLatestRes.value / effectiveAnalyticalShares
      : null;

  const totalBvpsVal =
    finCurrencyAllowed &&
    totalEquityLatest !== null &&
    effectiveAnalyticalShares !== null
      ? totalEquityLatest / effectiveAnalyticalShares
      : null;

  const commonBvpsItem: AuditedMetricItem = {
    key: 'commonBvps',
    nameAr: 'القيمة الدفترية للمساهمين العاديين (Common BVPS)',
    value: commonBvpsVal,
    formattedValue: fmtNum(commonBvpsVal, 2, currencySuffix),
    equationAr: 'EquityCommon ÷ End-of-Period Shares',
    numeratorLabelAr: 'حقوق المساهمين العاديين',
    numeratorValue: commonEqLatestRes.value,
    denominatorLabelAr: 'أسهم نهاية الفترة',
    denominatorValue: effectiveAnalyticalShares,
    basisCode: commonBvpsVal !== null ? commonEqLatestRes.basis : 'unavailable',
    basisLabelAr:
      commonBvpsVal !== null
        ? commonEqLatestRes.basis === 'explicit_common'
          ? 'محسوبة من EquityCommon الصريحة الموثقة'
          : 'محسوبة من TotalEquity بإقرار موثق (attested_total_equals_common)'
        : 'غير موثق فصل حقوق المساهمين العاديين',
    periodLabel: latestPeriod,
    periodKind: 'unknown',
    completenessStatus: commonBvpsVal !== null ? 'complete' : 'unavailable',
    usedByModels: commonBvpsVal !== null ? ['RIM', 'التقييم النسبي (Target_PB)', 'جراهام (Graham)'] : [],
    notesAr:
      sharesAlignmentStatus === 'cross_source_mismatch' && sharesAlignmentNoteAr
        ? [sharesAlignmentNoteAr]
        : [],
    unavailableReasonAr: commonEqLatestRes.unavailableReasonAr,
  };

  const totalEquityBvpsItem: AuditedMetricItem = {
    key: 'totalEquityBvps',
    nameAr: 'القيمة الدفترية على إجمالي حقوق الملكية (مرجعية فقط — Total-Equity Ref)',
    value: totalBvpsVal,
    formattedValue: fmtNum(totalBvpsVal, 2, currencySuffix),
    equationAr: 'TotalEquity ÷ End-of-Period Shares',
    numeratorLabelAr: 'إجمالي حقوق الملكية',
    numeratorValue: totalEquityLatest,
    denominatorLabelAr: 'أسهم نهاية الفترة',
    denominatorValue: effectiveAnalyticalShares,
    basisCode: totalBvpsVal !== null ? 'total_equity_eop' : 'unavailable',
    basisLabelAr:
      equityBasisForValuation === 'total_equity_unattested'
        ? 'إجمالي حقوق الملكية الكلي للمرجعية فقط (غير مفصول عن حقوق الأقلية — لا يدخل في النماذج)'
        : 'إجمالي حقوق الملكية في نهاية الفترة (مرجعية مقارنة)',
    periodLabel: latestPeriod,
    periodKind: 'unknown',
    completenessStatus:
      totalBvpsVal === null
        ? 'unavailable'
        : commonBvpsVal !== null
        ? 'complete'
        : 'unattested',
    usedByModels: ['مرجعية مقارنة لإجمالي حقوق الملكية فقط (لا يدخل في RIM أو Target_PB أو جراهام)'],
    notesAr:
      commonBvpsVal === null && totalBvpsVal !== null
        ? [
            'تنبيه حوكمة: TotalEquity غير موثق كحقوق مساهمين عاديين (EquityCommon / attested_total_equals_common)؛ لذا يُعرض كمرجعية فقط ولا يغذي RIM أو Target_PB أو جراهام.',
          ]
        : [],
    unavailableReasonAr:
      !finCurrencyAllowed
        ? 'عملة القوائم المالية غير مدعومة أو متضاربة.'
        : totalEquityLatest === null
        ? 'حقوق الملكية غير مدخلة في أحدث قائمة مالية.'
        : effectiveAnalyticalShares === null
        ? 'عدد الأسهم في نهاية الفترة غير متاح.'
        : null,
  };

  // Valuation BVPS strictly requires attested Common Equity (NEVER fall back to Total Equity)
  const valuationBvpsItem: AuditedMetricItem =
    commonBvpsVal !== null
      ? {
          ...commonBvpsItem,
          key: 'valuationBvps',
          nameAr: 'القيمة الدفترية المعتمدة للتقييم (Common BVPS)',
          usedByModels: ['RIM', 'التقييم النسبي (Target_PB)', 'صيغة جراهام (Graham)', 'مضاعف P/B التقييمي'],
        }
      : {
          ...commonBvpsItem,
          key: 'valuationBvps',
          nameAr: 'القيمة الدفترية المعتمدة للتقييم (Common BVPS)',
          value: null,
          formattedValue: 'غير متاح',
          basisCode: equityBasisForValuation,
          basisLabelAr:
            equityBasisForValuation === 'total_equity_unattested'
              ? 'محجوب عن التقييم: إجمالي حقوق الملكية متاح كمرجعية فقط دون توثيق EquityCommon'
              : 'غير متاح: تفتقد حقوق المساهمين العاديين',
          completenessStatus: totalBvpsVal !== null ? 'unattested' : 'unavailable',
          usedByModels: [],
          unavailableReasonAr:
            commonEqLatestRes.unavailableReasonAr ||
            totalEquityBvpsItem.unavailableReasonAr ||
            'حقوق المساهمين العاديين (EquityCommon) غير موثقة.',
        };

  // 10. ROE Metrics (Common EOP, Total EOP [Ref], Average Equity, Valuation ROE strictly Common)
  const roeCommonEopVal =
    finCurrencyAllowed &&
    netIncomeCommonTTM !== null &&
    commonEqLatestRes.value !== null &&
    commonEqLatestRes.value > 0
      ? netIncomeCommonTTM / commonEqLatestRes.value
      : null;

  const roeCommonEopItem: AuditedMetricItem = {
    key: 'roeCommonEop',
    nameAr: 'العائد على حقوق المساهمين العاديين نهاية الفترة (ROE Common EOP)',
    value: roeCommonEopVal,
    formattedValue: fmtPct(roeCommonEopVal, 2),
    equationAr: 'NetIncomeCommon_TTM ÷ EquityCommon_EOP',
    numeratorLabelAr: 'صافي ربح المساهمين العاديين TTM',
    numeratorValue: netIncomeCommonTTM,
    denominatorLabelAr: 'حقوق المساهمين العاديين نهاية الفترة',
    denominatorValue: commonEqLatestRes.value,
    basisCode: roeCommonEopVal !== null ? 'common_eop_equity' : 'unavailable',
    basisLabelAr:
      roeCommonEopVal !== null
        ? 'عائد المساهمين العاديين (NetIncomeCommon_TTM ÷ EquityCommon EOP)'
        : 'غير متاح لنقص NetIncomeCommon_TTM أو EquityCommon > 0',
    periodLabel: latestPeriod,
    periodKind: 'TTM',
    completenessStatus: roeCommonEopVal !== null ? 'complete' : 'unavailable',
    usedByModels: roeCommonEopVal !== null ? ['RIM (عائد تاريخي مرجعي متسق مع Common BVPS)'] : [],
    notesAr: [],
    unavailableReasonAr:
      commonEqLatestRes.value === null
        ? commonEqLatestRes.unavailableReasonAr
        : commonEqLatestRes.value <= 0
        ? 'حقوق المساهمين العاديين غير موجبة (<= 0).'
        : netIncomeCommonTTM === null
        ? netIncomeCommonTtmUnavailableReasonAr
        : null,
  };

  const roeTotalEopVal =
    finCurrencyAllowed &&
    netIncomeTTM !== null &&
    totalEquityLatest !== null &&
    totalEquityLatest > 0
      ? netIncomeTTM / totalEquityLatest
      : null;

  const roeTotalEopItem: AuditedMetricItem = {
    key: 'roeTotalEop',
    nameAr: 'العائد على إجمالي حقوق الملكية نهاية الفترة (مرجعية فقط — Total ROE Ref)',
    value: roeTotalEopVal,
    formattedValue: fmtPct(roeTotalEopVal, 2),
    equationAr: 'NetIncome_Consolidated_TTM ÷ TotalEquity_EOP',
    numeratorLabelAr: 'صافي الربح الموحد TTM',
    numeratorValue: netIncomeTTM,
    denominatorLabelAr: 'إجمالي حقوق الملكية نهاية الفترة',
    denominatorValue: totalEquityLatest,
    basisCode: roeTotalEopVal !== null ? 'end_of_period_equity' : 'unavailable',
    basisLabelAr:
      roeTotalEopVal !== null
        ? 'عائد على إجمالي حقوق الملكية للمرجعية فقط (غير مفصول عن حقوق الأقلية — لا يدخل في RIM)'
        : 'غير متاح',
    periodLabel: latestPeriod,
    periodKind: 'TTM',
    completenessStatus:
      roeTotalEopVal === null
        ? 'unavailable'
        : roeCommonEopVal !== null
        ? 'complete'
        : 'unattested',
    usedByModels: ['مرجعية لإجمالي حقوق الملكية وصافي الربح الموحد فقط (لا يدخل في RIM)'],
    notesAr:
      commonEqLatestRes.value === null && roeTotalEopVal !== null
        ? [
            'تنبيه حوكمة: محسوب على صافي الربح الموحد وإجمالي حقوق الملكية للمرجعية فقط ولا يدخل في RIM أو التقييم النسبي عند غياب توثيق الأسهم العادية.',
          ]
        : [],
    unavailableReasonAr:
      totalEquityLatest === null || totalEquityLatest <= 0
        ? 'إجمالي حقوق الملكية غير متاح أو غير موجب (<= 0).'
        : netIncomeTTM === null
        ? 'صافي الربح TTM غير متاح.'
        : null,
  };

  // Average Equity ROE (strict chronological start & end equity pair matching SAME equity scope)
  const startPeriodRec = latest ? (latest.quarter === 'FY' ? previousFY : previousComparable) : null;
  let roeAvgVal: number | null = null;
  let roeAvgNumerator: number | null = null;
  let roeAvgDenom: number | null = null;
  let roeAvgBasisCode = 'unavailable';
  let roeAvgBasisLabelAr = 'يتطلب توفر رصيد حقوق ملكية بداية ونهاية 12 شهراً متطابق الأساس';
  let roeAvgUnavailableAr: string | null = null;
  const roeAvgNotes: string[] = [];

  if (finCurrencyAllowed && latest && startPeriodRec) {
    const startCommon = resolvePeriodCommonEquity(startPeriodRec);
    const bothCommonPositive =
      commonEqLatestRes.value !== null &&
      commonEqLatestRes.value > 0 &&
      startCommon.value !== null &&
      startCommon.value > 0;

    if (bothCommonPositive && netIncomeCommonTTM !== null) {
      const avgCommon = (startCommon.value! + commonEqLatestRes.value!) / 2;
      if (avgCommon > 0) {
        roeAvgVal = netIncomeCommonTTM / avgCommon;
        roeAvgNumerator = netIncomeCommonTTM;
        roeAvgDenom = avgCommon;
        roeAvgBasisCode = 'common_average_equity';
        roeAvgBasisLabelAr = `عائد على متوسط حقوق العاديين بين ${startPeriodRec.quarter} ${startPeriodRec.year} و${latestPeriod}`;
      }
    } else if (
      netIncomeTTM !== null &&
      totalEquityLatest !== null &&
      totalEquityLatest > 0 &&
      isFiniteNum(startPeriodRec.totalEquity) &&
      startPeriodRec.totalEquity > 0
    ) {
      const avgTotal = (startPeriodRec.totalEquity + totalEquityLatest) / 2;
      if (avgTotal > 0) {
        roeAvgVal = netIncomeTTM / avgTotal;
        roeAvgNumerator = netIncomeTTM;
        roeAvgDenom = avgTotal;
        roeAvgBasisCode = 'total_average_equity';
        roeAvgBasisLabelAr = `عائد مرجعي على متوسط إجمالي حقوق الملكية بين ${startPeriodRec.quarter} ${startPeriodRec.year} و${latestPeriod}`;
        if (commonEqLatestRes.value !== null && startCommon.value === null) {
          roeAvgNotes.push(
            'لم يُدمج EquityCommon لفترة واحدة مع TotalEquity لفترة أخرى؛ اُستخدم زوج إجمالي حقوق الملكية كمرجعية فقط.'
          );
        }
      }
    } else {
      roeAvgUnavailableAr =
        'رصيد حقوق الملكية لبداية فترة الـ 12 شهراً غير متاح أو غير موجب.';
    }
  } else if (latest) {
    roeAvgUnavailableAr = `لا تتوفر فترة بداية الـ 12 شهراً (${latest.quarter === 'FY' ? `FY ${latest.year - 1}` : `${latest.quarter} ${latest.year - 1}`}) لحساب متوسط حقوق الملكية.`;
  } else {
    roeAvgUnavailableAr = 'لا توجد سجلات مالية فصلية.';
  }

  const roeAverageEquityItem: AuditedMetricItem = {
    key: 'roeAverageEquity',
    nameAr: 'العائد على متوسط حقوق الملكية (ROE Average Equity)',
    value: roeAvgVal,
    formattedValue: fmtPct(roeAvgVal, 2),
    equationAr: 'NetIncome_TTM ÷ ((Equity_Start + Equity_End) / 2)',
    numeratorLabelAr:
      roeAvgBasisCode === 'common_average_equity'
        ? 'صافي ربح العاديين TTM'
        : 'صافي الربح الموحد TTM (مرجعي)',
    numeratorValue: roeAvgNumerator,
    denominatorLabelAr:
      roeAvgBasisCode === 'common_average_equity'
        ? 'متوسط حقوق العاديين (بداية/نهاية)'
        : 'متوسط إجمالي حقوق الملكية (بداية/نهاية)',
    denominatorValue: roeAvgDenom,
    basisCode: roeAvgBasisCode,
    basisLabelAr: roeAvgBasisLabelAr,
    periodLabel: startPeriodRec && latestPeriod ? `${startPeriodRec.quarter} ${startPeriodRec.year} → ${latestPeriod}` : latestPeriod,
    periodKind: 'TTM',
    completenessStatus:
      roeAvgVal === null
        ? 'unavailable'
        : roeAvgBasisCode === 'common_average_equity'
        ? 'complete'
        : 'unattested',
    usedByModels: ['تحليل جودة الربحية التدقيقي (منفصل تماماً عن ROE نهاية الفترة في RIM)'],
    notesAr: [
      'يُفصل صراحةً عن ROE نهاية الفترة ولا يُخلط معه لتجنب تباين البداية مع معادلة Clean Surplus في RIM.',
      ...roeAvgNotes,
    ],
    unavailableReasonAr: roeAvgUnavailableAr,
  };

  // Valuation ROE strictly paired in scope with Common Equity & Common NI (NEVER fall back to Total Equity ROE)
  const valuationRoeItem: AuditedMetricItem =
    roeCommonEopVal !== null
      ? {
          ...roeCommonEopItem,
          key: 'valuationRoe',
          nameAr: 'العائد التاريخي للأسهم العادية المعتمد في RIM',
          usedByModels: ['RIM (عند غياب RIM_Expected_ROE)'],
        }
      : {
          ...roeCommonEopItem,
          key: 'valuationRoe',
          nameAr: 'العائد التاريخي للأسهم العادية المعتمد في RIM',
          value: null,
          formattedValue: 'غير متاح',
          completenessStatus:
            commonEqLatestRes.value !== null && netIncomeCommonTTM === null
              ? 'mismatch'
              : totalEquityLatest !== null
              ? 'unattested'
              : 'unavailable',
          usedByModels: [],
          unavailableReasonAr:
            commonEqLatestRes.value === null
              ? commonEqLatestRes.unavailableReasonAr
              : commonEqLatestRes.value <= 0
              ? 'حقوق المساهمين العاديين غير موجبة (<= 0).'
              : netIncomeCommonTtmUnavailableReasonAr ||
                'يمتنع RIM عن استخدام العائد الموحّد غير المفصول عن حقوق الأقلية عند غياب NetIncomeCommon_TTM.',
        };

  // Missing Common Fields diagnostic list (for actionable UI editing)
  const missingCommonFields: MissingCommonFieldItem[] = [];
  if (latest) {
    if (commonEqLatestRes.value === null) {
      missingCommonFields.push({
        period: `${latest.quarter} ${latest.year}`,
        year: latest.year,
        quarter: latest.quarter,
        field: latest.totalEquity !== null ? 'equityCommonBasis' : 'equityCommon',
        excelColumn: 'EquityCommon / EquityCommon_Basis',
        labelAr: `فصل حقوق المساهمين العاديين (${latest.quarter} ${latest.year})`,
        reasonAr:
          commonEqLatestRes.unavailableReasonAr ||
          'يلزم إدخال EquityCommon أو توثيق EquityCommon_Basis = attested_total_equals_common.',
        affectedModels: ['RIM', 'التقييم النسبي (Target_PB)', 'صيغة جراهام (Graham)', 'مضاعف P/B التقييمي'],
      });
    }

    const niPeriods = latest.quarter === 'FY'
      ? [latest]
      : [latest, previousFY, previousComparable].filter((p): p is QuarterlyFinancial => Boolean(p));
    const seenPeriods = new Set<string>();
    for (const pRec of niPeriods) {
      const pKey = `${pRec.year}_${pRec.quarter}`;
      if (seenPeriods.has(pKey)) continue;
      seenPeriods.add(pKey);
      const rCommonNi = resolvePeriodCommonNetIncome(pRec);
      if (rCommonNi.value === null) {
        missingCommonFields.push({
          period: `${pRec.quarter} ${pRec.year}`,
          year: pRec.year,
          quarter: pRec.quarter,
          field: pRec.netProfitYTD !== null ? 'netIncomeCommonBasis' : 'netIncomeCommonYTD',
          excelColumn: 'NetIncomeCommon_YTD / NetIncomeCommon_Basis',
          labelAr: `فصل صافي ربح المساهمين العاديين (${pRec.quarter} ${pRec.year})`,
          reasonAr:
            rCommonNi.unavailableReasonAr ||
            'يلزم إدخال NetIncomeCommon_YTD أو توثيق NetIncomeCommon_Basis = attested_net_income_equals_common.',
          affectedModels: ['التقييم النسبي (Target_PE)', 'صيغة جراهام (Graham)', 'مضاعف P/E التقييمي', 'RIM (عبر ROE التاريخي)'],
        });
      }
    }
  }

  // Missing AccountingEPS period / weighted-average shares fields — strictly driven by central eligibility decisions
  const missingAccountingEpsFields: MissingAccountingEpsFieldItem[] = [];
  if (latest) {
    const epsPeriods =
      latest.quarter === 'FY'
        ? [latest]
        : [latest, previousFY, previousComparable].filter((p): p is QuarterlyFinancial => Boolean(p));
    const seenEpsPeriods = new Set<string>();
    const seenMissingKey = new Set<string>();
    const pushMissing = (item: MissingAccountingEpsFieldItem) => {
      const k = `${item.year}_${item.quarter}_${item.field}`;
      if (seenMissingKey.has(k)) return;
      seenMissingKey.add(k);
      missingAccountingEpsFields.push(item);
    };

    for (const pRec of epsPeriods) {
      const pKey = `${pRec.year}_${pRec.quarter}`;
      if (seenEpsPeriods.has(pKey)) continue;
      seenEpsPeriods.add(pKey);

      const prevFyForPeriod = sorted.find((f) => f.year === pRec.year - 1 && f.quarter === 'FY') ?? null;
      const sameYearForPeriod = sorted.filter((f) => f.year === pRec.year && f.quarter !== pRec.quarter);
      const sharesElig = evaluatePeriodSharesBasisEligibility(pRec, {
        previousFY: prevFyForPeriod,
        sameYearRecords: sameYearForPeriod,
      });

      if (!sharesElig.eligible && sharesElig.missingField) {
        if (sharesElig.missingField === 'weightedAvgSharesYTD') {
          pushMissing({
            period: `${pRec.quarter} ${pRec.year}`,
            year: pRec.year,
            quarter: pRec.quarter,
            field: 'weightedAvgSharesYTD',
            excelColumn: sharesElig.missingExcelColumn || 'WeightedAvgShares_YTD',
            labelAr: `المتوسط المرجح للأسهم (${pRec.quarter} ${pRec.year})`,
            reasonAr: sharesElig.reasonAr,
            remediationAr: sharesElig.remediationAr,
            affectedModels: ['AccountingEPS', 'مطابقة ReportedEPS'],
          });
        } else if (sharesElig.missingField === 'weightedAvgSharesBasis') {
          pushMissing({
            period: `${pRec.quarter} ${pRec.year}`,
            year: pRec.year,
            quarter: pRec.quarter,
            field: 'weightedAvgSharesBasis',
            excelColumn: sharesElig.missingExcelColumn || 'WeightedAvgShares_Basis',
            labelAr: `أساس المتوسط المرجح للأسهم (${pRec.quarter} ${pRec.year})`,
            reasonAr: sharesElig.reasonAr,
            remediationAr: sharesElig.remediationAr,
            affectedModels: ['AccountingEPS', 'AccountingEPS TTM'],
          });
        } else if (
          sharesElig.missingField === 'periodStartDate' ||
          sharesElig.missingField === 'periodEndDate' ||
          sharesElig.missingField === 'periodDays'
        ) {
          pushMissing({
            period: `${pRec.quarter} ${pRec.year}`,
            year: pRec.year,
            quarter: pRec.quarter,
            field: sharesElig.missingField,
            excelColumn: sharesElig.missingExcelColumn || 'PeriodStartDate / PeriodEndDate',
            labelAr: `توثيق حدود الفترة (${pRec.quarter} ${pRec.year})`,
            reasonAr: sharesElig.reasonAr,
            remediationAr: sharesElig.remediationAr,
            affectedModels: ['AccountingEPS', 'AccountingEPS TTM'],
          });
        }
      }

      const periodDaysRes = resolveRecordPeriodDays(pRec);
      if (periodDaysRes.days === null) {
        pushMissing({
          period: `${pRec.quarter} ${pRec.year}`,
          year: pRec.year,
          quarter: pRec.quarter,
          field: 'periodStartDate',
          excelColumn: 'PeriodStartDate / PeriodEndDate / PeriodDays',
          labelAr: `تواريخ أو طول الفترة الفعلية (${pRec.quarter} ${pRec.year})`,
          reasonAr:
            periodDaysRes.reasonAr ||
            `يلزم إدخال PeriodStartDate و PeriodEndDate (أو PeriodDays) في ${pRec.quarter} ${pRec.year} لحساب AccountingEPS TTM بالأيام التقويمية الفعلية.`,
          remediationAr: `أدخل PeriodStartDate وPeriodEndDate (أو PeriodDays) في سجل ${pRec.quarter} ${pRec.year}.`,
          affectedModels: ['AccountingEPS TTM'],
        });
      }
    }

    // Surface actionable TTM capital-action or boundary remediation from the central TTM eligibility decision
    if (
      !accountingEpsTtmEligibility.eligible &&
      accountingEpsTtmEligibility.missingField === 'isCapitalActionAdjusted' &&
      accountingEpsTtmEligibility.missingPeriod
    ) {
      pushMissing({
        period: accountingEpsTtmEligibility.missingPeriod.period,
        year: accountingEpsTtmEligibility.missingPeriod.year,
        quarter: accountingEpsTtmEligibility.missingPeriod.quarter,
        field: 'isCapitalActionAdjusted',
        excelColumn: accountingEpsTtmEligibility.missingExcelColumn || 'IsCapitalActionAdjusted',
        labelAr: `توثيق تعديل أحداث رأس المال (${accountingEpsTtmEligibility.missingPeriod.period})`,
        reasonAr: accountingEpsTtmEligibility.reasonAr,
        remediationAr: accountingEpsTtmEligibility.remediationAr,
        affectedModels: ['AccountingEPS TTM'],
      });
    }
  }

  const summaryNotesAr: string[] = [];
  if (sharesAlignmentStatus === 'cross_source_mismatch' && sharesAlignmentNoteAr) {
    summaryNotesAr.push(sharesAlignmentNoteAr);
  }
  if (comparison.status === 'discrepancy' || comparison.status === 'withheld_period_or_basis_mismatch') {
    summaryNotesAr.push(comparison.messageAr);
  }
  if (equityBasisForValuation === 'total_equity_unattested') {
    summaryNotesAr.push(
      'حوكمة الأسهم العادية: لم يُوثّق EquityCommon أو EquityCommon_Basis؛ يُعرض إجمالي حقوق الملكية كمرجعية فقط وتُحجب نماذج RIM وTarget_PB وجراهام عن استخدامه، بينما تستمر النماذج المستقلة (DCF / DDM / Target_PE عند اكتمال مدخلاتها).'
    );
  }
  if (netIncomeCommonTTM === null && netIncomeTTM !== null) {
    summaryNotesAr.push(
      'حوكمة صافي ربح العاديين: لم يُوثّق NetIncomeCommon_YTD أو NetIncomeCommon_Basis لجميع فترات TTM؛ يُعرض Analytical EPS الموحد كمرجعية فقط وتُحجب نماذج Target_PE وجراهام ومضاعف P/E التقييمي عن استخدامه.'
    );
  }

  return {
    latestPeriod,
    sharesAlignmentStatus,
    sharesAlignmentNoteAr,
    quarterlyEopShares,
    quarterlyEopSharesPeriod,
    dailyListedShares,
    dailyListedSharesDate,
    effectiveAnalyticalShares,
    effectiveAnalyticalSharesSource,
    netIncomeTTM,
    netIncomeCommonLatestPeriod: commonLatestRes.value,
    netIncomeCommonLatestBasis: commonLatestRes.basis,
    netIncomeCommonTTM,
    netIncomeCommonTtmBasis,
    netIncomeCommonTtmUnavailableReasonAr,
    equityBasisForValuation,
    commonEquityLatest: commonEqLatestRes.value,
    totalEquityLatest,
    reportedEps: reportedEpsItem,
    accountingEpsLatest: accountingEpsLatestItem,
    accountingEpsTTM: accountingEpsTtmItem,
    accountingEpsLatestEligibility,
    accountingEpsTtmEligibility,
    analyticalEpsTTM: analyticalEpsItem,
    analyticalCommonEpsTTM: analyticalCommonEpsItem,
    valuationEps: valuationEpsItem,
    epsSelectionPolicy,
    reportedVsAccountingComparison: comparison,
    commonBvps: commonBvpsItem,
    totalEquityBvps: totalEquityBvpsItem,
    valuationBvps: valuationBvpsItem,
    roeCommonEop: roeCommonEopItem,
    roeTotalEop: roeTotalEopItem,
    roeAverageEquity: roeAverageEquityItem,
    valuationRoe: valuationRoeItem,
    missingCommonFields,
    missingAccountingEpsFields,
    summaryNotesAr,
  };
}
