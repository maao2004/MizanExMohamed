/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AccountingEpsEligibilityDecision,
  EffectiveWeightedAvgSharesBasis,
  NetIncomeCommonBasis,
  PeriodSharesBasisEligibilityDecision,
  QuarterlyFinancial,
} from '../../types/financial';
import {
  addIsoCalendarDays,
  computeCalendarSpanDays,
  formatWeightedAvgSharesBasisAr,
  inspectWeightedAvgSharesBasis,
  isValidCalendarDate,
} from '../contracts';

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const normalizeZero = (val: number): number => (Object.is(val, -0) ? 0 : val);

const getIsoYear = (isoDate: string): number => Number(isoDate.slice(0, 4));

const Q1_MIN_SPAN_DAYS = 60;
const Q1_MAX_SPAN_DAYS = 125;

export function formatEffectiveSharesBasisAr(
  effectiveBasis: EffectiveWeightedAvgSharesBasis | null
): string {
  if (effectiveBasis === 'ytd_weighted_avg') {
    return 'متوسط مرجح للفترة التراكمية / السنوية (ytd_weighted_avg)';
  }
  if (effectiveBasis === 'q1_standalone_equivalent_to_ytd') {
    return 'تكافؤ موثق للربع الأول: الربع المنفرد Q1 يطابق Q1 التراكمي (q1_standalone_equivalent_to_ytd)';
  }
  return 'محجوب / غير مؤهل';
}

export interface RecordPeriodDaysResolution {
  days: number | null;
  source: 'dates' | 'period_days' | 'missing';
  hasDates: boolean;
  periodStartDate: string | null;
  periodEndDate: string | null;
  reasonAr: string | null;
}

export function resolveQuarterlyPeriodDays(
  rec: Pick<QuarterlyFinancial, 'year' | 'quarter' | 'periodStartDate' | 'periodEndDate' | 'periodDays'>
): RecordPeriodDaysResolution {
  const label = `${rec.quarter} ${rec.year}`;
  const startRaw = typeof rec.periodStartDate === 'string' ? rec.periodStartDate.trim() : '';
  const endRaw = typeof rec.periodEndDate === 'string' ? rec.periodEndDate.trim() : '';

  if (startRaw || endRaw) {
    if (!startRaw || !endRaw) {
      return {
        days: null,
        source: 'missing',
        hasDates: false,
        periodStartDate: startRaw || null,
        periodEndDate: endRaw || null,
        reasonAr: `الفترة ${label} تحتوي تاريخاً واحداً فقط وتفتقد اكتمال PeriodStartDate وPeriodEndDate.`,
      };
    }
    if (!isValidCalendarDate(startRaw) || !isValidCalendarDate(endRaw) || startRaw > endRaw) {
      return {
        days: null,
        source: 'missing',
        hasDates: false,
        periodStartDate: null,
        periodEndDate: null,
        reasonAr: `تواريخ الفترة ${label} (${startRaw}..${endRaw}) غير صالحة.`,
      };
    }
    const span = computeCalendarSpanDays(startRaw, endRaw);
    if (span < 1 || span > 370) {
      return {
        days: null,
        source: 'missing',
        hasDates: false,
        periodStartDate: null,
        periodEndDate: null,
        reasonAr: `عدد الأيام التقويمية للفترة ${label} (${span}) خارج النطاق المسموح (1..370).`,
      };
    }
    if (rec.periodDays != null) {
      if (!Number.isInteger(rec.periodDays) || rec.periodDays !== span) {
        return {
          days: null,
          source: 'missing',
          hasDates: false,
          periodStartDate: startRaw,
          periodEndDate: endRaw,
          reasonAr: `تضارب في طول الفترة ${label}: PeriodDays (${rec.periodDays}) لا يطابق الفرق التقويمي (${span} يوماً).`,
        };
      }
    }
    return {
      days: span,
      source: 'dates',
      hasDates: true,
      periodStartDate: startRaw,
      periodEndDate: endRaw,
      reasonAr: null,
    };
  }

  if (rec.periodDays != null) {
    if (!Number.isInteger(rec.periodDays) || rec.periodDays < 1 || rec.periodDays > 370) {
      return {
        days: null,
        source: 'missing',
        hasDates: false,
        periodStartDate: null,
        periodEndDate: null,
        reasonAr: `قيمة PeriodDays للفترة ${label} غير صالحة (يجب أن تكون عدداً صحيحاً بين 1 و 370).`,
      };
    }
    return {
      days: rec.periodDays,
      source: 'period_days',
      hasDates: false,
      periodStartDate: null,
      periodEndDate: null,
      reasonAr: null,
    };
  }

  return {
    days: null,
    source: 'missing',
    hasDates: false,
    periodStartDate: null,
    periodEndDate: null,
    reasonAr: `طول الفترة الفعلي غير موثق للفترة ${label}: يلزم إدخال PeriodStartDate/PeriodEndDate أو PeriodDays.`,
  };
}

export interface PeriodSharesBasisContext {
  previousFY?: Pick<QuarterlyFinancial, 'year' | 'quarter' | 'periodStartDate' | 'periodEndDate'> | null;
  sameYearRecords?: Array<Pick<QuarterlyFinancial, 'year' | 'quarter' | 'periodStartDate' | 'periodEndDate'>>;
}

/**
 * Central Single Source of Truth evaluator for `WeightedAvgShares_YTD` + `WeightedAvgShares_Basis`
 * eligibility on a single quarterly record (reused by single-period AccountingEPS, TTM constituent
 * checks, UI audit cards, missing-field edit links, and Excel export).
 *
 * Rules:
 * - Preserves the stored `weightedAvgSharesBasis` code without mutation.
 * - `ytd_weighted_avg` is eligible directly (never implies capital-action adjustment by itself).
 * - `standalone_quarter` is eligible ONLY for fiscal `Q1` when BOTH `PeriodStartDate` and
 *   `PeriodEndDate` are validly documented, form a single-quarter calendar span (60..125 days,
 *   leap-year accurate), match `PeriodDays` (if entered), align with fiscal year, and do not
 *   conflict with adjacent fiscal year boundaries (`previousFY` end + 1 day or same-year start).
 * - Quarter label (`Q1`) or `PeriodDays` alone is NEVER sufficient for `standalone_quarter`.
 * - `standalone_quarter` is ALWAYS blocked for `Q2`, `Q3`, and `FY`.
 * - `end_of_period_proxy`, `unadjusted_weighted_avg`, `unknown`, empty (`null`), and any
 *   unrecognized stored code are ALWAYS blocked.
 */
