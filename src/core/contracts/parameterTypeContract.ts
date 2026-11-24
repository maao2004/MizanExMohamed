/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getParameterDefinition,
  ParameterCategory,
  ParameterValueType,
} from './parameterRegistry';

export const ALLOWED_PARAMETER_VALUE_TYPES: readonly ParameterValueType[] = [
  'pct',
  'integer',
  'multiple',
  'mode',
  'number',
] as const;

export const ALLOWED_PARAMETER_CATEGORIES: readonly ParameterCategory[] = [
  'tax_rf',
  'risk_premiums',
  'growth',
  'wacc_modes',
  'weights',
  'macro_inflation',
  'beta',
  'terminal',
  'multiples',
] as const;

const ALLOWED_VALUE_TYPE_SET = new Set<string>(ALLOWED_PARAMETER_VALUE_TYPES);
const ALLOWED_CATEGORY_SET = new Set<string>(ALLOWED_PARAMETER_CATEGORIES);

export type ParameterTypeSource = 'registry' | 'explicit' | 'unspecified';

export interface ParameterTypeMetadataInput {
  valueType?: ParameterValueType | string | null;
  isPercentage?: boolean | null;
  unit?: string | null;
}

export interface ResolvedParameterTypeContract {
  typeSource: ParameterTypeSource;
  valueType: ParameterValueType | null;
  isPercentage: boolean | null;
  /**
   * True ONLY when the parameter is authoritatively typed as a decimal-stored percentage
   * (either via central registry or via explicit custom parameter metadata).
   * NEVER inferred from `unit: 'decimal'` alone or numeric magnitude.
   */
  isPercentDecimal: boolean;
  defaultUnit: string;
}

export function isValidParameterValueType(val: unknown): val is ParameterValueType {
  return typeof val === 'string' && ALLOWED_VALUE_TYPE_SET.has(val.trim().toLowerCase());
}

export function isValidParameterCategory(val: unknown): val is ParameterCategory {
  return typeof val === 'string' && ALLOWED_CATEGORY_SET.has(val.trim());
}

export function parseOptionalParameterValueType(
  raw: unknown,
  contextKey: string
): ParameterValueType | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    throw new Error(
      `نوع المعامل (valueType) للمعامل ${contextKey} غير صالح؛ المسموح: ${ALLOWED_PARAMETER_VALUE_TYPES.join(', ')}.`
    );
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return undefined;
  if (!ALLOWED_VALUE_TYPE_SET.has(normalized)) {
    throw new Error(
      `نوع المعامل (valueType="${raw}") للمعامل ${contextKey} غير مدعوم؛ المسموح: ${ALLOWED_PARAMETER_VALUE_TYPES.join(', ')}.`
    );
  }
  return normalized as ParameterValueType;
}

export function parseOptionalParameterIsPercentage(
  raw: unknown,
  contextKey: string
): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'boolean') {
    throw new Error(
      `حقل النسبة المئوية (isPercentage) للمعامل ${contextKey} يجب أن يكون قيمة منطقية (true/false) أو فارغاً.`
    );
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
export function resolveCanonicalParameterType(
  key: string,
  meta?: ParameterTypeMetadataInput | null
): ResolvedParameterTypeContract {
  const trimmedKey = typeof key === 'string' ? key.trim() : '';
  const def = trimmedKey ? getParameterDefinition(trimmedKey) : null;

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

  const rawValueType =
    typeof meta?.valueType === 'string' && ALLOWED_VALUE_TYPE_SET.has(meta.valueType.trim().toLowerCase())
      ? (meta.valueType.trim().toLowerCase() as ParameterValueType)
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
