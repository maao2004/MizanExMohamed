/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Interpretive & Aggregation Logic — Documented Real Estate Disclosures (Foundation)
 *
 * Governance Invariants:
 * - Preserves strict distinction between `null` (missing) and `0` (explicit zero).
 * - Rejects non-finite and negative asset values.
 * - NEVER infers fair value from carrying value when fair value is missing.
 * - Computes ONLY «فرق القيمة العادلة المُفصح عنها عن القيمة الدفترية»
 *   when comparable values exist for matching scope, explicitly confirmed asset pool
 *   (`fairValueAssetScopeMatchesCarrying === true`, NEVER treating `null` as `true`), and date.
 * - Separates structural validity, documentation completeness, and comparability with zero
 *   contradiction (`complete_comparable` is NEVER reported when comparability is blocked).
 * - NEVER labels the difference as period revaluation gain, NAV, or share price.
 * - Enforces duplicate-ID detection before any summation (exact duplicates counted once;
 *   conflicting duplicates block aggregation with a structured reason).
 * - NEVER excludes `component_detail` based on `assetCategory` alone; exclusion requires
 *   a documented, verified containment relationship (`parentDisclosureId` matching a present
 *   `total_summary` with compatible company, period, and statement scope).
 * - Blocks approved aggregate totals under ambiguity/missing/conflicting parents while keeping
 *   all received disclosures visible in `items`.
 * - Does NOT alter NetIncome, EPS, Equity, valuation models, or Firestore.
 */

import {
  deriveRealEstateDisclosureStatusBreakdown,
  inspectFinancialStatementScope,
  inspectRealEstateAccountingPolicy,
  inspectRealEstateAggregationLevel,
  inspectRealEstateAssetCategory,
  inspectRealEstateDisclosureId,
  inspectRealEstateFairValueSourceType,
  isValidCalendarDate,
  type FinancialStatementScope,
  type RealEstateAccountingPolicy,
  type RealEstateAssetCategory,
  type RealEstateComparabilityStatus,
  type RealEstateDisclosureAggregationLevel,
  type RealEstateDisclosureCompletenessStatus,
  type RealEstateDisclosureRecord,
  type RealEstateDocumentationStatus,
  type RealEstateStructuralValidityStatus,
} from '../contracts';

export const DISCLOSED_FAIR_VALUE_DIFFERENCE_LABEL_AR =
  'فرق القيمة العادلة المُفصح عنها عن القيمة الدفترية';

export const DISCLOSED_FAIR_VALUE_ACCOUNTING_DISCLAIMER_AR =
  'هذا الرقم يمثل «فرق القيمة العادلة المُفصح عنها عن القيمة الدفترية» وفق بيانات الإيضاح فقط؛ ولا يُعد ربح إعادة تقييم للفترة ولا صافي قيمة أصول معدل (Adjusted NAV) ولا سعر سهم ولا يدخل في نماذج التقييم أو القيمة المركبة.';

export type RealEstateComparisonBlockCode =
  | 'missing_disclosure_id'
  | 'invalid_disclosure_id'
  | 'invalid_parent_disclosure_id'
  | 'missing_carrying_value'
  | 'missing_fair_value'
  | 'invalid_numeric_value'
  | 'unspecified_statement_scope'
  | 'unrecognized_statement_scope'
  | 'statement_scope_mismatch'
  | 'asset_scope_mismatch'
  | 'unverified_asset_scope_match'
  | 'invalid_asset_scope_match_flag'
  | 'unrecognized_asset_category'
  | 'unrecognized_accounting_policy'
  | 'unrecognized_aggregation_level'
  | 'unrecognized_fair_value_source_type'
  | 'missing_comparison_dates'
  | 'invalid_comparison_dates'
  | 'date_mismatch_not_comparable'
  | 'mixed_tickers_in_summary'
  | 'mixed_statement_scopes_in_summary'
  | 'mixed_balance_sheet_dates_in_summary'
  | 'conflicting_duplicate_disclosure_id'
  | 'missing_parent_disclosure'
  | 'conflicting_parent_disclosure'
  | 'unresolved_component_parent'
  | 'ambiguous_aggregation_overlap';

export interface RealEstateComparisonBlockReason {
  code: RealEstateComparisonBlockCode;
  messageAr: string;
}

export interface RealEstateComparisonOptions {
  /**
   * Maximum allowed absolute calendar day gap between `balanceSheetDate` and `fairValueDate`.
   * Defaults to `0` (exact date match required for strict comparability).
   */
  maxAllowedDateGapDays?: number;
  /**
   * Optional expected statement scope from the linked financial record context.
   * When provided and different from the disclosure's `statementScope`, comparison is blocked.
   */
  expectedStatementScope?: FinancialStatementScope | null;
}

/**
 * Input shape accepted by read/interpretive functions: allows inspecting raw/unvalidated
 * records too (e.g. records with an unrecognized stored category or invalid numbers/IDs)
 * without mutating them or silently defaulting unknown categories.
 */
export type RealEstateDisclosureInspectableInput = Partial<
  Omit<
    RealEstateDisclosureRecord,
    'statementScope' | 'assetCategory' | 'accountingPolicy' | 'aggregationLevel' | 'fairValueSourceType'
  >
> & {
  disclosureId?: string | null;
  ticker?: string | null;
  statementScope?: string | null;
  assetCategory?: string | null;
  accountingPolicy?: string | null;
  aggregationLevel?: string | null;
  fairValueSourceType?: string | null;
};