export function evaluatePeriodSharesBasisEligibility(
  rec: Pick<
    QuarterlyFinancial,
    | 'year'
    | 'quarter'
    | 'weightedAvgSharesYTD'
    | 'weightedAvgSharesBasis'
    | 'periodStartDate'
    | 'periodEndDate'
    | 'periodDays'
    | 'isCapitalActionAdjusted'
  >,
  context?: PeriodSharesBasisContext
): PeriodSharesBasisEligibilityDecision {
  const periodLabel = `${rec.quarter} ${rec.year}`;
  const daysInfo = resolveQuarterlyPeriodDays(rec);
  const inspectedBasis = inspectWeightedAvgSharesBasis(rec.weightedAvgSharesBasis);
  const originalSharesBasis = inspectedBasis.code ?? inspectedBasis.rawValue;
  const originalSharesBasisLabelAr = formatWeightedAvgSharesBasisAr(rec.weightedAvgSharesBasis);

  const baseMeta = {
    periodLabel,
    year: rec.year,
    quarter: rec.quarter,
    originalSharesBasis,
    originalSharesBasisLabelAr,
    periodStartDate: daysInfo.periodStartDate,
    periodEndDate: daysInfo.periodEndDate,
    periodDays: daysInfo.days,
  };

  // 1. Validate denominator share count (strictly finite and > 0; distinct from missing vs invalid)
  if (rec.weightedAvgSharesYTD === null || rec.weightedAvgSharesYTD === undefined) {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue: null,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'missing_weighted_avg_shares',
      reasonAr: `المتوسط المرجح للأسهم WeightedAvgShares_YTD مفقود في ${periodLabel} (يجب إدخال عدد أسهم كامل موجب وليس ربحية سهم أو نسبة).`,
      missingField: 'weightedAvgSharesYTD',
      missingExcelColumn: 'WeightedAvgShares_YTD',
      remediationAr: `أدخل عدد الأسهم الكامل في حقل WeightedAvgShares_YTD لسجل ${periodLabel}.`,
      sharesBasisNoteAr: null,
    };
  }

  if (!isFiniteNum(rec.weightedAvgSharesYTD) || rec.weightedAvgSharesYTD <= 0) {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue: null,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'invalid_weighted_avg_shares',
      reasonAr: `قيمة WeightedAvgShares_YTD (${rec.weightedAvgSharesYTD}) في ${periodLabel} غير صالحة كمقام؛ يجب أن يكون عدد الأسهم موجباً وأكبر من صفر.`,
      missingField: 'weightedAvgSharesYTD',
      missingExcelColumn: 'WeightedAvgShares_YTD',
      remediationAr: `صحّح حقل WeightedAvgShares_YTD في سجل ${periodLabel} إلى عدد أسهم كامل موجب أكبر من صفر.`,
      sharesBasisNoteAr: null,
    };
  }

  const denominatorValue = rec.weightedAvgSharesYTD;

  // 2. Evaluate WeightedAvgShares_Basis
  if (inspectedBasis.status === 'empty') {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'missing_shares_basis',
      reasonAr: `أساس المتوسط المرجح WeightedAvgShares_Basis غير موثق في ${periodLabel}؛ يلزم تحديد الأساس الفعلي قبل حساب AccountingEPS.`,
      missingField: 'weightedAvgSharesBasis',
      missingExcelColumn: 'WeightedAvgShares_Basis',
      remediationAr:
        rec.quarter === 'Q1'
          ? `وثّق WeightedAvgShares_Basis في ${periodLabel} إلى ytd_weighted_avg، أو standalone_quarter مع إدخال PeriodStartDate وPeriodEndDate.`
          : `وثّق WeightedAvgShares_Basis في ${periodLabel} إلى ytd_weighted_avg بعد التحقق من القوائم المالية.`,
      sharesBasisNoteAr: null,
    };
  }

  if (inspectedBasis.status === 'unrecognized') {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'unrecognized_shares_basis',
      reasonAr: `قيمة WeightedAvgShares_Basis المحفوظة في ${periodLabel} (${inspectedBasis.rawValue}) غير معروفة ضمن العقود المعتمدة؛ تم حجب AccountingEPS دون تغيير القيمة تلقائياً.`,
      missingField: 'weightedAvgSharesBasis',
      missingExcelColumn: 'WeightedAvgShares_Basis',
      remediationAr: `راجع WeightedAvgShares_Basis في سجل ${periodLabel} واختر رمزاً معتمداً من القائمة دون تعديل تلقائي.`,
      sharesBasisNoteAr: null,
    };
  }

  const code = inspectedBasis.code!;

  if (code === 'ytd_weighted_avg') {
    return {
      ...baseMeta,
      eligible: true,
      decision: 'eligible',
      denominatorValue,
      effectiveSharesBasis: 'ytd_weighted_avg',
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr('ytd_weighted_avg'),
      usedQ1DocumentedEquivalence: false,
      blockedCode: null,
      reasonAr: `مؤهل مباشرةً: المتوسط المرجح التراكمي/السنوي (ytd_weighted_avg) موثق للفترة ${periodLabel}.`,
      missingField: null,
      missingExcelColumn: null,
      remediationAr: null,
      sharesBasisNoteAr: null,
    };
  }

  if (code === 'end_of_period_proxy') {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'end_of_period_proxy_blocked',
      reasonAr: `تم حجب AccountingEPS للفترة ${periodLabel} لأن WeightedAvgShares_Basis هو end_of_period_proxy (عدد أسهم نهاية فترة تقريبي، وليس متوسطاً مرجحاً فعلياً ولا يعني سنة مالية كاملة).`,
      missingField: 'weightedAvgSharesBasis',
      missingExcelColumn: 'WeightedAvgShares_Basis',
      remediationAr: `أدخل المتوسط المرجح الفعلي للأسهم من القوائم المالية وحدّث WeightedAvgShares_Basis في ${periodLabel} إلى ytd_weighted_avg.`,
      sharesBasisNoteAr: null,
    };
  }

  if (code === 'unadjusted_weighted_avg') {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'unadjusted_weighted_avg_blocked',
      reasonAr: `تم حجب AccountingEPS للفترة ${periodLabel} لأن WeightedAvgShares_Basis هو unadjusted_weighted_avg (متوسط مرجح غير معدل لأحداث رأس المال).`,
      missingField: 'weightedAvgSharesBasis',
      missingExcelColumn: 'WeightedAvgShares_Basis',
      remediationAr: `أدخل المتوسط المرجح المعدل لأحداث رأس المال في ${periodLabel} وحدّث WeightedAvgShares_Basis وIsCapitalActionAdjusted.`,
      sharesBasisNoteAr: null,
    };
  }

  if (code === 'unknown') {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'unknown_shares_basis_blocked',
      reasonAr: `تم حجب AccountingEPS للفترة ${periodLabel} لأن WeightedAvgShares_Basis موثق كـ unknown (غير موثق الأساس).`,
      missingField: 'weightedAvgSharesBasis',
      missingExcelColumn: 'WeightedAvgShares_Basis',
      remediationAr: `تحقق من أساس المتوسط المرجح في القوائم المالية وحدّث WeightedAvgShares_Basis في سجل ${periodLabel}.`,
      sharesBasisNoteAr: null,
    };
  }

  // code === 'standalone_quarter'
  if (rec.quarter !== 'Q1') {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'standalone_quarter_non_q1_blocked',
      reasonAr: `تم حجب AccountingEPS للفترة ${periodLabel} لأن WeightedAvgShares_Basis هو standalone_quarter (متوسط ربع منفرد فقط)، ولا يجوز استخدامه مقاماً لأرباح ${
        rec.quarter === 'FY' ? 'سنة مالية كاملة (FY)' : `فترة تراكمية (${rec.quarter} YTD)`
      }.`,
      missingField: 'weightedAvgSharesBasis',
      missingExcelColumn: 'WeightedAvgShares_Basis',
      remediationAr: `أدخل المتوسط المرجح التراكمي للفترة ${periodLabel} من القوائم المالية وحدّث WeightedAvgShares_Basis إلى ytd_weighted_avg.`,
      sharesBasisNoteAr: null,
    };
  }

  // Fiscal Q1 with standalone_quarter: requires complete, valid, non-conflicting documented dates.
  // Quarter number (`Q1`) or `PeriodDays` alone is NEVER sufficient!
  if (daysInfo.reasonAr && (rec.periodStartDate || rec.periodEndDate || rec.periodDays != null)) {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'standalone_q1_period_conflict',
      reasonAr: `تم حجب تكافؤ Q1 المنفرد مع التراكمي في ${periodLabel} لتعارض أو عدم صلاحية توثيق حدود الفترة: ${daysInfo.reasonAr}`,
      missingField: 'periodStartDate',
      missingExcelColumn: 'PeriodStartDate / PeriodEndDate / PeriodDays',
      remediationAr: `صحّح PeriodStartDate وPeriodEndDate (وتطابق PeriodDays إن أُدخل) في سجل ${periodLabel} لتوثيق حدود الربع الأول الفعلية.`,
      sharesBasisNoteAr: null,
    };
  }

  if (!daysInfo.hasDates || !daysInfo.periodStartDate || !daysInfo.periodEndDate || daysInfo.days === null) {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'standalone_q1_missing_dates',
      reasonAr: `تم حجب AccountingEPS للفترة ${periodLabel} (الأساس المحفوظ standalone_quarter): رقم الربع Q1 أو عدد الأيام وحده لا يكفي لإثبات تكافؤ الربع الأول المنفرد مع التراكمي؛ يلزم توثيق تاريخي بداية ونهاية الفترة (PeriodStartDate وPeriodEndDate) معاً.`,
      missingField: 'periodStartDate',
      missingExcelColumn: 'PeriodStartDate / PeriodEndDate',
      remediationAr: `أدخل تاريخي PeriodStartDate وPeriodEndDate الفعليين لسجل ${periodLabel} لإثبات تطابق الربع الأول المنفرد مع الفترة التراكمية Q1 YTD، أو وثّق WeightedAvgShares_Basis = ytd_weighted_avg.`,
      sharesBasisNoteAr: null,
    };
  }

  const start = daysInfo.periodStartDate;
  const end = daysInfo.periodEndDate;
  const spanDays = daysInfo.days;

  if (spanDays < Q1_MIN_SPAN_DAYS || spanDays > Q1_MAX_SPAN_DAYS) {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'standalone_q1_period_conflict',
      reasonAr: `تم حجب تكافؤ Q1 المنفرد مع التراكمي في ${periodLabel} لأن النطاق الموثق (${start} → ${end} = ${spanDays} يوماً) لا يتسق مع ربع مالي أول منفرد (${Q1_MIN_SPAN_DAYS}–${Q1_MAX_SPAN_DAYS} يوماً).`,
      missingField: 'periodStartDate',
      missingExcelColumn: 'PeriodStartDate / PeriodEndDate',
      remediationAr: `تحقق من تاريخي PeriodStartDate وPeriodEndDate في سجل ${periodLabel} ليتطابقا مع ربع أول فعلي (أو عدّل WeightedAvgShares_Basis).`,
      sharesBasisNoteAr: null,
    };
  }

  const startYear = getIsoYear(start);
  const endYear = getIsoYear(end);
  if (rec.year < startYear - 1 || rec.year > endYear + 1) {
    return {
      ...baseMeta,
      eligible: false,
      decision: 'blocked',
      denominatorValue,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      blockedCode: 'standalone_q1_period_conflict',
      reasonAr: `تم حجب تكافؤ Q1 المنفرد مع التراكمي في ${periodLabel} لتعارض السنة المالية (${rec.year}) مع نطاق التواريخ الموثق (${start} → ${end}).`,
      missingField: 'periodStartDate',
      missingExcelColumn: 'PeriodStartDate / PeriodEndDate',
      remediationAr: `صحّح تاريخي PeriodStartDate وPeriodEndDate في سجل ${periodLabel} ليتطابقا مع السنة المالية ${rec.year}.`,
      sharesBasisNoteAr: null,
    };
  }

  // Cross-record fiscal boundary verification (when adjacent documented records exist)
  if (context?.previousFY?.periodEndDate && isValidCalendarDate(context.previousFY.periodEndDate)) {
    const expectedStart = addIsoCalendarDays(context.previousFY.periodEndDate, 1);
    if (start !== expectedStart) {
      return {
        ...baseMeta,
        eligible: false,
        decision: 'blocked',
        denominatorValue,
        effectiveSharesBasis: null,
        effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
        usedQ1DocumentedEquivalence: false,
        blockedCode: 'standalone_q1_period_conflict',
        reasonAr: `تم حجب تكافؤ Q1 المنفرد مع التراكمي في ${periodLabel} لتعارض بداية الربع الأول (${start}) مع اليوم التالي لنهاية السنة المالية السابقة FY ${context.previousFY.year} (${context.previousFY.periodEndDate} → المتوقع ${expectedStart}).`,
        missingField: 'periodStartDate',
        missingExcelColumn: 'PeriodStartDate / PeriodEndDate',
        remediationAr: `تحقق من اتصال PeriodStartDate في ${periodLabel} بنهاية FY ${context.previousFY.year} (${context.previousFY.periodEndDate}).`,
        sharesBasisNoteAr: null,
      };
    }
  }

  if (context?.sameYearRecords && context.sameYearRecords.length > 0) {
    for (const sibling of context.sameYearRecords) {
      if (sibling.quarter === rec.quarter) continue;
      if (sibling.periodStartDate && isValidCalendarDate(sibling.periodStartDate)) {
        if (sibling.periodStartDate !== start) {
          return {
            ...baseMeta,
            eligible: false,
            decision: 'blocked',
            denominatorValue,
            effectiveSharesBasis: null,
            effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
            usedQ1DocumentedEquivalence: false,
            blockedCode: 'standalone_q1_period_conflict',
            reasonAr: `تم حجب تكافؤ Q1 المنفرد مع التراكمي في ${periodLabel} لتعارض بداية الربع الأول (${start}) مع بداية السنة المالية الموثقة في ${sibling.quarter} ${sibling.year} (${sibling.periodStartDate}).`,
            missingField: 'periodStartDate',
            missingExcelColumn: 'PeriodStartDate / PeriodEndDate',
            remediationAr: `وحّد تاريخ بداية السنة المالية PeriodStartDate بين ${periodLabel} و${sibling.quarter} ${sibling.year}.`,
            sharesBasisNoteAr: null,
          };
        }
      }
    }
  }

  // Documented Q1 standalone == Q1 YTD equivalence verified!
  // Stored code remains `standalone_quarter` untouched.
  const equivalenceNote = `اعتماد تكافؤ Q1 موثق بالتواريخ (${start} → ${end}، ${spanDays} يوماً): الأساس الأصلي المحفوظ هو standalone_quarter دون تعديله، والأساس الفعلي المستخدم في الحساب هو تكافؤ الربع الأول المنفرد مع التراكمي (q1_standalone_equivalent_to_ytd).`;

  return {
    ...baseMeta,
    eligible: true,
    decision: 'eligible',
    denominatorValue,
    effectiveSharesBasis: 'q1_standalone_equivalent_to_ytd',
    effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr('q1_standalone_equivalent_to_ytd'),
    usedQ1DocumentedEquivalence: true,
    blockedCode: null,
    reasonAr: equivalenceNote,
    missingField: null,
    missingExcelColumn: null,
    remediationAr: null,
    sharesBasisNoteAr: equivalenceNote,
  };
}

