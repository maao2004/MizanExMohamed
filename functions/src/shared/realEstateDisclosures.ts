/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Central Contract — Documented Real Estate Disclosures (Foundation Batch 1)
 *
 * Scope & Non-Goals:
 * - Defines canonical types, dropdown-ready enum registries, field dictionary,
 *   non-mutating read inspection, and strict write validation for real estate
 *   disclosures as reported in financial statement notes.
 * - Reuses existing company ticker normalization, calendar date validation,
 *   and `QuarterlyRecordQuarter` (`Q1 | Q2 | Q3 | FY`) without creating parallel
 *   company, period, or currency/unit-multiplier schemas.
 * - Does NOT assume all properties of real-estate companies fall under IAS 40.
 * - Records accounting policy strictly as disclosed by the company without
 *   assuming an undocumented accounting standard.
 * - Values are kept in their current base reporting unit (no new currency or
 *   thousands/millions fields).
 * - Does NOT modify NetIncome, EPS, Equity, valuation models, or Firestore.
 */

import {
  isValidCalendarDate,
  normalizedTicker,
  parseCleanNumber,
  parseCleanText,
} from './normalization';
import type { QuarterlyRecordQuarter } from './reportedEpsPeriod';

export const REAL_ESTATE_DISCLOSURES_COLLECTION = 'real_estate_disclosures' as const;
export const QUARTERLY_FINANCIAL_RECORDS_COLLECTION = 'quarterly_financial_records' as const;

export type FinancialStatementScope = 'consolidated' | 'standalone' | 'unspecified';

export type RealEstateAssetCategory =
  | 'investment_property'
  | 'development_inventory'
  | 'owner_occupied_property'
  | 'land_bank_unspecified_use'
  | 'mixed_or_other_real_estate'
  | 'unspecified';

export type RealEstateAccountingPolicy =
  | 'cost_model'
  | 'fair_value_model'
  | 'unspecified';

export type RealEstateDisclosureAggregationLevel =
  | 'total_summary'
  | 'component_detail'
  | 'standalone_item'
  | 'unspecified';

export type RealEstateFairValueSourceType =
  | 'independent_valuer'
  | 'management_estimate'
  | 'market_observable'
  | 'unspecified';

/**
 * Axis 1: Structural validity of IDs, dates, numbers, and enum codes.
 */
export type RealEstateStructuralValidityStatus = 'valid' | 'invalid';

/**
 * Axis 2: Documentation completeness of the disclosure fields (independent from comparability).
 */
export type RealEstateDocumentationStatus =
  | 'documented_complete'
  | 'documented_missing_fair_value'
  | 'documented_missing_carrying_value'
  | 'documented_missing_metadata'
  | 'invalid_structure_or_classification';

/**
 * Axis 3: Comparability status for computing «فرق القيمة العادلة المُفصح عنها عن القيمة الدفترية».
 */
export type RealEstateComparabilityStatus = 'comparable' | 'blocked';

/**
 * Overall derived disclosure status.
 * NEVER returns `complete_comparable` when comparability is blocked for any reason
 * (date mismatch, scope mismatch, unspecified scope, unverified/mismatched asset pool,
 * invalid structure, or unrecognized classification).
 */
export type RealEstateDisclosureCompletenessStatus =
  | 'complete_comparable'
  | 'documented_not_comparable'
  | 'partial_missing_fair_value'
  | 'partial_missing_carrying_value'
  | 'incomplete_missing_metadata'
  | 'unrecognized_classification';

export interface RealEstateEnumOption<TCode extends string> {
  code: TCode;
  labelAr: string;
  shortLabelAr: string;
  selectLabelAr: string;
  descriptionAr: string;
}

export const FINANCIAL_STATEMENT_SCOPE_OPTIONS: readonly RealEstateEnumOption<FinancialStatementScope>[] = [
  {
    code: 'consolidated',
    labelAr: 'قوائم مالية موحدة (مجمعة)',
    shortLabelAr: 'موحد',
    selectLabelAr: 'consolidated — قوائم مالية موحدة (مجمعة)',
    descriptionAr: 'الإفصاح وارد في القوائم المالية الموحدة للمجموعة.',
  },
  {
    code: 'standalone',
    labelAr: 'قوائم مالية مستقلة (غير مجمعة)',
    shortLabelAr: 'مستقل',
    selectLabelAr: 'standalone — قوائم مالية مستقلة (غير مجمعة)',
    descriptionAr: 'الإفصاح وارد في القوائم المالية المستقلة للشركة الأم فقط.',
  },
  {
    code: 'unspecified',
    labelAr: 'غير محدد النطاق',
    shortLabelAr: 'غير محدد',
    selectLabelAr: 'unspecified — غير محدد النطاق',
    descriptionAr: 'لم يُوثّق ما إذا كان الإفصاح يخص القوائم الموحدة أم المستقلة؛ تُمنع المقارنة المضللة حتى التوثيق.',
  },
] as const;

export const REAL_ESTATE_ASSET_CATEGORY_OPTIONS: readonly RealEstateEnumOption<RealEstateAssetCategory>[] = [
  {
    code: 'investment_property',
    labelAr: 'استثمارات عقارية',
    shortLabelAr: 'استثمارات عقارية',
    selectLabelAr: 'investment_property — استثمارات عقارية (محتفظ بها للإيجار أو لنمو القيمة)',
    descriptionAr:
      'عقارات مُفصح عنها صراحةً كبند استثمارات عقارية بالقوائم المالية (لا يُفترض شمول جميع عقارات شركات التطوير العقاري ضمن هذا البند).',
  },
  {
    code: 'development_inventory',
    labelAr: 'أراضٍ ومشروعات قيد التطوير / مخزون عقاري للبيع',
    shortLabelAr: 'مخزون / تطوير عقاري',
    selectLabelAr: 'development_inventory — أراضٍ ومشروعات قيد التطوير / مخزون عقاري بغرض البيع',
    descriptionAr:
      'أراضٍ أو وحدات أو مشروعات تطوير محتفظ بها بغرض البيع ضمن النشاط العادي وليست استثمارات عقارية تلقائياً.',
  },
  {
    code: 'owner_occupied_property',
    labelAr: 'عقارات مستخدمة في النشاط (أصول ثابتة)',
    shortLabelAr: 'عقارات تشغيلية',
    selectLabelAr: 'owner_occupied_property — عقارات مستخدمة في النشاط / أصول ثابتة عقارية',
    descriptionAr:
      'أراضٍ ومبانٍ تستخدمها الشركة في أنشطتها الإدارية أو التشغيلية أو الإنتاجية وليست استثمارات عقارية.',
  },
  {
    code: 'land_bank_unspecified_use',
    labelAr: 'محفظة أراضٍ غير محدد الاستخدام',
    shortLabelAr: 'محفظة أراضٍ (غير محدد)',
    selectLabelAr: 'land_bank_unspecified_use — محفظة أراضٍ غير محدد الاستخدام المستقبلي',
    descriptionAr:
      'أراضٍ مملوكة لم يُحسم أو لم يُفصح عن استخدامها المستقبلي بدقة؛ تُوثّق دون افتراض تصنيف استثماري تلقائي.',
  },
  {
    code: 'mixed_or_other_real_estate',
    labelAr: 'أصول عقارية مختلطة أو أخرى موثقة',
    shortLabelAr: 'عقارية مختلطة / أخرى',
    selectLabelAr: 'mixed_or_other_real_estate — أصول عقارية مختلطة أو أخرى موثقة بالإيضاح',
    descriptionAr:
      'بند عقاري يجمع أكثر من طبيعة استخدام أو يرد بتبويب خاص في الإيضاحات المتممة.',
  },
  {
    code: 'unspecified',
    labelAr: 'غير محدد التصنيف والاستخدام',
    shortLabelAr: 'غير محدد',
    selectLabelAr: 'unspecified — غير محدد التصنيف والاستخدام',
    descriptionAr:
      'لم يُحدد تصنيف العقار أو استخدامه من القوائم المالية؛ لا يُحوّل تلقائياً إلى استثمارات عقارية.',
  },
] as const;

