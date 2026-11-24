/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DdmBasisStatus,
  DividendRecord,
  DividendYearStatusRecord,
  DividendYearStatusValue,
} from '../../types';
import {
  isActiveDividendRecordForConflict,
  isValidCalendarDate,
  normalizedTicker,
} from '../contracts';

export const DIVIDEND_COMPLETENESS_BASIS_RULES = {
  ddmPermitsAnnualTotalWhenYearUnknown: true,
  retentionRequiresCompleteOrConfirmedNoDividend: true,
  ddmRuleAr:
    'نموذج DDM (جوردون) يقبل التوزيع المنتظم (regular) متى توافر سجل إجمالي سنوي معتمد (annual_total) أو سنة موثقة الاكتمال (complete).',
  retentionRuleAr:
    'نسبة التوزيع الرسمية ونسبة الاحتجاز التاريخية (Historical Payout / Retention) لتغذية RIM تشترط توثيق اكتمال السنة كاملةً (complete أو confirmed_no_dividend) لتفادي تشوه الاحتجاز بغياب التوزيعات الاستثنائية أو الأقساط الأخرى.',
} as const;

export function explainDdmVsRetentionBasisDifferenceAr(params: {
  ddmEligible: boolean;
  ddmBasisStatus: DdmBasisStatus;
  dividendYearStatus: DividendYearStatusValue;
  targetFiscalYear: number | null;
  historicalRetentionSuitableForRim: boolean;
}): string | null {
  if (
    params.ddmEligible &&
    params.ddmBasisStatus === 'eligible_annual_total' &&
    params.dividendYearStatus !== 'complete' &&
    !params.historicalRetentionSuitableForRim
  ) {
    const yr = params.targetFiscalYear ? ` (${params.targetFiscalYear})` : '';
    return `تفسير اختلاف أهلية DDM عن الاحتجاز التاريخي (RIM) للسنة${yr}: يعتمد نموذج DDM هنا على سجل التوزيع المنتظم السنوي (annual_total) باعتباره كافياً لقياس D0 المستدام رغم أن حالة اكتمال السنة ما زالت "${params.dividendYearStatus}"، بينما تشترط نسبة التوزيع والاحتجاز التاريخية (1 - Payout) توثيق اكتمال جميع توزيعات السنة (complete) لضمان عدم تضخيم نسبة الاحتجاز عند تغذية RIM.`;
  }
  return null;
}

export interface DividendYearResolutionParams {
  ticker: string;
  cutoffDate: string;
  allDividendRecordsForTicker: DividendRecord[];
  eligibleRecordsWithinCutoff: DividendRecord[];
  rawStatusesForTicker: DividendYearStatusRecord[];
  completedFiscalYear: number | null;
}

export interface DividendYearResolutionResult {
  cutoffDate: string;
  targetFiscalYear: number | null;
  displayLatestEventsYear: number | null;
  latestPositiveDividendYear: number | null;
  ddmBasisFiscalYear: number | null;
  retentionFiscalYear: number | null;
  fiscalYearDataAgeYears: number | null;
  yearResolutionNoteAr: string | null;
  basisSourceKind: 'dividend_records' | 'confirmed_no_dividend' | 'missing';
  confirmedNoDividendStatusRecord: DividendYearStatusRecord | null;
  trustedStatusByYear: Map<number, DividendYearStatusRecord>;
  displayStatusByYear: Map<number, DividendYearStatusRecord>;
  statusCutoffExcludedCount: number;
  statusMissingDateCount: number;
  warningsAr: string[];
}

function summarizeYearRecordsForResolution(records: DividendRecord[]): {
  hasPositiveDps: boolean;
  hasRegularAnnualTotal: boolean;
  hasAnyRegular: boolean;
} {
  let hasPositiveDps = false;
  let hasRegularAnnualTotal = false;
  let hasAnyRegular = false;

  for (const r of records) {
    if (r.cashDps > 0) hasPositiveDps = true;
    if (r.recordType === 'regular') {
      hasAnyRegular = true;
      if (r.distributionSemantics === 'annual_total') {
        hasRegularAnnualTotal = true;
      }
    }
  }
  return { hasPositiveDps, hasRegularAnnualTotal, hasAnyRegular };
}