/**
 * Central AccountingEPS eligibility decision for a single period (`latest`).
 */
export function evaluateAccountingEpsEligibility(params: {
  finCurrencyAllowed: boolean;
  record: QuarterlyFinancial | null;
  commonNetIncome: {
    value: number | null;
    basis: NetIncomeCommonBasis | 'unavailable';
    unavailableReasonAr: string | null;
  };
  previousFY?: QuarterlyFinancial | null;
  sameYearRecords?: QuarterlyFinancial[];
}): AccountingEpsEligibilityDecision {
  const { finCurrencyAllowed, record, commonNetIncome, previousFY, sameYearRecords } = params;
  const periodLabel = record ? `${record.quarter} ${record.year}` : null;
  const daysInfo = record ? resolveQuarterlyPeriodDays(record) : null;
  const inspectedBasis = inspectWeightedAvgSharesBasis(record?.weightedAvgSharesBasis);
  const originalSharesBasis = inspectedBasis.code ?? inspectedBasis.rawValue;
  const originalSharesBasisLabelAr = formatWeightedAvgSharesBasisAr(record?.weightedAvgSharesBasis);

  if (!finCurrencyAllowed) {
    return {
      eligible: false,
      decision: 'blocked',
      accountingEpsValue: null,
      numeratorValue: null,
      numeratorBasis: 'unavailable',
      denominatorValue: null,
      originalSharesBasis,
      originalSharesBasisLabelAr,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      periodLabel,
      periodStartDate: daysInfo?.periodStartDate ?? null,
      periodEndDate: daysInfo?.periodEndDate ?? null,
      periodDays: daysInfo?.days ?? null,
      isActionAdjusted: record?.isCapitalActionAdjusted ?? null,
      blockedCode: 'currency_blocked',
      reasonAr: 'عملة القوائم المالية غير مدعومة أو متضاربة.',
      missingField: null,
      missingExcelColumn: null,
      missingPeriod: null,
      remediationAr: 'صحّح عملة القوائم المالية (EGP أو USD) في السجلات الفصلية.',
      notesAr: [],
    };
  }

  if (!record) {
    return {
      eligible: false,
      decision: 'blocked',
      accountingEpsValue: null,
      numeratorValue: null,
      numeratorBasis: 'unavailable',
      denominatorValue: null,
      originalSharesBasis: null,
      originalSharesBasisLabelAr: formatWeightedAvgSharesBasisAr(null),
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      periodLabel: null,
      periodStartDate: null,
      periodEndDate: null,
      periodDays: null,
      isActionAdjusted: null,
      blockedCode: 'no_records',
      reasonAr: 'لا توجد سجلات مالية فصلية.',
      missingField: null,
      missingExcelColumn: null,
      missingPeriod: null,
      remediationAr: null,
      notesAr: [],
    };
  }

  const periodRef = { period: periodLabel!, year: record.year, quarter: record.quarter };

  // Guard 1: Attested NetIncomeCommon is strictly required (never bypassed).
  // Zero (0) and negative values are valid and preserved accurately.
  if (commonNetIncome.value === null) {
    const missingNiField =
      record.netProfitYTD !== null && isFiniteNum(record.netProfitYTD)
        ? 'netIncomeCommonBasis'
        : 'netIncomeCommonYTD';
    return {
      eligible: false,
      decision: 'blocked',
      accountingEpsValue: null,
      numeratorValue: null,
      numeratorBasis: 'unavailable',
      denominatorValue:
        isFiniteNum(record.weightedAvgSharesYTD) && record.weightedAvgSharesYTD > 0
          ? record.weightedAvgSharesYTD
          : null,
      originalSharesBasis,
      originalSharesBasisLabelAr,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      periodLabel,
      periodStartDate: daysInfo?.periodStartDate ?? null,
      periodEndDate: daysInfo?.periodEndDate ?? null,
      periodDays: daysInfo?.days ?? null,
      isActionAdjusted: record.isCapitalActionAdjusted ?? null,
      blockedCode: 'missing_net_income_common',
      reasonAr:
        commonNetIncome.unavailableReasonAr ||
        `صافي ربح المساهمين العاديين غير موثق للفترة ${periodLabel}.`,
      missingField: missingNiField,
      missingExcelColumn: 'NetIncomeCommon_YTD / NetIncomeCommon_Basis',
      missingPeriod: periodRef,
      remediationAr: `أدخل NetIncomeCommon_YTD أو وثّق NetIncomeCommon_Basis في سجل ${periodLabel}.`,
      notesAr: [],
    };
  }

  // Guard 2: WeightedAvgShares_YTD + WeightedAvgShares_Basis central eligibility check
  const sharesDecision = evaluatePeriodSharesBasisEligibility(record, {
    previousFY,
    sameYearRecords,
  });

  if (!sharesDecision.eligible || sharesDecision.denominatorValue === null) {
    return {
      eligible: false,
      decision: 'blocked',
      accountingEpsValue: null,
      numeratorValue: commonNetIncome.value,
      numeratorBasis: commonNetIncome.basis,
      denominatorValue: sharesDecision.denominatorValue,
      originalSharesBasis: sharesDecision.originalSharesBasis,
      originalSharesBasisLabelAr: sharesDecision.originalSharesBasisLabelAr,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: sharesDecision.effectiveSharesBasisLabelAr,
      usedQ1DocumentedEquivalence: false,
      periodLabel,
      periodStartDate: sharesDecision.periodStartDate,
      periodEndDate: sharesDecision.periodEndDate,
      periodDays: sharesDecision.periodDays,
      isActionAdjusted: record.isCapitalActionAdjusted ?? null,
      blockedCode: sharesDecision.blockedCode,
      reasonAr: sharesDecision.reasonAr,
      missingField: sharesDecision.missingField,
      missingExcelColumn: sharesDecision.missingExcelColumn,
      missingPeriod: sharesDecision.missingField ? periodRef : null,
      remediationAr: sharesDecision.remediationAr,
      notesAr: [],
    };
  }

  const epsVal = normalizeZero(commonNetIncome.value / sharesDecision.denominatorValue);
  const notesAr: string[] = [];
  if (sharesDecision.sharesBasisNoteAr) {
    notesAr.push(sharesDecision.sharesBasisNoteAr);
  }
  if (epsVal < 0) {
    notesAr.push(
      'الربحية المحاسبية للفترة سالبة (تُظهر للعرض والتدقيق وتُحجب عن مضاعف P/E وجراهام).'
    );
  } else if (epsVal === 0) {
    notesAr.push('الربحية المحاسبية للفترة تساوي صفراً (0.00) وتُحفظ بقيمتها الفعلية.');
  }
  if (sharesDecision.periodDays !== null) {
    notesAr.push(
      `طول الفترة الفعلي: ${sharesDecision.periodDays} يوماً${
        sharesDecision.periodStartDate && sharesDecision.periodEndDate
          ? ` (${sharesDecision.periodStartDate} → ${sharesDecision.periodEndDate})`
          : ''
      }.`
    );
  }

  return {
    eligible: true,
    decision: 'eligible',
    accountingEpsValue: epsVal,
    numeratorValue: commonNetIncome.value,
    numeratorBasis: commonNetIncome.basis,
    denominatorValue: sharesDecision.denominatorValue,
    originalSharesBasis: sharesDecision.originalSharesBasis,
    originalSharesBasisLabelAr: sharesDecision.originalSharesBasisLabelAr,
    effectiveSharesBasis: sharesDecision.effectiveSharesBasis,
    effectiveSharesBasisLabelAr: sharesDecision.effectiveSharesBasisLabelAr,
    usedQ1DocumentedEquivalence: sharesDecision.usedQ1DocumentedEquivalence,
    periodLabel,
    periodStartDate: sharesDecision.periodStartDate,
    periodEndDate: sharesDecision.periodEndDate,
    periodDays: sharesDecision.periodDays,
    isActionAdjusted: record.isCapitalActionAdjusted ?? null,
    blockedCode: null,
    reasonAr: sharesDecision.reasonAr,
    missingField: null,
    missingExcelColumn: null,
    missingPeriod: null,
    remediationAr: null,
    notesAr,
  };
}