export interface RealEstateFairValueGapEvaluation {
  disclosureId: string | null;
  ticker: string | null;
  /** Fixed canonical Arabic label — NEVER revaluation gain / NAV / share price. */
  metricNameAr: typeof DISCLOSED_FAIR_VALUE_DIFFERENCE_LABEL_AR;
  accountingNatureDisclaimerAr: string;
  /** Axis 1: Structural validity of IDs, numbers, dates, and enum codes. */
  structuralValidityStatus: RealEstateStructuralValidityStatus;
  structuralIssues: RealEstateComparisonBlockReason[];
  /** Axis 2: Documentation completeness independent from comparability. */
  documentationStatus: RealEstateDocumentationStatus;
  missingDocumentationFields: string[];
  /** Axis 3: Comparability of carryingValue vs disclosedFairValue. */
  comparabilityStatus: RealEstateComparabilityStatus;
  comparable: boolean;
  /** `disclosedFairValue - carryingValue` ONLY when `comparable === true`; otherwise `null`. */
  difference: number | null;
  /** `(difference / carryingValue)` ONLY when `comparable === true` and `carryingValue > 0`. */
  differenceRatioToCarrying: number | null;
  carryingValue: number | null;
  disclosedFairValue: number | null;
  isCarryingValueExplicitZero: boolean;
  isFairValueExplicitZero: boolean;
  statementScopeStatus: 'empty' | 'valid' | 'unrecognized';
  statementScope: FinancialStatementScope | null;
  rawStatementScope: string | null;
  assetCategoryStatus: 'empty' | 'valid' | 'unrecognized';
  assetCategory: RealEstateAssetCategory | null;
  rawAssetCategory: string | null;
  accountingPolicyStatus: 'empty' | 'valid' | 'unrecognized';
  accountingPolicy: RealEstateAccountingPolicy | null;
  rawAccountingPolicy: string | null;
  aggregationLevelStatus: 'empty' | 'valid' | 'unrecognized';
  aggregationLevel: RealEstateDisclosureAggregationLevel | null;
  completenessStatus: RealEstateDisclosureCompletenessStatus;
  blockingReasons: RealEstateComparisonBlockReason[];
  dateGapDays: number | null;
  summaryAr: string;
}

const AGGREGATE_INTEGRITY_BLOCK_CODES = new Set<RealEstateComparisonBlockCode>([
  'missing_disclosure_id',
  'invalid_disclosure_id',
  'invalid_parent_disclosure_id',
  'mixed_tickers_in_summary',
  'mixed_statement_scopes_in_summary',
  'mixed_balance_sheet_dates_in_summary',
  'conflicting_duplicate_disclosure_id',
  'missing_parent_disclosure',
  'conflicting_parent_disclosure',
  'unresolved_component_parent',
  'ambiguous_aggregation_overlap',
]);

function absoluteCalendarDayDiff(dateA: string, dateB: string): number {
  const [ay, am, ad] = dateA.split('-').map(Number);
  const [by, bm, bd] = dateB.split('-').map(Number);
  const msA = Date.UTC(ay, am - 1, ad);
  const msB = Date.UTC(by, bm - 1, bd);
  return Math.abs(Math.round((msA - msB) / 86_400_000));
}

