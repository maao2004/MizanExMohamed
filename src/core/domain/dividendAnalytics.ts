/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AssumptionPriority,
  CurrencyCode,
  DividendAggregationSummary,
  DividendRecord,
  DividendRecordType,
  DividendYearStatusRecord,
  DividendYearStatusValue,
  ResolvedAssumption,
  RimRetentionPolicy,
} from '../../types';
import type { QuarterlyFinancial } from '../../types/financial';
import {
  buildDividendDocId,
  isActiveDividendRecordForConflict,
  isValidCalendarDate,
  normalizedTicker,
  normalizeStrictCurrency,
} from '../contracts';
import {
  evaluateRegularDividendStability,
  explainDdmVsRetentionBasisDifferenceAr,
  resolveDdmEligibilityGate,
  resolveDividendYearPolicy,
} from './dividendYearResolver';

export interface ResolveDividendAnalyticsParams {
  ticker: string;
  dividendRecords?: DividendRecord[];
  dividendYearStatuses?: DividendYearStatusRecord[];
  quarterlyRecords?: Array<
    Pick<QuarterlyFinancial, 'year' | 'quarter' | 'sharesCount' | 'netProfitYTD'> &
      Partial<
        Pick<
          QuarterlyFinancial,
          'financialCurrency' | 'netIncomeCommonYTD' | 'netIncomeCommonBasis' | 'netIncomeCommonNote'
        >
      >
  >;
  sharesOutstanding: number | null;
  netIncomeTTM?: number | null;
  financialCurrency: CurrencyCode | null;
  cutoffDate?: string | null;
  valuationDate?: string | null;
}

export const DIVIDEND_DATE_POLICY_NOTE_AR =
  'سياسة تواريخ التوزيعات: تُعتمد السجلات ذات حالة (approved/paid) متى كان تاريخ إعلانها/سريانها (asOfDate) <= تاريخ التقييم، حتى إذا وقع تاريخ الحق أو التسجيل أو الصرف لاحقاً، مع تتبع الجزء المصروف فعلياً (paid بتاريخ صرف صريح <= تاريخ التقييم) بشكل منفصل.';

export const RIM_RETENTION_SELECTION_RULE_NOTE_AR =
  'سياسة الحد الأدنى (minimum) قاعدة اختيار لكل شركة: min(RIM_Retention, Historical_Retention) وتستخدم الاحتجاز التاريخي فقط عند ملاءمته، دون تعديل معامل RIM_Retention المحفوظ في المصادر المعتمدة (company_assumptions أو macro_params).';

function resolveRecordAttributableAmount(
  rec: DividendRecord
): {
  amount: number | null;
  basis: 'total_distribution_amount' | 'cash_dps_x_eligible_shares' | 'unavailable';
} {
  if (
    rec.totalDistributionAmount !== undefined &&
    rec.totalDistributionAmount !== null &&
    Number.isFinite(rec.totalDistributionAmount)
  ) {
    return {
      amount: rec.totalDistributionAmount,
      basis: 'total_distribution_amount',
    };
  }
  if (
    rec.eligibleSharesCount !== undefined &&
    rec.eligibleSharesCount !== null &&
    Number.isFinite(rec.eligibleSharesCount) &&
    rec.eligibleSharesCount > 0
  ) {
    return {
      amount: rec.cashDps * rec.eligibleSharesCount,
      basis: 'cash_dps_x_eligible_shares',
    };
  }
  return { amount: null, basis: 'unavailable' };
}

interface BucketAggregationResult {
  dps: number | null;
  attributableAmount: number | null;
  attributableBasis: 'total_distribution_amount' | 'cash_dps_x_eligible_shares' | 'unavailable';
  matchedRecords: DividendRecord[];
  deduplicatedCount: number;
  warnings: string[];
}