/**
 * Central AccountingEPS TTM eligibility decision:
 * Uses the exact same `evaluatePeriodSharesBasisEligibility` for every constituent period
 * while preserving all TTM guards:
 * - NetIncomeCommon_TTM attestation
 * - Capital-action compatibility (`IsCapitalActionAdjusted`)
 * - Actual calendar days (`PeriodStartDate`/`PeriodEndDate` or `PeriodDays`) with 360..370 window
 * - Contiguous period boundaries (when dates exist)
 * - NEVER naively sums weighted average shares across quarters; uses calendar-day weighting only
 *   when shares are constant or `IsCapitalActionAdjusted === true`.
 */
export function evaluateAccountingEpsTtmEligibility(params: {
  finCurrencyAllowed: boolean;
  latest: QuarterlyFinancial | null;
  previousFY: QuarterlyFinancial | null;
  previousComparable: QuarterlyFinancial | null;
  previousPrevFY?: QuarterlyFinancial | null;
  sameYearRecordsForLatest?: QuarterlyFinancial[];
  sameYearRecordsForPrevComp?: QuarterlyFinancial[];
  netIncomeCommonTTM: number | null;
  netIncomeCommonTtmBasis: NetIncomeCommonBasis | 'mixed_common' | 'unavailable';
  netIncomeCommonTtmUnavailableReasonAr: string | null;
  latestPeriodDecision: AccountingEpsEligibilityDecision;
  capitalActionCheck: {
    compatible: boolean;
    adjustedFlag: boolean | null;
    reasonAr: string | null;
  };
}): AccountingEpsEligibilityDecision {
  const {
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
    latestPeriodDecision,
    capitalActionCheck,
  } = params;

  const latestLabel = latest ? `${latest.quarter} ${latest.year}` : null;
  const ttmLabel = latestLabel ? `TTM حتى ${latestLabel}` : null;

  if (!finCurrencyAllowed) {
    return {
      eligible: false,
      decision: 'blocked',
      accountingEpsValue: null,
      numeratorValue: null,
      numeratorBasis: 'unavailable',
      denominatorValue: null,
      originalSharesBasis: latestPeriodDecision.originalSharesBasis,
      originalSharesBasisLabelAr: latestPeriodDecision.originalSharesBasisLabelAr,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      periodLabel: ttmLabel,
      periodStartDate: null,
      periodEndDate: null,
      periodDays: null,
      isActionAdjusted: latest?.isCapitalActionAdjusted ?? null,
      blockedCode: 'currency_blocked',
      reasonAr: 'عملة القوائم المالية غير مدعومة أو متضاربة.',
      missingField: null,
      missingExcelColumn: null,
      missingPeriod: null,
      remediationAr: 'صحّح عملة القوائم المالية (EGP أو USD) في السجلات الفصلية.',
      notesAr: [],
    };
  }

  if (!latest) {
    return {
      eligible: false,
      decision: 'blocked',
      accountingEpsValue: null,
      numeratorValue: null,
      numeratorBasis: 'unavailable',
      denominatorValue: null,
      originalSharesBasis: null,
      originalSharesBasisLabelAr: formatWeightedAvgSharesBasisAr(null),
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      periodLabel: null,
      periodStartDate: null,
      periodEndDate: null,
      periodDays: null,
      isActionAdjusted: null,
      blockedCode: 'no_records',
      reasonAr: 'لا توجد سجلات مالية فصلية.',
      missingField: null,
      missingExcelColumn: null,
      missingPeriod: null,
      remediationAr: null,
      notesAr: [],
    };
  }

  // Case A: Latest record is FY
  if (latest.quarter === 'FY') {
    const latestDaysInfo = resolveQuarterlyPeriodDays(latest);
    const ttmWindowStart =
      latestDaysInfo.hasDates && latestDaysInfo.days !== null && latestDaysInfo.days >= 360 && latestDaysInfo.days <= 370
        ? latestDaysInfo.periodStartDate
        : null;
    const ttmWindowEnd =
      latestDaysInfo.hasDates && latestDaysInfo.days !== null && latestDaysInfo.days >= 360 && latestDaysInfo.days <= 370
        ? latestDaysInfo.periodEndDate
        : null;

    if (!latestPeriodDecision.eligible || latestPeriodDecision.accountingEpsValue === null) {
      return {
        ...latestPeriodDecision,
        periodLabel: ttmLabel,
        periodStartDate: ttmWindowStart,
        periodEndDate: ttmWindowEnd,
      };
    }

    if (latestDaysInfo.days === null) {
      return {
        eligible: false,
        decision: 'blocked',
        accountingEpsValue: null,
        numeratorValue: netIncomeCommonTTM,
        numeratorBasis: netIncomeCommonTtmBasis,
        denominatorValue: latestPeriodDecision.denominatorValue,
        originalSharesBasis: latestPeriodDecision.originalSharesBasis,
        originalSharesBasisLabelAr: latestPeriodDecision.originalSharesBasisLabelAr,
        effectiveSharesBasis: null,
        effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
        usedQ1DocumentedEquivalence: false,
        periodLabel: ttmLabel,
        periodStartDate: null,
        periodEndDate: null,
        periodDays: null,
        isActionAdjusted: latest.isCapitalActionAdjusted ?? null,
        blockedCode: 'ttm_missing_period_days',
        reasonAr:
          latestDaysInfo.reasonAr ||
          `يتعذر اعتماد AccountingEPS TTM للسنة ${latestLabel} لعدم توثيق طول الفترة الفعلي (PeriodStartDate/PeriodEndDate أو PeriodDays).`,
        missingField: 'periodStartDate',
        missingExcelColumn: 'PeriodStartDate / PeriodEndDate / PeriodDays',
        missingPeriod: { period: latestLabel!, year: latest.year, quarter: latest.quarter },
        remediationAr: `أدخل PeriodStartDate وPeriodEndDate (أو PeriodDays) لسجل ${latestLabel}.`,
        notesAr: [],
      };
    }

    if (latestDaysInfo.days < 360 || latestDaysInfo.days > 370) {
      return {
        eligible: false,
        decision: 'blocked',
        accountingEpsValue: null,
        numeratorValue: netIncomeCommonTTM,
        numeratorBasis: netIncomeCommonTtmBasis,
        denominatorValue: latestPeriodDecision.denominatorValue,
        originalSharesBasis: latestPeriodDecision.originalSharesBasis,
        originalSharesBasisLabelAr: latestPeriodDecision.originalSharesBasisLabelAr,
        effectiveSharesBasis: null,
        effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
        usedQ1DocumentedEquivalence: false,
        periodLabel: ttmLabel,
        periodStartDate: ttmWindowStart,
        periodEndDate: ttmWindowEnd,
        periodDays: latestDaysInfo.days,
        isActionAdjusted: latest.isCapitalActionAdjusted ?? null,
        blockedCode: 'ttm_invalid_window_days',
        reasonAr: `تم حجب AccountingEPS TTM لأن طول السنة المالية ${latestLabel} (${latestDaysInfo.days} يوماً) لا يغطي 12 شهراً (360–370 يوماً).`,
        missingField: 'periodStartDate',
        missingExcelColumn: 'PeriodStartDate / PeriodEndDate / PeriodDays',
        missingPeriod: { period: latestLabel!, year: latest.year, quarter: latest.quarter },
        remediationAr: `تحقق من تاريخي بداية ونهاية السنة المالية في سجل ${latestLabel} (المتوقع 360–370 يوماً).`,
        notesAr: [],
      };
    }

    return {
      eligible: true,
      decision: 'eligible',
      accountingEpsValue: latestPeriodDecision.accountingEpsValue,
      numeratorValue: latestPeriodDecision.numeratorValue,
      numeratorBasis: latestPeriodDecision.numeratorBasis,
      denominatorValue: latestPeriodDecision.denominatorValue,
      originalSharesBasis: latestPeriodDecision.originalSharesBasis,
      originalSharesBasisLabelAr: latestPeriodDecision.originalSharesBasisLabelAr,
      effectiveSharesBasis: latestPeriodDecision.effectiveSharesBasis,
      effectiveSharesBasisLabelAr: latestPeriodDecision.effectiveSharesBasisLabelAr,
      usedQ1DocumentedEquivalence: false,
      periodLabel: ttmLabel,
      periodStartDate: ttmWindowStart,
      periodEndDate: ttmWindowEnd,
      periodDays: latestDaysInfo.days,
      isActionAdjusted: latest.isCapitalActionAdjusted ?? null,
      blockedCode: null,
      reasonAr: `الفترة الأحدث سنة مالية مكتملة بطول فعلي موثق (${latestDaysInfo.days} يوماً)، لذا تطابق AccountingEPS TTM القيمة السنوية مباشرة.`,
      missingField: null,
      missingExcelColumn: null,
      missingPeriod: null,
      remediationAr: null,
      notesAr: [
        `الفترة الأحدث سنة مالية مكتملة بطول فعلي موثق (${latestDaysInfo.days} يوماً)، لذا تطابق AccountingEPS TTM القيمة السنوية مباشرة.`,
      ],
    };
  }

  // Case B: Interim quarter (Q1 / Q2 / Q3) -> requires previousFY + previousComparable
  if (!previousFY || !previousComparable) {
    return {
      eligible: false,
      decision: 'blocked',
      accountingEpsValue: null,
      numeratorValue: netIncomeCommonTTM,
      numeratorBasis: netIncomeCommonTtmBasis,
      denominatorValue: null,
      originalSharesBasis: latestPeriodDecision.originalSharesBasis,
      originalSharesBasisLabelAr: latestPeriodDecision.originalSharesBasisLabelAr,
      effectiveSharesBasis: null,
      effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
      usedQ1DocumentedEquivalence: false,
      periodLabel: ttmLabel,
      periodStartDate: null,
      periodEndDate: null,
      periodDays: null,
      isActionAdjusted: latest.isCapitalActionAdjusted ?? null,
      blockedCode: 'ttm_missing_comparatives',
      reasonAr: `يتعذر اشتقاق AccountingEPS TTM لغياب الفترة المقارنة (${!previousFY ? `FY ${latest.year - 1}` : ''}${!previousFY && !previousComparable ? ' و' : ''}${!previousComparable ? `${latest.quarter} ${latest.year - 1}` : ''}).`,
      missingField: null,
      missingExcelColumn: null,
      missingPeriod: null,
      remediationAr: `أضف السجل المقارن الناقص (${!previousFY ? `FY ${latest.year - 1}` : ''}${!previousFY && !previousComparable ? ' و' : ''}${!previousComparable ? `${latest.quarter} ${latest.year - 1}` : ''}) لتمكين اشتقاق TTM.`,
      notesAr: [],
    };
  }

  const currDays = resolveQuarterlyPeriodDays(latest);
  const fyPrevDays = resolveQuarterlyPeriodDays(previousFY);
  const compDays = resolveQuarterlyPeriodDays(previousComparable);

  // Derive exact documented TTM calendar window independently whenever all 3 records have valid contiguous dates
  let ttmPeriodStart: string | null = null;
  let ttmPeriodEnd: string | null = null;
  if (currDays.hasDates && fyPrevDays.hasDates && compDays.hasDates) {
    const compStart = compDays.periodStartDate!;
    const compEnd = compDays.periodEndDate!;
    const fyStart = fyPrevDays.periodStartDate!;
    const fyEnd = fyPrevDays.periodEndDate!;
    const currStart = currDays.periodStartDate!;
    const currEnd = currDays.periodEndDate!;
    if (compStart === fyStart && compEnd < fyEnd && addIsoCalendarDays(fyEnd, 1) === currStart) {
      const candidateStart = addIsoCalendarDays(compEnd, 1);
      const span = computeCalendarSpanDays(candidateStart, currEnd);
      if (span >= 360 && span <= 370) {
        ttmPeriodStart = candidateStart;
        ttmPeriodEnd = currEnd;
      }
    }
  }

  const baseBlocked = {
    eligible: false as const,
    decision: 'blocked' as const,
    accountingEpsValue: null,
    numeratorValue: netIncomeCommonTTM,
    numeratorBasis: netIncomeCommonTtmBasis,
    denominatorValue: null,
    originalSharesBasis: latestPeriodDecision.originalSharesBasis,
    originalSharesBasisLabelAr: latestPeriodDecision.originalSharesBasisLabelAr,
    effectiveSharesBasis: null,
    effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(null),
    usedQ1DocumentedEquivalence: false,
    periodLabel: ttmLabel,
    periodStartDate: ttmPeriodStart,
    periodEndDate: ttmPeriodEnd,
    periodDays: null,
    isActionAdjusted: capitalActionCheck.adjustedFlag,
    notesAr: [] as string[],
  };

  // Guard 1: Capital-action compatibility across trio
  if (!capitalActionCheck.compatible) {
    return {
      ...baseBlocked,
      blockedCode: 'ttm_capital_action_conflict',
      reasonAr:
        capitalActionCheck.reasonAr ||
        'تضارب في حقل IsCapitalActionAdjusted عبر الفترات المكونة لـ TTM.',
      missingField: 'isCapitalActionAdjusted',
      missingExcelColumn: 'IsCapitalActionAdjusted',
      missingPeriod: { period: latestLabel!, year: latest.year, quarter: latest.quarter },
      remediationAr: 'وحّد حالة IsCapitalActionAdjusted عبر الفترات الثلاث المكونة لـ TTM.',
    };
  }

  // Guard 2: NetIncomeCommon TTM must be attested
  if (netIncomeCommonTTM === null) {
    return {
      ...baseBlocked,
      blockedCode: 'missing_net_income_common',
      reasonAr:
        netIncomeCommonTtmUnavailableReasonAr ||
        'صافي ربح المساهمين العاديين TTM غير موثق لجميع فترات المقارنة.',
      missingField: 'netIncomeCommonBasis',
      missingExcelColumn: 'NetIncomeCommon_YTD / NetIncomeCommon_Basis',
      missingPeriod: { period: latestLabel!, year: latest.year, quarter: latest.quarter },
      remediationAr: 'استكمل توثيق صافي ربح العاديين (NetIncomeCommon_YTD / NetIncomeCommon_Basis) للفترات الثلاث المكونة لـ TTM.',
    };
  }

  // Guard 3: Evaluate EVERY constituent period using the EXACT same central shares-basis eligibility rule
  const latestSharesDecision = evaluatePeriodSharesBasisEligibility(latest, {
    previousFY,
    sameYearRecords: sameYearRecordsForLatest,
  });
  const prevFySharesDecision = evaluatePeriodSharesBasisEligibility(previousFY);
  const prevCompSharesDecision = evaluatePeriodSharesBasisEligibility(previousComparable, {
    previousFY: previousPrevFY,
    sameYearRecords: sameYearRecordsForPrevComp ?? [previousFY],
  });

  const failedPeriodDecision = [latestSharesDecision, prevFySharesDecision, prevCompSharesDecision].find(
    (d) => !d.eligible
  );
  if (failedPeriodDecision) {
    return {
      ...baseBlocked,
      originalSharesBasis: failedPeriodDecision.originalSharesBasis,
      originalSharesBasisLabelAr: failedPeriodDecision.originalSharesBasisLabelAr,
      blockedCode: failedPeriodDecision.blockedCode,
      reasonAr: `تم حجب AccountingEPS TTM بسبب الفترة ${failedPeriodDecision.periodLabel}: ${failedPeriodDecision.reasonAr}`,
      missingField: failedPeriodDecision.missingField,
      missingExcelColumn: failedPeriodDecision.missingExcelColumn,
      missingPeriod: {
        period: failedPeriodDecision.periodLabel,
        year: failedPeriodDecision.year,
        quarter: failedPeriodDecision.quarter,
      },
      remediationAr: failedPeriodDecision.remediationAr,
    };
  }

  // Guard 4: Period days / dates must be documented for all 3 periods
  if (currDays.days === null || fyPrevDays.days === null || compDays.days === null) {
    const failedPeriod =
      currDays.days === null ? latest : fyPrevDays.days === null ? previousFY : previousComparable;
    return {
      ...baseBlocked,
      blockedCode: 'ttm_missing_period_days',
      reasonAr: currDays.reasonAr || fyPrevDays.reasonAr || compDays.reasonAr || 'طول الفترة الفعلي غير موثق.',
      missingField: 'periodStartDate',
      missingExcelColumn: 'PeriodStartDate / PeriodEndDate / PeriodDays',
      missingPeriod: {
        period: `${failedPeriod.quarter} ${failedPeriod.year}`,
        year: failedPeriod.year,
        quarter: failedPeriod.quarter,
      },
      remediationAr: `أدخل PeriodStartDate وPeriodEndDate (أو PeriodDays) في سجل ${failedPeriod.quarter} ${failedPeriod.year}.`,
    };
  }

  // Guard 5: Contiguous calendar boundaries when dates exist on all 3 periods
  if (currDays.hasDates && fyPrevDays.hasDates && compDays.hasDates) {
    const compStart = compDays.periodStartDate!;
    const compEnd = compDays.periodEndDate!;
    const fyStart = fyPrevDays.periodStartDate!;
    const fyEnd = fyPrevDays.periodEndDate!;
    const currStart = currDays.periodStartDate!;
    let boundaryError: string | null = null;
    if (compStart !== fyStart) {
      boundaryError = `تباين بداية السنة المالية السابقة بين ${previousComparable.quarter} (${compStart}) وFY (${fyStart}).`;
    } else if (compEnd >= fyEnd) {
      boundaryError = `نهاية الفترة المقارنة (${compEnd}) يجب أن تسبق نهاية السنة المالية (${fyEnd}).`;
    } else if (addIsoCalendarDays(fyEnd, 1) !== currStart) {
      boundaryError = `الفترات غير متصلة زمنياً: نهاية FY (${fyEnd}) لا تتصل مباشرة ببداية ${latestLabel} (${currStart}).`;
    }
    if (boundaryError) {
      return {
        ...baseBlocked,
        blockedCode: 'ttm_boundary_conflict',
        reasonAr: `تم حجب AccountingEPS TTM: ${boundaryError}`,
        missingField: 'periodStartDate',
        missingExcelColumn: 'PeriodStartDate / PeriodEndDate',
        missingPeriod: { period: latestLabel!, year: latest.year, quarter: latest.quarter },
        remediationAr: 'تحقق من اتصال وتطابق تواريخ PeriodStartDate وPeriodEndDate عبر الفترات الثلاث المكونة لـ TTM.',
      };
    }
  }

  const dCurr = currDays.days;
  const dFyPrev = fyPrevDays.days;
  const dComp = compDays.days;
  const dRem = dFyPrev - dComp;
  const ttmDays = dCurr + dRem;

  if (dRem <= 0) {
    return {
      ...baseBlocked,
      blockedCode: 'ttm_invalid_window_days',
      reasonAr: `طول الفترة المقارنة (${dComp} يوماً) يجب أن يكون أصغر من السنة الكاملة (${dFyPrev} يوماً).`,
      missingField: 'periodDays',
      missingExcelColumn: 'PeriodStartDate / PeriodEndDate / PeriodDays',
      missingPeriod: {
        period: `${previousComparable.quarter} ${previousComparable.year}`,
        year: previousComparable.year,
        quarter: previousComparable.quarter,
      },
      remediationAr: `راجع تواريخ وطول الفترة في ${previousComparable.quarter} ${previousComparable.year} وFY ${previousFY.year}.`,
    };
  }

  if (ttmDays < 360 || ttmDays > 370) {
    return {
      ...baseBlocked,
      periodDays: ttmDays,
      blockedCode: 'ttm_invalid_window_days',
      reasonAr: `تم حجب AccountingEPS TTM لأن مجموع أيام نافذة TTM المحسوبة (${ttmDays} يوماً = ${dCurr} + ${dRem}) خارج نطاق السنة المكتملة (360–370 يوماً).`,
      missingField: 'periodStartDate',
      missingExcelColumn: 'PeriodStartDate / PeriodEndDate / PeriodDays',
      missingPeriod: { period: latestLabel!, year: latest.year, quarter: latest.quarter },
      remediationAr: 'تحقق من دقة تواريخ البداية والنهاية للفترات الثلاث بحيث تغطي نافذة TTM بين 360 و370 يوماً.',
    };
  }

  // Guard 6: Calendar-day weighted shares reconstruction (NEVER naively sum weighted shares!)
  const wasCurr = latestSharesDecision.denominatorValue!;
  const wasFyPrev = prevFySharesDecision.denominatorValue!;
  const wasComp = prevCompSharesDecision.denominatorValue!;

  const minW = Math.min(wasCurr, wasFyPrev, wasComp);
  const maxW = Math.max(wasCurr, wasFyPrev, wasComp);
  const sameSharesBase = minW > 0 && (maxW - minW) / maxW <= 1e-4;

  let accountingTtmWas: number | null = null;
  let accountingTtmVal: number | null = null;
  const notesAr: string[] = [];

  if (sameSharesBase) {
    accountingTtmWas = wasCurr;
    accountingTtmVal = normalizeZero(netIncomeCommonTTM / wasCurr);
    notesAr.push(
      `ثبات المتوسط المرجح للأسهم عبر نافذة متصلة بطول فعلي ${ttmDays} يوماً (${dCurr} + ${dRem}).`
    );
  } else if (capitalActionCheck.adjustedFlag === true) {
    const remainingPriorNumerator = dFyPrev * wasFyPrev - dComp * wasComp;
    const ttmWeightedShares = (dCurr * wasCurr + remainingPriorNumerator) / ttmDays;
    if (remainingPriorNumerator > 0 && ttmWeightedShares > 0) {
      accountingTtmWas = ttmWeightedShares;
      accountingTtmVal = normalizeZero(netIncomeCommonTTM / ttmWeightedShares);
      notesAr.push(
        `تم اشتقاق المتوسط المرجح بالوزن التقويمي الفعلي (${dCurr}/${ttmDays} للفترة الحالية + ${dRem}/${ttmDays} للفترة المتممة السابقة، إجمالي ${ttmDays} يوماً) لتأكيد تعديل أحداث رأس المال.`
      );
    } else {
      return {
        ...baseBlocked,
        periodDays: ttmDays,
        blockedCode: 'ttm_numeric_reconstruction_failed',
        reasonAr: 'تعذر إعادة بناء المتوسط المرجح بالأيام الفعلية رقمياً من السلاسل المرحلة.',
        missingField: 'weightedAvgSharesYTD',
        missingExcelColumn: 'WeightedAvgShares_YTD',
        missingPeriod: { period: latestLabel!, year: latest.year, quarter: latest.quarter },
        remediationAr: 'تحقق من اتساق قيم WeightedAvgShares_YTD عبر الفترات الثلاث المكونة لـ TTM.',
      };
    }
  } else {
    return {
      ...baseBlocked,
      periodDays: ttmDays,
      blockedCode: 'ttm_unadjusted_shares_change',
      reasonAr:
        'تغير المتوسط المرجح للأسهم عبر فترات التراكم دون تأكيد IsCapitalActionAdjusted=TRUE؛ تم حجب AccountingEPS TTM لمنع تشويه المتوسطات.',
      missingField: 'isCapitalActionAdjusted',
      missingExcelColumn: 'IsCapitalActionAdjusted',
      missingPeriod: { period: latestLabel!, year: latest.year, quarter: latest.quarter },
      remediationAr:
        'تحقق من تعديل السلسلة لأحداث رأس المال في القوائم المالية واضبط IsCapitalActionAdjusted=TRUE للفترات المتسقة فقط.',
    };
  }

  const q1EquivPeriods = [latestSharesDecision, prevCompSharesDecision].filter(
    (d) => d.usedQ1DocumentedEquivalence
  );
  const usedQ1DocumentedEquivalence = q1EquivPeriods.length > 0;
  if (usedQ1DocumentedEquivalence) {
    notesAr.push(
      `اعتمد اشتقاق TTM تكافؤ Q1 الموثق بالتواريخ في (${q1EquivPeriods
        .map((p) => p.periodLabel)
        .join('، ')}) مع الإبقاء على الرمز المحفوظ standalone_quarter كما هو دون تعديل.`
    );
  }

  const effectiveBasis: EffectiveWeightedAvgSharesBasis = usedQ1DocumentedEquivalence
    ? 'q1_standalone_equivalent_to_ytd'
    : 'ytd_weighted_avg';

  return {
    eligible: true,
    decision: 'eligible',
    accountingEpsValue: accountingTtmVal,
    numeratorValue: netIncomeCommonTTM,
    numeratorBasis: netIncomeCommonTtmBasis,
    denominatorValue: accountingTtmWas,
    originalSharesBasis: latestSharesDecision.originalSharesBasis,
    originalSharesBasisLabelAr: latestSharesDecision.originalSharesBasisLabelAr,
    effectiveSharesBasis: effectiveBasis,
    effectiveSharesBasisLabelAr: formatEffectiveSharesBasisAr(effectiveBasis),
    usedQ1DocumentedEquivalence,
    periodLabel: ttmLabel,
    periodStartDate: ttmPeriodStart,
    periodEndDate: ttmPeriodEnd,
    periodDays: ttmDays,
    isActionAdjusted: capitalActionCheck.adjustedFlag,
    blockedCode: null,
    reasonAr: notesAr[0] || 'مؤهل لحساب AccountingEPS TTM.',
    missingField: null,
    missingExcelColumn: null,
    missingPeriod: null,
    remediationAr: null,
    notesAr,
  };
}