/**
 * حل السنة المالية المرجعية للتوزيعات وفق سياسات الحوكمة الثلاث:
 * 1) قطع تواريخ dividend_year_statuses عند confirmedAt <= cutoffDate، وعدم الوثوق بتاريخ مفقود كتأكيد تاريخي.
 * 2) عند وجود سنة أحدث confirmed_no_dividend بعد سنة موجبة سابقة: تفوز confirmed_no_dividend الأحدث (regularDps = 0) مع حفظ latestPositiveDividendYear للمراجعة.
 * 3) عند كون السنة الأحدث partial/unknown: تُعرض في displayLatestEventsYear مع الرجوع في DDM والاحتجاز إلى أحدث سنة صالحة (complete أو confirmed_no_dividend) مع توثيق عمر البيانات.
 */
export function resolveDividendYearPolicy(
  params: DividendYearResolutionParams
): DividendYearResolutionResult {
  const ticker = normalizedTicker(params.ticker);
  const { cutoffDate, allDividendRecordsForTicker, eligibleRecordsWithinCutoff, rawStatusesForTicker } =
    params;

  const warningsAr: string[] = [];
  const trustedStatusByYear = new Map<number, DividendYearStatusRecord>();
  const displayStatusByYear = new Map<number, DividendYearStatusRecord>();
  let statusCutoffExcludedCount = 0;
  let statusMissingDateCount = 0;

  for (const st of rawStatusesForTicker) {
    if (!st || st.isDeleted === true) continue;
    let stTicker: string;
    try {
      stTicker = normalizedTicker(st.ticker);
    } catch {
      continue;
    }
    if (stTicker !== ticker) continue;

    const confirmedAt = typeof st.confirmedAt === 'string' ? st.confirmedAt.trim() : null;
    const isFormalProofStatus =
      st.status === 'complete' || st.status === 'confirmed_no_dividend';

    if (confirmedAt && isValidCalendarDate(confirmedAt)) {
      if (confirmedAt > cutoffDate) {
        statusCutoffExcludedCount += 1;
        warningsAr.push(
          `تم استبعاد توثيق حالة توزيعات السنة ${st.fiscalYear} (${st.status}) لأن تاريخ تأكيده (${confirmedAt}) لاحق لتاريخ التقييم (${cutoffDate}).`
        );
        continue;
      }
      trustedStatusByYear.set(st.fiscalYear, st);
      displayStatusByYear.set(st.fiscalYear, st);
    } else if (isFormalProofStatus) {
      statusMissingDateCount += 1;
      warningsAr.push(
        `توثيق حالة توزيعات السنة ${st.fiscalYear} (${st.status}) يفتقد تاريخ التأكيد الصالح (confirmedAt)؛ لا يُعتمد كتوثيق تاريخي موثوق عند تاريخ التقييم ${cutoffDate}.`
      );
      displayStatusByYear.set(st.fiscalYear, st);
    } else {
      trustedStatusByYear.set(st.fiscalYear, st);
      displayStatusByYear.set(st.fiscalYear, st);
    }
  }

  const eligibleByYear = new Map<number, DividendRecord[]>();
  for (const rec of eligibleRecordsWithinCutoff) {
    const arr = eligibleByYear.get(rec.fiscalYear) ?? [];
    arr.push(rec);
    eligibleByYear.set(rec.fiscalYear, arr);
  }

  const activeRecordYears = Array.from(eligibleByYear.keys()).sort((a, b) => b - a);
  const latestPositiveDividendYear =
    activeRecordYears.find((y) => summarizeYearRecordsForResolution(eligibleByYear.get(y)!).hasPositiveDps) ??
    null;

  const validConfirmedNoDivYears = Array.from(trustedStatusByYear.values())
    .filter((s) => {
      if (s.status !== 'confirmed_no_dividend') return false;
      const hasConflict = allDividendRecordsForTicker.some(
        (r) =>
          r.fiscalYear === s.fiscalYear &&
          r.asOfDate <= cutoffDate &&
          isActiveDividendRecordForConflict(r)
      );
      return !hasConflict;
    })
    .map((s) => s.fiscalYear)
    .sort((a, b) => b - a);

  const validConfirmedNoDivSet = new Set(validConfirmedNoDivYears);
  const latestConfirmedNoDivYear = validConfirmedNoDivYears[0] ?? null;
  const latestActiveRecordYear = activeRecordYears[0] ?? null;

  const partialOrCompleteYears = Array.from(trustedStatusByYear.values())
    .filter((s) => s.status === 'partial' || s.status === 'complete' || validConfirmedNoDivSet.has(s.fiscalYear))
    .map((s) => s.fiscalYear);

  const allEventYears = Array.from(
    new Set([...activeRecordYears, ...validConfirmedNoDivYears, ...partialOrCompleteYears])
  ).sort((a, b) => b - a);
  const displayLatestEventsYear = allEventYears[0] ?? null;

  const isFullBasisFallbackCandidate = (year: number): boolean => {
    if (validConfirmedNoDivSet.has(year)) return true;
    if (!eligibleByYear.has(year)) return false;
    const st = trustedStatusByYear.get(year)?.status;
    return st === 'complete';
  };

  const cutoffYear = Number(cutoffDate.slice(0, 4));
  const computeAgeYears = (basisYear: number | null): number | null =>
    basisYear !== null && Number.isFinite(cutoffYear) ? Math.max(0, cutoffYear - basisYear) : null;

  // Case 1: Newer proven confirmed_no_dividend wins over older positive dividend year(s)
  if (
    latestConfirmedNoDivYear !== null &&
    (latestActiveRecordYear === null || latestConfirmedNoDivYear > latestActiveRecordYear)
  ) {
    const statusRec = trustedStatusByYear.get(latestConfirmedNoDivYear) ?? null;
    let yearResolutionNoteAr: string | null = null;
    if (latestPositiveDividendYear !== null && latestPositiveDividendYear < latestConfirmedNoDivYear) {
      yearResolutionNoteAr = `تم اعتماد السنة الأحدث ${latestConfirmedNoDivYear} بحالة عدم توزيع مؤكد (confirmed_no_dividend، Regular DPS = 0) بدلاً من إحياء التوزيع الموجب السابق لعام ${latestPositiveDividendYear} في DDM والاحتجاز.`;
      warningsAr.push(yearResolutionNoteAr);
    } else if (
      displayLatestEventsYear !== null &&
      displayLatestEventsYear > latestConfirmedNoDivYear
    ) {
      const newerSt = trustedStatusByYear.get(displayLatestEventsYear)?.status ?? 'unknown';
      yearResolutionNoteAr = `السنة الأحدث (${displayLatestEventsYear}) بحالتها (${newerSt}) غير مكتملة التوثيق؛ تم اعتماد أحدث سنة ذات أساس مكتمل (${latestConfirmedNoDivYear}: confirmed_no_dividend).`;
      warningsAr.push(yearResolutionNoteAr);
    }

    return {
      cutoffDate,
      targetFiscalYear: latestConfirmedNoDivYear,
      displayLatestEventsYear: displayLatestEventsYear ?? latestConfirmedNoDivYear,
      latestPositiveDividendYear,
      ddmBasisFiscalYear: latestConfirmedNoDivYear,
      retentionFiscalYear: latestConfirmedNoDivYear,
      fiscalYearDataAgeYears: computeAgeYears(latestConfirmedNoDivYear),
      yearResolutionNoteAr,
      basisSourceKind: 'confirmed_no_dividend',
      confirmedNoDividendStatusRecord: statusRec,
      trustedStatusByYear,
      displayStatusByYear,
      statusCutoffExcludedCount,
      statusMissingDateCount,
      warningsAr,
    };
  }

  // Case 2 & Normal record resolution
  if (latestActiveRecordYear !== null) {
    const newestCandidateYear = displayLatestEventsYear ?? latestActiveRecordYear;
    const newestStatus = trustedStatusByYear.get(newestCandidateYear)?.status ?? 'unknown';
    const newestRecords = eligibleByYear.get(newestCandidateYear) ?? [];
    const newestSummary = summarizeYearRecordsForResolution(newestRecords);

    const newestIsUsableFullBasis =
      newestStatus === 'complete' ||
      validConfirmedNoDivSet.has(newestCandidateYear) ||
      (newestStatus !== 'partial' && newestSummary.hasRegularAnnualTotal);

    if (!newestIsUsableFullBasis) {
      const candidateFallbackYears = Array.from(
        new Set([...activeRecordYears, ...validConfirmedNoDivYears])
      )
        .filter((y) => y < newestCandidateYear && isFullBasisFallbackCandidate(y))
        .sort((a, b) => b - a);

      const fallbackYear = candidateFallbackYears[0] ?? null;
      if (fallbackYear !== null) {
        const ageYears = computeAgeYears(fallbackYear);
        const fallbackIsNoDiv = validConfirmedNoDivSet.has(fallbackYear);
        const statusDesc = newestStatus === 'partial' ? 'جزئية (partial)' : 'غير مؤكدة الاكتمال (unknown)';
        const yearResolutionNoteAr = `السنة الأحدث (${newestCandidateYear}) حالتها ${statusDesc}؛ تم عرض أحداثها للمراجعة مع الاعتماد في DDM ونسبة الاحتجاز على أحدث سنة موثقة بالكامل (${fallbackYear}${
          fallbackIsNoDiv ? ' - confirmed_no_dividend' : ' - complete'
        }${ageYears !== null ? `، عمر البيانات: ${ageYears} سنة` : ''}) دون افتراض استمرار التوزيعات.`;
        warningsAr.push(yearResolutionNoteAr);

        return {
          cutoffDate,
          targetFiscalYear: fallbackYear,
          displayLatestEventsYear: newestCandidateYear,
          latestPositiveDividendYear,
          ddmBasisFiscalYear: fallbackYear,
          retentionFiscalYear: fallbackYear,
          fiscalYearDataAgeYears: ageYears,
          yearResolutionNoteAr,
          basisSourceKind: fallbackIsNoDiv ? 'confirmed_no_dividend' : 'dividend_records',
          confirmedNoDividendStatusRecord: fallbackIsNoDiv
            ? trustedStatusByYear.get(fallbackYear) ?? null
            : null,
          trustedStatusByYear,
          displayStatusByYear,
          statusCutoffExcludedCount,
          statusMissingDateCount,
          warningsAr,
        };
      }
    }

    const chosenYear = latestActiveRecordYear;
    return {
      cutoffDate,
      targetFiscalYear: chosenYear,
      displayLatestEventsYear: displayLatestEventsYear ?? chosenYear,
      latestPositiveDividendYear,
      ddmBasisFiscalYear: chosenYear,
      retentionFiscalYear: chosenYear,
      fiscalYearDataAgeYears: computeAgeYears(chosenYear),
      yearResolutionNoteAr: null,
      basisSourceKind: 'dividend_records',
      confirmedNoDividendStatusRecord: null,
      trustedStatusByYear,
      displayStatusByYear,
      statusCutoffExcludedCount,
      statusMissingDateCount,
      warningsAr,
    };
  }

  return {
    cutoffDate,
    targetFiscalYear: null,
    displayLatestEventsYear,
    latestPositiveDividendYear,
    ddmBasisFiscalYear: null,
    retentionFiscalYear: null,
    fiscalYearDataAgeYears: null,
    yearResolutionNoteAr: null,
    basisSourceKind: 'missing',
    confirmedNoDividendStatusRecord: null,
    trustedStatusByYear,
    displayStatusByYear,
    statusCutoffExcludedCount,
    statusMissingDateCount,
    warningsAr,
  };
}