function aggregateDividendBucket(
  records: DividendRecord[],
  recordType: DividendRecordType
): BucketAggregationResult {
  if (records.length === 0) {
    return {
      dps: null,
      attributableAmount: null,
      attributableBasis: 'unavailable',
      matchedRecords: [],
      deduplicatedCount: 0,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const typeLabelAr = recordType === 'special' ? 'الاستثنائية' : 'المنتظمة';
  const sortedNewestFirst = [...records].sort((a, b) => {
    const dateCmp = (b.asOfDate || '').localeCompare(a.asOfDate || '');
    if (dateCmp !== 0) return dateCmp;
    const updCmp = (b.updatedAt || '').localeCompare(a.updatedAt || '');
    if (updCmp !== 0) return updCmp;
    return b.distributionId.localeCompare(a.distributionId);
  });

  const annualTotals = sortedNewestFirst.filter((r) => r.distributionSemantics === 'annual_total');
  if (annualTotals.length > 0) {
    const chosen = annualTotals[0];
    const suppressedCount = records.length - 1;
    if (annualTotals.length > 1) {
      warnings.push(
        `تم رصد ${annualTotals.length} سجلات annual_total للتوزيعات ${typeLabelAr} في سنة ${chosen.fiscalYear}؛ تم اعتماد الأحدث (${chosen.distributionId} بتاريخ ${chosen.asOfDate}) واستبعاد البقية منعاً للازدواج.`
      );
    }
    if (records.some((r) => r.distributionSemantics !== 'annual_total')) {
      warnings.push(
        `تم استبعاد أقساط أو أحداث فرعية في سنة ${chosen.fiscalYear} لوجود سجل إجمالي سنوي معتمد (annual_total) للتوزيعات ${typeLabelAr}.`
      );
    }
    const attrRes = resolveRecordAttributableAmount(chosen);
    return {
      dps: chosen.cashDps,
      attributableAmount: attrRes.amount,
      attributableBasis: attrRes.basis,
      matchedRecords: [chosen],
      deduplicatedCount: suppressedCount,
      warnings,
    };
  }

  const byDistId = new Map<string, DividendRecord>();
  let deduplicatedCount = 0;

  for (const rec of sortedNewestFirst) {
    if (byDistId.has(rec.distributionId)) {
      deduplicatedCount += 1;
      continue;
    }
    byDistId.set(rec.distributionId, rec);
  }

  const uniqueRecords = Array.from(byDistId.values());
  const activeDistIds = new Set(uniqueRecords.map((r) => r.distributionId));

  const kept: DividendRecord[] = [];
  for (const rec of uniqueRecords) {
    if (
      rec.distributionSemantics === 'installment' &&
      rec.parentAnnouncementId &&
      activeDistIds.has(rec.parentAnnouncementId)
    ) {
      deduplicatedCount += 1;
      warnings.push(
        `تم استبعاد الدفعة الفرعية (${rec.distributionId}) لأن سجل التوزيع الأب (${rec.parentAnnouncementId}) موجود بالفعل لنفس السنة.`
      );
      continue;
    }
    kept.push(rec);
  }

  if (kept.length === 0) {
    return {
      dps: null,
      attributableAmount: null,
      attributableBasis: 'unavailable',
      matchedRecords: [],
      deduplicatedCount,
      warnings,
    };
  }

  let dpsSum = 0;
  let totalAttributableSum = 0;
  let allHaveAttributable = true;
  let usedBasis: BucketAggregationResult['attributableBasis'] = 'unavailable';

  for (const rec of kept) {
    dpsSum += rec.cashDps;
    const attrRes = resolveRecordAttributableAmount(rec);
    if (attrRes.amount === null) {
      allHaveAttributable = false;
    } else {
      totalAttributableSum += attrRes.amount;
      if (usedBasis === 'unavailable') usedBasis = attrRes.basis;
      else if (usedBasis !== attrRes.basis) usedBasis = 'total_distribution_amount';
    }
  }

  return {
    dps: Object.is(dpsSum, -0) ? 0 : dpsSum,
    attributableAmount: allHaveAttributable ? totalAttributableSum : null,
    attributableBasis: allHaveAttributable ? usedBasis : 'unavailable',
    matchedRecords: kept,
    deduplicatedCount,
    warnings,
  };
}

function resolveFiscalYearCommonIncome(
  quarters: ResolveDividendAnalyticsParams['quarterlyRecords'],
  targetFiscalYear: number
): {
  targetFyExists: boolean;
  income: number | null;
  source: DividendAggregationSummary['fiscalYearIncomeSource'];
  unavailableReasonAr: string | null;
} {
  const targetFyRecord = (quarters ?? []).find(
    (q) => q.year === targetFiscalYear && q.quarter === 'FY'
  );
  if (!targetFyRecord) {
    return {
      targetFyExists: false,
      income: null,
      source: 'unavailable',
      unavailableReasonAr: `لا تتوفر قائمة سنة مالية مكتملة (FY ${targetFiscalYear}) لمطابقة نسبة التوزيع؛ لا تُستخدم أرباح TTM أو الأرباع المرحلية كمقام لنسبة التوزيع.`,
    };
  }

  if (
    targetFyRecord.netIncomeCommonYTD !== undefined &&
    targetFyRecord.netIncomeCommonYTD !== null &&
    Number.isFinite(targetFyRecord.netIncomeCommonYTD)
  ) {
    return {
      targetFyExists: true,
      income: targetFyRecord.netIncomeCommonYTD,
      source: 'netIncomeCommonYTD',
      unavailableReasonAr: null,
    };
  }

  if (
    targetFyRecord.netIncomeCommonBasis === 'attested_net_income_equals_common' &&
    targetFyRecord.netProfitYTD !== undefined &&
    targetFyRecord.netProfitYTD !== null &&
    Number.isFinite(targetFyRecord.netProfitYTD)
  ) {
    return {
      targetFyExists: true,
      income: targetFyRecord.netProfitYTD,
      source: 'netProfitYTD_attested_common',
      unavailableReasonAr: null,
    };
  }

  if (
    targetFyRecord.netProfitYTD !== undefined &&
    targetFyRecord.netProfitYTD !== null &&
    Number.isFinite(targetFyRecord.netProfitYTD)
  ) {
    return {
      targetFyExists: true,
      income: null,
      source: 'unavailable',
      unavailableReasonAr: `يتطلب حساب نسبة التوزيع والاحتجاز التاريخي للسنة FY ${targetFiscalYear} توثيق صافي ربح المساهمين العاديين (NetIncomeCommon_YTD) أو إقرار تطابقه مع صافي الربح (attested_net_income_equals_common)؛ لا يُعتمد صافي الربح العام تلقائياً لاحتمال وجود حقوق أقلية أو حصص ممتازة.`,
    };
  }

  return {
    targetFyExists: true,
    income: null,
    source: 'unavailable',
    unavailableReasonAr: `صافي ربح المساهمين العاديين للسنة المالية FY ${targetFiscalYear} غير متاح.`,
  };
}

function evaluateRimRetentionSuitability(params: {
  dividendYearStatus: DividendYearStatusValue;
  targetFiscalYear: number | null;
  fiscalYearIncomeUsed: number | null;
  historicalRetentionRatio: number | null;
  payoutUnavailableReasonAr: string | null;
  hasConflict?: boolean;
}): {
  suitable: boolean;
  blockReasonAr: string | null;
} {
  if (params.hasConflict) {
    return {
      suitable: false,
      blockReasonAr:
        'يوجد تعارض بين سجلات التوزيع المعتمدة وحالة عدم التوزيع المؤكد (confirmed_no_dividend)؛ يجب حسم الحالة أولاً قبل تغذية RIM.',
    };
  }
  if (
    params.dividendYearStatus !== 'complete' &&
    params.dividendYearStatus !== 'confirmed_no_dividend'
  ) {
    const statusLabel =
      params.dividendYearStatus === 'partial' ? 'جزئية (partial)' : 'غير مؤكدة (unknown)';
    return {
      suitable: false,
      blockReasonAr: `تم حجب نسبة الاحتجاز التاريخية عن RIM لأن حالة اكتمال توزيعات السنة${
        params.targetFiscalYear ? ` (${params.targetFiscalYear})` : ''
      } هي ${statusLabel}؛ أدخل معامل RIM_Retention يدوياً أو أكمل توثيق توزيعات السنة.`,
    };
  }
  if (params.fiscalYearIncomeUsed === null || params.fiscalYearIncomeUsed <= 0) {
    return {
      suitable: false,
      blockReasonAr:
        params.payoutUnavailableReasonAr ||
        'تم حجب نسبة الاحتجاز التاريخية عن RIM لأن صافي ربح المساهمين العاديين للسنة المالية غير متاح أو غير موجب (<= 0)؛ يُرجى إدخال معامل RIM_Retention موثق يدوياً.',
    };
  }
  const ret = params.historicalRetentionRatio;
  if (ret === null || !Number.isFinite(ret)) {
    return {
      suitable: false,
      blockReasonAr:
        params.payoutUnavailableReasonAr ||
        'نسبة الاحتجاز التاريخية غير متاحة؛ يُرجى إدخال معامل RIM_Retention موثق يدوياً.',
    };
  }
  if (ret < 0 || ret > 1) {
    return {
      suitable: false,
      blockReasonAr: `تم حجب نسبة الاحتجاز التاريخية (${(ret * 100).toFixed(
        1
      )}%) من التغذية الآلية لنموذج RIM لأنها خارج النطاق الصالح [0%..100%]؛ يُرجى إدخال معامل RIM_Retention موثق يدوياً.`,
    };
  }
  return { suitable: true, blockReasonAr: null };
}

/**
 * حل التوزيعات النقدية المعتمدة للسهم من مصدر الحقيقة الوحيد (DPS_Actual / dividend_records + dividend_year_statuses):
 * - إنهاء الاعتماد على الحقل القديم quarterly.dpsCurrent نهائياً.
 * - تطبيق قواعد قطع التواريخ على سجلات التوزيع وتأكيدات حالات السنوات (confirmedAt <= cutoffDate).
 * - تتبع التوزيع المصروف فعلياً (paid) يشترط وجود paymentDate صالح <= cutoffDate.
 * - تطبيق بوابة صلاحية DDM وتقييم الاستقرار التاريخي وسياسة اختيار السنة المرجعية المركزية.
 */
export function resolveDividendAnalyticsForStock(
  params: ResolveDividendAnalyticsParams
): DividendAggregationSummary {
  const ticker = normalizedTicker(params.ticker);
  const rawDateCandidate = params.valuationDate ?? params.cutoffDate ?? null;
  const cutoffDate =
    rawDateCandidate && isValidCalendarDate(rawDateCandidate)
      ? rawDateCandidate
      : new Date().toISOString().slice(0, 10);

  const quarters = params.quarterlyRecords ?? [];
  const fyYears = quarters
    .filter((q) => q.quarter === 'FY')
    .map((q) => q.year)
    .sort((a, b) => b - a);
  const completedFiscalYear = fyYears.length > 0 ? fyYears[0] : null;
  const fyYearSet = new Set(fyYears);
  const interimFiscalYears = Array.from(
    new Set(quarters.filter((q) => !fyYearSet.has(q.year)).map((q) => q.year))
  ).sort((a, b) => b - a);

  const warningsAr: string[] = [];

  const allForTicker = (params.dividendRecords ?? []).filter((r) => {
    if (!r || r.isDeleted === true) return false;
    try {
      return normalizedTicker(r.ticker) === ticker;
    } catch {
      return false;
    }
  });

  let excludedCancelledCount = 0;
  let excludedProposedCount = 0;
  let excludedFutureCount = 0;
  let excludedCurrencyMismatchCount = 0;

  const eligible: DividendRecord[] = [];
  for (const rec of allForTicker) {
    if (rec.approvalStatus === 'cancelled') {
      excludedCancelledCount += 1;
      continue;
    }
    if (rec.approvalStatus === 'proposed') {
      excludedProposedCount += 1;
      continue;
    }
    if (rec.asOfDate > cutoffDate) {
      excludedFutureCount += 1;
      continue;
    }
    if (rec.currency && params.financialCurrency) {
      const normalizedRecCur = normalizeStrictCurrency(rec.currency);
      if (normalizedRecCur.code && normalizedRecCur.code !== params.financialCurrency) {
        excludedCurrencyMismatchCount += 1;
        continue;
      }
    }
    eligible.push(rec);
  }

  if (excludedProposedCount > 0) {
    warningsAr.push(
      `تم استبعاد ${excludedProposedCount} سجل توزيع بحالة "مقترح" (proposed) تلقائياً من التوزيعات الفعلية وDDM حتى تأكيد اعتماده أو صرفه.`
    );
  }
  if (excludedFutureCount > 0) {
    warningsAr.push(
      `تم استبعاد ${excludedFutureCount} سجل توزيع لأن تاريخ إعلانه/اعتماده (asOfDate) لاحق لتاريخ التقييم (${cutoffDate}).`
    );
  }
  if (excludedCurrencyMismatchCount > 0) {
    warningsAr.push(
      `تم استبعاد ${excludedCurrencyMismatchCount} سجل توزيع لاختلاف عملته عن عملة القوائم المالية (${params.financialCurrency}).`
    );
  }

  const yearPolicy = resolveDividendYearPolicy({
    ticker,
    cutoffDate,
    allDividendRecordsForTicker: allForTicker,
    eligibleRecordsWithinCutoff: eligible,
    rawStatusesForTicker: params.dividendYearStatuses ?? [],
    completedFiscalYear,
  });

  warningsAr.push(...yearPolicy.warningsAr);

  const stabilityEval = evaluateRegularDividendStability({
    eligibleRecords: eligible,
    trustedStatusByYear: yearPolicy.trustedStatusByYear,
  });

  // Case 1: Proven confirmed_no_dividend wins for targetFiscalYear
  if (
    yearPolicy.basisSourceKind === 'confirmed_no_dividend' &&
    yearPolicy.targetFiscalYear !== null &&
    yearPolicy.confirmedNoDividendStatusRecord
  ) {
    const targetFiscalYear = yearPolicy.targetFiscalYear;
    const preferredNoDiv = yearPolicy.confirmedNoDividendStatusRecord;
    const incomeRes = resolveFiscalYearCommonIncome(quarters, targetFiscalYear);
    let historicalPayoutRatio: number | null = null;
    let historicalRetentionRatio: number | null = null;
    let payoutUnavailableReasonAr = incomeRes.unavailableReasonAr;

    if (incomeRes.income !== null && incomeRes.income > 0) {
      historicalPayoutRatio = 0;
      historicalRetentionRatio = 1;
      payoutUnavailableReasonAr = null;
    } else if (incomeRes.targetFyExists && !payoutUnavailableReasonAr) {
      payoutUnavailableReasonAr = `صافي ربح المساهمين العاديين للسنة المالية FY ${targetFiscalYear} غير موجب (<= 0) لحساب نسبة الاحتجاز التاريخية.`;
    }

    const rimSuit = evaluateRimRetentionSuitability({
      dividendYearStatus: 'confirmed_no_dividend',
      targetFiscalYear,
      fiscalYearIncomeUsed: incomeRes.income,
      historicalRetentionRatio,
      payoutUnavailableReasonAr,
    });

    const ddmGate = resolveDdmEligibilityGate({
      source: 'confirmed_no_dividend',
      dividendYearStatus: 'confirmed_no_dividend',
      basisFiscalYear: yearPolicy.ddmBasisFiscalYear,
      regularDps: 0,
      specialDps: 0,
      matchedRegularRecords: [],
    });

    return {
      ticker,
      cutoffDate,
      valuationDate: cutoffDate,
      targetFiscalYear,
      displayLatestEventsYear: yearPolicy.displayLatestEventsYear,
      latestPositiveDividendYear: yearPolicy.latestPositiveDividendYear,
      ddmBasisFiscalYear: yearPolicy.ddmBasisFiscalYear,
      retentionFiscalYear: yearPolicy.retentionFiscalYear,
      fiscalYearDataAgeYears: yearPolicy.fiscalYearDataAgeYears,
      yearResolutionNoteAr: yearPolicy.yearResolutionNoteAr,
      source: 'confirmed_no_dividend',
      dividendYearStatus: 'confirmed_no_dividend',
      dividendYearStatusSource: preferredNoDiv.confirmedSource ?? null,
      dividendYearStatusConfirmedAt: preferredNoDiv.confirmedAt ?? null,
      dividendYearStatusNotes: preferredNoDiv.notes ?? null,
      regularDps: 0,
      specialDps: 0,
      totalDps: 0,
      ddmEligible: ddmGate.ddmEligible,
      ddmBasisStatus: ddmGate.ddmBasisStatus,
      ddmIneligibleReasonAr: ddmGate.ddmIneligibleReasonAr,
      ddmInputMethod: ddmGate.ddmInputMethod,
      dividendStabilityWarningAr: stabilityEval.stabilityWarningAr,
      dividendSuitabilityNoteAr: stabilityEval.suitabilityNoteAr,
      paidRegularDps: 0,
      paidSpecialDps: 0,
      paidTotalDps: 0,
      paidAttributableDividends: 0,
      paidRecordsCount: 0,
      paidMissingPaymentDateCount: 0,
      totalAttributableDividends: 0,
      attributableBasis: 'confirmed_no_dividend',
      attributableUnavailableReasonAr: null,
      fiscalYearIncomeUsed: incomeRes.income,
      fiscalYearIncomeSource: incomeRes.source,
      payoutUnavailableReasonAr,
      completedFiscalYear,
      interimFiscalYears,
      historicalPayoutRatio,
      historicalRetentionRatio,
      partialPayoutRatio: null,
      partialRetentionRatio: null,
      historicalRetentionSuitableForRim: rimSuit.suitable,
      historicalRetentionRimBlockReasonAr: rimSuit.blockReasonAr,
      ddmVsRetentionDifferenceReasonAr: explainDdmVsRetentionBasisDifferenceAr({
        ddmEligible: ddmGate.ddmEligible,
        ddmBasisStatus: ddmGate.ddmBasisStatus,
        dividendYearStatus: 'confirmed_no_dividend',
        targetFiscalYear,
        historicalRetentionSuitableForRim: rimSuit.suitable,
      }),
      dividendDatePolicyNoteAr: DIVIDEND_DATE_POLICY_NOTE_AR,
      currency: params.financialCurrency,
      matchedRecordIds: [],
      matchedRecordsCount: 0,
      excludedFutureCount,
      excludedProposedCount,
      excludedCancelledCount,
      excludedCurrencyMismatchCount,
      excludedDeduplicatedCount: 0,
      statusCutoffExcludedCount: yearPolicy.statusCutoffExcludedCount,
      statusMissingDateCount: yearPolicy.statusMissingDateCount,
      legacyFallbackUsed: false,
      legacyFallbackBlockedReasonAr: null,
      warningsAr,
    };
  }

  // Case 2: Missing eligible records (either no dividend_records at all, or all excluded by status/date/currency)
  if (eligible.length === 0 || yearPolicy.targetFiscalYear === null) {
    const latestAllYear =
      allForTicker.length > 0
        ? Math.max(...allForTicker.map((r) => r.fiscalYear))
        : yearPolicy.displayLatestEventsYear;
    const statusRec =
      latestAllYear !== null
        ? yearPolicy.trustedStatusByYear.get(latestAllYear) ?? null
        : Array.from(yearPolicy.trustedStatusByYear.values()).sort(
            (a, b) => b.fiscalYear - a.fiscalYear
          )[0] ?? null;

    const resolvedStatus: DividendYearStatusValue = statusRec?.status ?? 'unknown';
    const unavailableReason =
      allForTicker.length === 0
        ? 'لا توجد سجلات توزيعات موثقة في DPS_Actual للسهم (حالة توزيعات السنة غير مؤكدة unknown).'
        : `جميع سجلات التوزيع في DPS_Actual للسهم ${ticker} مستبعدة (مقترحة أو ملغاة أو بتاريخ إعلان بعد تاريخ التقييم ${cutoffDate} أو بعملة مخالفة).`;
    warningsAr.push(unavailableReason);

    const rimSuit = evaluateRimRetentionSuitability({
      dividendYearStatus: resolvedStatus,
      targetFiscalYear: statusRec?.fiscalYear ?? completedFiscalYear,
      fiscalYearIncomeUsed: null,
      historicalRetentionRatio: null,
      payoutUnavailableReasonAr: unavailableReason,
    });

    const ddmGate = resolveDdmEligibilityGate({
      source: 'missing',
      dividendYearStatus: resolvedStatus,
      basisFiscalYear: yearPolicy.ddmBasisFiscalYear,
      regularDps: null,
      specialDps: null,
      matchedRegularRecords: [],
    });

    return {
      ticker,
      cutoffDate,
      valuationDate: cutoffDate,
      targetFiscalYear: null,
      displayLatestEventsYear: yearPolicy.displayLatestEventsYear,
      latestPositiveDividendYear: yearPolicy.latestPositiveDividendYear,
      ddmBasisFiscalYear: yearPolicy.ddmBasisFiscalYear,
      retentionFiscalYear: yearPolicy.retentionFiscalYear,
      fiscalYearDataAgeYears: yearPolicy.fiscalYearDataAgeYears,
      yearResolutionNoteAr: yearPolicy.yearResolutionNoteAr,
      source: 'missing',
      dividendYearStatus: resolvedStatus,
      dividendYearStatusSource: statusRec?.confirmedSource ?? null,
      dividendYearStatusConfirmedAt: statusRec?.confirmedAt ?? null,
      dividendYearStatusNotes: statusRec?.notes ?? null,
      regularDps: null,
      specialDps: null,
      totalDps: null,
      ddmEligible: ddmGate.ddmEligible,
      ddmBasisStatus: ddmGate.ddmBasisStatus,
      ddmIneligibleReasonAr: ddmGate.ddmIneligibleReasonAr,
      ddmInputMethod: ddmGate.ddmInputMethod,
      dividendStabilityWarningAr: stabilityEval.stabilityWarningAr,
      dividendSuitabilityNoteAr: stabilityEval.suitabilityNoteAr,
      paidRegularDps: null,
      paidSpecialDps: null,
      paidTotalDps: null,
      paidAttributableDividends: null,
      paidRecordsCount: 0,
      paidMissingPaymentDateCount: 0,
      totalAttributableDividends: null,
      attributableBasis: 'unavailable',
      attributableUnavailableReasonAr: unavailableReason,
      fiscalYearIncomeUsed: null,
      fiscalYearIncomeSource: 'unavailable',
      payoutUnavailableReasonAr: unavailableReason,
      completedFiscalYear,
      interimFiscalYears,
      historicalPayoutRatio: null,
      historicalRetentionRatio: null,
      partialPayoutRatio: null,
      partialRetentionRatio: null,
      historicalRetentionSuitableForRim: rimSuit.suitable,
      historicalRetentionRimBlockReasonAr: rimSuit.blockReasonAr,
      ddmVsRetentionDifferenceReasonAr: null,
      dividendDatePolicyNoteAr: DIVIDEND_DATE_POLICY_NOTE_AR,
      currency: params.financialCurrency,
      matchedRecordIds: [],
      matchedRecordsCount: 0,
      excludedFutureCount,
      excludedProposedCount,
      excludedCancelledCount,
      excludedCurrencyMismatchCount,
      excludedDeduplicatedCount: 0,
      statusCutoffExcludedCount: yearPolicy.statusCutoffExcludedCount,
      statusMissingDateCount: yearPolicy.statusMissingDateCount,
      legacyFallbackUsed: false,
      legacyFallbackBlockedReasonAr: null,
      warningsAr,
    };
  }

  // Case 3: Active approved/paid dividend_records matched within cutoff for resolved targetFiscalYear
  const targetFiscalYear = yearPolicy.targetFiscalYear;
  const yearRecords = eligible.filter((r) => r.fiscalYear === targetFiscalYear);

  const yearStatusRecord = yearPolicy.trustedStatusByYear.get(targetFiscalYear) ?? null;
  const dividendYearStatus: DividendYearStatusValue = yearStatusRecord?.status ?? 'unknown';
  const hasConfirmedNoDivConflict = dividendYearStatus === 'confirmed_no_dividend';
  if (hasConfirmedNoDivConflict) {
    warningsAr.push(
      `تضارب حوكمة: السنة المالية ${targetFiscalYear} مسجلة بحالة "عدم توزيع مؤكد" (confirmed_no_dividend) مع وجود سجلات توزيع معتمدة أو مدفوعة؛ تم إيقاف اعتماد نسبة التوزيع التاريخية حتى تصحيح الحالة.`
    );
  }

  const regularRes = aggregateDividendBucket(
    yearRecords.filter((r) => r.recordType === 'regular'),
    'regular'
  );
  const specialRes = aggregateDividendBucket(
    yearRecords.filter((r) => r.recordType === 'special'),
    'special'
  );

  warningsAr.push(...regularRes.warnings, ...specialRes.warnings);

  const regularDps = regularRes.dps;
  const specialDps = specialRes.dps;
  const totalDps =
    regularDps !== null || specialDps !== null
      ? (regularDps ?? 0) + (specialDps ?? 0)
      : null;

  // Paid subset: strictly requires explicit valid paymentDate <= cutoffDate
  let paidMissingPaymentDateCount = 0;
  for (const r of yearRecords) {
    if (r.approvalStatus === 'paid' && (!r.paymentDate || !isValidCalendarDate(r.paymentDate))) {
      paidMissingPaymentDateCount += 1;
    }
  }
  if (paidMissingPaymentDateCount > 0) {
    warningsAr.push(
      `يوجد ${paidMissingPaymentDateCount} سجل توزيع بحالة "paid" دون تاريخ صرف صالح (paymentDate)؛ لم يُحتسب ضمن الجزء المصروف فعلياً عند تاريخ التقييم (${cutoffDate}).`
    );
  }

  const isPaidAsOfCutoff = (r: DividendRecord): boolean =>
    r.approvalStatus === 'paid' &&
    Boolean(r.paymentDate && isValidCalendarDate(r.paymentDate) && r.paymentDate <= cutoffDate);

  const paidRegularRes = aggregateDividendBucket(
    yearRecords.filter((r) => r.recordType === 'regular' && isPaidAsOfCutoff(r)),
    'regular'
  );
  const paidSpecialRes = aggregateDividendBucket(
    yearRecords.filter((r) => r.recordType === 'special' && isPaidAsOfCutoff(r)),
    'special'
  );
  const paidRegularDps = paidRegularRes.dps;
  const paidSpecialDps = paidSpecialRes.dps;
  const paidTotalDps =
    paidRegularDps !== null || paidSpecialDps !== null
      ? (paidRegularDps ?? 0) + (paidSpecialDps ?? 0)
      : null;
  const paidRecordsCount =
    paidRegularRes.matchedRecords.length + paidSpecialRes.matchedRecords.length;
  let paidAttributableDividends: number | null = null;
  if (
    paidRecordsCount > 0 &&
    (paidRegularRes.matchedRecords.length === 0 || paidRegularRes.attributableAmount !== null) &&
    (paidSpecialRes.matchedRecords.length === 0 || paidSpecialRes.attributableAmount !== null)
  ) {
    paidAttributableDividends =
      (paidRegularRes.attributableAmount ?? 0) + (paidSpecialRes.attributableAmount ?? 0);
  }

  let totalAttributableDividends: number | null = null;
  let attributableBasis: DividendAggregationSummary['attributableBasis'] = 'unavailable';
  let attributableUnavailableReasonAr: string | null = null;

  const matchedRegularCount = regularRes.matchedRecords.length;
  const matchedSpecialCount = specialRes.matchedRecords.length;
  if (
    (matchedRegularCount === 0 || regularRes.attributableAmount !== null) &&
    (matchedSpecialCount === 0 || specialRes.attributableAmount !== null) &&
    matchedRegularCount + matchedSpecialCount > 0
  ) {
    totalAttributableDividends =
      (regularRes.attributableAmount ?? 0) + (specialRes.attributableAmount ?? 0);
    attributableBasis =
      regularRes.attributableBasis !== 'unavailable'
        ? regularRes.attributableBasis
        : specialRes.attributableBasis;
  } else {
    attributableUnavailableReasonAr =
      'تعذر حساب إجمالي التوزيعات النقدية لعدم توثيق TotalDistributionAmount أو EligibleSharesCount (ولا يُضرب CashDPS في الأسهم الحالية).';
    warningsAr.push(attributableUnavailableReasonAr);
  }

  // Strict Common Shareholder Net Income Denominator for FY
  const incomeRes = resolveFiscalYearCommonIncome(quarters, targetFiscalYear);
  const fiscalYearIncomeUsed = incomeRes.income;
  const fiscalYearIncomeSource = incomeRes.source;
  let payoutUnavailableReasonAr = incomeRes.unavailableReasonAr;

  if (incomeRes.targetFyExists && fiscalYearIncomeUsed !== null && fiscalYearIncomeUsed <= 0) {
    payoutUnavailableReasonAr = `صافي ربح المساهمين العاديين للسنة المالية FY ${targetFiscalYear} غير موجب (<= 0) لحساب نسبة التوزيع التاريخية.`;
  } else if (totalAttributableDividends === null) {
    payoutUnavailableReasonAr = attributableUnavailableReasonAr;
  }

  const rawPayoutRatio =
    totalAttributableDividends !== null &&
    fiscalYearIncomeUsed !== null &&
    fiscalYearIncomeUsed > 0
      ? totalAttributableDividends / fiscalYearIncomeUsed
      : null;
  const rawRetentionRatio = rawPayoutRatio !== null ? 1 - rawPayoutRatio : null;

  let historicalPayoutRatio: number | null = null;
  let historicalRetentionRatio: number | null = null;
  let partialPayoutRatio: number | null = null;
  let partialRetentionRatio: number | null = null;

  if (hasConfirmedNoDivConflict) {
    payoutUnavailableReasonAr =
      'تعارض حوكمة: وجود توزيعات معتمدة مع حالة confirmed_no_dividend يمنع اعتماد نسبة التوزيع التاريخية.';
  } else if (dividendYearStatus === 'complete') {
    historicalPayoutRatio = rawPayoutRatio;
    historicalRetentionRatio = rawRetentionRatio;
    if (historicalPayoutRatio !== null && historicalPayoutRatio > 1) {
      warningsAr.push(
        `نسبة التوزيع التاريخية للسنة ${targetFiscalYear} تبلغ ${(historicalPayoutRatio * 100).toFixed(
          1
        )}% (> 100% من صافي ربح المساهمين العاديين)؛ نسبة الاحتجاز التاريخية (1 - Payout) سالبة ولا يتم تقليمها صامتاً.`
      );
    }
  } else {
    partialPayoutRatio = rawPayoutRatio;
    partialRetentionRatio = rawRetentionRatio;
    if (!payoutUnavailableReasonAr) {
      const statusText =
        dividendYearStatus === 'partial' ? 'جزئية (partial)' : 'غير مؤكدة الاكتمال (unknown)';
      payoutUnavailableReasonAr = `حالة اكتمال توزيعات السنة ${targetFiscalYear} هي "${statusText}"؛ تم تعليق نسبة التوزيع/الاحتجاز الرسمية وإظهار النسبة الجزئية لأغراض المراجعة فقط حتى توثيق اكتمال السنة (complete).`;
    }
    if (partialPayoutRatio !== null) {
      warningsAr.push(
        `تنبيه تدقيقي: النسبة المحسوبة لتوزيعات ${targetFiscalYear} (${(partialPayoutRatio * 100).toFixed(
          1
        )}%) جزئية لأن حالة اكتمال التوزيعات للسنة لم تُؤكَّد كـ complete بعد.`
      );
    }
  }

  const rimSuit = evaluateRimRetentionSuitability({
    dividendYearStatus,
    targetFiscalYear,
    fiscalYearIncomeUsed,
    historicalRetentionRatio,
    payoutUnavailableReasonAr,
    hasConflict: hasConfirmedNoDivConflict,
  });

  const ddmGate = resolveDdmEligibilityGate({
    source: 'dividend_records',
    dividendYearStatus,
    basisFiscalYear: yearPolicy.ddmBasisFiscalYear ?? targetFiscalYear,
    regularDps,
    specialDps,
    matchedRegularRecords: regularRes.matchedRecords,
  });

  const ddmVsRetentionDifferenceReasonAr = explainDdmVsRetentionBasisDifferenceAr({
    ddmEligible: ddmGate.ddmEligible,
    ddmBasisStatus: ddmGate.ddmBasisStatus,
    dividendYearStatus,
    targetFiscalYear,
    historicalRetentionSuitableForRim: rimSuit.suitable,
  });

  if (regularDps !== null && regularDps > 0 && !ddmGate.ddmEligible && ddmGate.ddmIneligibleReasonAr) {
    warningsAr.push(ddmGate.ddmIneligibleReasonAr);
  }
  if (ddmVsRetentionDifferenceReasonAr) {
    warningsAr.push(ddmVsRetentionDifferenceReasonAr);
  }
  if (stabilityEval.stabilityWarningAr) {
    warningsAr.push(stabilityEval.stabilityWarningAr);
  }

  const matchedAll = [...regularRes.matchedRecords, ...specialRes.matchedRecords];
  const matchedRecordIds = matchedAll.map((r) =>
    buildDividendDocId({
      ticker: r.ticker,
      fiscalYear: r.fiscalYear,
      recordType: r.recordType,
      distributionId: r.distributionId,
    })
  );

  const resolvedCurrency =
    matchedAll.find((r) => r.currency)?.currency ?? params.financialCurrency ?? null;

  return {
    ticker,
    cutoffDate,
    valuationDate: cutoffDate,
    targetFiscalYear,
    displayLatestEventsYear: yearPolicy.displayLatestEventsYear,
    latestPositiveDividendYear: yearPolicy.latestPositiveDividendYear,
    ddmBasisFiscalYear: yearPolicy.ddmBasisFiscalYear ?? targetFiscalYear,
    retentionFiscalYear: yearPolicy.retentionFiscalYear ?? targetFiscalYear,
    fiscalYearDataAgeYears: yearPolicy.fiscalYearDataAgeYears,
    yearResolutionNoteAr: yearPolicy.yearResolutionNoteAr,
    source: 'dividend_records',
    dividendYearStatus,
    dividendYearStatusSource: yearStatusRecord?.confirmedSource ?? null,
    dividendYearStatusConfirmedAt: yearStatusRecord?.confirmedAt ?? null,
    dividendYearStatusNotes: yearStatusRecord?.notes ?? null,
    regularDps,
    specialDps,
    totalDps,
    ddmEligible: ddmGate.ddmEligible,
    ddmBasisStatus: ddmGate.ddmBasisStatus,
    ddmIneligibleReasonAr: ddmGate.ddmIneligibleReasonAr,
    ddmInputMethod: ddmGate.ddmInputMethod,
    dividendStabilityWarningAr: stabilityEval.stabilityWarningAr,
    dividendSuitabilityNoteAr: stabilityEval.suitabilityNoteAr,
    paidRegularDps,
    paidSpecialDps,
    paidTotalDps,
    paidAttributableDividends,
    paidRecordsCount,
    paidMissingPaymentDateCount,
    totalAttributableDividends,
    attributableBasis,
    attributableUnavailableReasonAr,
    fiscalYearIncomeUsed,
    fiscalYearIncomeSource,
    payoutUnavailableReasonAr,
    completedFiscalYear,
    interimFiscalYears,
    historicalPayoutRatio,
    historicalRetentionRatio,
    partialPayoutRatio,
    partialRetentionRatio,
    historicalRetentionSuitableForRim: rimSuit.suitable,
    historicalRetentionRimBlockReasonAr: rimSuit.blockReasonAr,
    ddmVsRetentionDifferenceReasonAr,
    dividendDatePolicyNoteAr: DIVIDEND_DATE_POLICY_NOTE_AR,
    currency: resolvedCurrency,
    matchedRecordIds,
    matchedRecordsCount: matchedAll.length,
    excludedFutureCount,
    excludedProposedCount,
    excludedCancelledCount,
    excludedCurrencyMismatchCount,
    excludedDeduplicatedCount: regularRes.deduplicatedCount + specialRes.deduplicatedCount,
    statusCutoffExcludedCount: yearPolicy.statusCutoffExcludedCount,
    statusMissingDateCount: yearPolicy.statusMissingDateCount,
    legacyFallbackUsed: false,
    legacyFallbackBlockedReasonAr: null,
    warningsAr,
  };
}

function buildMissingRimRetentionDiagnosticAr(params: {
  policy: 'rim_parameter' | 'minimum';
  rimRetentionResolved?: Pick<ResolvedAssumption, 'source' | 'companyValue' | 'globalValue'> | null;
  assumptionPriority?: AssumptionPriority;
}): string {
  const priorityLabelAr =
    params.assumptionPriority === 'global_first'
      ? 'المرجع العام (macro_params) ثم تخصيص الشركة (company_assumptions)'
      : 'تخصيص الشركة (company_assumptions) ثم المرجع العام (macro_params)';

  const sourceStateAr =
    params.rimRetentionResolved && params.rimRetentionResolved.source === 'missing'
      ? `لا توجد قيمة فعالة لمعامل RIM_Retention في المصادر المعتمدة (تخصيص الشركة company_assumptions أو المرجع العام macro_params) وفق أولوية المصادر النشطة (${priorityLabelAr})`
      : `لا توجد قيمة فعالة لمعامل RIM_Retention في المصادر المعتمدة (تخصيص الشركة company_assumptions أو المرجع العام macro_params) وفق أولوية المصادر (${priorityLabelAr})`;

  if (params.policy === 'minimum') {
    return `سياسة احتجاز RIM (الحد الأدنى): قاعدة الاختيار min(RIM_Retention, Historical_Retention) تتطلب توفر معامل RIM_Retention ونسبة الاحتجاز التاريخية الصالحة؛ ${sourceStateAr}. خطوة الاستكمال: احفظ قيمة صالحة لـ RIM_Retention (0% إلى 100%) في تخصيص الشركة (company_assumptions) أو في المرجع العام (macro_params).`;
  }

  return `${sourceStateAr}. خطوة الاستكمال: احفظ قيمة صالحة لـ RIM_Retention (0% إلى 100%) في تخصيص الشركة (company_assumptions) أو في المرجع العام (macro_params)، أو بدّل سياسة احتجاز RIM إلى الاحتجاز التاريخي (historical_retention) عند توفر بيانات توزيعات مكتملة وصالحة.`;
}

export function resolveRimRetentionValue(params: {
  policy: RimRetentionPolicy;
  rimRetentionParam: number | null;
  rimRetentionResolved?: Pick<ResolvedAssumption, 'source' | 'companyValue' | 'globalValue'> | null;
  assumptionPriority?: AssumptionPriority;
  historicalRetentionRatio: number | null;
  historicalRetentionSuitableForRim?: boolean;
  historicalRetentionBlockReasonAr?: string | null;
}): {
  retention: number | null;
  noteAr: string | null;
} {
  const {
    policy,
    rimRetentionParam,
    rimRetentionResolved,
    assumptionPriority,
    historicalRetentionRatio,
    historicalRetentionSuitableForRim,
    historicalRetentionBlockReasonAr,
  } = params;

  if (policy === 'rim_parameter') {
    return {
      retention: rimRetentionParam,
      noteAr:
        rimRetentionParam !== null
          ? `سياسة احتجاز RIM: معامل RIM_Retention المعتمد (${(rimRetentionParam * 100).toFixed(1)}%).`
          : buildMissingRimRetentionDiagnosticAr({
              policy: 'rim_parameter',
              rimRetentionResolved,
              assumptionPriority,
            }),
    };
  }

  const isHistoricalBounded =
    historicalRetentionRatio !== null &&
    Number.isFinite(historicalRetentionRatio) &&
    historicalRetentionRatio >= 0 &&
    historicalRetentionRatio <= 1 &&
    historicalRetentionSuitableForRim !== false;

  if (!isHistoricalBounded) {
    return {
      retention: null,
      noteAr:
        historicalRetentionBlockReasonAr ||
        (historicalRetentionRatio !== null && (historicalRetentionRatio < 0 || historicalRetentionRatio > 1)
          ? `تم حجب نسبة الاحتجاز التاريخية (${(historicalRetentionRatio * 100).toFixed(
              1
            )}%) عن RIM لوقوعها خارج [0%..100%]؛ يُرجى استخدام معامل RIM_Retention موثق يدوياً.`
          : 'سياسة احتجاز RIM: نسبة الاحتجاز التاريخية غير صالحة أو غير مكتملة لتغذية RIM؛ يُرجى استخدام معامل RIM_Retention موثق يدوياً.'),
    };
  }

  if (policy === 'historical_retention') {
    return {
      retention: historicalRetentionRatio,
      noteAr: `سياسة احتجاز RIM: نسبة الاحتجاز التاريخية (${(historicalRetentionRatio * 100).toFixed(1)}%).`,
    };
  }

  if (rimRetentionParam === null || !Number.isFinite(rimRetentionParam)) {
    return {
      retention: null,
      noteAr: buildMissingRimRetentionDiagnosticAr({
        policy: 'minimum',
        rimRetentionResolved,
        assumptionPriority,
      }),
    };
  }
  const minVal = Math.min(rimRetentionParam, historicalRetentionRatio);
  return {
    retention: minVal,
    noteAr: `سياسة احتجاز RIM: قاعدة اختيار min(RIM_Retention=${(rimRetentionParam * 100).toFixed(
      1
    )}%, Historical=${(historicalRetentionRatio * 100).toFixed(1)}%) = ${(minVal * 100).toFixed(
      1
    )}% (لا تعدّل المعامل المحفوظ).`,
  };
}
