"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_PARAMETERS_TEMPLATE_INSTRUCTIONS = exports.ALL_PARAMETERS_EXCEL_HEADER_ALIASES = exports.ALL_PARAMETERS_EXCEL_HEADERS = exports.ALL_PARAMETERS_INSTRUCTIONS_SHEET_NAME = exports.ALL_PARAMETERS_SHEET_NAME = void 0;
exports.parameterRecordToExcelRow = parameterRecordToExcelRow;
exports.templateRowToExcelRow = templateRowToExcelRow;
exports.excelRowToAoa = excelRowToAoa;
const parameterRegistry_1 = require("./parameterRegistry");
const parameterTypeContract_1 = require("./parameterTypeContract");
exports.ALL_PARAMETERS_SHEET_NAME = 'All_Parameters';
exports.ALL_PARAMETERS_INSTRUCTIONS_SHEET_NAME = 'تعليمات القالب';
exports.ALL_PARAMETERS_EXCEL_HEADERS = [
    'Key',
    'NameAr',
    'Value',
    'ValueType',
    'IsPercentage',
    'Description',
    'Scope',
    'Ticker',
    'Unit',
    'AsOfDate',
    'Source',
    'RfMethodology',
    'Currency',
    'ForecastHorizonYears',
];
/**
 * Single Source of Truth for Excel header aliases accepted by `parseAllParametersExcelFile`.
 * Every canonical column emitted by templates and exports is listed first.
 */
exports.ALL_PARAMETERS_EXCEL_HEADER_ALIASES = {
    Key: ['Key', 'المعامل', 'المفتاح'],
    NameAr: ['NameAr', 'Name_Ar', 'Name', 'الاسم', 'التسمية', 'التسمية_العربية'],
    Value: ['Value', 'القيمة'],
    ValueType: ['ValueType', 'Value_Type', 'Type', 'نوع_القيمة', 'النوع'],
    IsPercentage: ['IsPercentage', 'Is_Percentage', 'Percentage', 'نسبة_مئوية', 'هل_نسبة'],
    Description: ['Description', 'DescriptionAr', 'الوصف'],
    Scope: ['Scope', 'النطاق'],
    Ticker: ['Ticker', 'الرمز'],
    Unit: ['Unit', 'الوحدة'],
    AsOfDate: ['AsOfDate', 'As_Of_Date', 'التاريخ'],
    Source: ['Source', 'المصدر'],
    RfMethodology: ['RfMethodology', 'Rf_Methodology', 'منهجية_Rf'],
    Currency: ['Currency', 'العملة'],
    ForecastHorizonYears: ['ForecastHorizonYears', 'Forecast_Horizon_Years', 'أفق_التوقع'],
};
/**
 * Converts a saved parameter (`MacroParameter` or `CompanyParameterOverride`) or template row
 * into the single canonical Excel row shape shared across template generation and export.
 *
 * - Known (cataloged) parameters always emit the central registry's authoritative type & Arabic name.
 * - Explicitly typed custom parameters emit their exact `ValueType` and boolean `IsPercentage`.
 * - Legacy untyped custom parameters emit blank `ValueType` & `IsPercentage` (never inventing a type).
 * - `Value` is always preserved as the exact stored finite number (no ×100 scaling, no rounding).
 */