function normalizeZero(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

function normalizeOptionalText(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalTicker(val: unknown): string | null {
  const cleaned = normalizeOptionalText(val);
  if (!cleaned) return null;
  return cleaned.toUpperCase().replace(/\.CA$/, '');
}

function normalizeOptionalQuarter(val: unknown): string | null {
  const cleaned = normalizeOptionalText(val);
  return cleaned ? cleaned.toUpperCase() : null;
}

function serializeComparableValue(val: unknown): string {
  if (val === undefined || val === null) return 'null';
  if (typeof val === 'number') {
    if (Number.isNaN(val)) return 'num:NaN';
    return `num:${normalizeZero(val)}`;
  }
  if (typeof val === 'boolean') return `bool:${val}`;
  if (typeof val === 'string') return `str:${val}`;
  return `other:${String(val)}`;
}

/**
 * Pure interpretive evaluator for a single documented real estate disclosure.
 * - Never mutates unknown classifications into defaults.
 * - Never infers fair value from carrying value.
 * - Preserves `0` vs `null` strictly.
 * - Treats `fairValueAssetScopeMatchesCarrying === null` as undocumented (`unverified_asset_scope_match`),
 *   NEVER as `true`.
 * - Separates structural validity, documentation completeness, and comparability cleanly with zero
 *   contradiction (`complete_comparable` is never returned when comparability is blocked).
 */
export function evaluateRealEstateFairValueGap(
  disclosure: RealEstateDisclosureInspectableInput,
  options?: RealEstateComparisonOptions
): RealEstateFairValueGapEvaluation {
  const maxGap = options?.maxAllowedDateGapDays ?? 0;
  const blockingReasons: RealEstateComparisonBlockReason[] = [];
  const structuralIssues: RealEstateComparisonBlockReason[] = [];

  const pushStructuralAndBlocking = (reason: RealEstateComparisonBlockReason) => {
    structuralIssues.push(reason);
    blockingReasons.push(reason);
  };

  // Validate IDs against the central identity rule without mutating raw values
  const idInsp = inspectRealEstateDisclosureId(
    disclosure.disclosureId,
    'معرّف الإفصاح العقاري (disclosureId)'
  );
  if (idInsp.status === 'invalid') {
    pushStructuralAndBlocking({
      code: 'invalid_disclosure_id',
      messageAr: idInsp.errorMessageAr ?? `معرّف الإفصاح العقاري (${idInsp.rawValue ?? '-'}) غير صالح.`,
    });
  }

  const parentIdInsp = inspectRealEstateDisclosureId(
    disclosure.parentDisclosureId,
    'معرّف الإفصاح الأب (parentDisclosureId)'
  );
  if (parentIdInsp.status === 'invalid') {
    pushStructuralAndBlocking({
      code: 'invalid_parent_disclosure_id',
      messageAr:
        parentIdInsp.errorMessageAr ??
        `معرّف الإفصاح الأب (${parentIdInsp.rawValue ?? '-'}) غير صالح.`,
    });
  } else if (
    parentIdInsp.status === 'valid' &&
    idInsp.status === 'valid' &&
    parentIdInsp.normalizedId === idInsp.normalizedId
  ) {
    pushStructuralAndBlocking({
      code: 'invalid_parent_disclosure_id',
      messageAr: `معرّف الإفصاح الأب (${parentIdInsp.normalizedId}) لا يمكن أن يساوي معرّف الإفصاح نفسه.`,
    });
  }

  const scopeInsp = inspectFinancialStatementScope(disclosure.statementScope);
  const categoryInsp = inspectRealEstateAssetCategory(disclosure.assetCategory);
  const policyInsp = inspectRealEstateAccountingPolicy(disclosure.accountingPolicy);
  const aggInsp = inspectRealEstateAggregationLevel(disclosure.aggregationLevel);
  const fvSourceTypeInsp = inspectRealEstateFairValueSourceType(disclosure.fairValueSourceType);
  const fvScopeInsp =
    disclosure.fairValueStatementScope !== undefined && disclosure.fairValueStatementScope !== null
      ? inspectFinancialStatementScope(disclosure.fairValueStatementScope)
      : null;

  const hasUnrecognizedCode =
    scopeInsp.status === 'unrecognized' ||
    categoryInsp.status === 'unrecognized' ||
    policyInsp.status === 'unrecognized' ||
    aggInsp.status === 'unrecognized' ||
    fvSourceTypeInsp.status === 'unrecognized' ||
    fvScopeInsp?.status === 'unrecognized';

  if (scopeInsp.status === 'unrecognized') {
    pushStructuralAndBlocking({
      code: 'unrecognized_statement_scope',
      messageAr: `نطاق الإفصاح المحفوظ (${scopeInsp.rawValue ?? '-'}) غير معروف ولا يُفترض أنه موحد أو مستقل.`,
    });
  } else if (scopeInsp.status === 'empty' || scopeInsp.code === 'unspecified') {
    blockingReasons.push({
      code: 'unspecified_statement_scope',
      messageAr:
        'نطاق الإفصاح (موحد أم مستقل) غير محدد؛ لا تُحسب مقارنة بين القيمة العادلة والدفترية قبل توثيق نطاق القوائم المالية.',
    });
  }

  if (categoryInsp.status === 'unrecognized') {
    pushStructuralAndBlocking({
      code: 'unrecognized_asset_category',
      messageAr: `تصنيف العقار المحفوظ (${categoryInsp.rawValue ?? '-'}) غير معروف ويُحفظ كما هو للمراجعة دون افتراض صامت بأنه استثمارات عقارية.`,
    });
  }

  if (policyInsp.status === 'unrecognized') {
    pushStructuralAndBlocking({
      code: 'unrecognized_accounting_policy',
      messageAr: `السياسة المحاسبية المحفوظة (${policyInsp.rawValue ?? '-'}) غير معروفة وتحتاج مراجعة دون افتراض صامت.`,
    });
  }

  if (aggInsp.status === 'unrecognized') {
    pushStructuralAndBlocking({
      code: 'unrecognized_aggregation_level',
      messageAr: `مستوى التجميع المحفوظ (${aggInsp.rawValue ?? '-'}) غير معروف ويحتاج مراجعة دون افتراض صامت.`,
    });
  }

  if (fvSourceTypeInsp.status === 'unrecognized') {
    pushStructuralAndBlocking({
      code: 'unrecognized_fair_value_source_type',
      messageAr: `تصنيف مصدر القيمة العادلة المحفوظ (${fvSourceTypeInsp.rawValue ?? '-'}) غير معروف ويحتاج مراجعة دون افتراض صامت.`,
    });
  }

  // Validate carryingValue & disclosedFairValue strictly (0 is valid; null is missing; negative/non-finite rejected)
  const rawCarrying = disclosure.carryingValue;
  const rawFair = disclosure.disclosedFairValue;

  let validCarrying: number | null = null;
  let carryingInvalid = false;
  if (rawCarrying === undefined || rawCarrying === null) {
    blockingReasons.push({
      code: 'missing_carrying_value',
      messageAr: 'القيمة الدفترية غير متاحة (null) وليست صفراً؛ تعذر احتساب فرق القيمة العادلة عن الدفترية.',
    });
  } else if (typeof rawCarrying !== 'number' || !Number.isFinite(rawCarrying) || rawCarrying < 0) {
    carryingInvalid = true;
    pushStructuralAndBlocking({
      code: 'invalid_numeric_value',
      messageAr: `القيمة الدفترية غير صالحة (${String(rawCarrying)})؛ يُشترط رقم منتهٍ أكبر من أو يساوي صفر.`,
    });
  } else {
    validCarrying = normalizeZero(rawCarrying);
  }

  let validFair: number | null = null;
  let fairInvalid = false;
  if (rawFair === undefined || rawFair === null) {
    blockingReasons.push({
      code: 'missing_fair_value',
      messageAr:
        'القيمة العادلة المُفصح عنها غير متاحة (null)؛ لا تُستنتج القيمة العادلة من القيمة الدفترية ولا يُحسب فرق افتراضي.',
    });
  } else if (typeof rawFair !== 'number' || !Number.isFinite(rawFair) || rawFair < 0) {
    fairInvalid = true;
    pushStructuralAndBlocking({
      code: 'invalid_numeric_value',
      messageAr: `القيمة العادلة المُفصح عنها غير صالحة (${String(rawFair)})؛ يُشترط رقم منتهٍ أكبر من أو يساوي صفر.`,
    });
  } else {
    validFair = normalizeZero(rawFair);
  }

  // Statement scope cross-checks (disclosure vs fairValueStatementScope, and vs expectedStatementScope)
  if (fvScopeInsp && fvScopeInsp.status === 'unrecognized') {
    pushStructuralAndBlocking({
      code: 'statement_scope_mismatch',
      messageAr: `نطاق القيمة العادلة المُفصح عنها (${fvScopeInsp.rawValue ?? '-'}) غير معروف ولا يمكن التحقق من تطابقه مع نطاق القيمة الدفترية.`,
    });
  } else if (
    fvScopeInsp &&
    fvScopeInsp.status === 'valid' &&
    fvScopeInsp.code &&
    scopeInsp.status === 'valid' &&
    scopeInsp.code &&
    scopeInsp.code !== 'unspecified'
  ) {
    if (fvScopeInsp.code === 'unspecified' || fvScopeInsp.code !== scopeInsp.code) {
      blockingReasons.push({
        code: 'statement_scope_mismatch',
        messageAr: `اختلاف نطاق الإفصاح: القيمة الدفترية تخص القوائم (${scopeInsp.code}) بينما القيمة العادلة تخص (${fvScopeInsp.code})؛ لا يجوز احتساب فرق بين نطاقين مختلفين.`,
      });
    }
  }

  if (
    options?.expectedStatementScope &&
    options.expectedStatementScope !== 'unspecified' &&
    scopeInsp.status === 'valid' &&
    scopeInsp.code &&
    scopeInsp.code !== 'unspecified' &&
    scopeInsp.code !== options.expectedStatementScope
  ) {
    blockingReasons.push({
      code: 'statement_scope_mismatch',
      messageAr: `نطاق الإفصاح العقاري (${scopeInsp.code}) يختلف عن نطاق القوائم المالية المطلوب للمقارنة (${options.expectedStatementScope}).`,
    });
  }

  // Asset pool match check — STRICT: null/undefined means UNDOCUMENTED, NEVER treated as true!
  const rawAssetScopeMatch = disclosure.fairValueAssetScopeMatchesCarrying;
  let normalizedAssetScopeMatch: boolean | null = null;
  if (rawAssetScopeMatch === true) {
    normalizedAssetScopeMatch = true;
  } else if (rawAssetScopeMatch === false) {
    normalizedAssetScopeMatch = false;
    blockingReasons.push({
      code: 'asset_scope_mismatch',
      messageAr:
        'نطاق الأصول المشمولة في القيمة العادلة المُفصح عنها لا يطابق نطاق الأصول المشمولة في القيمة الدفترية؛ تعذر احتساب فرق قابل للمقارنة.',
    });
  } else if (rawAssetScopeMatch === null || rawAssetScopeMatch === undefined) {
    normalizedAssetScopeMatch = null;
    blockingReasons.push({
      code: 'unverified_asset_scope_match',
      messageAr:
        'تطابق نطاق الأصول بين القيمة العادلة والدفترية غير موثّق (null)؛ لا يُفترض التطابق تلقائياً ويُعلق احتساب الفرق المعتمد حتى توثيق التطابق صراحةً.',
    });
  } else {
    pushStructuralAndBlocking({
      code: 'invalid_asset_scope_match_flag',
      messageAr: `قيمة تطابق نطاق الأصول (${String(rawAssetScopeMatch)}) غير صالحة؛ يُشترط true أو false أو null.`,
    });
  }

  // Date comparability check — strict calendar date match (default maxGap = 0)
  const bsDate = normalizeOptionalText(disclosure.balanceSheetDate);
  const fvDate = normalizeOptionalText(disclosure.fairValueDate);

  let dateGapDays: number | null = null;
  let hasInvalidDate = false;
  if (!bsDate || !fvDate) {
    if (bsDate && !isValidCalendarDate(bsDate)) {
      hasInvalidDate = true;
      pushStructuralAndBlocking({
        code: 'invalid_comparison_dates',
        messageAr: `تاريخ المركز المالي (${bsDate}) غير صالح تقويمياً (المطلوب YYYY-MM-DD).`,
      });
    }
    if (fvDate && !isValidCalendarDate(fvDate)) {
      hasInvalidDate = true;
      pushStructuralAndBlocking({
        code: 'invalid_comparison_dates',
        messageAr: `تاريخ القيمة العادلة (${fvDate}) غير صالح تقويمياً (المطلوب YYYY-MM-DD).`,
      });
    }
    blockingReasons.push({
      code: 'missing_comparison_dates',
      messageAr:
        'تاريخ المركز المالي (balanceSheetDate) وتاريخ القيمة العادلة (fairValueDate) مطلوبان معاً للتحقق من قابلية المقارنة الزمنية.',
    });
  } else if (!isValidCalendarDate(bsDate) || !isValidCalendarDate(fvDate)) {
    hasInvalidDate = true;
    pushStructuralAndBlocking({
      code: 'invalid_comparison_dates',
      messageAr: `أحد تاريخي المقارنة غير صالح تقويمياً (المركز المالي: ${bsDate}، القيمة العادلة: ${fvDate}).`,
    });
  } else {
    dateGapDays = absoluteCalendarDayDiff(bsDate, fvDate);
    if (dateGapDays > maxGap) {
      blockingReasons.push({
        code: 'date_mismatch_not_comparable',
        messageAr: `تاريخ القيمة العادلة (${fvDate}) لا يطابق تاريخ المركز المالي (${bsDate}) بفارق ${dateGapDays} يوماً؛ لا يُحسب فرق مضلل بين تاريخين غير متوافقين.`,
      });
    }
  }

  const hasInvalidStructure =
    structuralIssues.length > 0 || carryingInvalid || fairInvalid || hasInvalidDate;

  const statusBreakdown = deriveRealEstateDisclosureStatusBreakdown({
    carryingValue: validCarrying,
    disclosedFairValue: validFair,
    statementScope: scopeInsp.code ?? 'unspecified',
    fairValueStatementScope: fvScopeInsp?.status === 'valid' ? fvScopeInsp.code : null,
    fairValueAssetScopeMatchesCarrying: normalizedAssetScopeMatch,
    balanceSheetDate: bsDate && isValidCalendarDate(bsDate) ? bsDate : null,
    fairValueDate: fvDate && isValidCalendarDate(fvDate) ? fvDate : null,
    accountingPolicy: policyInsp.code ?? 'unspecified',
    footnoteReference: normalizeOptionalText(disclosure.footnoteReference),
    fairValueSource: normalizeOptionalText(disclosure.fairValueSource),
    hasUnrecognizedCode,
    hasInvalidStructure,
    maxAllowedDateGapDays: maxGap,
    expectedStatementScope: options?.expectedStatementScope ?? null,
  });

  const comparable =
    blockingReasons.length === 0 &&
    statusBreakdown.comparabilityStatus === 'comparable' &&
    !carryingInvalid &&
    !fairInvalid &&
    validCarrying !== null &&
    validFair !== null;

  const difference = comparable ? normalizeZero(validFair! - validCarrying!) : null;
  const differenceRatioToCarrying =
    comparable && validCarrying !== null && validCarrying > 0 && difference !== null
      ? normalizeZero(difference / validCarrying)
      : null;

  const summaryAr = comparable
    ? difference === 0
      ? `${DISCLOSED_FAIR_VALUE_DIFFERENCE_LABEL_AR} = 0 (القيمة العادلة المُفصح عنها تساوي القيمة الدفترية عند ${bsDate}؛ ولا يُستنتج من ذلك ربح إعادة تقييم للفترة).`
      : `${DISCLOSED_FAIR_VALUE_DIFFERENCE_LABEL_AR} = ${difference} (القيمة العادلة ${validFair} − الدفترية ${validCarrying} بتاريخ ${bsDate}؛ إفصاح مقارن وليس ربح فترة أو NAV).`
    : `${DISCLOSED_FAIR_VALUE_DIFFERENCE_LABEL_AR}: غير متاح (${blockingReasons.map((r) => r.messageAr).join(' | ')}).`;

  return {
    disclosureId: disclosure.disclosureId ?? null,
    ticker: disclosure.ticker ?? null,
    metricNameAr: DISCLOSED_FAIR_VALUE_DIFFERENCE_LABEL_AR,
    accountingNatureDisclaimerAr: DISCLOSED_FAIR_VALUE_ACCOUNTING_DISCLAIMER_AR,
    structuralValidityStatus: statusBreakdown.structuralValidityStatus,
    structuralIssues,
    documentationStatus: statusBreakdown.documentationStatus,
    missingDocumentationFields: statusBreakdown.missingDocumentationFields,
    comparabilityStatus: comparable ? 'comparable' : 'blocked',
    comparable,
    difference,
    differenceRatioToCarrying,
    carryingValue: validCarrying,
    disclosedFairValue: validFair,
    isCarryingValueExplicitZero: validCarrying === 0,
    isFairValueExplicitZero: validFair === 0,
    statementScopeStatus: scopeInsp.status,
    statementScope: scopeInsp.code,
    rawStatementScope: scopeInsp.rawValue,
    assetCategoryStatus: categoryInsp.status,
    assetCategory: categoryInsp.code,
    rawAssetCategory: categoryInsp.rawValue,
    accountingPolicyStatus: policyInsp.status,
    accountingPolicy: policyInsp.code,
    rawAccountingPolicy: policyInsp.rawValue,
    aggregationLevelStatus: aggInsp.status,
    aggregationLevel: aggInsp.code,
    completenessStatus: statusBreakdown.completenessStatus,
    blockingReasons,
    dateGapDays,
    summaryAr,
  };
}

export interface ExcludedDisclosureEntry {
  disclosureId: string | null;
  reasonCode: 'exact_duplicate_disclosure_id' | 'child_of_present_total';
  parentDisclosureId: string | null;
  reasonAr: string;
}

export interface RealEstateDisclosuresAggregateSummary {
  metricNameAr: string;
  accountingNatureDisclaimerAr: string;
  ticker: string | null;
  statementScope: FinancialStatementScope | null;
  balanceSheetDate: string | null;
  totalDisclosuresReceived: number;
  includedDisclosureIds: string[];
  excludedDuplicates: ExcludedDisclosureEntry[];
  items: RealEstateFairValueGapEvaluation[];
  aggregateComparable: boolean;
  totalCarryingValue: number | null;
  totalDisclosedFairValue: number | null;
  /** Sum of `disclosedFairValue - carryingValue` across non-overlapping comparable items ONLY. */
  totalFairValueMinusCarryingValue: number | null;
  blockingReasons: RealEstateComparisonBlockReason[];
  reconciliationNotesAr: string[];
}

interface SubstantiveSnapshot {
  ticker: string;
  fiscalYear: string;
  fiscalQuarter: string;
  balanceSheetDate: string;
  statementScope: string;
  assetCategory: string;
  assetUsageDescription: string;
  accountingPolicy: string;
  aggregationLevel: string;
  parentDisclosureId: string;
  carryingValue: string;
  disclosedFairValue: string;
  fairValueDate: string;
  fairValueStatementScope: string;
  fairValueAssetScopeMatchesCarrying: string;
  fairValueSource: string;
  fairValueSourceType: string;
  footnoteReference: string;
  explanatoryNote: string;
}

function buildSubstantiveSnapshot(raw: RealEstateDisclosureInspectableInput): SubstantiveSnapshot {
  const scopeInsp = inspectFinancialStatementScope(raw.statementScope);
  const catInsp = inspectRealEstateAssetCategory(raw.assetCategory);
  const polInsp = inspectRealEstateAccountingPolicy(raw.accountingPolicy);
  const aggInsp = inspectRealEstateAggregationLevel(raw.aggregationLevel);
  const fvScopeInsp = inspectFinancialStatementScope(raw.fairValueStatementScope);
  const fvSrcInsp = inspectRealEstateFairValueSourceType(raw.fairValueSourceType);
  const parentInsp = inspectRealEstateDisclosureId(raw.parentDisclosureId);

  return {
    ticker: serializeComparableValue(normalizeOptionalTicker(raw.ticker)),
    fiscalYear: serializeComparableValue(raw.fiscalYear ?? null),
    fiscalQuarter: serializeComparableValue(normalizeOptionalQuarter(raw.fiscalQuarter)),
    balanceSheetDate: serializeComparableValue(normalizeOptionalText(raw.balanceSheetDate)),
    statementScope: serializeComparableValue(scopeInsp.code ?? scopeInsp.rawValue),
    assetCategory: serializeComparableValue(catInsp.code ?? catInsp.rawValue),
    assetUsageDescription: serializeComparableValue(normalizeOptionalText(raw.assetUsageDescription)),
    accountingPolicy: serializeComparableValue(polInsp.code ?? polInsp.rawValue),
    aggregationLevel: serializeComparableValue(aggInsp.code ?? aggInsp.rawValue),
    parentDisclosureId: serializeComparableValue(parentInsp.normalizedId ?? parentInsp.rawValue),
    carryingValue: serializeComparableValue(raw.carryingValue ?? null),
    disclosedFairValue: serializeComparableValue(raw.disclosedFairValue ?? null),
    fairValueDate: serializeComparableValue(normalizeOptionalText(raw.fairValueDate)),
    fairValueStatementScope: serializeComparableValue(fvScopeInsp.code ?? fvScopeInsp.rawValue),
    fairValueAssetScopeMatchesCarrying: serializeComparableValue(
      raw.fairValueAssetScopeMatchesCarrying ?? null
    ),
    fairValueSource: serializeComparableValue(normalizeOptionalText(raw.fairValueSource)),
    fairValueSourceType: serializeComparableValue(fvSrcInsp.code ?? fvSrcInsp.rawValue),
    footnoteReference: serializeComparableValue(normalizeOptionalText(raw.footnoteReference)),
    explanatoryNote: serializeComparableValue(normalizeOptionalText(raw.explanatoryNote)),
  };
}

function findSnapshotDifferences(a: SubstantiveSnapshot, b: SubstantiveSnapshot): string[] {
  const diffs: string[] = [];
  (Object.keys(a) as Array<keyof SubstantiveSnapshot>).forEach((key) => {
    if (a[key] !== b[key]) {
      diffs.push(key);
    }
  });
  return diffs;
}

/**
 * Pure non-duplicative aggregator for multiple real estate disclosures of a single company/period.
 * - Detects duplicate identities BEFORE any summation:
 *   - Exact identical duplicates are counted ONCE (logged in `excludedDuplicates`).
 *   - Conflicting duplicate IDs block aggregation with `conflicting_duplicate_disclosure_id`
 *     (never silently choosing one record over another).
 * - Refuses to sum across different tickers, different statement scopes (consolidated vs standalone),
 *   or different balance-sheet dates.
 * - NEVER excludes `component_detail` solely because a `total_summary` shares the same `assetCategory`.
 * - Excludes `component_detail` ONLY when it has a documented, verified containment relationship
 *   (`parentDisclosureId` referencing a present `total_summary` with matching company, period, and scope).
 * - Treats missing/conflicting parents and unresolved overlap as review cases that block approved
 *   aggregate totals while keeping ALL received records visible in `items`.
 */
export function summarizeRealEstateDisclosures(
  disclosures: readonly RealEstateDisclosureInspectableInput[],
  options?: RealEstateComparisonOptions
): RealEstateDisclosuresAggregateSummary {
  const evaluations = disclosures.map((d) => evaluateRealEstateFairValueGap(d, options));
  const blockingReasons: RealEstateComparisonBlockReason[] = [];
  const excludedDuplicates: ExcludedDisclosureEntry[] = [];
  const reconciliationNotesAr: string[] = [];

  const addUniqueBlocker = (reason: RealEstateComparisonBlockReason) => {
    if (!blockingReasons.some((b) => b.code === reason.code && b.messageAr === reason.messageAr)) {
      blockingReasons.push(reason);
    }
  };

  if (disclosures.length === 0) {
    return {
      metricNameAr: `${DISCLOSED_FAIR_VALUE_DIFFERENCE_LABEL_AR} (إجمالي دون تكرار)`,
      accountingNatureDisclaimerAr: DISCLOSED_FAIR_VALUE_ACCOUNTING_DISCLAIMER_AR,
      ticker: null,
      statementScope: null,
      balanceSheetDate: null,
      totalDisclosuresReceived: 0,
      includedDisclosureIds: [],
      excludedDuplicates: [],
      items: [],
      aggregateComparable: false,
      totalCarryingValue: null,
      totalDisclosedFairValue: null,
      totalFairValueMinusCarryingValue: null,
      blockingReasons: [],
      reconciliationNotesAr: ['لا توجد إفصاحات عقارية مسجلة لهذه المجموعة.'],
    };
  }

  // 1) Cross-record consistency checks (ticker, statementScope, balanceSheetDate)
  const distinctTickers = Array.from(
    new Set(disclosures.map((d) => normalizeOptionalTicker(d.ticker)).filter(Boolean) as string[])
  );
  if (distinctTickers.length > 1) {
    addUniqueBlocker({
      code: 'mixed_tickers_in_summary',
      messageAr: `لا يجوز تجميع إفصاحات لأكثر من شركة واحدة (${distinctTickers.join('، ')}).`,
    });
  }

  const distinctScopes = Array.from(
    new Set(evaluations.map((e) => e.statementScope ?? e.rawStatementScope ?? 'unspecified'))
  );
  if (distinctScopes.length > 1) {
    addUniqueBlocker({
      code: 'mixed_statement_scopes_in_summary',
      messageAr: `تعارض نطاقات القوائم المالية داخل التجميع (${distinctScopes.join(' مقابل ')})؛ لا يجوز جمع قوائم موحدة مع مستقلة أو غير محددة.`,
    });
  }

  const distinctBsDates = Array.from(
    new Set(
      disclosures
        .map((d) => normalizeOptionalText(d.balanceSheetDate))
        .filter(Boolean) as string[]
    )
  );
  if (distinctBsDates.length > 1) {
    addUniqueBlocker({
      code: 'mixed_balance_sheet_dates_in_summary',
      messageAr: `اختلاف تواريخ المركز المالي داخل التجميع (${distinctBsDates.join(' مقابل ')})؛ لا يجوز جمع أرصدة من تواريخ مركز مالي مختلفة.`,
    });
  }

  // 2) Duplicate identity detection BEFORE any summation
  interface IndexedEntry {
    idx: number;
    raw: RealEstateDisclosureInspectableInput;
    ev: RealEstateFairValueGapEvaluation;
    canonicalId: string | null;
    snapshot: SubstantiveSnapshot;
  }

  const uniqueEntries: IndexedEntry[] = [];
  const firstById = new Map<string, IndexedEntry>();
  const exactDuplicateCountById = new Map<string, number>();
  const conflictingIds = new Set<string>();

  disclosures.forEach((raw, idx) => {
    const ev = evaluations[idx];
    const idInsp = inspectRealEstateDisclosureId(
      raw.disclosureId,
      'معرّف الإفصاح العقاري (disclosureId)'
    );
    const snapshot = buildSubstantiveSnapshot(raw);

    if (idInsp.status === 'empty') {
      addUniqueBlocker({
        code: 'missing_disclosure_id',
        messageAr: `الصف رقم (${idx + 1}) يفتقد معرّف الإفصاح (disclosureId)؛ لا يمكن التحقق من عدم التكرار أو علاقات الاحتواء قبل تعيين معرّف صالح.`,
      });
      uniqueEntries.push({ idx, raw, ev, canonicalId: null, snapshot });
      return;
    }

    if (idInsp.status === 'invalid' || !idInsp.normalizedId) {
      addUniqueBlocker({
        code: 'invalid_disclosure_id',
        messageAr:
          idInsp.errorMessageAr ??
          `الصف رقم (${idx + 1}) يحمل معرّف إفصاح غير صالح (${idInsp.rawValue ?? '-'}).`,
      });
      uniqueEntries.push({ idx, raw, ev, canonicalId: null, snapshot });
      return;
    }

    const canonicalId = idInsp.normalizedId;
    const existing = firstById.get(canonicalId);
    if (!existing) {
      const entry: IndexedEntry = { idx, raw, ev, canonicalId, snapshot };
      firstById.set(canonicalId, entry);
      uniqueEntries.push(entry);
      return;
    }

    const diffs = findSnapshotDifferences(existing.snapshot, snapshot);
    if (diffs.length === 0) {
      // Exact duplicate of the same disclosure: do NOT sum twice
      exactDuplicateCountById.set(canonicalId, (exactDuplicateCountById.get(canonicalId) ?? 0) + 1);
      excludedDuplicates.push({
        disclosureId: canonicalId,
        reasonCode: 'exact_duplicate_disclosure_id',
        parentDisclosureId: null,
        reasonAr: `استُبعد التكرار المطابق للمعرّف (${canonicalId}) من الجمع حتى لا تتضاعف الأرصدة.`,
      });
      return;
    }

    // Conflicting duplicate identity: NEVER silently pick one; block aggregate with structured reason
    conflictingIds.add(canonicalId);
    addUniqueBlocker({
      code: 'conflicting_duplicate_disclosure_id',
      messageAr: `تعارض في تكرار معرّف الإفصاح (${canonicalId}) بقيم مختلفة في الحقول (${diffs.join('، ')})؛ حُجب التجميع المعتمد دون اختيار أحد السجلين بصمت وتبقى جميع السجلات ظاهرة للمراجعة.`,
    });
  });

  for (const [dupId, dupCount] of exactDuplicateCountById.entries()) {
    reconciliationNotesAr.push(
      `ملاحظة إزالة تكرار: ورد السجل المطابق (${dupId}) عدد (${dupCount + 1}) مرات بالقيم نفسها تماماً، وتم احتسابه مرة واحدة فقط دون مضاعفة الأرصدة.`
    );
  }

  // 3) Strict documented containment resolution (NEVER exclude based on assetCategory alone)
  const totalSummaryEntries = uniqueEntries.filter(
    (entry) => entry.ev.aggregationLevel === 'total_summary'
  );

  // Detect overlapping multiple total_summary rows for the same assetCategory or unspecified category
  const totalSummaryByCategory = new Map<string, string[]>();
  for (const totalEntry of totalSummaryEntries) {
    const catKey = totalEntry.ev.assetCategory ?? totalEntry.ev.rawAssetCategory ?? 'unspecified';
    const list = totalSummaryByCategory.get(catKey) ?? [];
    list.push(totalEntry.canonicalId ?? `row_${totalEntry.idx + 1}`);
    totalSummaryByCategory.set(catKey, list);
  }
  for (const [catKey, ids] of totalSummaryByCategory.entries()) {
    if (ids.length > 1) {
      addUniqueBlocker({
        code: 'ambiguous_aggregation_overlap',
        messageAr: `تزامن أكثر من إفصاح إجمالي (total_summary) لنفس التصنيف (${catKey}): (${ids.join('، ')})؛ حُجب الإجمالي المعتمد لوجود تداخل غير محسوم وتبقى جميع السجلات ظاهرة.`,
      });
    }
  }

  const includedEntries: IndexedEntry[] = [];
  const childrenByParentId = new Map<string, RealEstateFairValueGapEvaluation[]>();

  for (const entry of uniqueEntries) {
    const { raw, ev, canonicalId } = entry;
    const displayId = canonicalId ?? raw.disclosureId ?? `row_${entry.idx + 1}`;
    const parentInsp = inspectRealEstateDisclosureId(
      raw.parentDisclosureId,
      'معرّف الإفصاح الأب (parentDisclosureId)'
    );

    if (parentInsp.status === 'invalid') {
      addUniqueBlocker({
        code: 'invalid_parent_disclosure_id',
        messageAr:
          parentInsp.errorMessageAr ??
          `معرّف الإفصاح الأب في السجل (${displayId}) غير صالح (${parentInsp.rawValue ?? '-'}).`,
      });
      includedEntries.push(entry);
      continue;
    }

    if (ev.aggregationLevel === 'component_detail') {
      if (parentInsp.status === 'empty' || !parentInsp.normalizedId) {
        // NEVER exclude by category alone — missing parent reference is a review case
        addUniqueBlocker({
          code: 'unresolved_component_parent',
          messageAr: `التفصيل الفرعي (${displayId}) لا يوثّق معرّف الإفصاح الإجمالي الأب (parentDisclosureId)؛ لا يُستبعد تلقائياً اعتماداً على التصنيف وحده، وحُجب الإجمالي المعتمد للمراجعة مع إبقاء جميع السجلات ظاهرة.`,
        });
        includedEntries.push(entry);
        continue;
      }

      const parentId = parentInsp.normalizedId;
      if (canonicalId && parentId === canonicalId) {
        addUniqueBlocker({
          code: 'invalid_parent_disclosure_id',
          messageAr: `التفصيل الفرعي (${displayId}) يشير إلى نفسه كإفصاح أب (${parentId}).`,
        });
        includedEntries.push(entry);
        continue;
      }

      const parentEntry = firstById.get(parentId);
      if (!parentEntry) {
        // Missing / different parent — NEVER exclude by category alone
        addUniqueBlocker({
          code: 'missing_parent_disclosure',
          messageAr: `التفصيل الفرعي (${displayId}) مرتبط بإفصاح أب غائب عن المجموعة (${parentId})؛ لا يُعد ذلك إثباتاً على دخوله ضمن إجمالي آخر بنفس التصنيف، وحُجب الإجمالي المعتمد للمراجعة مع إبقاء جميع السجلات ظاهرة.`,
        });
        includedEntries.push(entry);
        continue;
      }

      // Verify full containment compatibility: parent must be non-conflicting total_summary
      // with matching company (ticker), period (fiscalYear, fiscalQuarter, balanceSheetDate), and statementScope.
      const compatibilityIssues: string[] = [];

      if (conflictingIds.has(parentId)) {
        compatibilityIssues.push(`الإفصاح الأب (${parentId}) يعاني من تعارض تكرار هوية`);
      }
      if (parentEntry.ev.aggregationLevel !== 'total_summary') {
        compatibilityIssues.push(
          `الإفصاح الأب (${parentId}) ليس من نوع total_summary (النوع الحالي: ${parentEntry.ev.aggregationLevel ?? 'غير معروف'})`
        );
      }

      const childTicker = normalizeOptionalTicker(raw.ticker);
      const parentTicker = normalizeOptionalTicker(parentEntry.raw.ticker);
      if (!childTicker || !parentTicker || childTicker !== parentTicker) {
        compatibilityIssues.push(
          `اختلاف الشركة بين التفصيل (${childTicker ?? 'غير محدد'}) والأب (${parentTicker ?? 'غير محدد'})`
        );
      }

      const childYear = raw.fiscalYear ?? null;
      const parentYear = parentEntry.raw.fiscalYear ?? null;
      const childQuarter = normalizeOptionalQuarter(raw.fiscalQuarter);
      const parentQuarter = normalizeOptionalQuarter(parentEntry.raw.fiscalQuarter);
      const childBsDate = normalizeOptionalText(raw.balanceSheetDate);
      const parentBsDate = normalizeOptionalText(parentEntry.raw.balanceSheetDate);
      if (childYear !== parentYear || childQuarter !== parentQuarter || childBsDate !== parentBsDate) {
        compatibilityIssues.push(
          `عدم توافق الفترة/تاريخ المركز المالي بين التفصيل (${childYear ?? '-'}/${childQuarter ?? '-'} | ${childBsDate ?? '-'}) والأب (${parentYear ?? '-'}/${parentQuarter ?? '-'} | ${parentBsDate ?? '-'})`
        );
      }

      const childScope = ev.statementScope;
      const parentScope = parentEntry.ev.statementScope;
      if (
        !childScope ||
        !parentScope ||
        childScope === 'unspecified' ||
        parentScope === 'unspecified' ||
        childScope !== parentScope
      ) {
        compatibilityIssues.push(
          `عدم توافق نطاق القوائم المالية بين التفصيل (${childScope ?? ev.rawStatementScope ?? 'غير محدد'}) والأب (${parentScope ?? parentEntry.ev.rawStatementScope ?? 'غير محدد'})`
        );
      }

      if (compatibilityIssues.length > 0) {
        addUniqueBlocker({
          code: 'conflicting_parent_disclosure',
          messageAr: `تعارض في علاقة الاحتواء للتفصيل (${displayId}) مع الأب (${parentId}): ${compatibilityIssues.join('؛ ')}؛ لا يُستبعد التفصيل صامتاً وحُجب الإجمالي المعتمد للمراجعة مع إبقاء جميع السجلات ظاهرة.`,
        });
        includedEntries.push(entry);
        continue;
      }

      // Documented, verified containment relationship => exclude child from summation without double-counting
      excludedDuplicates.push({
        disclosureId: canonicalId,
        reasonCode: 'child_of_present_total',
        parentDisclosureId: parentId,
        reasonAr: `استُبعد التفصيل الفرعي (${displayId}) من الجمع لثبوت علاقة احتواء موثقة ومتوافقة (الشركة والفترة والنطاق) مع الإفصاح الإجمالي (${parentId}) منعاً للتكرار.`,
      });
      const list = childrenByParentId.get(parentId) ?? [];
      list.push(ev);
      childrenByParentId.set(parentId, list);
      continue;
    }

    // Non-component_detail rows must not declare a parentDisclosureId
    if (parentInsp.status === 'valid' && parentInsp.normalizedId) {
      addUniqueBlocker({
        code: 'conflicting_parent_disclosure',
        messageAr: `السجل (${displayId}) من نوع (${ev.aggregationLevel ?? 'غير معروف'}) يحمل معرّف أب (${parentInsp.normalizedId}) رغم أنه ليس component_detail؛ حُجب الإجمالي المعتمد للمراجعة.`,
      });
    }

    // Unspecified aggregation level alongside a total_summary or multiple records => unresolved overlap
    if (
      (ev.aggregationLevel === 'unspecified' || ev.aggregationLevel === null) &&
      (totalSummaryEntries.length > 0 || uniqueEntries.length > 1)
    ) {
      addUniqueBlocker({
        code: 'ambiguous_aggregation_overlap',
        messageAr: `الإفصاح (${displayId}) غير محدد مستوى التجميع (unspecified) ويتزامن مع إفصاحات أخرى؛ حُجب الإجمالي المعتمد منعاً لخطر التكرار وتبقى جميع السجلات ظاهرة.`,
      });
    }

    includedEntries.push(entry);
  }

  // 4) Reconciliation audit notes between parent total_summary and its verified excluded children
  for (const [parentId, children] of childrenByParentId.entries()) {
    const parentEntry = firstById.get(parentId);
    if (!parentEntry || parentEntry.ev.carryingValue === null) continue;
    if (children.every((c) => c.carryingValue !== null)) {
      const childrenCarryingSum = children.reduce((acc, c) => acc + (c.carryingValue ?? 0), 0);
      const diff = normalizeZero(parentEntry.ev.carryingValue - childrenCarryingSum);
      if (Math.abs(diff) > 1e-6) {
        reconciliationNotesAr.push(
          `ملاحظة مطابقة: مجموع القيمة الدفترية للتفاصيل الفرعية المرتبطة بالإجمالي (${parentId}) يساوي ${childrenCarryingSum} بينما الإجمالي الموثق يساوي ${parentEntry.ev.carryingValue} (فرق ${diff})؛ اعتُمد الإجمالي الموثق فقط في الجمع دون تكرار.`
        );
      } else {
        reconciliationNotesAr.push(
          `مطابقة تامة: مجموع التفاصيل الفرعية (${childrenCarryingSum}) يطابق الإفصاح الإجمالي (${parentId} = ${parentEntry.ev.carryingValue})، وتم استبعاد التفاصيل الفرعية من الجمع منعاً للتكرار.`
        );
      }
    }
  }

  const includedEvals = includedEntries.map((entry) => entry.ev);
  const includedDisclosureIds = includedEntries
    .map((entry) => entry.canonicalId ?? entry.raw.disclosureId ?? `row_${entry.idx + 1}`)
    .filter(Boolean);

  // Collect item-level blockers from included rows
  for (const ev of includedEvals) {
    for (const reason of ev.blockingReasons) {
      addUniqueBlocker(reason);
    }
  }

  const hasAggregateIntegrityBlocker = blockingReasons.some((r) =>
    AGGREGATE_INTEGRITY_BLOCK_CODES.has(r.code)
  );

  const canSumCarrying =
    !hasAggregateIntegrityBlocker &&
    includedEvals.length > 0 &&
    includedEvals.every((e) => e.carryingValue !== null);

  const canSumFair =
    !hasAggregateIntegrityBlocker &&
    includedEvals.length > 0 &&
    includedEvals.every((e) => e.disclosedFairValue !== null);

  const aggregateComparable =
    blockingReasons.length === 0 &&
    includedEvals.length > 0 &&
    includedEvals.every((e) => e.comparable && e.difference !== null);

  const totalCarryingValue = canSumCarrying
    ? normalizeZero(includedEvals.reduce((acc, e) => acc + (e.carryingValue ?? 0), 0))
    : null;

  const totalDisclosedFairValue = canSumFair
    ? normalizeZero(includedEvals.reduce((acc, e) => acc + (e.disclosedFairValue ?? 0), 0))
    : null;

  const totalFairValueMinusCarryingValue = aggregateComparable
    ? normalizeZero(includedEvals.reduce((acc, e) => acc + (e.difference ?? 0), 0))
    : null;

  return {
    metricNameAr: `${DISCLOSED_FAIR_VALUE_DIFFERENCE_LABEL_AR} (إجمالي دون تكرار)`,
    accountingNatureDisclaimerAr: DISCLOSED_FAIR_VALUE_ACCOUNTING_DISCLAIMER_AR,
    ticker: distinctTickers.length === 1 ? distinctTickers[0] : null,
    statementScope:
      distinctScopes.length === 1 && evaluations[0].statementScope
        ? evaluations[0].statementScope
        : null,
    balanceSheetDate: distinctBsDates.length === 1 ? distinctBsDates[0] : null,
    totalDisclosuresReceived: disclosures.length,
    includedDisclosureIds,
    excludedDuplicates,
    items: evaluations,
    aggregateComparable,
    totalCarryingValue,
    totalDisclosedFairValue,
    totalFairValueMinusCarryingValue,
    blockingReasons,
    reconciliationNotesAr,
  };
}