export const REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS: readonly RealEstateEnumOption<RealEstateAccountingPolicy>[] = [
  {
    code: 'cost_model',
    labelAr: 'نموذج التكلفة (كما أفصحت الشركة)',
    shortLabelAr: 'التكلفة',
    selectLabelAr: 'cost_model — نموذج التكلفة (وفق إفصاح الشركة)',
    descriptionAr:
      'تُقاس الأصول بالتكلفة مطروحاً منها الإهلاك المتراكم وأي اضمحلال كما ورد في إيضاح السياسات المحاسبية، دون افتراض معيار غير موثق.',
  },
  {
    code: 'fair_value_model',
    labelAr: 'نموذج القيمة العادلة (كما أفصحت الشركة)',
    shortLabelAr: 'القيمة العادلة',
    selectLabelAr: 'fair_value_model — نموذج القيمة العادلة (وفق إفصاح الشركة)',
    descriptionAr:
      'تُقاس الأصول بالقيمة العادلة في القوائم المالية كما ورد في إيضاح السياسات المحاسبية، دون افتراض معيار غير موثق.',
  },
  {
    code: 'unspecified',
    labelAr: 'سياسة محاسبية غير محددة في الإفصاح',
    shortLabelAr: 'غير محددة',
    selectLabelAr: 'unspecified — سياسة محاسبية غير محددة في الإفصاح',
    descriptionAr: 'لم تُوثّق السياسة المحاسبية المعلنة لهذا البند بعد.',
  },
] as const;

export const REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS: readonly RealEstateEnumOption<RealEstateDisclosureAggregationLevel>[] = [
  {
    code: 'total_summary',
    labelAr: 'إجمالي مجمّع للفئة / البند',
    shortLabelAr: 'إجمالي مجمّع',
    selectLabelAr: 'total_summary — إفصاح إجمالي مجمّع (لا يُجمع مع تفاصيله الفرعية)',
    descriptionAr:
      'سطر إجمالي يغطي فئة عقارية أو كامل البند؛ يجب عدم جمعه مع التفاصيل الفرعية الداخلة فيه منعاً للتكرار.',
  },
  {
    code: 'component_detail',
    labelAr: 'تفصيل فرعي داخل إجمالي',
    shortLabelAr: 'تفصيل فرعي',
    selectLabelAr: 'component_detail — تفصيل فرعي داخل إفصاح إجمالي (يُستبعد من الجمع فقط بعلاقة احتواء موثقة)',
    descriptionAr:
      'بند تفصيلي (مثل مشروع أو مبنى محدد) يدخل ضمن إفصاح إجمالي؛ لا يُستبعد من الجمع اعتماداً على التصنيف وحده، بل يشترط ربطه عبر parentDisclosureId بإفصاح إجمالي حاضر ومتوافق الشركة والفترة والنطاق.',
  },
  {
    code: 'standalone_item',
    labelAr: 'بند مستقل غير متداخل',
    shortLabelAr: 'بند مستقل',
    selectLabelAr: 'standalone_item — بند مستقل غير متداخل مع إفصاح إجمالي آخر',
    descriptionAr:
      'إفصاح مستقل عن أصل أو محفظة غير مشمولة ضمن سطر إجمالي آخر في نفس الفترة والنطاق.',
  },
  {
    code: 'unspecified',
    labelAr: 'غير محدد مستوى التجميع',
    shortLabelAr: 'غير محدد',
    selectLabelAr: 'unspecified — غير محدد مستوى التجميع',
    descriptionAr:
      'لم يُحدد ما إذا كان الإفصاح إجمالياً أم تفصيلاً فرعياً؛ يُمنع جمعه التلقائي مع إجماليات أخرى عند وجود تداخل محتمل.',
  },
] as const;

export const REAL_ESTATE_FAIR_VALUE_SOURCE_TYPE_OPTIONS: readonly RealEstateEnumOption<RealEstateFairValueSourceType>[] = [
  {
    code: 'independent_valuer',
    labelAr: 'مثمن عقاري مستقل معتمد',
    shortLabelAr: 'مثمن مستقل',
    selectLabelAr: 'independent_valuer — مثمن عقاري مستقل معتمد',
    descriptionAr: 'تقييم صادر عن خبير تقييم عقاري مستقل ورد ذكره في الإيضاحات المتممة.',
  },
  {
    code: 'management_estimate',
    labelAr: 'تقدير إدارة الشركة المُفصح عنه',
    shortLabelAr: 'تقدير الإدارة',
    selectLabelAr: 'management_estimate — تقدير إدارة الشركة المُفصح عنه بالإيضاح',
    descriptionAr: 'قيمة عادلة مقدرة من إدارة الشركة ومُفصح عنها داخل القوائم أو الإيضاحات.',
  },
  {
    code: 'market_observable',
    labelAr: 'مؤشرات أو معاملات سوقية قابلة للرصد',
    shortLabelAr: 'بيانات سوقية',
    selectLabelAr: 'market_observable — معاملات أو مؤشرات سوقية قابلة للرصد',
    descriptionAr: 'قيمة عادلة مستندة إلى أسعار معاملات سوقية مماثلة مُفصح عنها.',
  },
  {
    code: 'unspecified',
    labelAr: 'مصدر تقييم غير محدد',
    shortLabelAr: 'غير محدد',
    selectLabelAr: 'unspecified — مصدر تقييم غير محدد',
    descriptionAr: 'لم يُوثّق نوع مصدر القيمة العادلة بعد.',
  },
] as const;

export const ALLOWED_FINANCIAL_STATEMENT_SCOPES = new Set<FinancialStatementScope>(
  FINANCIAL_STATEMENT_SCOPE_OPTIONS.map((o) => o.code)
);
export const ALLOWED_REAL_ESTATE_ASSET_CATEGORIES = new Set<RealEstateAssetCategory>(
  REAL_ESTATE_ASSET_CATEGORY_OPTIONS.map((o) => o.code)
);
export const ALLOWED_REAL_ESTATE_ACCOUNTING_POLICIES = new Set<RealEstateAccountingPolicy>(
  REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS.map((o) => o.code)
);
export const ALLOWED_REAL_ESTATE_AGGREGATION_LEVELS = new Set<RealEstateDisclosureAggregationLevel>(
  REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS.map((o) => o.code)
);
export const ALLOWED_REAL_ESTATE_FAIR_VALUE_SOURCE_TYPES = new Set<RealEstateFairValueSourceType>(
  REAL_ESTATE_FAIR_VALUE_SOURCE_TYPE_OPTIONS.map((o) => o.code)
);

const ALLOWED_QUARTERLY_QUARTERS = new Set<QuarterlyRecordQuarter>(['Q1', 'Q2', 'Q3', 'FY']);

