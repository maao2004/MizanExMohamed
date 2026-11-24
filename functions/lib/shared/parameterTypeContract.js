"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_PARAMETER_CATEGORIES = exports.ALLOWED_PARAMETER_VALUE_TYPES = void 0;
exports.isValidParameterValueType = isValidParameterValueType;
exports.isValidParameterCategory = isValidParameterCategory;
exports.parseOptionalParameterValueType = parseOptionalParameterValueType;
exports.parseOptionalParameterIsPercentage = parseOptionalParameterIsPercentage;
exports.resolveCanonicalParameterType = resolveCanonicalParameterType;
const parameterRegistry_1 = require("./parameterRegistry");
exports.ALLOWED_PARAMETER_VALUE_TYPES = [
    'pct',
    'integer',
    'multiple',
    'mode',
    'number',
];
exports.ALLOWED_PARAMETER_CATEGORIES = [
    'tax_rf',
    'risk_premiums',
    'growth',
    'wacc_modes',
    'weights',
    'macro_inflation',
    'beta',
    'terminal',
    'multiples',
];
const ALLOWED_VALUE_TYPE_SET = new Set(exports.ALLOWED_PARAMETER_VALUE_TYPES);
const ALLOWED_CATEGORY_SET = new Set(exports.ALLOWED_PARAMETER_CATEGORIES);
function isValidParameterValueType(val) {
    return typeof val === 'string' && ALLOWED_VALUE_TYPE_SET.has(val.trim().toLowerCase());
}
function isValidParameterCategory(val) {
    return typeof val === 'string' && ALLOWED_CATEGORY_SET.has(val.trim());
}
function parseOptionalParameterValueType(raw, contextKey) {
    if (raw === undefined || raw === null)
        return undefined;
    if (typeof raw !== 'string') {
        throw new Error(`نوع المعامل (valueType) للمعامل ${contextKey} غير صالح؛ المسموح: ${exports.ALLOWED_PARAMETER_VALUE_TYPES.join(', ')}.`);
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === '')
        return undefined;
    if (!ALLOWED_VALUE_TYPE_SET.has(normalized)) {
        throw new Error(`نوع المعامل (valueType="${raw}") للمعامل ${contextKey} غير مدعوم؛ المسموح: ${exports.ALLOWED_PARAMETER_VALUE_TYPES.join(', ')}.`);
    }
    return normalized;
}
function parseOptionalParameterIsPercentage(raw, contextKey) {
    if (raw === undefined || raw === null)
        return undefined;
    if (typeof raw !== 'boolean') {
        throw new Error(`حقل النسبة المئوية (isPercentage) للمعامل ${contextKey} يجب أن يكون قيمة منطقية (true/false) أو فارغاً.`);
    }
    return raw;
}
/**
 * Single authoritative resolver for parameter type across UI, writers, validators,
 * business hashing, Cloud Functions, and Firestore readers.
 *
 * Rules:
 * 1. Cataloged parameters (static or dynamic via `getParameterDefinition`) ALWAYS follow
 *    the central registry definition.
 * 2. Custom (uncataloged) parameters require explicit `valueType` or `isPercentage`.
 *    `unit: 'decimal'` alone NEVER implies percentage, and numeric value is NEVER inspected.
 * 3. Legacy/uncataloged parameters lacking explicit type metadata remain `typeSource: 'unspecified'`
 *    (`valueType: null, isPercentage: null, isPercentDecimal: false`) rather than inventing a type.
 */
function resolveCanonicalParameterType(key, meta) {
    const trimmedKey = typeof key === 'string' ? key.trim() : '';
    const def = trimmedKey ? (0, parameterRegistry_1.getParameterDefinition)(trimmedKey) : null;
    if (def) {
        const isPct = def.valueType === 'pct' || def.isPercentage === true;
        return {
            typeSource: 'registry',
            valueType: def.valueType,
            isPercentage: isPct,
            isPercentDecimal: isPct && def.unit === 'decimal',
            defaultUnit: def.unit,
        };
    }
    const rawValueType = typeof meta?.valueType === 'string' && ALLOWED_VALUE_TYPE_SET.has(meta.valueType.trim().toLowerCase())
        ? meta.valueType.trim().toLowerCase()
        : null;
    if (rawValueType !== null) {
        const isPct = rawValueType === 'pct';
        return {
            typeSource: 'explicit',
            valueType: rawValueType,
            isPercentage: isPct,
            isPercentDecimal: isPct,
            defaultUnit: isPct ? 'decimal' : rawValueType === 'multiple' ? 'multiple' : 'number',
        };
    }
    if (typeof meta?.isPercentage === 'boolean') {
        const isPct = meta.isPercentage;
        return {
            typeSource: 'explicit',
            valueType: isPct ? 'pct' : 'number',
            isPercentage: isPct,
            isPercentDecimal: isPct,
            defaultUnit: isPct ? 'decimal' : 'number',
        };
    }
    // Legacy / unspecified custom parameter: never invent pct from unit='decimal' or numeric magnitude.
    return {
        typeSource: 'unspecified',
        valueType: null,
        isPercentage: null,
        isPercentDecimal: false,
        defaultUnit: 'number',
    };
}
//# sourceMappingURL=parameterTypeContract.js.map