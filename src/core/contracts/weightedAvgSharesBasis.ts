/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseCleanText } from './normalization';

/**
 * Persisted canonical codes for `WeightedAvgShares_Basis` (preserved strictly without migration).
 */
export type WeightedAvgSharesBasis =
  | 'ytd_weighted_avg'
  | 'standalone_quarter'
  | 'end_of_period_proxy'
  | 'unadjusted_weighted_avg'
  | 'unknown';

export type WeightedAvgSharesBasisPolicy =
  | 'direct_ytd_or_fy'
  | 'conditional_q1_documented_equivalence'
  | 'blocked';

export interface WeightedAvgSharesBasisOption {
  code: WeightedAvgSharesBasis;
  labelAr: string;
  shortLabelAr: string;
  selectLabelAr: string;
  meaningAr: string;
  usageLimitsAr: string;
  accountingEpsPolicy: WeightedAvgSharesBasisPolicy;
  /**
   * Explicitly records that selecting a period scope in `WeightedAvgShares_Basis`
   * NEVER automatically proves capital-action adjustment (documented separately in `IsCapitalActionAdjusted`).
   */
  provesCapitalActionAdjustment: false;
}

export const WEIGHTED_AVG_SHARES_BASIS_CODES_TEXT =
  'ytd_weighted_avg | standalone_quarter | end_of_period_proxy | unadjusted_weighted_avg | unknown';

export const WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR =
  'عدد أسهم كامل (المتوسط المرجح للأسهم للفترة)، وليس ربحية سهم (EPS) أو نسبة مئوية.';

export const WEIGHTED_AVG_SHARES_BASIS_EMPTY_OPTION_AR =
  'غير محدد (BLANK — يحجب AccountingEPS لعدم توثيق أساس المتوسط المرجح)';

export const WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR =
  'اختيار نطاق الفترة في WeightedAvgShares_Basis لا يُثبت تلقائياً تعديل عدد الأسهم لأحداث رأس المال؛ يُوثّق ذلك مستقلاً في حقل IsCapitalActionAdjusted.';

export const WEIGHTED_AVG_SHARES_BASIS_OPTIONS: readonly WeightedAvgSharesBasisOption[] = [
  {
    code: 'ytd_weighted_avg',
    labelAr: 'متوسط مرجح للفترة التراكمية (وقد تشمل السنة الكاملة)',
    shortLabelAr: 'متوسط مرجح تراكمي / سنوي',
    selectLabelAr: 'ytd_weighted_avg — متوسط مرجح للفترة التراكمية YTD (وقد تشمل السنة الكاملة FY)',
    meaningAr:
      'متوسط مرجح لعدد الأسهم يغطي الفترة التراكمية منذ بداية السنة المالية وحتى نهاية الفترة المسجلة، وقد تشمل السنة المالية الكاملة (FY).',
    usageLimitsAr:
      'مؤهل مباشرةً كمقام لـ AccountingEPS للفترة وللفترات المكوّنة لـ TTM عند اكتمال شروط الأيام والاتصال. لا يُثبت وحده تعديل الأسهم لأحداث رأس المال (يُوثّق ذلك عبر IsCapitalActionAdjusted).',
    accountingEpsPolicy: 'direct_ytd_or_fy',
    provesCapitalActionAdjustment: false,
  },
  {
    code: 'standalone_quarter',
    labelAr: 'متوسط مرجح للربع المنفرد فقط',
    shortLabelAr: 'ربع منفرد فقط',
    selectLabelAr: 'standalone_quarter — متوسط مرجح للربع المنفرد فقط',
    meaningAr:
      'متوسط مرجح لعدد الأسهم لربع مالي واحد منفرد، ولا يمثل تلقائياً فترة 6 أشهر (Q2 YTD) أو 9 أشهر (Q3 YTD) أو سنة مالية كاملة (FY).',
    usageLimitsAr:
      'لا يُقبل مقاماً لأرباح Q2/Q3 التراكمية أو FY؛ ويُقبل في Q1 فقط عند توثيق حدود الفترة بالتواريخ الفعلية وتطابقها مع الربع الأول التراكمي (دون تغيير الرمز المحفوظ). لا يُثبت وحده تعديل أحداث رأس المال.',
    accountingEpsPolicy: 'conditional_q1_documented_equivalence',
    provesCapitalActionAdjustment: false,
  },
  {
    code: 'end_of_period_proxy',
    labelAr: 'عدد أسهم نهاية الفترة (تقريبي)',
    shortLabelAr: 'نهاية فترة تقريبي',
    selectLabelAr: 'end_of_period_proxy — عدد أسهم نهاية الفترة التقريبي (وليس متوسطاً أو سنة كاملة)',
    meaningAr:
      'عدد أسهم نهاية الفترة التقريبي بدلاً من متوسط مرجح فعلي خلال الفترة، ولا يعني «سنة مالية كاملة».',
    usageLimitsAr:
      'يُستبعد من حساب AccountingEPS المحاسبي الدقيق (الفترة وTTM) لكونه قيمة تقريبية لنهاية الفترة وليس متوسطاً مرجحاً زمنياً فعلياً.',
    accountingEpsPolicy: 'blocked',
    provesCapitalActionAdjustment: false,
  },
  {
    code: 'unadjusted_weighted_avg',
    labelAr: 'متوسط مرجح غير معدل لأحداث رأس المال',
    shortLabelAr: 'غير معدل رأسمالياً',
    selectLabelAr: 'unadjusted_weighted_avg — متوسط مرجح غير معدل لأحداث رأس المال',
    meaningAr:
      'متوسط مرجح لعدد الأسهم لم يُعدّل بأثر رجعي لأحداث رأس المال (مثل التجزئة أو الأسهم المجانية أو زيادة رأس المال).',
    usageLimitsAr:
      'يُستبعد من حساب AccountingEPS المحاسبي الدقيق لمنع تشويه الربحية أو خلط فترات غير متكافئة رأسمالياً.',
    accountingEpsPolicy: 'blocked',
    provesCapitalActionAdjustment: false,
  },
  {
    code: 'unknown',
    labelAr: 'غير موثق الأساس',
    shortLabelAr: 'غير موثق',
    selectLabelAr: 'unknown — أساس غير موثق',
    meaningAr:
      'الأساس المحاسبي لعدد الأسهم المرجح غير موثق أو غير معروف من القوائم المالية.',
    usageLimitsAr:
      'يُستبعد من حساب AccountingEPS المحاسبي الدقيق إلى حين توثيق الأساس الفعلي من القوائم المالية.',
    accountingEpsPolicy: 'blocked',
    provesCapitalActionAdjustment: false,
  },
] as const;