function parameterRecordToExcelRow(record) {
    const key = record.key.trim();
    const def = (0, parameterRegistry_1.getParameterDefinition)(key);
    const resolvedType = (0, parameterTypeContract_1.resolveCanonicalParameterType)(key, {
        valueType: record.valueType,
        isPercentage: record.isPercentage,
        unit: record.unit,
    });
    const scope = record.scope === 'company' ? 'company' : 'global';
    const ticker = scope === 'company' && typeof record.ticker === 'string' ? record.ticker.trim() : '';
    const nameAr = def?.nameAr ||
        (typeof record.nameAr === 'string' && record.nameAr.trim() !== '' ? record.nameAr.trim() : key);
    const description = (typeof record.description === 'string' && record.description.trim() !== ''
        ? record.description.trim()
        : typeof record.descriptionAr === 'string' && record.descriptionAr.trim() !== ''
            ? record.descriptionAr.trim()
            : def?.descriptionAr || '');
    const unit = (typeof record.unit === 'string' && record.unit.trim() !== '' ? record.unit.trim() : '') ||
        def?.unit ||
        resolvedType.defaultUnit;
    return {
        Key: key,
        NameAr: nameAr,
        Value: Object.is(record.value, -0) ? 0 : record.value,
        ValueType: resolvedType.valueType ?? '',
        IsPercentage: resolvedType.isPercentage === null ? '' : resolvedType.isPercentage,
        Description: description,
        Scope: scope,
        Ticker: ticker,
        Unit: unit,
        AsOfDate: typeof record.asOfDate === 'string' ? record.asOfDate.trim() : '',
        Source: typeof record.source === 'string' ? record.source.trim() : '',
        RfMethodology: typeof record.rfMethodology === 'string' && record.rfMethodology.trim() !== ''
            ? record.rfMethodology.trim()
            : '',
        Currency: typeof record.currency === 'string' && record.currency.trim() !== ''
            ? record.currency.trim()
            : '',
        ForecastHorizonYears: typeof record.forecastHorizonYears === 'number' && Number.isFinite(record.forecastHorizonYears)
            ? record.forecastHorizonYears
            : '',
    };
}
function templateRowToExcelRow(row) {
    return parameterRecordToExcelRow({
        key: row.Key,
        value: row.Value,
        description: row.Description,
        scope: row.Scope,
        ticker: row.Ticker || null,
        unit: row.Unit,
        asOfDate: row.AsOfDate,
        source: row.Source,
        rfMethodology: row.RfMethodology,
        currency: row.Currency,
        forecastHorizonYears: typeof row.ForecastHorizonYears === 'number' ? row.ForecastHorizonYears : null,
    });
}
function excelRowToAoa(row) {
    return [
        row.Key,
        row.NameAr,
        row.Value,
        row.ValueType,
        row.IsPercentage,
        row.Description,
        row.Scope,
        row.Ticker,
        row.Unit,
        row.AsOfDate,
        row.Source,
        row.RfMethodology,
        row.Currency,
        row.ForecastHorizonYears,
    ];
}
exports.ALL_PARAMETERS_TEMPLATE_INSTRUCTIONS = [
    ['تنبيه مهم', 'هذا الملف يستخدم العقد الموحد لأعمدة All_Parameters.xlsx في القالب والاستيراد والتصدير؛ ولا يُزرع القالب تلقائياً في قاعدة البيانات قبل مراجعتك.'],
    ['الفرق بين الواجهة وملف الاستيراد (النسب المئوية)', 'في لوحة المدير تُعرض وتُدخل النسب بصيغة مئوية مباشرة (مثل 15 لتمثيل 15% وتُحفظ 0.15). أما في ملف Excel فيُكتب في عمود Value الكسر العشري المخزّن (0.15 لتمثيل 15%) أو نص صريح بعلامة % (15%) عند الاستيراد فقط. إدخال 15 بدون % في صف نسبة مئوية يُرفض لمنع التحويل المزدوج. التصدير يكتب دائماً الكسر العشري المخزّن (0.15) مع ValueType=pct وIsPercentage=TRUE.'],
    ['عمودا ValueType وIsPercentage', 'القيم المسموحة لـ ValueType: pct | number | integer | multiple | mode. والقيم المسموحة لـ IsPercentage: TRUE | FALSE. للمعاملات المعروفة يظل السجل المركزي المرجع الحاسم للنوع والوحدة والحدود والنطاق.'],
    ['المعاملات المخصصة (غير المدرجة في السجل)', 'يجب تحديد ValueType و/أو IsPercentage صراحةً دون تعارض (مثل ValueType=pct مع IsPercentage=TRUE، أو ValueType=number مع IsPercentage=FALSE). يُرفض الصف المخصص عند غياب النوع أو تعارضه لمنع محو النوع أو سوء التفسير. لا يُستنتج النوع من اسم المعامل أو مقدار الرقم أو Unit=decimal وحدها، وتبقى المعاملات المخصصة غير مفعّلة في المحرك تلقائياً (enabledInEngine=false).'],
    ['NameAr وDescription وUnit وSource وAsOfDate', 'يحفظ التصدير والاستيراد الاسم العربي (NameAr) والوصف والوحدة والمصدر والتاريخ (YYYY-MM-DD) والنطاق. الفراغ في Value يُرفض ولا يُحوّل إلى صفر، بينما 0 قيمة صحيحة وتُحفظ القيم الدقيقة والصغيرة جداً دون تقريب صامت.'],
    ['Scope & Ticker', 'للنطاق العام اكتب Scope=global واترك Ticker فارغاً. لتخصيص شركة اكتب Scope=company وضع رمز السهم في Ticker.'],
    ['Projected_Terminal_EBITDA', 'يُسمح به على نطاق company فقط بالقيمة الأساسية مع تحديد Currency (عند الحاجة) وForecastHorizonYears المطابق لـ Forecast_Years.'],
    ['RfMethodology', 'عمود اختياري لمعاملات Rf_Egypt_10Y وRf_USD_10Y: unspecified | sovereign_yield | default_free | synthetic.'],
    ['WACC_Mode vs r_Mode', 'WACC_Mode: 1=EG+CRP | 2=EG بدون CRP | 3=USD. أما r_Mode: 1=EG+CRP | 2=USD | 3=EG بدون CRP.'],
    ['معاملات نموذج RIM النهائية والمستقبلية', 'RIM_Terminal_Method (1=بقاء RI، 2=تلاشي ROE، 3=نمو دائم g_B)، RIM_Expected_ROE (اختياري؛ وإلا يُرحّل ROE التاريخي)، RIM_Fade_Years (للنمط 2)، RIM_Terminal_ROE و RIM_Terminal_Retention (للنمط 2 عند اختلاف النهاية أو النمط 3).'],
    ['غير مفعّل حسابياً', 'المعاملات US_Default_Spread وInflation_Egypt_LT وInflation_US_LT تُحفظ للشفافية المرجعية ولا تدخل معادلات Ke/WACC الحالية.'],
];
//# sourceMappingURL=parameterExcelContract.js.map