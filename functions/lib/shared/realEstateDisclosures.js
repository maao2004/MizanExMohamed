"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.REAL_ESTATE_DISCLOSURE_FIELD_DICTIONARY = exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS = exports.REAL_ESTATE_DISCLOSURE_ID_PATTERN = exports.REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH = exports.ALLOWED_REAL_ESTATE_FAIR_VALUE_SOURCE_TYPES = exports.ALLOWED_REAL_ESTATE_AGGREGATION_LEVELS = exports.ALLOWED_REAL_ESTATE_ACCOUNTING_POLICIES = exports.ALLOWED_REAL_ESTATE_ASSET_CATEGORIES = exports.ALLOWED_FINANCIAL_STATEMENT_SCOPES = exports.REAL_ESTATE_FAIR_VALUE_SOURCE_TYPE_OPTIONS = exports.REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS = exports.REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS = exports.REAL_ESTATE_ASSET_CATEGORY_OPTIONS = exports.FINANCIAL_STATEMENT_SCOPE_OPTIONS = exports.QUARTERLY_FINANCIAL_RECORDS_COLLECTION = exports.REAL_ESTATE_DISCLOSURES_COLLECTION = void 0;
exports.inspectFinancialStatementScope = inspectFinancialStatementScope;
exports.inspectRealEstateAssetCategory = inspectRealEstateAssetCategory;
exports.inspectRealEstateAccountingPolicy = inspectRealEstateAccountingPolicy;
exports.inspectRealEstateAggregationLevel = inspectRealEstateAggregationLevel;
exports.inspectRealEstateFairValueSourceType = inspectRealEstateFairValueSourceType;
exports.inspectRealEstateDisclosureId = inspectRealEstateDisclosureId;
exports.validateRealEstateDisclosureId = validateRealEstateDisclosureId;
exports.sanitizeRealEstateDisclosureId = sanitizeRealEstateDisclosureId;
exports.buildLinkedQuarterlyDocId = buildLinkedQuarterlyDocId;
exports.buildRealEstateDisclosureDocId = buildRealEstateDisclosureDocId;
exports.deriveRealEstateDisclosureStatusBreakdown = deriveRealEstateDisclosureStatusBreakdown;
exports.deriveRealEstateDisclosureCompleteness = deriveRealEstateDisclosureCompleteness;
exports.validateAndNormalizeRealEstateDisclosure = validateAndNormalizeRealEstateDisclosure;
const normalization_1 = require("./normalization");
exports.REAL_ESTATE_DISCLOSURES_COLLECTION = 'real_estate_disclosures';
exports.QUARTERLY_FINANCIAL_RECORDS_COLLECTION = 'quarterly_financial_records';
exports.FINANCIAL_STATEMENT_SCOPE_OPTIONS = [
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
];
exports.REAL_ESTATE_ASSET_CATEGORY_OPTIONS = [
    {
        code: 'investment_property',
        labelAr: 'استثمارات عقارية',
        shortLabelAr: 'استثمارات عقارية',
        selectLabelAr: 'investment_property — استثمارات عقارية (محتفظ بها للإيجار أو لنمو القيمة)',
        descriptionAr: 'عقارات مُفصح عنها صراحةً كبند استثمارات عقارية بالقوائم المالية (لا يُفترض شمول جميع عقارات شركات التطوير العقاري ضمن هذا البند).',
    },
    {
        code: 'development_inventory',
        labelAr: 'أراضٍ ومشروعات قيد التطوير / مخزون عقاري للبيع',
        shortLabelAr: 'مخزون / تطوير عقاري',
        selectLabelAr: 'development_inventory — أراضٍ ومشروعات قيد التطوير / مخزون عقاري بغرض البيع',
        descriptionAr: 'أراضٍ أو وحدات أو مشروعات تطوير محتفظ بها بغرض البيع ضمن النشاط العادي وليست استثمارات عقارية تلقائياً.',
    },
    {
        code: 'owner_occupied_property',
        labelAr: 'عقارات مستخدمة في النشاط (أصول ثابتة)',
        shortLabelAr: 'عقارات تشغيلية',
        selectLabelAr: 'owner_occupied_property — عقارات مستخدمة في النشاط / أصول ثابتة عقارية',
        descriptionAr: 'أراضٍ ومبانٍ تستخدمها الشركة في أنشطتها الإدارية أو التشغيلية أو الإنتاجية وليست استثمارات عقارية.',
    },
    {
        code: 'land_bank_unspecified_use',
        labelAr: 'محفظة أراضٍ غير محدد الاستخدام',
        shortLabelAr: 'محفظة أراضٍ (غير محدد)',
        selectLabelAr: 'land_bank_unspecified_use — محفظة أراضٍ غير محدد الاستخدام المستقبلي',
        descriptionAr: 'أراضٍ مملوكة لم يُحسم أو لم يُفصح عن استخدامها المستقبلي بدقة؛ تُوثّق دون افتراض تصنيف استثماري تلقائي.',
    },
    {
        code: 'mixed_or_other_real_estate',
        labelAr: 'أصول عقارية مختلطة أو أخرى موثقة',
        shortLabelAr: 'عقارية مختلطة / أخرى',
        selectLabelAr: 'mixed_or_other_real_estate — أصول عقارية مختلطة أو أخرى موثقة بالإيضاح',
        descriptionAr: 'بند عقاري يجمع أكثر من طبيعة استخدام أو يرد بتبويب خاص في الإيضاحات المتممة.',
    },
    {
        code: 'unspecified',
        labelAr: 'غير محدد التصنيف والاستخدام',
        shortLabelAr: 'غير محدد',
        selectLabelAr: 'unspecified — غير محدد التصنيف والاستخدام',
        descriptionAr: 'لم يُحدد تصنيف العقار أو استخدامه من القوائم المالية؛ لا يُحوّل تلقائياً إلى استثمارات عقارية.',
    },
];
exports.REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS = [
    {
        code: 'cost_model',
        labelAr: 'نموذج التكلفة (كما أفصحت الشركة)',
        shortLabelAr: 'التكلفة',
        selectLabelAr: 'cost_model — نموذج التكلفة (وفق إفصاح الشركة)',
        descriptionAr: 'تُقاس الأصول بالتكلفة مطروحاً منها الإهلاك المتراكم وأي اضمحلال كما ورد في إيضاح السياسات المحاسبية، دون افتراض معيار غير موثق.',
    },
    {
        code: 'fair_value_model',
        labelAr: 'نموذج القيمة العادلة (كما أفصحت الشركة)',
        shortLabelAr: 'القيمة العادلة',
        selectLabelAr: 'fair_value_model — نموذج القيمة العادلة (وفق إفصاح الشركة)',
        descriptionAr: 'تُقاس الأصول بالقيمة العادلة في القوائم المالية كما ورد في إيضاح السياسات المحاسبية، دون افتراض معيار غير موثق.',
    },
    {
        code: 'unspecified',
        labelAr: 'سياسة محاسبية غير محددة في الإفصاح',
        shortLabelAr: 'غير محددة',
        selectLabelAr: 'unspecified — سياسة محاسبية غير محددة في الإفصاح',
        descriptionAr: 'لم تُوثّق السياسة المحاسبية المعلنة لهذا البند بعد.',
    },
];
exports.REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS = [
    {
        code: 'total_summary',
        labelAr: 'إجمالي مجمّع للفئة / البند',
        shortLabelAr: 'إجمالي مجمّع',
        selectLabelAr: 'total_summary — إفصاح إجمالي مجمّع (لا يُجمع مع تفاصيله الفرعية)',
        descriptionAr: 'سطر إجمالي يغطي فئة عقارية أو كامل البند؛ يجب عدم جمعه مع التفاصيل الفرعية الداخلة فيه منعاً للتكرار.',
    },
    {
        code: 'component_detail',
        labelAr: 'تفصيل فرعي داخل إجمالي',
        shortLabelAr: 'تفصيل فرعي',
        selectLabelAr: 'component_detail — تفصيل فرعي داخل إفصاح إجمالي (يُستبعد من الجمع فقط بعلاقة احتواء موثقة)',
        descriptionAr: 'بند تفصيلي (مثل مشروع أو مبنى محدد) يدخل ضمن إفصاح إجمالي؛ لا يُستبعد من الجمع اعتماداً على التصنيف وحده، بل يشترط ربطه عبر parentDisclosureId بإفصاح إجمالي حاضر ومتوافق الشركة والفترة والنطاق.',
    },
    {
        code: 'standalone_item',
        labelAr: 'بند مستقل غير متداخل',
        shortLabelAr: 'بند مستقل',
        selectLabelAr: 'standalone_item — بند مستقل غير متداخل مع إفصاح إجمالي آخر',
        descriptionAr: 'إفصاح مستقل عن أصل أو محفظة غير مشمولة ضمن سطر إجمالي آخر في نفس الفترة والنطاق.',
    },
    {
        code: 'unspecified',
        labelAr: 'غير محدد مستوى التجميع',
        shortLabelAr: 'غير محدد',
        selectLabelAr: 'unspecified — غير محدد مستوى التجميع',
        descriptionAr: 'لم يُحدد ما إذا كان الإفصاح إجمالياً أم تفصيلاً فرعياً؛ يُمنع جمعه التلقائي مع إجماليات أخرى عند وجود تداخل محتمل.',
    },
];
exports.REAL_ESTATE_FAIR_VALUE_SOURCE_TYPE_OPTIONS = [
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
];
exports.ALLOWED_FINANCIAL_STATEMENT_SCOPES = new Set(exports.FINANCIAL_STATEMENT_SCOPE_OPTIONS.map((o) => o.code));
exports.ALLOWED_REAL_ESTATE_ASSET_CATEGORIES = new Set(exports.REAL_ESTATE_ASSET_CATEGORY_OPTIONS.map((o) => o.code));
exports.ALLOWED_REAL_ESTATE_ACCOUNTING_POLICIES = new Set(exports.REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS.map((o) => o.code));
exports.ALLOWED_REAL_ESTATE_AGGREGATION_LEVELS = new Set(exports.REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS.map((o) => o.code));
exports.ALLOWED_REAL_ESTATE_FAIR_VALUE_SOURCE_TYPES = new Set(exports.REAL_ESTATE_FAIR_VALUE_SOURCE_TYPE_OPTIONS.map((o) => o.code));
const ALLOWED_QUARTERLY_QUARTERS = new Set(['Q1', 'Q2', 'Q3', 'FY']);
function inspectEnumCode(raw, allowedSet, options) {
    if (raw === undefined || raw === null) {
        return { status: 'empty', rawValue: null, code: null, option: null };
    }
    const cleaned = typeof raw === 'string' ? (0, normalization_1.parseCleanText)(raw) : String(raw).trim() || null;
    if (!cleaned) {
        return { status: 'empty', rawValue: null, code: null, option: null };
    }
    const normalized = cleaned.toLowerCase();
    if (allowedSet.has(normalized)) {
        const code = normalized;
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
function inspectFinancialStatementScope(raw) {
    return inspectEnumCode(raw, exports.ALLOWED_FINANCIAL_STATEMENT_SCOPES, exports.FINANCIAL_STATEMENT_SCOPE_OPTIONS);
}
function inspectRealEstateAssetCategory(raw) {
    return inspectEnumCode(raw, exports.ALLOWED_REAL_ESTATE_ASSET_CATEGORIES, exports.REAL_ESTATE_ASSET_CATEGORY_OPTIONS);
}
function inspectRealEstateAccountingPolicy(raw) {
    return inspectEnumCode(raw, exports.ALLOWED_REAL_ESTATE_ACCOUNTING_POLICIES, exports.REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS);
}
function inspectRealEstateAggregationLevel(raw) {
    return inspectEnumCode(raw, exports.ALLOWED_REAL_ESTATE_AGGREGATION_LEVELS, exports.REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS);
}
function inspectRealEstateFairValueSourceType(raw) {
    return inspectEnumCode(raw, exports.ALLOWED_REAL_ESTATE_FAIR_VALUE_SOURCE_TYPES, exports.REAL_ESTATE_FAIR_VALUE_SOURCE_TYPE_OPTIONS);
}
/**
 * Central canonical identity rule for `disclosureId` and `parentDisclosureId`:
 * - Exact lossless string identity (NO silent truncation, NO whitespace-to-underscore replacement,
 *   NO case folding) so two distinct IDs can NEVER silently collapse onto one identity.
 * - Length: 1..80 characters.
 * - Allowed characters: ASCII letters, digits, dot (.), underscore (_), hyphen (-),
 *   starting with an ASCII letter or digit; rejects any whitespace, `/`, `\`, and `..`.
 */
exports.REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH = 80;
exports.REAL_ESTATE_DISCLOSURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/**
 * Central maximum lengths for optional free-text documentation fields.
 * Exceeding any limit is explicitly rejected — NEVER silently truncated with `.slice()`.
 */
exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS = {
    assetUsageDescription: 240,
    fairValueSource: 240,
    footnoteReference: 160,
    explanatoryNote: 800,
};
function validateOptionalBoundedText(raw, fieldLabel, maxLength) {
    const cleaned = (0, normalization_1.parseCleanText)(raw);
    if (cleaned === null)
        return null;
    if (cleaned.length > maxLength) {
        throw new Error(`طول حقل ${fieldLabel} (${cleaned.length} حرفاً) يتجاوز الحد الأقصى المسموح (${maxLength} حرفاً)؛ لا يُقص النص التوثيقي بصمت منعاً لفقدان التفاصيل.`);
    }
    return cleaned;
}
/**
 * Non-throwing central identity inspector applied consistently to `disclosureId`
 * and `parentDisclosureId` on both read and write paths.
 */
function inspectRealEstateDisclosureId(raw, fieldLabel = 'معرّف الإفصاح العقاري (disclosureId)') {
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
    if (raw.length > exports.REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH) {
        return {
            status: 'invalid',
            rawValue: raw,
            normalizedId: null,
            invalidReason: 'exceeds_max_length',
            errorMessageAr: `طول ${fieldLabel} (${raw.length} حرفاً) يتجاوز الحد الأقصى المسموح (${exports.REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH} حرفاً)؛ لا يُقص المعرّف بصمت منعاً لتصادم الهويات.`,
        };
    }
    if (!exports.REAL_ESTATE_DISCLOSURE_ID_PATTERN.test(raw)) {
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
function validateRealEstateDisclosureId(raw, fieldLabel = 'معرّف الإفصاح العقاري (disclosureId)') {
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
function sanitizeRealEstateDisclosureId(raw, fieldLabel = 'معرّف الإفصاح العقاري (disclosureId)') {
    return validateRealEstateDisclosureId(raw, fieldLabel);
}
/**
 * Logical linkage key matching the existing `quarterly_financial_records` docId format (`${ticker}_${year}_${quarter}`).
 */
function buildLinkedQuarterlyDocId(ticker, fiscalYear, fiscalQuarter) {
    if (fiscalYear === null || fiscalQuarter === null)
        return null;
    const tk = (0, normalization_1.normalizedTicker)(ticker);
    return `${tk}_${fiscalYear}_${fiscalQuarter}`;
}
/**
 * Deterministic document ID format for `real_estate_disclosures`.
 * Strictly validates every component so two distinct disclosures never collapse into the same document ID.
 */
function buildRealEstateDisclosureDocId(params) {
    const tk = (0, normalization_1.normalizedTicker)(params.ticker);
    const scopeInsp = inspectFinancialStatementScope(params.statementScope);
    if (scopeInsp.status !== 'valid' || !scopeInsp.code) {
        throw new Error(`نطاق الإفصاح (statementScope) غير صالح لبناء معرّف المستند (${String(params.statementScope)}).`);
    }
    const hasYear = params.fiscalYear !== undefined && params.fiscalYear !== null;
    const hasQuarter = params.fiscalQuarter !== undefined && params.fiscalQuarter !== null;
    if (hasYear !== hasQuarter) {
        throw new Error(`يلزم تمرير السنة المالية (fiscalYear) والربع (fiscalQuarter) معاً لبناء معرّف مستند الإفصاح للسهم ${tk}.`);
    }
    let periodToken;
    if (hasYear && hasQuarter) {
        if (typeof params.fiscalYear !== 'number' ||
            !Number.isInteger(params.fiscalYear) ||
            params.fiscalYear < 1900 ||
            params.fiscalYear > 2200) {
            throw new Error(`السنة المالية (${String(params.fiscalYear)}) غير صالحة لبناء معرّف مستند الإفصاح.`);
        }
        if (!ALLOWED_QUARTERLY_QUARTERS.has(params.fiscalQuarter)) {
            throw new Error(`الربع المالي (${String(params.fiscalQuarter)}) غير صالح لبناء معرّف مستند الإفصاح.`);
        }
        periodToken = `${params.fiscalYear}_${params.fiscalQuarter}`;
    }
    else if (params.balanceSheetDate && (0, normalization_1.isValidCalendarDate)(params.balanceSheetDate)) {
        periodToken = params.balanceSheetDate;
    }
    else {
        throw new Error(`يلزم تحديد الفترة المالية (fiscalYear + fiscalQuarter) أو تاريخ مركز مالي صالح (balanceSheetDate) لبناء معرّف مستند الإفصاح للسهم ${tk}.`);
    }
    const idToken = validateRealEstateDisclosureId(params.disclosureId);
    return `${tk}_${periodToken}_${scopeInsp.code}_${idToken}`;
}
function validateStrictEnum(raw, fieldLabel, allowedSet, options, defaultWhenEmpty) {
    const inspected = inspectEnumCode(raw, allowedSet, options);
    if (inspected.status === 'empty') {
        return defaultWhenEmpty;
    }
    if (inspected.status === 'valid' && inspected.code) {
        return inspected.code;
    }
    const allowedList = options.map((o) => o.code).join(' | ');
    throw new Error(`قيمة ${fieldLabel} غير صالحة (${inspected.rawValue ?? String(raw)})؛ القيم المعتمدة: ${allowedList}.`);
}
function validateNonNegativeAssetNumber(raw, fieldLabel) {
    const parsed = (0, normalization_1.parseCleanNumber)(raw, fieldLabel);
    if (parsed === null)
        return null;
    if (!Number.isFinite(parsed)) {
        throw new Error(`قيمة ${fieldLabel} يجب أن تكون رقماً منتهياً أو فارغة (null).`);
    }
    if (parsed < 0) {
        throw new Error(`قيمة ${fieldLabel} (${parsed}) لا يمكن أن تكون سالبة لقيمة أصل عقاري.`);
    }
    return Object.is(parsed, -0) ? 0 : parsed;
}
function absoluteCalendarDayGap(dateA, dateB) {
    const [ay, am, ad] = dateA.split('-').map(Number);
    const [by, bm, bd] = dateB.split('-').map(Number);
    const msA = Date.UTC(ay, am - 1, ad);
    const msB = Date.UTC(by, bm - 1, bd);
    return Math.abs(Math.round((msA - msB) / 86_400_000));
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
function deriveRealEstateDisclosureStatusBreakdown(record) {
    const maxGap = record.maxAllowedDateGapDays ?? 0;
    const hasValidBsDate = Boolean(record.balanceSheetDate && (0, normalization_1.isValidCalendarDate)(record.balanceSheetDate));
    const hasValidFvDate = Boolean(record.fairValueDate && (0, normalization_1.isValidCalendarDate)(record.fairValueDate));
    const hasInvalidDateFormat = (record.balanceSheetDate !== null && !hasValidBsDate) ||
        (record.fairValueDate !== null && !hasValidFvDate);
    const hasInvalidNumber = (record.carryingValue !== null && (!Number.isFinite(record.carryingValue) || record.carryingValue < 0)) ||
        (record.disclosedFairValue !== null &&
            (!Number.isFinite(record.disclosedFairValue) || record.disclosedFairValue < 0));
    const hasInvalidAssetScopeFlag = record.fairValueAssetScopeMatchesCarrying !== undefined &&
        record.fairValueAssetScopeMatchesCarrying !== null &&
        typeof record.fairValueAssetScopeMatchesCarrying !== 'boolean';
    const structuralValidityStatus = record.hasUnrecognizedCode ||
        record.hasInvalidStructure ||
        hasInvalidDateFormat ||
        hasInvalidNumber ||
        hasInvalidAssetScopeFlag
        ? 'invalid'
        : 'valid';
    // Axis 2: Documentation completeness
    const missingDocumentationFields = [];
    if (record.carryingValue === null)
        missingDocumentationFields.push('carryingValue');
    if (record.disclosedFairValue === null)
        missingDocumentationFields.push('disclosedFairValue');
    if (record.statementScope === 'unspecified')
        missingDocumentationFields.push('statementScope');
    if (record.accountingPolicy === 'unspecified')
        missingDocumentationFields.push('accountingPolicy');
    if (!hasValidBsDate)
        missingDocumentationFields.push('balanceSheetDate');
    if (!hasValidFvDate)
        missingDocumentationFields.push('fairValueDate');
    if (!record.footnoteReference)
        missingDocumentationFields.push('footnoteReference');
    if (!record.fairValueSource)
        missingDocumentationFields.push('fairValueSource');
    if (record.fairValueAssetScopeMatchesCarrying === undefined ||
        record.fairValueAssetScopeMatchesCarrying === null) {
        missingDocumentationFields.push('fairValueAssetScopeMatchesCarrying');
    }
    let documentationStatus;
    if (structuralValidityStatus === 'invalid') {
        documentationStatus = 'invalid_structure_or_classification';
    }
    else if (record.carryingValue === null) {
        documentationStatus = 'documented_missing_carrying_value';
    }
    else if (record.disclosedFairValue === null) {
        documentationStatus = 'documented_missing_fair_value';
    }
    else if (missingDocumentationFields.length === 0) {
        documentationStatus = 'documented_complete';
    }
    else {
        documentationStatus = 'documented_missing_metadata';
    }
    // Axis 3: Strict comparability check (never treats null asset-scope match as true, never relaxes date/scope match)
    const scopeSpecified = record.statementScope !== 'unspecified';
    const fvScopeMatches = record.fairValueStatementScope === undefined ||
        record.fairValueStatementScope === null ||
        (record.fairValueStatementScope !== 'unspecified' &&
            record.fairValueStatementScope === record.statementScope);
    const expectedScopeMatches = !record.expectedStatementScope ||
        record.expectedStatementScope === 'unspecified' ||
        record.statementScope === record.expectedStatementScope;
    const assetScopeExplicitlyConfirmed = record.fairValueAssetScopeMatchesCarrying === true;
    const datesComparable = hasValidBsDate &&
        hasValidFvDate &&
        absoluteCalendarDayGap(record.balanceSheetDate, record.fairValueDate) <= maxGap;
    const comparable = structuralValidityStatus === 'valid' &&
        record.carryingValue !== null &&
        record.disclosedFairValue !== null &&
        scopeSpecified &&
        fvScopeMatches &&
        expectedScopeMatches &&
        assetScopeExplicitlyConfirmed &&
        datesComparable;
    const comparabilityStatus = comparable ? 'comparable' : 'blocked';
    let completenessStatus;
    if (record.hasUnrecognizedCode || structuralValidityStatus === 'invalid') {
        completenessStatus = 'unrecognized_classification';
    }
    else if (record.carryingValue === null) {
        completenessStatus = 'partial_missing_carrying_value';
    }
    else if (record.disclosedFairValue === null) {
        completenessStatus = 'partial_missing_fair_value';
    }
    else if (documentationStatus !== 'documented_complete') {
        completenessStatus = 'incomplete_missing_metadata';
    }
    else if (comparable) {
        completenessStatus = 'complete_comparable';
    }
    else {
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
function deriveRealEstateDisclosureCompleteness(record) {
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
function validateAndNormalizeRealEstateDisclosure(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('سجل الإفصاح العقاري غير صالح.');
    }
    const ticker = (0, normalization_1.normalizedTicker)(raw.ticker);
    const disclosureId = sanitizeRealEstateDisclosureId(raw.disclosureId);
    let fiscalYear = null;
    if (raw.fiscalYear !== undefined && raw.fiscalYear !== null && raw.fiscalYear !== '') {
        const parsedYear = typeof raw.fiscalYear === 'number' ? raw.fiscalYear : Number(String(raw.fiscalYear).trim());
        if (!Number.isFinite(parsedYear) || !Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2200) {
            throw new Error(`السنة المالية للإفصاح العقاري للسهم ${ticker} يجب أن تكون عدداً صحيحاً بين 1900 و 2200.`);
        }
        fiscalYear = parsedYear;
    }
    let fiscalQuarter = null;
    const rawQuarterText = (0, normalization_1.parseCleanText)(raw.fiscalQuarter);
    if (rawQuarterText !== null) {
        const upperQ = rawQuarterText.toUpperCase();
        if (!ALLOWED_QUARTERLY_QUARTERS.has(upperQ)) {
            throw new Error(`الربع المالي للإفصاح العقاري للسهم ${ticker} غير صالح (${rawQuarterText})؛ القيم المعتمدة: Q1 | Q2 | Q3 | FY.`);
        }
        fiscalQuarter = upperQ;
    }
    if ((fiscalYear !== null && fiscalQuarter === null) || (fiscalYear === null && fiscalQuarter !== null)) {
        throw new Error(`يلزم إدخال السنة المالية (fiscalYear) والربع (fiscalQuarter) معاً عند ربط الإفصاح العقاري بفترة مالية للسهم ${ticker}.`);
    }
    const balanceSheetDate = (0, normalization_1.parseCleanText)(raw.balanceSheetDate);
    if (balanceSheetDate !== null && !(0, normalization_1.isValidCalendarDate)(balanceSheetDate)) {
        throw new Error(`تاريخ المركز المالي (balanceSheetDate) للإفصاح العقاري للسهم ${ticker} غير صالح تقويمياً (المطلوب YYYY-MM-DD).`);
    }
    if (fiscalYear === null && balanceSheetDate === null) {
        throw new Error(`يلزم تحديد الفترة المالية (fiscalYear + fiscalQuarter) أو تاريخ المركز المالي (balanceSheetDate) للإفصاح العقاري للسهم ${ticker}.`);
    }
    const statementScope = validateStrictEnum(raw.statementScope, 'نطاق الإفصاح (statementScope)', exports.ALLOWED_FINANCIAL_STATEMENT_SCOPES, exports.FINANCIAL_STATEMENT_SCOPE_OPTIONS, 'unspecified');
    const assetCategory = validateStrictEnum(raw.assetCategory, 'تصنيف العقار واستخدامه (assetCategory)', exports.ALLOWED_REAL_ESTATE_ASSET_CATEGORIES, exports.REAL_ESTATE_ASSET_CATEGORY_OPTIONS, 'unspecified');
    const accountingPolicy = validateStrictEnum(raw.accountingPolicy, 'السياسة المحاسبية المعلنة (accountingPolicy)', exports.ALLOWED_REAL_ESTATE_ACCOUNTING_POLICIES, exports.REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS, 'unspecified');
    const aggregationLevel = validateStrictEnum(raw.aggregationLevel, 'مستوى التجميع (aggregationLevel)', exports.ALLOWED_REAL_ESTATE_AGGREGATION_LEVELS, exports.REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS, 'unspecified');
    const fairValueSourceType = validateStrictEnum(raw.fairValueSourceType, 'نوع مصدر القيمة العادلة (fairValueSourceType)', exports.ALLOWED_REAL_ESTATE_FAIR_VALUE_SOURCE_TYPES, exports.REAL_ESTATE_FAIR_VALUE_SOURCE_TYPE_OPTIONS, 'unspecified');
    let fairValueStatementScope = null;
    if (raw.fairValueStatementScope !== undefined && raw.fairValueStatementScope !== null && (0, normalization_1.parseCleanText)(raw.fairValueStatementScope) !== null) {
        fairValueStatementScope = validateStrictEnum(raw.fairValueStatementScope, 'نطاق القيمة العادلة (fairValueStatementScope)', exports.ALLOWED_FINANCIAL_STATEMENT_SCOPES, exports.FINANCIAL_STATEMENT_SCOPE_OPTIONS, 'unspecified');
    }
    let parentDisclosureId = null;
    const parentInsp = inspectRealEstateDisclosureId(raw.parentDisclosureId, 'معرّف الإفصاح الأب (parentDisclosureId)');
    if (parentInsp.status === 'invalid') {
        throw new Error(parentInsp.errorMessageAr ?? 'معرّف الإفصاح الأب (parentDisclosureId) غير صالح.');
    }
    if (parentInsp.status === 'valid' && parentInsp.normalizedId) {
        parentDisclosureId = parentInsp.normalizedId;
        if (parentDisclosureId === disclosureId) {
            throw new Error(`معرّف الإفصاح الأب (parentDisclosureId) لا يمكن أن يساوي معرّف الإفصاح نفسه (${disclosureId}).`);
        }
        if (aggregationLevel !== 'component_detail') {
            throw new Error(`لا يجوز تعيين معرّف الإفصاح الأب (${parentDisclosureId}) إلا عندما يكون مستوى التجميع component_detail (الحالي: ${aggregationLevel}).`);
        }
    }
    const carryingValue = validateNonNegativeAssetNumber(raw.carryingValue, 'القيمة الدفترية (carryingValue)');
    const disclosedFairValue = validateNonNegativeAssetNumber(raw.disclosedFairValue, 'القيمة العادلة المُفصح عنها (disclosedFairValue)');
    const fairValueDate = (0, normalization_1.parseCleanText)(raw.fairValueDate);
    if (fairValueDate !== null && !(0, normalization_1.isValidCalendarDate)(fairValueDate)) {
        throw new Error(`تاريخ القيمة العادلة (fairValueDate) للإفصاح العقاري للسهم ${ticker} غير صالح تقويمياً (المطلوب YYYY-MM-DD).`);
    }
    let fairValueAssetScopeMatchesCarrying = null;
    if (raw.fairValueAssetScopeMatchesCarrying !== undefined && raw.fairValueAssetScopeMatchesCarrying !== null) {
        if (typeof raw.fairValueAssetScopeMatchesCarrying !== 'boolean') {
            throw new Error('حقل تطابق نطاق الأصول بين القيمة العادلة والدفترية (fairValueAssetScopeMatchesCarrying) يجب أن يكون قيمة منطقية (true/false) أو فارغاً.');
        }
        fairValueAssetScopeMatchesCarrying = raw.fairValueAssetScopeMatchesCarrying;
    }
    const assetUsageDescription = validateOptionalBoundedText(raw.assetUsageDescription, 'وصف استخدام العقار (assetUsageDescription)', exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.assetUsageDescription);
    const fairValueSource = validateOptionalBoundedText(raw.fairValueSource, 'مصدر القيمة العادلة (fairValueSource)', exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.fairValueSource);
    const footnoteReference = validateOptionalBoundedText(raw.footnoteReference, 'رقم الإيضاح أو مرجعه (footnoteReference)', exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.footnoteReference);
    const explanatoryNote = validateOptionalBoundedText(raw.explanatoryNote, 'الملاحظة التفسيرية (explanatoryNote)', exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.explanatoryNote);
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
exports.REAL_ESTATE_DISCLOSURE_FIELD_DICTIONARY = [
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
        dataType: 'investment_property | development_inventory | owner_occupied_property | land_bank_unspecified_use | mixed_or_other_real_estate | unspecified',
        required: true,
        reusedContractOrSource: 'تبويب قائمة المركز المالي والإيضاحات المتممة',
        governanceNotesAr: 'لا يفترض أن جميع عقارات شركات التطوير العقاري هي استثمارات عقارية ضمن IAS 40.',
    },
    {
        field: 'assetUsageDescription',
        labelAr: 'وصف استخدام العقار من الإيضاح',
        dataType: `string (<=${exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.assetUsageDescription}) | null`,
        required: false,
        reusedContractOrSource: 'نص الإيضاح المتمم بالقوائم المالية',
        governanceNotesAr: `توثيق اختياري للطبيعة التشغيلية أو الاستثمارية للأصل؛ يُرفض تجاوز ${exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.assetUsageDescription} حرفاً دون قص صامت.`,
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
        dataType: `string (<=${exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.fairValueSource}) | null`,
        required: false,
        reusedContractOrSource: 'اسم المثمن المستقل أو مرجع تقدير الإدارة كما ورد بالإيضاح',
        governanceNotesAr: `توثيق مصدر القيمة العادلة للتدقيق دون اختلاق؛ يُرفض تجاوز ${exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.fairValueSource} حرفاً دون قص صامت.`,
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
        dataType: `string (<=${exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.footnoteReference}) | null`,
        required: false,
        reusedContractOrSource: 'رقم وعنوان الإيضاح المتمم بالقوائم المالية',
        governanceNotesAr: `يمكّن المراجع من الرجوع المباشر لنص القوائم المالية؛ يُرفض تجاوز ${exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.footnoteReference} حرفاً دون قص صامت.`,
    },
    {
        field: 'explanatoryNote',
        labelAr: 'ملاحظة تفسيرية',
        dataType: `string (<=${exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.explanatoryNote}) | null`,
        required: false,
        reusedContractOrSource: 'ملحوظات المحلل / مدخل البيانات المستندة إلى الإيضاح',
        governanceNotesAr: `لتوضيح أي قيود أو استثناءات أو تحفظات في الإفصاح؛ يُرفض تجاوز ${exports.REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.explanatoryNote} حرفاً دون قص صامت.`,
    },
    {
        field: 'completenessStatus',
        labelAr: 'حالة اكتمال بيانات الإفصاح وقابليته للمقارنة',
        dataType: 'complete_comparable | documented_not_comparable | partial_missing_fair_value | partial_missing_carrying_value | incomplete_missing_metadata | unrecognized_classification',
        required: true,
        reusedContractOrSource: 'مشتقة مركزياً بفصل صحة البنية واكتمال التوثيق وقابلية المقارنة دون تضارب',
        governanceNotesAr: 'لا تُرجع complete_comparable أبداً إذا كانت المقارنة محجوبة لاختلاف التاريخ أو النطاق أو عدم توثيق/تطابق نطاق الأصول.',
    },
];
//# sourceMappingURL=realEstateDisclosures.js.map