export interface RealEstateDisclosureRecord {
  /** Unique identifier of this disclosure within ticker/period context. */
  disclosureId: string;
  /** Canonical normalized company ticker (reusing `normalizedTicker`). */
  ticker: string;
  /** Linked financial period year (reusing quarterly_financial_records year: 1900..2200), optional if balanceSheetDate alone is documented. */
  fiscalYear: number | null;
  /** Linked financial period quarter (reusing `QuarterlyRecordQuarter`: Q1 | Q2 | Q3 | FY). */
  fiscalQuarter: QuarterlyRecordQuarter | null;
  /** Logical reference to existing `quarterly_financial_records` docId (`${ticker}_${fiscalYear}_${fiscalQuarter}`) without altering quarterly storage. */
  linkedQuarterlyDocId: string | null;
  /** Balance-sheet / statement of financial position date (YYYY-MM-DD). */
  balanceSheetDate: string | null;
  /** Scope of the financial statement containing the carrying value (consolidated vs standalone). */
  statementScope: FinancialStatementScope;
  /** Classification & economic use of the real estate asset (never assumes IAS 40 by default). */
  assetCategory: RealEstateAssetCategory;
  /** Optional concise usage detail directly from the footnote (e.g. leased malls vs raw land). */
  assetUsageDescription: string | null;
  /** Accounting policy strictly as disclosed by the company. */
  accountingPolicy: RealEstateAccountingPolicy;
  /** Aggregation hierarchy level to prevent double-counting totals with component details. */
  aggregationLevel: RealEstateDisclosureAggregationLevel;
  /** Optional parent disclosureId when `aggregationLevel === 'component_detail'`. */
  parentDisclosureId: string | null;
  /** Carrying value in the company's base reporting unit (`0` is explicit zero, distinct from `null`). */
  carryingValue: number | null;
  /** Disclosed fair value in the same base reporting unit (`0` is explicit zero, distinct from `null`; NEVER inferred from carryingValue). */
  disclosedFairValue: number | null;
  /** Effective valuation date of the disclosed fair value (YYYY-MM-DD). */
  fairValueDate: string | null;
  /** Optional explicit statement scope of the disclosed fair value if different/stated separately from `statementScope`. */
  fairValueStatementScope: FinancialStatementScope | null;
  /** Explicit flag indicating whether disclosed fair value covers the exact same asset pool as carryingValue (`false` blocks comparison). */
  fairValueAssetScopeMatchesCarrying: boolean | null;
  /** Textual description of the fair value source / valuer as disclosed in the note. */
  fairValueSource: string | null;
  /** Structured category of fair value source for filtering/audit. */
  fairValueSourceType: RealEstateFairValueSourceType;
  /** Note number / footnote reference in the financial statements (e.g. "إيضاح رقم 11"). */
  footnoteReference: string | null;
  /** Optional explanatory/audit note. */
  explanatoryNote: string | null;
  /** Derived completeness status of the disclosure. */
  completenessStatus: RealEstateDisclosureCompletenessStatus;
}

export interface RealEstateDisclosureInput {
  disclosureId?: unknown;
  ticker: unknown;
  fiscalYear?: unknown;
  fiscalQuarter?: unknown;
  balanceSheetDate?: unknown;
  statementScope?: unknown;
  assetCategory?: unknown;
  assetUsageDescription?: unknown;
  accountingPolicy?: unknown;
  aggregationLevel?: unknown;
  parentDisclosureId?: unknown;
  carryingValue?: unknown;
  disclosedFairValue?: unknown;
  fairValueDate?: unknown;
  fairValueStatementScope?: unknown;
  fairValueAssetScopeMatchesCarrying?: unknown;
  fairValueSource?: unknown;
  fairValueSourceType?: unknown;
  footnoteReference?: unknown;
  explanatoryNote?: unknown;
}

export interface RealEstateEnumInspection<TCode extends string> {
  status: 'empty' | 'valid' | 'unrecognized';
  rawValue: string | null;
  code: TCode | null;
  option: RealEstateEnumOption<TCode> | null;
}