export const ALLOWED_WEIGHTED_AVG_SHARES_BASIS = new Set<WeightedAvgSharesBasis>(
  WEIGHTED_AVG_SHARES_BASIS_OPTIONS.map((opt) => opt.code)
);

const OPTION_BY_CODE = new Map<WeightedAvgSharesBasis, WeightedAvgSharesBasisOption>(
  WEIGHTED_AVG_SHARES_BASIS_OPTIONS.map((opt) => [opt.code, opt])
);

export function isAllowedWeightedAvgSharesBasis(value: unknown): value is WeightedAvgSharesBasis {
  return typeof value === 'string' && ALLOWED_WEIGHTED_AVG_SHARES_BASIS.has(value as WeightedAvgSharesBasis);
}

export function getWeightedAvgSharesBasisOption(
  value: unknown
): WeightedAvgSharesBasisOption | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return OPTION_BY_CODE.get(trimmed as WeightedAvgSharesBasis) ?? null;
}

export interface WeightedAvgSharesBasisInspection {
  status: 'empty' | 'valid' | 'unrecognized';
  rawValue: string | null;
  code: WeightedAvgSharesBasis | null;
  option: WeightedAvgSharesBasisOption | null;
}

/**
 * Non-mutating inspection for read paths and edit modals:
 * NEVER silently maps an unrecognized stored value to the first option or to `unknown`.
 */
export function inspectWeightedAvgSharesBasis(raw: unknown): WeightedAvgSharesBasisInspection {
  if (raw === undefined || raw === null) {
    return { status: 'empty', rawValue: null, code: null, option: null };
  }
  const cleaned = typeof raw === 'string' ? parseCleanText(raw) : String(raw).trim() || null;
  if (!cleaned) {
    return { status: 'empty', rawValue: null, code: null, option: null };
  }
  const normalized = cleaned.toLowerCase();
  if (ALLOWED_WEIGHTED_AVG_SHARES_BASIS.has(normalized as WeightedAvgSharesBasis)) {
    const code = normalized as WeightedAvgSharesBasis;
    return {
      status: 'valid',
      rawValue: cleaned,
      code,
      option: OPTION_BY_CODE.get(code) ?? null,
    };
  }
  return {
    status: 'unrecognized',
    rawValue: cleaned,
    code: null,
    option: null,
  };
}

/**
 * Single Source of Truth write validator used identically by UI forms, Excel importer, and server `validateRecords`.
 * Preserves existing canonical codes, trims & lowercases valid codes, converts empty/BLANK to `null`,
 * and explicitly rejects any unknown or non-string value without defaulting to the first option.
 */
export function validateAndNormalizeWeightedAvgSharesBasis(
  raw: unknown
): WeightedAvgSharesBasis | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new Error(
      `قيمة WeightedAvgShares_Basis غير صالحة؛ المسموح: ${WEIGHTED_AVG_SHARES_BASIS_CODES_TEXT}.`
    );
  }
  const cleaned = parseCleanText(raw);
  if (!cleaned) return null;
  const normalized = cleaned.toLowerCase();
  if (!ALLOWED_WEIGHTED_AVG_SHARES_BASIS.has(normalized as WeightedAvgSharesBasis)) {
    throw new Error(
      `قيمة WeightedAvgShares_Basis غير صالحة (${cleaned})؛ المسموح: ${WEIGHTED_AVG_SHARES_BASIS_CODES_TEXT}.`
    );
  }
  return normalized as WeightedAvgSharesBasis;
}

export function formatWeightedAvgSharesBasisAr(raw: unknown): string {
  const inspected = inspectWeightedAvgSharesBasis(raw);
  if (inspected.status === 'empty') return 'غير محدد (BLANK)';
  if (inspected.status === 'valid' && inspected.option) {
    return `${inspected.option.labelAr} (${inspected.option.code})`;
  }
  return `قيمة محفوظة غير معروفة (${inspected.rawValue ?? '-'})`;
}