export function resolveDdmEligibilityGate(params: {
  source: 'dividend_records' | 'confirmed_no_dividend' | 'missing';
  dividendYearStatus: DividendYearStatusValue;
  basisFiscalYear: number | null;
  regularDps: number | null;
  specialDps: number | null;
  matchedRegularRecords: DividendRecord[];
}): {
  ddmEligible: boolean;
  ddmBasisStatus: DdmBasisStatus;
  ddmIneligibleReasonAr: string | null;
  ddmInputMethod: 'annual_total' | 'aggregated_complete_year' | null;
} {
  if (params.source === 'confirmed_no_dividend') {
    return {
      ddmEligible: false,
      ddmBasisStatus: 'blocked_confirmed_no_dividend',
      ddmIneligibleReasonAr:
        'DDM مستبعد: التوزيع النقدي المنتظم المؤكد يساوي صفراً (confirmed_no_dividend؛ لا ينطبق نموذج جوردون عند التوزيع الصفري).',
      ddmInputMethod: null,
    };
  }

  if (params.regularDps === null) {
    if (params.specialDps !== null && params.specialDps > 0) {
      return {
        ddmEligible: false,
        ddmBasisStatus: 'blocked_special_only',
        ddmIneligibleReasonAr:
          'DDM مستبعد: السهم لديه توزيعات استثنائية (special) فقط دون توزيع منتظم (regular)، والتوزيعات الاستثنائية لا تُغذّي نموذج جوردون.',
        ddmInputMethod: null,
      };
    }
    return {
      ddmEligible: false,
      ddmBasisStatus: 'blocked_missing',
      ddmIneligibleReasonAr: 'DDM مستبعد: التوزيع النقدي السنوي المنتظم غير متاح.',
      ddmInputMethod: null,
    };
  }

  if (params.regularDps <= 0) {
    return {
      ddmEligible: false,
      ddmBasisStatus: 'blocked_confirmed_no_dividend',
      ddmIneligibleReasonAr:
        'DDM مستبعد: التوزيع النقدي المنتظم المؤكد يساوي صفراً (لا ينطبق نموذج جوردون عند التوزيع الصفري، ولا تُضمّن التوزيعات الاستثنائية).',
      ddmInputMethod: null,
    };
  }

  const hasAnnualTotalRegular = params.matchedRegularRecords.some(
    (r) => r.distributionSemantics === 'annual_total'
  );

  if (params.dividendYearStatus === 'partial') {
    return {
      ddmEligible: false,
      ddmBasisStatus: 'blocked_partial_year',
      ddmIneligibleReasonAr: `DDM مستبعد: توزيعات السنة${
        params.basisFiscalYear ? ` (${params.basisFiscalYear})` : ''
      } جزئية (partial) وليست توزيعاً سنوياً مكتملاً؛ تم عرض Regular DPS للمراجعة دون تشغيل نموذج جوردون.`,
      ddmInputMethod: null,
    };
  }

  if (params.dividendYearStatus === 'confirmed_no_dividend') {
    return {
      ddmEligible: false,
      ddmBasisStatus: 'blocked_confirmed_no_dividend',
      ddmIneligibleReasonAr:
        'DDM مستبعد: وجود تعارض مع حالة confirmed_no_dividend يمنع استخدام التوزيع في نموذج جوردون.',
      ddmInputMethod: null,
    };
  }

  if (params.dividendYearStatus === 'complete') {
    return {
      ddmEligible: true,
      ddmBasisStatus: hasAnnualTotalRegular ? 'eligible_annual_total' : 'eligible_complete_year',
      ddmIneligibleReasonAr: null,
      ddmInputMethod: hasAnnualTotalRegular ? 'annual_total' : 'aggregated_complete_year',
    };
  }

  // dividendYearStatus === 'unknown'
  if (hasAnnualTotalRegular) {
    return {
      ddmEligible: true,
      ddmBasisStatus: 'eligible_annual_total',
      ddmIneligibleReasonAr: null,
      ddmInputMethod: 'annual_total',
    };
  }

  return {
    ddmEligible: false,
    ddmBasisStatus: 'blocked_unconfirmed_events',
    ddmIneligibleReasonAr:
      'DDM مستبعد: السجلات المتاحة عبارة عن أقساط أو أحداث منفردة (installment/standalone_event) بدون تأكيد اكتمال السنة (complete) أو سجل annual_total؛ تم عرض Regular DPS للمراجعة فقط.',
    ddmInputMethod: null,
  };
}