function inspectEnumCode<TCode extends string>(
  raw: unknown,
  allowedSet: ReadonlySet<TCode>,
  options: readonly RealEstateEnumOption<TCode>[]
): RealEstateEnumInspection<TCode> {
  if (raw === undefined || raw === null) {
    return { status: 'empty', rawValue: null, code: null, option: null };
  }
  const cleaned = typeof raw === 'string' ? parseCleanText(raw) : String(raw).trim() || null;
  if (!cleaned) {
    return { status: 'empty', rawValue: null, code: null, option: null };
  }
  const normalized = cleaned.toLowerCase();
  if (allowedSet.has(normalized as TCode)) {
    const code = normalized as TCode;
    return {
      status: 'valid',
      rawValue: cleaned,
      code,
      option: options.find((o) => o.code === code) ?? null,
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
 * Non-mutating read-path inspectors:
 * NEVER silently coerce an unrecognized stored code into a default category/policy/scope.
 */
export function inspectFinancialStatementScope(raw: unknown): RealEstateEnumInspection<FinancialStatementScope> {
  return inspectEnumCode(raw, ALLOWED_FINANCIAL_STATEMENT_SCOPES, FINANCIAL_STATEMENT_SCOPE_OPTIONS);
}

export function inspectRealEstateAssetCategory(raw: unknown): RealEstateEnumInspection<RealEstateAssetCategory> {
  return inspectEnumCode(raw, ALLOWED_REAL_ESTATE_ASSET_CATEGORIES, REAL_ESTATE_ASSET_CATEGORY_OPTIONS);
}

export function inspectRealEstateAccountingPolicy(raw: unknown): RealEstateEnumInspection<RealEstateAccountingPolicy> {
  return inspectEnumCode(raw, ALLOWED_REAL_ESTATE_ACCOUNTING_POLICIES, REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS);
}

export function inspectRealEstateAggregationLevel(
  raw: unknown
): RealEstateEnumInspection<RealEstateDisclosureAggregationLevel> {
  return inspectEnumCode(raw, ALLOWED_REAL_ESTATE_AGGREGATION_LEVELS, REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS);
}

export function inspectRealEstateFairValueSourceType(
  raw: unknown
): RealEstateEnumInspection<RealEstateFairValueSourceType> {
  return inspectEnumCode(raw, ALLOWED_REAL_ESTATE_FAIR_VALUE_SOURCE_TYPES, REAL_ESTATE_FAIR_VALUE_SOURCE_TYPE_OPTIONS);
}

/**
 * Central canonical identity rule for `disclosureId` and `parentDisclosureId`:
 * - Exact lossless string identity (NO silent truncation, NO whitespace-to-underscore replacement,
 *   NO case folding) so two distinct IDs can NEVER silently collapse onto one identity.
 * - Length: 1..80 characters.
 * - Allowed characters: ASCII letters, digits, dot (.), underscore (_), hyphen (-),
 *   starting with an ASCII letter or digit; rejects any whitespace, `/`, `\`, and `..`.
 */
export const REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH = 80;
export const REAL_ESTATE_DISCLOSURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Central maximum lengths for optional free-text documentation fields.
 * Exceeding any limit is explicitly rejected — NEVER silently truncated with `.slice()`.
 */
export const REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS = {
  assetUsageDescription: 240,
  fairValueSource: 240,
  footnoteReference: 160,
  explanatoryNote: 800,
} as const;

function validateOptionalBoundedText(
  raw: unknown,
  fieldLabel: string,
  maxLength: number
): string | null {
  const cleaned = parseCleanText(raw);
  if (cleaned === null) return null;
  if (cleaned.length > maxLength) {
    throw new Error(
      `طول حقل ${fieldLabel} (${cleaned.length} حرفاً) يتجاوز الحد الأقصى المسموح (${maxLength} حرفاً)؛ لا يُقص النص التوثيقي بصمت منعاً لفقدان التفاصيل.`
    );
  }
  return cleaned;
}

export type RealEstateDisclosureIdInvalidReason =
  | 'not_a_string'
  | 'exceeds_max_length'
  | 'contains_whitespace'
  | 'contains_forbidden_path_sequence'
  | 'invalid_characters';

export interface RealEstateDisclosureIdInspection {
  status: 'empty' | 'valid' | 'invalid';
  rawValue: string | null;
  normalizedId: string | null;
  invalidReason: RealEstateDisclosureIdInvalidReason | null;
  errorMessageAr: string | null;
}

/**
 * Non-throwing central identity inspector applied consistently to `disclosureId`
 * and `parentDisclosureId` on both read and write paths.
 */
export function inspectRealEstateDisclosureId(
  raw: unknown,
  fieldLabel = 'معرّف الإفصاح العقاري (disclosureId)'
): RealEstateDisclosureIdInspection {
  if (raw === undefined || raw === null) {
    return {
      status: 'empty',
      rawValue: null,
      normalizedId: null,
      invalidReason: null,
      errorMessageAr: null,
    };
  }
  if (typeof raw !== 'string') {
    return {
      status: 'invalid',
      rawValue: String(raw),
      normalizedId: null,
      invalidReason: 'not_a_string',
      errorMessageAr: `${fieldLabel} يجب أن يكون نصاً صريحاً دون تحويلات ضمنية.`,
    };
  }
  if (raw.trim().length === 0) {
    return {
      status: 'empty',
      rawValue: null,
      normalizedId: null,
      invalidReason: null,
      errorMessageAr: null,
    };
  }
  if (/\s/.test(raw)) {
    return {
      status: 'invalid',
      rawValue: raw,
      normalizedId: null,
      invalidReason: 'contains_whitespace',
      errorMessageAr: `لا يُسمح بأي مسافات في ${fieldLabel} (${raw}) ولا تُستبدل بـ (_) منعاً لتصادم المعرّفات؛ استخدم أحرفاً لاتينية وأرقاماً والرموز (._-) فقط.`,
    };
  }
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    return {
      status: 'invalid',
      rawValue: raw,
      normalizedId: null,
      invalidReason: 'contains_forbidden_path_sequence',
      errorMessageAr: `${fieldLabel} (${raw}) لا يجب أن يحتوي على / أو \\ أو ..`,
    };
  }
  if (raw.length > REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH) {
    return {
      status: 'invalid',
      rawValue: raw,
      normalizedId: null,
      invalidReason: 'exceeds_max_length',
      errorMessageAr: `طول ${fieldLabel} (${raw.length} حرفاً) يتجاوز الحد الأقصى المسموح (${REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH} حرفاً)؛ لا يُقص المعرّف بصمت منعاً لتصادم الهويات.`,
    };
  }
  if (!REAL_ESTATE_DISCLOSURE_ID_PATTERN.test(raw)) {
    return {
      status: 'invalid',
      rawValue: raw,
      normalizedId: null,
      invalidReason: 'invalid_characters',
      errorMessageAr: `صيغة ${fieldLabel} (${raw}) غير صالحة؛ يجب أن يبدأ بحرف لاتيني أو رقم ويقتصر على الأحرف اللاتينية والأرقام والرموز (._-) دون تحويلات صامتة.`,
    };
  }
  return {
    status: 'valid',
    rawValue: raw,
    normalizedId: raw,
    invalidReason: null,
    errorMessageAr: null,
  };
}

/**
 * Strict central identity validator for `disclosureId` and `parentDisclosureId`.
 * Rejects silent truncation (> 80 chars), whitespace (no space-to-underscore collision),
 * forbidden path tokens, and unsupported characters.
 */
export function validateRealEstateDisclosureId(
  raw: unknown,
  fieldLabel = 'معرّف الإفصاح العقاري (disclosureId)'
): string {
  const inspected = inspectRealEstateDisclosureId(raw, fieldLabel);
  if (inspected.status === 'empty') {
    throw new Error(`${fieldLabel} مطلوب.`);
  }
  if (inspected.status === 'invalid' || !inspected.normalizedId) {
    throw new Error(inspected.errorMessageAr ?? `${fieldLabel} غير صالح.`);
  }
  return inspected.normalizedId;
}

/**
 * Retained exported entry point — strictly enforces the central lossless identity rule
 * without silent truncation or whitespace replacement.
 */
export function sanitizeRealEstateDisclosureId(
  raw: unknown,
  fieldLabel = 'معرّف الإفصاح العقاري (disclosureId)'
): string {
  return validateRealEstateDisclosureId(raw, fieldLabel);
}

/**
 * Logical linkage key matching the existing `quarterly_financial_records` docId format (`${ticker}_${year}_${quarter}`).
 */
export function buildLinkedQuarterlyDocId(
  ticker: string,
  fiscalYear: number | null,
  fiscalQuarter: QuarterlyRecordQuarter | null
): string | null {
  if (fiscalYear === null || fiscalQuarter === null) return null;
  const tk = normalizedTicker(ticker);
  return `${tk}_${fiscalYear}_${fiscalQuarter}`;
}

/**
 * Deterministic document ID format for `real_estate_disclosures`.
 * Strictly validates every component so two distinct disclosures never collapse into the same document ID.
 */
export function buildRealEstateDisclosureDocId(params: {
  ticker: string;
  fiscalYear?: number | null;
  fiscalQuarter?: QuarterlyRecordQuarter | null;
  balanceSheetDate?: string | null;
  statementScope: FinancialStatementScope;
  disclosureId: string;
}): string {
  const tk = normalizedTicker(params.ticker);

  const scopeInsp = inspectFinancialStatementScope(params.statementScope);
  if (scopeInsp.status !== 'valid' || !scopeInsp.code) {
    throw new Error(
      `نطاق الإفصاح (statementScope) غير صالح لبناء معرّف المستند (${String(params.statementScope)}).`
    );
  }

  const hasYear = params.fiscalYear !== undefined && params.fiscalYear !== null;
  const hasQuarter = params.fiscalQuarter !== undefined && params.fiscalQuarter !== null;
  if (hasYear !== hasQuarter) {
    throw new Error(
      `يلزم تمرير السنة المالية (fiscalYear) والربع (fiscalQuarter) معاً لبناء معرّف مستند الإفصاح للسهم ${tk}.`
    );
  }

  let periodToken: string;
  if (hasYear && hasQuarter) {
    if (
      typeof params.fiscalYear !== 'number' ||
      !Number.isInteger(params.fiscalYear) ||
      params.fiscalYear < 1900 ||
      params.fiscalYear > 2200
    ) {
      throw new Error(`السنة المالية (${String(params.fiscalYear)}) غير صالحة لبناء معرّف مستند الإفصاح.`);
    }
    if (!ALLOWED_QUARTERLY_QUARTERS.has(params.fiscalQuarter!)) {
      throw new Error(`الربع المالي (${String(params.fiscalQuarter)}) غير صالح لبناء معرّف مستند الإفصاح.`);
    }
    periodToken = `${params.fiscalYear}_${params.fiscalQuarter}`;
  } else if (params.balanceSheetDate && isValidCalendarDate(params.balanceSheetDate)) {
    periodToken = params.balanceSheetDate;
  } else {
    throw new Error(
      `يلزم تحديد الفترة المالية (fiscalYear + fiscalQuarter) أو تاريخ مركز مالي صالح (balanceSheetDate) لبناء معرّف مستند الإفصاح للسهم ${tk}.`
    );
  }

  const idToken = validateRealEstateDisclosureId(params.disclosureId);
  return `${tk}_${periodToken}_${scopeInsp.code}_${idToken}`;
}

function validateStrictEnum<TCode extends string>(
  raw: unknown,
  fieldLabel: string,
  allowedSet: ReadonlySet<TCode>,
  options: readonly RealEstateEnumOption<TCode>[],
  defaultWhenEmpty: TCode
): TCode {
  const inspected = inspectEnumCode(raw, allowedSet, options);
  if (inspected.status === 'empty') {
    return defaultWhenEmpty;
  }
  if (inspected.status === 'valid' && inspected.code) {
    return inspected.code;
  }
  const allowedList = options.map((o) => o.code).join(' | ');
  throw new Error(
    `قيمة ${fieldLabel} غير صالحة (${inspected.rawValue ?? String(raw)})؛ القيم المعتمدة: ${allowedList}.`
  );
}

function validateNonNegativeAssetNumber(
  raw: unknown,
  fieldLabel: string
): number | null {
  const parsed = parseCleanNumber(raw, fieldLabel);
  if (parsed === null) return null;
  if (!Number.isFinite(parsed)) {
    throw new Error(`قيمة ${fieldLabel} يجب أن تكون رقماً منتهياً أو فارغة (null).`);
  }
  if (parsed < 0) {
    throw new Error(`قيمة ${fieldLabel} (${parsed}) لا يمكن أن تكون سالبة لقيمة أصل عقاري.`);
  }
  return Object.is(parsed, -0) ? 0 : parsed;
}

function absoluteCalendarDayGap(dateA: string, dateB: string): number {
  const [ay, am, ad] = dateA.split('-').map(Number);
  const [by, bm, bd] = dateB.split('-').map(Number);
  const msA = Date.UTC(ay, am - 1, ad);
  const msB = Date.UTC(by, bm - 1, bd);
  return Math.abs(Math.round((msA - msB) / 86_400_000));
}

export interface RealEstateDisclosureCompletenessInput {
  carryingValue: number | null;
  disclosedFairValue: number | null;
  statementScope: FinancialStatementScope;
  fairValueStatementScope?: FinancialStatementScope | null;
  fairValueAssetScopeMatchesCarrying?: boolean | null;
  balanceSheetDate: string | null;
  fairValueDate: string | null;
  accountingPolicy: RealEstateAccountingPolicy;
  footnoteReference: string | null;
  fairValueSource: string | null;
  hasUnrecognizedCode?: boolean;
  hasInvalidStructure?: boolean;
  maxAllowedDateGapDays?: number;
  expectedStatementScope?: FinancialStatementScope | null;
}

export interface RealEstateDisclosureStatusBreakdown {
  structuralValidityStatus: RealEstateStructuralValidityStatus;
  documentationStatus: RealEstateDocumentationStatus;
  comparabilityStatus: RealEstateComparabilityStatus;
  completenessStatus: RealEstateDisclosureCompletenessStatus;
  missingDocumentationFields: string[];
  comparabilityBlocked: boolean;
}

/**
 * Central three-axis status derivation shared by contract validation and domain analysis:
 * 1. `structuralValidityStatus`: valid vs invalid (unrecognized codes or invalid structure).
 * 2. `documentationStatus`: completeness of documented disclosure metadata independent of comparability.
 * 3. `comparabilityStatus`: whether carryingValue and disclosedFairValue are strictly comparable
 *    (matching specified scope, matching calendar dates within maxAllowedDateGapDays=0, and explicit
 *    `fairValueAssetScopeMatchesCarrying === true` — NEVER treating `null` as `true`).
 *
 * Invariant: `completenessStatus` is `complete_comparable` IF AND ONLY IF all 3 axes succeed
 * (`valid` + `documented_complete` + `comparable`).
 */
export function deriveRealEstateDisclosureStatusBreakdown(
  record: RealEstateDisclosureCompletenessInput
): RealEstateDisclosureStatusBreakdown {
  const maxGap = record.maxAllowedDateGapDays ?? 0;

  const hasValidBsDate = Boolean(record.balanceSheetDate && isValidCalendarDate(record.balanceSheetDate));
  const hasValidFvDate = Boolean(record.fairValueDate && isValidCalendarDate(record.fairValueDate));
  const hasInvalidDateFormat =
    (record.balanceSheetDate !== null && !hasValidBsDate) ||
    (record.fairValueDate !== null && !hasValidFvDate);

  const hasInvalidNumber =
    (record.carryingValue !== null && (!Number.isFinite(record.carryingValue) || record.carryingValue < 0)) ||
    (record.disclosedFairValue !== null &&
      (!Number.isFinite(record.disclosedFairValue) || record.disclosedFairValue < 0));

  const hasInvalidAssetScopeFlag =
    record.fairValueAssetScopeMatchesCarrying !== undefined &&
    record.fairValueAssetScopeMatchesCarrying !== null &&
    typeof record.fairValueAssetScopeMatchesCarrying !== 'boolean';

  const structuralValidityStatus: RealEstateStructuralValidityStatus =
    record.hasUnrecognizedCode ||
    record.hasInvalidStructure ||
    hasInvalidDateFormat ||
    hasInvalidNumber ||
    hasInvalidAssetScopeFlag
      ? 'invalid'
      : 'valid';

  // Axis 2: Documentation completeness
  const missingDocumentationFields: string[] = [];
  if (record.carryingValue === null) missingDocumentationFields.push('carryingValue');
  if (record.disclosedFairValue === null) missingDocumentationFields.push('disclosedFairValue');
  if (record.statementScope === 'unspecified') missingDocumentationFields.push('statementScope');
  if (record.accountingPolicy === 'unspecified') missingDocumentationFields.push('accountingPolicy');
  if (!hasValidBsDate) missingDocumentationFields.push('balanceSheetDate');
  if (!hasValidFvDate) missingDocumentationFields.push('fairValueDate');
  if (!record.footnoteReference) missingDocumentationFields.push('footnoteReference');
  if (!record.fairValueSource) missingDocumentationFields.push('fairValueSource');
  if (
    record.fairValueAssetScopeMatchesCarrying === undefined ||
    record.fairValueAssetScopeMatchesCarrying === null
  ) {
    missingDocumentationFields.push('fairValueAssetScopeMatchesCarrying');
  }

  let documentationStatus: RealEstateDocumentationStatus;
  if (structuralValidityStatus === 'invalid') {
    documentationStatus = 'invalid_structure_or_classification';
  } else if (record.carryingValue === null) {
    documentationStatus = 'documented_missing_carrying_value';
  } else if (record.disclosedFairValue === null) {
    documentationStatus = 'documented_missing_fair_value';
  } else if (missingDocumentationFields.length === 0) {
    documentationStatus = 'documented_complete';
  } else {
    documentationStatus = 'documented_missing_metadata';
  }

  // Axis 3: Strict comparability check (never treats null asset-scope match as true, never relaxes date/scope match)
  const scopeSpecified = record.statementScope !== 'unspecified';
  const fvScopeMatches =
    record.fairValueStatementScope === undefined ||
    record.fairValueStatementScope === null ||
    (record.fairValueStatementScope !== 'unspecified' &&
      record.fairValueStatementScope === record.statementScope);
  const expectedScopeMatches =
    !record.expectedStatementScope ||
    record.expectedStatementScope === 'unspecified' ||
    record.statementScope === record.expectedStatementScope;
  const assetScopeExplicitlyConfirmed = record.fairValueAssetScopeMatchesCarrying === true;
  const datesComparable =
    hasValidBsDate &&
    hasValidFvDate &&
    absoluteCalendarDayGap(record.balanceSheetDate!, record.fairValueDate!) <= maxGap;

  const comparable =
    structuralValidityStatus === 'valid' &&
    record.carryingValue !== null &&
    record.disclosedFairValue !== null &&
    scopeSpecified &&
    fvScopeMatches &&
    expectedScopeMatches &&
    assetScopeExplicitlyConfirmed &&
    datesComparable;

  const comparabilityStatus: RealEstateComparabilityStatus = comparable ? 'comparable' : 'blocked';

  let completenessStatus: RealEstateDisclosureCompletenessStatus;
  if (record.hasUnrecognizedCode || structuralValidityStatus === 'invalid') {
    completenessStatus = 'unrecognized_classification';
  } else if (record.carryingValue === null) {
    completenessStatus = 'partial_missing_carrying_value';
  } else if (record.disclosedFairValue === null) {
    completenessStatus = 'partial_missing_fair_value';
  } else if (documentationStatus !== 'documented_complete') {
    completenessStatus = 'incomplete_missing_metadata';
  } else if (comparable) {
    completenessStatus = 'complete_comparable';
  } else {
    completenessStatus = 'documented_not_comparable';
  }

  return {
    structuralValidityStatus,
    documentationStatus,
    comparabilityStatus,
    completenessStatus,
    missingDocumentationFields,
    comparabilityBlocked: !comparable,
  };
}

export function deriveRealEstateDisclosureCompleteness(
  record: RealEstateDisclosureCompletenessInput
): RealEstateDisclosureCompletenessStatus {
  return deriveRealEstateDisclosureStatusBreakdown(record).completenessStatus;
}

/**
 * Strict write-path validator & normalizer for a documented real estate disclosure.
 * - Preserves `0` distinctly from `null`.
 * - Rejects non-finite numbers and negative asset values.
 * - Rejects unrecognized enum values without silent fallback.
 * - Never infers `disclosedFairValue` from `carryingValue`.
 * - Requires canonical ticker + at least a documented period `(fiscalYear, fiscalQuarter)` or `balanceSheetDate`.
 */
export function validateAndNormalizeRealEstateDisclosure(
  raw: RealEstateDisclosureInput
): RealEstateDisclosureRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('سجل الإفصاح العقاري غير صالح.');
  }

  const ticker = normalizedTicker(raw.ticker);
  const disclosureId = sanitizeRealEstateDisclosureId(raw.disclosureId);

  let fiscalYear: number | null = null;
  if (raw.fiscalYear !== undefined && raw.fiscalYear !== null && raw.fiscalYear !== '') {
    const parsedYear =
      typeof raw.fiscalYear === 'number' ? raw.fiscalYear : Number(String(raw.fiscalYear).trim());
    if (!Number.isFinite(parsedYear) || !Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2200) {
      throw new Error(`السنة المالية للإفصاح العقاري للسهم ${ticker} يجب أن تكون عدداً صحيحاً بين 1900 و 2200.`);
    }
    fiscalYear = parsedYear;
  }

  let fiscalQuarter: QuarterlyRecordQuarter | null = null;
  const rawQuarterText = parseCleanText(raw.fiscalQuarter);
  if (rawQuarterText !== null) {
    const upperQ = rawQuarterText.toUpperCase() as QuarterlyRecordQuarter;
    if (!ALLOWED_QUARTERLY_QUARTERS.has(upperQ)) {
      throw new Error(
        `الربع المالي للإفصاح العقاري للسهم ${ticker} غير صالح (${rawQuarterText})؛ القيم المعتمدة: Q1 | Q2 | Q3 | FY.`
      );
    }
    fiscalQuarter = upperQ;
  }

  if ((fiscalYear !== null && fiscalQuarter === null) || (fiscalYear === null && fiscalQuarter !== null)) {
    throw new Error(
      `يلزم إدخال السنة المالية (fiscalYear) والربع (fiscalQuarter) معاً عند ربط الإفصاح العقاري بفترة مالية للسهم ${ticker}.`
    );
  }

  const balanceSheetDate = parseCleanText(raw.balanceSheetDate);
  if (balanceSheetDate !== null && !isValidCalendarDate(balanceSheetDate)) {
    throw new Error(
      `تاريخ المركز المالي (balanceSheetDate) للإفصاح العقاري للسهم ${ticker} غير صالح تقويمياً (المطلوب YYYY-MM-DD).`
    );
  }

  if (fiscalYear === null && balanceSheetDate === null) {
    throw new Error(
      `يلزم تحديد الفترة المالية (fiscalYear + fiscalQuarter) أو تاريخ المركز المالي (balanceSheetDate) للإفصاح العقاري للسهم ${ticker}.`
    );
  }

  const statementScope = validateStrictEnum(
    raw.statementScope,
    'نطاق الإفصاح (statementScope)',
    ALLOWED_FINANCIAL_STATEMENT_SCOPES,
    FINANCIAL_STATEMENT_SCOPE_OPTIONS,
    'unspecified'
  );

  const assetCategory = validateStrictEnum(
    raw.assetCategory,
    'تصنيف العقار واستخدامه (assetCategory)',
    ALLOWED_REAL_ESTATE_ASSET_CATEGORIES,
    REAL_ESTATE_ASSET_CATEGORY_OPTIONS,
    'unspecified'
  );

  const accountingPolicy = validateStrictEnum(
    raw.accountingPolicy,
    'السياسة المحاسبية المعلنة (accountingPolicy)',
    ALLOWED_REAL_ESTATE_ACCOUNTING_POLICIES,
    REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS,
    'unspecified'
  );

  const aggregationLevel = validateStrictEnum(
    raw.aggregationLevel,
    'مستوى التجميع (aggregationLevel)',
    ALLOWED_REAL_ESTATE_AGGREGATION_LEVELS,
    REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS,
    'unspecified'
  );

  const fairValueSourceType = validateStrictEnum(
    raw.fairValueSourceType,
    'نوع مصدر القيمة العادلة (fairValueSourceType)',
    ALLOWED_REAL_ESTATE_FAIR_VALUE_SOURCE_TYPES,
    REAL_ESTATE_FAIR_VALUE_SOURCE_TYPE_OPTIONS,
    'unspecified'
  );

  let fairValueStatementScope: FinancialStatementScope | null = null;
  if (raw.fairValueStatementScope !== undefined && raw.fairValueStatementScope !== null && parseCleanText(raw.fairValueStatementScope) !== null) {
    fairValueStatementScope = validateStrictEnum(
      raw.fairValueStatementScope,
      'نطاق القيمة العادلة (fairValueStatementScope)',
      ALLOWED_FINANCIAL_STATEMENT_SCOPES,
      FINANCIAL_STATEMENT_SCOPE_OPTIONS,
      'unspecified'
    );
  }

  let parentDisclosureId: string | null = null;
  const parentInsp = inspectRealEstateDisclosureId(
    raw.parentDisclosureId,
    'معرّف الإفصاح الأب (parentDisclosureId)'
  );
  if (parentInsp.status === 'invalid') {
    throw new Error(parentInsp.errorMessageAr ?? 'معرّف الإفصاح الأب (parentDisclosureId) غير صالح.');
  }
  if (parentInsp.status === 'valid' && parentInsp.normalizedId) {
    parentDisclosureId = parentInsp.normalizedId;
    if (parentDisclosureId === disclosureId) {
      throw new Error(`معرّف الإفصاح الأب (parentDisclosureId) لا يمكن أن يساوي معرّف الإفصاح نفسه (${disclosureId}).`);
    }
    if (aggregationLevel !== 'component_detail') {
      throw new Error(
        `لا يجوز تعيين معرّف الإفصاح الأب (${parentDisclosureId}) إلا عندما يكون مستوى التجميع component_detail (الحالي: ${aggregationLevel}).`
      );
    }
  }

  const carryingValue = validateNonNegativeAssetNumber(
    raw.carryingValue,
    'القيمة الدفترية (carryingValue)'
  );
  const disclosedFairValue = validateNonNegativeAssetNumber(
    raw.disclosedFairValue,
    'القيمة العادلة المُفصح عنها (disclosedFairValue)'
  );

  const fairValueDate = parseCleanText(raw.fairValueDate);
  if (fairValueDate !== null && !isValidCalendarDate(fairValueDate)) {
    throw new Error(
      `تاريخ القيمة العادلة (fairValueDate) للإفصاح العقاري للسهم ${ticker} غير صالح تقويمياً (المطلوب YYYY-MM-DD).`
    );
  }

  let fairValueAssetScopeMatchesCarrying: boolean | null = null;
  if (raw.fairValueAssetScopeMatchesCarrying !== undefined && raw.fairValueAssetScopeMatchesCarrying !== null) {
    if (typeof raw.fairValueAssetScopeMatchesCarrying !== 'boolean') {
      throw new Error(
        'حقل تطابق نطاق الأصول بين القيمة العادلة والدفترية (fairValueAssetScopeMatchesCarrying) يجب أن يكون قيمة منطقية (true/false) أو فارغاً.'
      );
    }
    fairValueAssetScopeMatchesCarrying = raw.fairValueAssetScopeMatchesCarrying;
  }

  const assetUsageDescription = validateOptionalBoundedText(
    raw.assetUsageDescription,
    'وصف استخدام العقار (assetUsageDescription)',
    REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.assetUsageDescription
  );
  const fairValueSource = validateOptionalBoundedText(
    raw.fairValueSource,
    'مصدر القيمة العادلة (fairValueSource)',
    REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.fairValueSource
  );
  const footnoteReference = validateOptionalBoundedText(
    raw.footnoteReference,
    'رقم الإيضاح أو مرجعه (footnoteReference)',
    REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.footnoteReference
  );
  const explanatoryNote = validateOptionalBoundedText(
    raw.explanatoryNote,
    'الملاحظة التفسيرية (explanatoryNote)',
    REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.explanatoryNote
  );

  const linkedQuarterlyDocId = buildLinkedQuarterlyDocId(ticker, fiscalYear, fiscalQuarter);
  const completenessStatus = deriveRealEstateDisclosureCompleteness({
    carryingValue,
    disclosedFairValue,
    statementScope,
    fairValueStatementScope,
    fairValueAssetScopeMatchesCarrying,
    balanceSheetDate,
    fairValueDate,
    accountingPolicy,
    footnoteReference,
    fairValueSource,
  });

  return {
    disclosureId,
    ticker,
    fiscalYear,
    fiscalQuarter,
    linkedQuarterlyDocId,
    balanceSheetDate,
    statementScope,
    assetCategory,
    assetUsageDescription,
    accountingPolicy,
    aggregationLevel,
    parentDisclosureId,
    carryingValue,
    disclosedFairValue,
    fairValueDate,
    fairValueStatementScope,
    fairValueAssetScopeMatchesCarrying,
    fairValueSource,
    fairValueSourceType,
    footnoteReference,
    explanatoryNote,
    completenessStatus,
  };
}

export interface RealEstateDisclosureFieldDictionaryEntry {
  field: keyof RealEstateDisclosureRecord;
  labelAr: string;
  dataType: string;
  required: boolean;
  reusedContractOrSource: string;
  governanceNotesAr: string;
}

export const REAL_ESTATE_DISCLOSURE_FIELD_DICTIONARY: readonly RealEstateDisclosureFieldDictionaryEntry[] = [
  {
    field: 'disclosureId',
    labelAr: 'معرّف الإفصاح العقاري',
    dataType: 'string (1..80, /^[A-Za-z0-9][A-Za-z0-9._-]*$/)',
    required: true,
    reusedContractOrSource: 'قاعدة هوية مركزية بلا قص صامت ولا استبدال مسافات لمنع تصادم المعرّفات',
    governanceNotesAr: 'يرفض تجاوز 80 حرفاً أو وجود مسافات أو رموز مسار بدلاً من تحويلها بصمت، وتُطبق القاعدة نفسها على parentDisclosureId.',
  },
  {
    field: 'ticker',
    labelAr: 'رمز السهم',
    dataType: 'string (normalizedTicker)',
    required: true,
    reusedContractOrSource: 'إعادة استخدام normalizedTicker من normalization.ts وهوية companies',
    governanceNotesAr: 'لا يُنشئ كيان شركة موازياً.',
  },
  {
    field: 'fiscalYear',
    labelAr: 'السنة المالية',
    dataType: 'integer (1900..2200) | null',
    required: false,
    reusedContractOrSource: 'إعادة استخدام سنة quarterly_financial_records (مطلوب مع fiscalQuarter أو استخدام balanceSheetDate)',
    governanceNotesAr: 'يربط الإفصاح منطقياً بسجل الفترة المالية دون تعديل تخزين quarterly_financial_records.',
  },
  {
    field: 'fiscalQuarter',
    labelAr: 'الفترة / الربع المالي',
    dataType: 'Q1 | Q2 | Q3 | FY | null',
    required: false,
    reusedContractOrSource: 'إعادة استخدام QuarterlyRecordQuarter من reportedEpsPeriod.ts',
    governanceNotesAr: 'يطابق رموز الفترات القائمة في النظام دون تعريف موازٍ.',
  },
  {
    field: 'linkedQuarterlyDocId',
    labelAr: 'المرجع المنطقي لسجل القوائم المالية',
    dataType: 'string | null',
    required: false,
    reusedContractOrSource: 'مشتق آلياً بصيغة ${ticker}_${fiscalYear}_${fiscalQuarter}',
    governanceNotesAr: 'مرجع قراءة/ربط منطقي فقط ولا يضيف حقولاً إلى مستند quarterly_financial_records.',
  },
  {
    field: 'balanceSheetDate',
    labelAr: 'تاريخ المركز المالي',
    dataType: 'YYYY-MM-DD | null',
    required: false,
    reusedContractOrSource: 'isValidCalendarDate — تاريخ قائمة المركز المالي (عادةً periodEndDate)',
    governanceNotesAr: 'شرط أساسي للتحقق من توافق تاريخ القيمة الدفترية مع تاريخ القيمة العادلة.',
  },
  {
    field: 'statementScope',
    labelAr: 'نطاق القوائم المالية (موحد / مستقل)',
    dataType: 'consolidated | standalone | unspecified',
    required: true,
    reusedContractOrSource: 'ترويسة القوائم المالية (موحدة أم مستقلة)',
    governanceNotesAr: 'يمنع مقارنة أو جمع إفصاحات موحدة مع مستقلة أو غير محددة النطاق.',
  },
  {
    field: 'assetCategory',
    labelAr: 'تصنيف العقار واستخدامه',
    dataType:
      'investment_property | development_inventory | owner_occupied_property | land_bank_unspecified_use | mixed_or_other_real_estate | unspecified',
    required: true,
    reusedContractOrSource: 'تبويب قائمة المركز المالي والإيضاحات المتممة',
    governanceNotesAr: 'لا يفترض أن جميع عقارات شركات التطوير العقاري هي استثمارات عقارية ضمن IAS 40.',
  },
  {
    field: 'assetUsageDescription',
    labelAr: 'وصف استخدام العقار من الإيضاح',
    dataType: `string (<=${REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.assetUsageDescription}) | null`,
    required: false,
    reusedContractOrSource: 'نص الإيضاح المتمم بالقوائم المالية',
    governanceNotesAr: `توثيق اختياري للطبيعة التشغيلية أو الاستثمارية للأصل؛ يُرفض تجاوز ${REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.assetUsageDescription} حرفاً دون قص صامت.`,
  },
  {
    field: 'accountingPolicy',
    labelAr: 'السياسة المحاسبية المعلنة',
    dataType: 'cost_model | fair_value_model | unspecified',
    required: true,
    reusedContractOrSource: 'إيضاح السياسات المحاسبية الهامة بالقوائم المالية',
    governanceNotesAr: 'تُسجل كما أفصحت عنها الشركة دون افتراض معيار محاسبي غير موثق.',
  },
  {
    field: 'aggregationLevel',
    labelAr: 'مستوى التجميع (إجمالي / تفصيل / مستقل)',
    dataType: 'total_summary | component_detail | standalone_item | unspecified',
    required: true,
    reusedContractOrSource: 'بنية جدول الإيضاح العقاري بالقوائم المالية',
    governanceNotesAr: 'يمنع جمع الإجمالي مع تفاصيله الموثقة؛ ولا يُستبعد التفصيل اعتماداً على التصنيف وحده دون علاقة احتواء موثقة.',
  },
  {
    field: 'parentDisclosureId',
    labelAr: 'معرّف الإفصاح الإجمالي الأب',
    dataType: 'string (1..80, same identity rule) | null',
    required: false,
    reusedContractOrSource: 'ربط component_detail بـ total_summary حاضر ومتوافق الشركة والفترة والنطاق',
    governanceNotesAr: 'يُطبق عليه نفس معيار الهوية المركزي؛ وغياب الأب أو تعارضه حالة مراجعة تحجب الإجمالي المعتمد دون استبعاد صامت.',
  },
  {
    field: 'carryingValue',
    labelAr: 'القيمة الدفترية',
    dataType: 'number (>= 0) | null',
    required: false,
    reusedContractOrSource: 'قائمة المركز المالي / إيضاح الأصل العقاري (بالوحدة الأساسية القائمة للسهم)',
    governanceNotesAr: 'يُحافظ على الفرق الصارم بين الصفر (0) والفراغ (null)، وتُرفض القيم السالبة وغير المنتهية.',
  },
  {
    field: 'disclosedFairValue',
    labelAr: 'القيمة العادلة المُفصح عنها',
    dataType: 'number (>= 0) | null',
    required: false,
    reusedContractOrSource: 'إيضاح القيمة العادلة للأصول العقارية (بالوحدة الأساسية القائمة للسهم)',
    governanceNotesAr: 'لا تُستنتج أبداً من القيمة الدفترية عند غيابها، ويُحافظ على الفرق بين 0 و null.',
  },
  {
    field: 'fairValueDate',
    labelAr: 'تاريخ القيمة العادلة',
    dataType: 'YYYY-MM-DD | null',
    required: false,
    reusedContractOrSource: 'تاريخ التقييم المذكور في إيضاح القيمة العادلة أو تقرير المثمن',
    governanceNotesAr: 'شرط للتحقق من قابلية المقارنة الزمنية مع تاريخ المركز المالي.',
  },
  {
    field: 'fairValueStatementScope',
    labelAr: 'نطاق القيمة العادلة (إن ورد منفصلاً)',
    dataType: 'consolidated | standalone | unspecified | null',
    required: false,
    reusedContractOrSource: 'إيضاح القيمة العادلة بالقوائم المالية',
    governanceNotesAr: 'إذا اختلفت عن statementScope تُحجب المقارنة منعاً لاحتساب فرق مضلل.',
  },
  {
    field: 'fairValueAssetScopeMatchesCarrying',
    labelAr: 'تطابق نطاق الأصول المقيمة مع الدفترية',
    dataType: 'boolean | null',
    required: false,
    reusedContractOrSource: 'قراءة نطاق الأصول المشمولة في تقييم القيمة العادلة بالإيضاح',
    governanceNotesAr: 'true = تطابق موثق؛ false = عدم تطابق يحجب المقارنة؛ null = التطابق غير موثّق ولا يُعامل أبداً كـ true بل يعلّق الفرق المعتمد حتى التوثيق.',
  },
  {
    field: 'fairValueSource',
    labelAr: 'مصدر القيمة العادلة / جهة التقييم',
    dataType: `string (<=${REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.fairValueSource}) | null`,
    required: false,
    reusedContractOrSource: 'اسم المثمن المستقل أو مرجع تقدير الإدارة كما ورد بالإيضاح',
    governanceNotesAr: `توثيق مصدر القيمة العادلة للتدقيق دون اختلاق؛ يُرفض تجاوز ${REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.fairValueSource} حرفاً دون قص صامت.`,
  },
  {
    field: 'fairValueSourceType',
    labelAr: 'تصنيف مصدر القيمة العادلة',
    dataType: 'independent_valuer | management_estimate | market_observable | unspecified',
    required: true,
    reusedContractOrSource: 'الإيضاح المتمم بالقوائم المالية',
    governanceNotesAr: 'يميز بين تقييم مثمن مستقل وتقدير الإدارة والبيانات السوقية.',
  },
  {
    field: 'footnoteReference',
    labelAr: 'رقم الإيضاح أو مرجعه',
    dataType: `string (<=${REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.footnoteReference}) | null`,
    required: false,
    reusedContractOrSource: 'رقم وعنوان الإيضاح المتمم بالقوائم المالية',
    governanceNotesAr: `يمكّن المراجع من الرجوع المباشر لنص القوائم المالية؛ يُرفض تجاوز ${REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.footnoteReference} حرفاً دون قص صامت.`,
  },
  {
    field: 'explanatoryNote',
    labelAr: 'ملاحظة تفسيرية',
    dataType: `string (<=${REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.explanatoryNote}) | null`,
    required: false,
    reusedContractOrSource: 'ملحوظات المحلل / مدخل البيانات المستندة إلى الإيضاح',
    governanceNotesAr: `لتوضيح أي قيود أو استثناءات أو تحفظات في الإفصاح؛ يُرفض تجاوز ${REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.explanatoryNote} حرفاً دون قص صامت.`,
  },
  {
    field: 'completenessStatus',
    labelAr: 'حالة اكتمال بيانات الإفصاح وقابليته للمقارنة',
    dataType:
      'complete_comparable | documented_not_comparable | partial_missing_fair_value | partial_missing_carrying_value | incomplete_missing_metadata | unrecognized_classification',
    required: true,
    reusedContractOrSource: 'مشتقة مركزياً بفصل صحة البنية واكتمال التوثيق وقابلية المقارنة دون تضارب',
    governanceNotesAr: 'لا تُرجع complete_comparable أبداً إذا كانت المقارنة محجوبة لاختلاف التاريخ أو النطاق أو عدم توثيق/تطابق نطاق الأصول.',
  },
] as const;