export function evaluateRegularDividendStability(params: {
  eligibleRecords: DividendRecord[];
  trustedStatusByYear: Map<number, DividendYearStatusRecord>;
}): {
  stabilityWarningAr: string | null;
  suitabilityNoteAr: string;
} {
  const regularByYear = new Map<number, DividendRecord[]>();
  for (const r of params.eligibleRecords) {
    if (r.recordType !== 'regular') continue;
    const arr = regularByYear.get(r.fiscalYear) ?? [];
    arr.push(r);
    regularByYear.set(r.fiscalYear, arr);
  }

  const seriesByYear = new Map<number, number>();
  for (const [yr, recs] of regularByYear.entries()) {
    const annual = recs
      .filter((r) => r.distributionSemantics === 'annual_total')
      .sort((a, b) => (b.asOfDate || '').localeCompare(a.asOfDate || ''));
    if (annual.length > 0) {
      seriesByYear.set(yr, annual[0].cashDps);
      continue;
    }
    const st = params.trustedStatusByYear.get(yr)?.status;
    if (st === 'complete') {
      const seen = new Set<string>();
      let sum = 0;
      const sorted = [...recs].sort((a, b) => (b.asOfDate || '').localeCompare(a.asOfDate || ''));
      const ids = new Set(sorted.map((x) => x.distributionId));
      for (const item of sorted) {
        if (seen.has(item.distributionId)) continue;
        seen.add(item.distributionId);
        if (
          item.distributionSemantics === 'installment' &&
          item.parentAnnouncementId &&
          ids.has(item.parentAnnouncementId)
        ) {
          continue;
        }
        sum += item.cashDps;
      }
      seriesByYear.set(yr, sum);
    }
  }

  for (const [yr, stRec] of params.trustedStatusByYear.entries()) {
    if (stRec.status === 'confirmed_no_dividend' && !seriesByYear.has(yr)) {
      seriesByYear.set(yr, 0);
    }
  }

  const sortedYears = Array.from(seriesByYear.keys()).sort((a, b) => a - b);
  if (sortedYears.length <= 1) {
    return {
      stabilityWarningAr: null,
      suitabilityNoteAr:
        'ملاحظة ملاءمة نموذج DDM (تُفصل عن اكتمال البيانات): يتوفر عام توزيع واحد موثق فقط؛ اكتمال بيانات السنة الحالية لا يثبت بمفرده استقرار التوزيعات على المدى الطويل لنموذج النمو الثابت.',
    };
  }

  let maxSwingPct = 0;
  let hadSuspensionOrRestart = false;
  for (let i = 1; i < sortedYears.length; i++) {
    const prev = seriesByYear.get(sortedYears[i - 1])!;
    const cur = seriesByYear.get(sortedYears[i])!;
    if ((prev > 0 && cur === 0) || (prev === 0 && cur > 0)) {
      hadSuspensionOrRestart = true;
    } else if (prev > 0) {
      const swing = Math.abs(cur - prev) / prev;
      if (swing > maxSwingPct) maxSwingPct = swing;
    }
  }

  if (hadSuspensionOrRestart || maxSwingPct > 0.5) {
    const reason = hadSuspensionOrRestart
      ? 'توقف/استئناف للتوزيع المنتظم بين سنوات موثقة'
      : `تذبذب سنوي حاد في التوزيع المنتظم (${(maxSwingPct * 100).toFixed(0)}%)`;
    const stabilityWarningAr = `تنبيه استقرار التوزيعات (D0): تم رصد ${reason} عبر سلسلة السنوات (${sortedYears.join('، ')})؛ يجب التمييز بين اكتمال توثيق البيانات ومدى ملاءمة فرضية النمو الدائم الثابت في نموذج جوردون.`;
    return {
      stabilityWarningAr,
      suitabilityNoteAr:
        'تقييم الملاءمة مقابل الاكتمال: البيانات قد تكون مكتملة محاسبياً (complete)، إلا أن تذبذب أو انقطاع التوزيعات يحد من ملاءمة افتراض النمو المستقر في نموذج جوردون.',
    };
  }

  return {
    stabilityWarningAr: null,
    suitabilityNoteAr: `ملاحظة الملاءمة مقابل الاكتمال: استقرار التوزيع المنتظم عبر ${sortedYears.length} سنوات (${sortedYears.join('–')}) يدعم قابلية مراجعة نموذج النمو الثابت، مع بقاء الحكم النهائي لاختيار معدل g للمحلل.`,
  };
}
