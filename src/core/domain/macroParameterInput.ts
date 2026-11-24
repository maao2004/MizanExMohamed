/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CanonicalRfMethodology,
  PARAMETER_REGISTRY,
  ParameterRegistryDefinition,
  ParameterScope,
  ParameterTypeSource,
  ParameterValueType,
  getParameterDefinition,
  normalizeRfMethodology,
  resolveCanonicalParameterType,
} from '../contracts';
import type { MacroParameter } from '../../types';

const PARAMETER_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const STRICT_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const RF_METHODOLOGY_KEYS = new Set(['Rf_Egypt_10Y', 'Rf_USD_10Y']);

const MAX_PLAIN_INTEGER_DIGITS = 21;
const MAX_PLAIN_FRACTION_DIGITS = 24;

export interface MacroParameterInputSpec {
  key: string;
  isCataloged: boolean;
  definition: ParameterRegistryDefinition | null;
  typeSource: ParameterTypeSource;
  /** Effective UI input valueType (defaults to 'number' when legacy custom type is unspecified). */
  valueType: ParameterValueType;
  /** Exact canonical valueType for persistence (`null` when legacy custom type is unspecified). */
  resolvedValueType: ParameterValueType | null;
  /** Exact canonical isPercentage for persistence (`null` when legacy custom type is unspecified). */
  resolvedIsPercentage: boolean | null;
  storageUnit: string;
  isPercentDecimal: boolean;
  scale: 100 | 1;
  inputSuffix: string | null;
  displayUnitLabelAr: string;
  storageHintAr: string;
  boundsSummaryAr: string | null;
  placeholderAr: string;
  inputMode: 'decimal' | 'numeric';
  minStored?: number;
  maxStored?: number;
  minDisplay?: number;
  maxDisplay?: number;
  allowedValues?: number[];
  allowedScopes: ParameterScope[];
  descriptionAr: string | null;
  modeNoteAr: string | null;
}

export type MacroParameterDraftErrorCode =
  | 'invalid_key'
  | 'invalid_scope'
  | 'empty'
  | 'invalid_number'
  | 'not_integer'
  | 'invalid_mode'
  | 'below_min'
  | 'above_max';

export interface MacroParameterDraftValidationSuccess {
  ok: true;
  storedValue: number;
  displayNumber: number;
  normalizedDraft: string;
  spec: MacroParameterInputSpec;
}

export interface MacroParameterDraftValidationFailure {
  ok: false;
  code: MacroParameterDraftErrorCode;
  errorAr: string;
  spec: MacroParameterInputSpec;
}

export type MacroParameterDraftValidationResult =
  | MacroParameterDraftValidationSuccess
  | MacroParameterDraftValidationFailure;

export interface PrepareMacroParamsSuccess {
  ok: true;
  params: MacroParameter[];
  fieldErrors: Record<string, string>;
}

export interface PrepareMacroParamsFailure {
  ok: false;
  fieldErrors: Record<string, string>;
  errorCount: number;
  summaryErrorAr: string;
}

export type PrepareMacroParamsResult = PrepareMacroParamsSuccess | PrepareMacroParamsFailure;

export interface BuildNewMacroParamInput {
  key: string;
  nameAr: string;
  descriptionAr?: string;
  draftValue: string;
  rfMethodology?: CanonicalRfMethodology;
  customValueType?: ParameterValueType;
  /** @deprecated Prefer `customValueType`; kept for backward compatibility. */
  customIsPercentDecimal?: boolean;
}

export type BuildNewMacroParamResult =
  | {
      ok: true;
      param: MacroParameter;
      normalizedDraft: string;
      spec: MacroParameterInputSpec;
    }
  | {
      ok: false;
      errorAr: string;
      code: MacroParameterDraftErrorCode | 'missing_name';
      spec: MacroParameterInputSpec;
    };

interface DecimalParts {
  sign: '' | '-';
  digits: string;
  exp: number;
}

/**
 * Normalizes `-0` to `0` without applying any lossy rounding or precision truncation.
 */
export function normalizeFiniteNumber(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Preserved export name for compatibility; strictly lossless (no `toPrecision(12)` truncation).
 */
export function cleanFiniteNumber(value: number): number {
  return normalizeFiniteNumber(value);
}

function parseDecimalParts(raw: string): DecimalParts | null {
  const trimmed = raw.trim();
  if (!STRICT_NUMBER_PATTERN.test(trimmed)) return null;

  const sign: '' | '-' = trimmed.startsWith('-') ? '-' : '';
  const unsigned = trimmed.startsWith('-') || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;

  const [mantissaRaw, expStr] = unsigned.split(/[eE]/);
  const expPart = expStr !== undefined ? Number.parseInt(expStr, 10) : 0;
  if (!Number.isFinite(expPart)) return null;

  const dotIdx = mantissaRaw.indexOf('.');
  const intPart = dotIdx === -1 ? mantissaRaw : mantissaRaw.slice(0, dotIdx);
  const fracPart = dotIdx === -1 ? '' : mantissaRaw.slice(dotIdx + 1);

  const combined = `${intPart}${fracPart}`.replace(/^0+/, '');
  if (combined.length === 0) {
    return { sign: '', digits: '0', exp: 0 };
  }

  let trailingZeros = 0;
  while (
    trailingZeros < combined.length &&
    combined.charCodeAt(combined.length - 1 - trailingZeros) === 48
  ) {
    trailingZeros += 1;
  }

  const digits = combined.slice(0, combined.length - trailingZeros);
  const exp = expPart - fracPart.length + trailingZeros;

  return { sign, digits, exp };
}

function formatDecimalParts(parts: DecimalParts, shiftPower10 = 0): string {
  if (parts.digits === '0') return '0';

  const L = parts.digits.length;
  const shiftedExp = parts.exp + shiftPower10;
  const pointPos = L + shiftedExp;

  // Integer form: pointPos >= L
  if (pointPos >= L) {
    if (pointPos <= MAX_PLAIN_INTEGER_DIGITS) {
      return `${parts.sign}${parts.digits}${'0'.repeat(pointPos - L)}`;
    }
    const mantissa = L === 1 ? parts.digits : `${parts.digits[0]}.${parts.digits.slice(1)}`;
    return `${parts.sign}${mantissa}e+${pointPos - 1}`;
  }

  // Mixed decimal form: 0 < pointPos < L
  if (pointPos > 0) {
    return `${parts.sign}${parts.digits.slice(0, pointPos)}.${parts.digits.slice(pointPos)}`;
  }

  // Fractional form: pointPos <= 0
  const leadingZeros = -pointPos;
  const totalFracDigits = leadingZeros + L;
  if (totalFracDigits <= MAX_PLAIN_FRACTION_DIGITS) {
    return `${parts.sign}0.${'0'.repeat(leadingZeros)}${parts.digits}`;
  }

  const mantissa = L === 1 ? parts.digits : `${parts.digits[0]}.${parts.digits.slice(1)}`;
  return `${parts.sign}${mantissa}e${pointPos - 1}`;
}

/**
 * Performs an exact base-10 decimal shift on a numeric string (e.g., `+2` for ×100, `-2` for ÷100)
 * with zero IEEE-754 multiplication/division artifacts and zero precision truncation.
 */
export function shiftDecimalString(raw: string, shiftPower10: number): string | null {
  const parts = parseDecimalParts(raw);
  if (!parts) return null;
  return formatDecimalParts(parts, shiftPower10);
}

/**
 * Formats any finite number into an exact, parser-readable edit string without lossy rounding.
 * - Never truncates to 12 significant digits or 10 decimal places.
 * - Never turns a non-zero value (e.g., 1e-12) into "0".
 * - Emits plain decimal up to 24 fractional digits / 21 integer digits, and canonical
 *   scientific notation beyond that (fully accepted by `parseAndValidateMacroParameterDraft`).
 */
export function formatExactNumberString(value: number, shiftPower10 = 0): string {
  const normalized = normalizeFiniteNumber(value);
  if (!Number.isFinite(normalized)) return '';
  if (normalized === 0) return '0';

  const rawStr = String(normalized);
  const shifted = shiftDecimalString(rawStr, shiftPower10);
  if (shifted === null) return rawStr;
  // Invariant: a non-zero finite number must NEVER format as "0".
  if (shifted === '0' || shifted === '-0') {
    return rawStr;
  }
  return shifted;
}

/**
 * Preserved export name for exact lossless edit/save number formatting.
 */
export function formatCleanNumberString(value: number): string {
  return formatExactNumberString(value, 0);
}

/**
 * Optional read-only compact visual preview formatter strictly separated from editing/saving.
 * Never feed its output into editable inputs or save payloads.
 */
export function formatParameterCompactPreview(
  key: string,
  storedValue: number | null | undefined,
  fallbackParam?: Partial<Pick<MacroParameter, 'valueType' | 'isPercentage' | 'unit'>>,
  maxFractionDigits = 4
): string {
  if (typeof storedValue !== 'number' || !Number.isFinite(storedValue)) return '—';
  const spec = getMacroParameterInputSpec(key, fallbackParam);
  const exactDisplay = storedValueToEditString(key, storedValue, fallbackParam);
  const displayNum = Number(exactDisplay);
  const suffix = spec.inputSuffix ? (spec.inputSuffix === 'سنة' ? ' سنة' : spec.inputSuffix) : '';

  if (storedValue === 0) return `0${suffix}`;
  // If compact rounding would collapse a tiny non-zero value to 0, keep exact representation!
  const threshold = Math.pow(10, -Math.max(0, maxFractionDigits));
  if (Math.abs(displayNum) < threshold) {
    return `${exactDisplay}${suffix}`;
  }
  const compact = new Intl.NumberFormat('en-US', {
    useGrouping: false,
    maximumFractionDigits: maxFractionDigits,
  }).format(displayNum);
  return `${compact}${suffix}`;
}

function formatBoundValue(
  value: number,
  spec: Pick<MacroParameterInputSpec, 'isPercentDecimal' | 'valueType' | 'storageUnit'>
): string {
  const text = formatExactNumberString(value, 0);
  if (spec.isPercentDecimal) return `${text}%`;
  if (spec.valueType === 'multiple') return `${text}x`;
  if (spec.valueType === 'integer' && spec.storageUnit === 'years') return `${text} سنة`;
  return text;
}

function buildBoundsSummaryAr(
  spec: Pick<
    MacroParameterInputSpec,
    'isPercentDecimal' | 'valueType' | 'storageUnit' | 'minDisplay' | 'maxDisplay' | 'allowedValues'
  >
): string | null {
  if (spec.allowedValues && spec.allowedValues.length > 0) {
    return `القيم المسموحة: ${spec.allowedValues.join('، ')}`;
  }
  if (spec.minDisplay !== undefined && spec.maxDisplay !== undefined) {
    return `النطاق المسموح: من ${formatBoundValue(spec.minDisplay, spec)} إلى ${formatBoundValue(spec.maxDisplay, spec)}`;
  }
  if (spec.minDisplay !== undefined) {
    return `الحد الأدنى المسموح: ${formatBoundValue(spec.minDisplay, spec)}`;
  }
  if (spec.maxDisplay !== undefined) {
    return `الحد الأقصى المسموح: ${formatBoundValue(spec.maxDisplay, spec)}`;
  }
  return null;
}

/**
 * Derives the display/input specification strictly from the central parameter type contract:
 * - Known (cataloged) parameters ALWAYS follow `parameterRegistry` (`getParameterDefinition`).
 * - Custom parameters follow explicit `valueType` / `isPercentage` ONLY (`unit: 'decimal'` alone
 *   never implies percentage, and numeric value magnitude is never inspected).
 * - Legacy untyped custom parameters stay explicitly `typeSource: 'unspecified'` without scaling.
 */
export function getMacroParameterInputSpec(
  key: string,
  fallbackParam?: Partial<
    Pick<MacroParameter, 'valueType' | 'isPercentage' | 'unit' | 'descriptionAr' | 'modeNoteAr'>
  >
): MacroParameterInputSpec {
  const trimmedKey = key.trim();
  const def = trimmedKey ? getParameterDefinition(trimmedKey) : null;
  const canonicalType = resolveCanonicalParameterType(trimmedKey, {
    valueType: fallbackParam?.valueType,
    isPercentage: fallbackParam?.isPercentage,
    unit: fallbackParam?.unit,
  });

  if (def) {
    const isPercentDecimal = canonicalType.isPercentDecimal;
    const scale: 100 | 1 = isPercentDecimal ? 100 : 1;
    const minDisplay =
      def.min !== undefined
        ? Number(formatExactNumberString(def.min, isPercentDecimal ? 2 : 0))
        : undefined;
    const maxDisplay =
      def.max !== undefined
        ? Number(formatExactNumberString(def.max, isPercentDecimal ? 2 : 0))
        : undefined;

    const inputSuffix = isPercentDecimal
      ? '%'
      : def.valueType === 'multiple'
      ? 'x'
      : def.valueType === 'integer' && def.unit === 'years'
      ? 'سنة'
      : null;

    const displayUnitLabelAr = isPercentDecimal
      ? 'نسبة مئوية (%)'
      : def.valueType === 'multiple'
      ? 'مضاعف (x)'
      : def.valueType === 'integer' && def.unit === 'years'
      ? 'سنوات (عدد صحيح)'
      : def.valueType === 'integer'
      ? 'عدد صحيح'
      : def.valueType === 'mode'
      ? 'رمز نمط'
      : 'معامل عددي';

    const storageHintAr = isPercentDecimal
      ? 'أدخل النسبة بالمئة؛ تُحفظ حسابياً ككسر عشري'
      : def.valueType === 'multiple'
      ? 'أدخل المضاعف كما هو دون تحويل (x)'
      : def.valueType === 'integer'
      ? 'أدخل عدداً صحيحاً كما هو دون تحويل'
      : def.valueType === 'mode'
      ? 'أدخل رمز النمط الرقمي المعتمد كما هو'
      : 'أدخل القيمة الرقمية كما هي دون تحويل إلى نسبة مئوية';

    const placeholderAr = isPercentDecimal
      ? 'مثال: 22.5 (تُحفظ 0.225)'
      : def.valueType === 'multiple'
      ? 'مثال: 5.5'
      : def.valueType === 'integer'
      ? 'مثال: 5'
      : def.valueType === 'mode' && def.allowedValues?.length
      ? `مثال: ${def.allowedValues.join(' أو ')}`
      : 'أدخل القيمة الرقمية';

    const partial = {
      isPercentDecimal,
      valueType: def.valueType,
      storageUnit: def.unit,
      minDisplay,
      maxDisplay,
      allowedValues: def.allowedValues,
    };

    return {
      key: trimmedKey,
      isCataloged: true,
      definition: def,
      typeSource: 'registry',
      valueType: def.valueType,
      resolvedValueType: canonicalType.valueType,
      resolvedIsPercentage: canonicalType.isPercentage,
      storageUnit: def.unit,
      isPercentDecimal,
      scale,
      inputSuffix,
      displayUnitLabelAr,
      storageHintAr,
      boundsSummaryAr: buildBoundsSummaryAr(partial),
      placeholderAr,
      inputMode: def.valueType === 'integer' || def.valueType === 'mode' ? 'numeric' : 'decimal',
      minStored: def.min,
      maxStored: def.max,
      minDisplay,
      maxDisplay,
      allowedValues: def.allowedValues,
      allowedScopes: def.allowedScopes,
      descriptionAr: def.descriptionAr,
      modeNoteAr: def.modeNoteAr ?? null,
    };
  }

  // Uncataloged / custom parameter
  const isPercentDecimal = canonicalType.isPercentDecimal;
  const scale: 100 | 1 = isPercentDecimal ? 100 : 1;
  const effectiveValueType: ParameterValueType = canonicalType.valueType ?? 'number';
  const storageUnit =
    (typeof fallbackParam?.unit === 'string' && fallbackParam.unit.trim() !== ''
      ? fallbackParam.unit.trim()
      : '') || canonicalType.defaultUnit;

  const isUnspecified = canonicalType.typeSource === 'unspecified';

  const inputSuffix = isPercentDecimal
    ? '%'
    : effectiveValueType === 'multiple'
    ? 'x'
    : null;

  const displayUnitLabelAr = isUnspecified
    ? 'نوع غير محدد (سجل قديم)'
    : isPercentDecimal
    ? 'نسبة مئوية (%)'
    : effectiveValueType === 'multiple'
    ? 'مضاعف (x)'
    : effectiveValueType === 'integer'
    ? 'عدد صحيح'
    : effectiveValueType === 'mode'
    ? 'رمز نمط'
    : 'معامل عددي';

  const storageHintAr = isUnspecified
    ? 'النوع غير محدد في السجل القديم؛ تُعرض وتُحفظ القيمة كما هي دون تحويل حتى يُحدد النوع صراحةً'
    : isPercentDecimal
    ? 'أدخل النسبة بالمئة؛ تُحفظ حسابياً ككسر عشري'
    : effectiveValueType === 'integer'
    ? 'أدخل عدداً صحيحاً كما هو دون تحويل'
    : effectiveValueType === 'multiple'
    ? 'أدخل المضاعف كما هو دون تحويل (x)'
    : 'أدخل القيمة الرقمية كما هي دون تحويل إلى نسبة مئوية';

  return {
    key: trimmedKey,
    isCataloged: false,
    definition: null,
    typeSource: canonicalType.typeSource,
    valueType: effectiveValueType,
    resolvedValueType: canonicalType.valueType,
    resolvedIsPercentage: canonicalType.isPercentage,
    storageUnit,
    isPercentDecimal,
    scale,
    inputSuffix,
    displayUnitLabelAr,
    storageHintAr,
    boundsSummaryAr: null,
    placeholderAr: isPercentDecimal ? 'مثال: 15 (تُحفظ 0.15)' : 'أدخل القيمة الرقمية',
    inputMode:
      effectiveValueType === 'integer' || effectiveValueType === 'mode' ? 'numeric' : 'decimal',
    allowedScopes: ['global', 'company'],
    descriptionAr: fallbackParam?.descriptionAr ?? null,
    modeNoteAr: fallbackParam?.modeNoteAr ?? null,
  };
}

/**
 * Lossless conversion from stored Firestore numeric value to editable input string ONCE at the UI boundary.
 * - Percentage decimal parameters (`0.5` -> `"50"`, `0.225` -> `"22.5"`, `1e-12` -> `"0.0000000001"`).
 * - Non-percentage parameters (`5.5` -> `"5.5"`, `0.67` -> `"0.67"`, `1e-12` -> `"0.000000000001"`).
 * - Missing / non-finite stored values return `""` (never coerced to `"0"`).
 */
export function storedValueToEditString(
  key: string,
  storedValue: number | null | undefined,
  fallbackParam?: Partial<Pick<MacroParameter, 'valueType' | 'isPercentage' | 'unit'>>
): string {
  if (typeof storedValue !== 'number' || !Number.isFinite(storedValue)) {
    return '';
  }
  const spec = getMacroParameterInputSpec(key, fallbackParam);
  return formatExactNumberString(storedValue, spec.isPercentDecimal ? 2 : 0);
}

/**
 * Alias kept for backward compatibility with existing callers/tests.
 */
export function storedValueToDisplayString(
  key: string,
  storedValue: number | null | undefined,
  fallbackParam?: Partial<Pick<MacroParameter, 'valueType' | 'isPercentage' | 'unit'>>
): string {
  return storedValueToEditString(key, storedValue, fallbackParam);
}

/**
 * Creates a lossless string draft map keyed by parameter key from stored `MacroParameter[]`.
 */
export function createMacroParamDraftMap(params: MacroParameter[]): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const param of params) {
    drafts[param.key] = storedValueToEditString(param.key, param.value, param);
  }
  return drafts;
}

/**
 * Parses and validates a user-entered draft string against the central parameter registry,
 * converting percentage display input (`50` -> `0.5`) ONCE via exact base-10 decimal shifting.
 * - Accepts plain decimals and standard scientific notation (e.g., `1e-12`).
 * - Preserves full IEEE-754 precision with no `toPrecision(12)` truncation.
 * - Rejects silent underflow of non-zero inputs to 0.
 * - Never converts empty or unparseable text to 0.
 */
export function parseAndValidateMacroParameterDraft(
  key: string,
  draftText: string,
  options?: {
    fallbackParam?: Partial<
      Pick<MacroParameter, 'valueType' | 'isPercentage' | 'unit' | 'nameAr' | 'descriptionAr' | 'modeNoteAr'>
    >;
    displayLabel?: string;
    scope?: ParameterScope;
  }
): MacroParameterDraftValidationResult {
  const trimmedKey = key.trim();
  const spec = getMacroParameterInputSpec(trimmedKey, options?.fallbackParam);
  const scope: ParameterScope = options?.scope ?? 'global';
  const label =
    options?.displayLabel ||
    (options?.fallbackParam?.nameAr ? `${trimmedKey} (${options.fallbackParam.nameAr})` : trimmedKey || 'المعامل');

  if (!PARAMETER_KEY_PATTERN.test(trimmedKey)) {
    return {
      ok: false,
      code: 'invalid_key',
      errorAr: `رمز المتغير "${trimmedKey}" غير صالح؛ يجب أن يبدأ بحرف إنجليزي ويحتوي على أحرف أو أرقام أو "_" فقط.`,
      spec,
    };
  }

  if (!spec.allowedScopes.includes(scope)) {
    return {
      ok: false,
      code: 'invalid_scope',
      errorAr:
        scope === 'global'
          ? `المعامل ${label} مخصص لنطاق الشركة فقط (company_assumptions) ولا يُحفظ في المتغيرات العامة (macro_params).`
          : `المعامل ${label} لا يدعم النطاق ${scope}.`,
      spec,
    };
  }

  const trimmed = typeof draftText === 'string' ? draftText.trim() : '';
  if (trimmed === '') {
    return {
      ok: false,
      code: 'empty',
      errorAr: `الحقل فارغ للمعامل ${label}؛ أدخل قيمة صالحة (بما فيها 0 إن كان مقصوداً) أو احذف المعامل صراحةً من زر الحذف.`,
      spec,
    };
  }

  if (!STRICT_NUMBER_PATTERN.test(trimmed)) {
    return {
      ok: false,
      code: 'invalid_number',
      errorAr: `القيمة "${trimmed}" للمعامل ${label} غير صالحة؛ أدخل رقماً فقط دون رموز أو نصوص.`,
      spec,
    };
  }

  const parsedParts = parseDecimalParts(trimmed);
  if (!parsedParts) {
    return {
      ok: false,
      code: 'invalid_number',
      errorAr: `القيمة "${trimmed}" للمعامل ${label} غير صالحة.`,
      spec,
    };
  }

  const displayNumber = normalizeFiniteNumber(Number(trimmed));
  if (!Number.isFinite(displayNumber)) {
    return {
      ok: false,
      code: 'invalid_number',
      errorAr: `القيمة "${trimmed}" للمعامل ${label} ليست رقماً منتهياً صالحاً.`,
      spec,
    };
  }

  const isInputNonZero = parsedParts.digits !== '0';
  if (isInputNonZero && displayNumber === 0) {
    return {
      ok: false,
      code: 'invalid_number',
      errorAr: `القيمة "${trimmed}" للمعامل ${label} أصغر من الدقة العددية المدعومة ولا يجوز تحويلها تلقائياً إلى صفر.`,
      spec,
    };
  }

  let storedValue: number;
  if (spec.isPercentDecimal) {
    const shiftedStr = formatDecimalParts(parsedParts, -2);
    storedValue = normalizeFiniteNumber(Number(shiftedStr));
  } else {
    storedValue = displayNumber;
  }

  if (!Number.isFinite(storedValue)) {
    return {
      ok: false,
      code: 'invalid_number',
      errorAr: `القيمة المحولة للمعامل ${label} خارج النطاق العددي المنتهي.`,
      spec,
    };
  }

  if (isInputNonZero && storedValue === 0) {
    return {
      ok: false,
      code: 'invalid_number',
      errorAr: `تحويل القيمة "${trimmed}" للمعامل ${label} إلى كسر عشري يتجاوز أدنى دقة رقمية ولا يجوز حفظها كصفر.`,
      spec,
    };
  }

  if (spec.valueType === 'integer' && !Number.isInteger(storedValue)) {
    return {
      ok: false,
      code: 'not_integer',
      errorAr: `المعامل ${label} يجب أن يكون عدداً صحيحاً دون كسور.`,
      spec,
    };
  }

  if (spec.valueType === 'mode') {
    if (!Number.isInteger(storedValue) || (spec.allowedValues && !spec.allowedValues.includes(storedValue))) {
      return {
        ok: false,
        code: 'invalid_mode',
        errorAr: `المعامل ${label} يقبل القيم المعتمدة فقط: ${spec.allowedValues?.join('، ') ?? ''}.`,
        spec,
      };
    }
  }

  if (spec.minStored !== undefined && storedValue < spec.minStored) {
    const minLabel = formatBoundValue(spec.minDisplay ?? spec.minStored, spec);
    const maxLabel =
      spec.maxDisplay !== undefined || spec.maxStored !== undefined
        ? formatBoundValue(spec.maxDisplay ?? spec.maxStored!, spec)
        : null;
    const rangeHint = maxLabel ? ` (النطاق المسموح: من ${minLabel} إلى ${maxLabel})` : ` (الحد الأدنى: ${minLabel})`;
    return {
      ok: false,
      code: 'below_min',
      errorAr: `قيمة المعامل ${label} أقل من الحد الأدنى المسموح${rangeHint}.`,
      spec,
    };
  }

  if (spec.maxStored !== undefined && storedValue > spec.maxStored) {
    const maxLabel = formatBoundValue(spec.maxDisplay ?? spec.maxStored, spec);
    const minLabel =
      spec.minDisplay !== undefined || spec.minStored !== undefined
        ? formatBoundValue(spec.minDisplay ?? spec.minStored!, spec)
        : null;
    const rangeHint = minLabel ? ` (النطاق المسموح: من ${minLabel} إلى ${maxLabel})` : ` (الحد الأقصى: ${maxLabel})`;
    return {
      ok: false,
      code: 'above_max',
      errorAr: `قيمة المعامل ${label} تتجاوز الحد الأقصى المسموح${rangeHint}.`,
      spec,
    };
  }

  return {
    ok: true,
    storedValue,
    displayNumber,
    normalizedDraft: formatExactNumberString(storedValue, spec.isPercentDecimal ? 2 : 0),
    spec,
  };
}

/**
 * Validates every edited global macro parameter draft before persistence.
 * - Blocks saving completely if any parameter is empty, unparseable, out-of-bounds, or wrong scope.
 * - Never coerces empty fields to 0 and never removes parameters implicitly.
 * - Preserves canonical type metadata (`valueType`, `isPercentage`, `parameterTypeSource`)
 *   without fabricating a type for legacy unspecified custom records and without auto-enabling
 *   custom parameters in the valuation engine.
 */
export function prepareMacroParamsForSave(
  editableParams: MacroParameter[],
  drafts: Record<string, string>
): PrepareMacroParamsResult {
  const fieldErrors: Record<string, string> = {};
  const nextParams: MacroParameter[] = [];

  for (const param of editableParams) {
    const draftText = Object.prototype.hasOwnProperty.call(drafts, param.key)
      ? drafts[param.key]
      : storedValueToEditString(param.key, param.value, param);

    const validation = parseAndValidateMacroParameterDraft(param.key, draftText, {
      fallbackParam: param,
      scope: 'global',
    });

    if (!validation.ok) {
      fieldErrors[param.key] = validation.errorAr;
      continue;
    }

    const spec = validation.spec;
    nextParams.push({
      ...param,
      value: validation.storedValue,
      valueType: spec.resolvedValueType,
      isPercentage: spec.resolvedIsPercentage,
      parameterTypeSource: spec.typeSource,
      unit: param.unit || spec.storageUnit,
      enabledInEngine: spec.isCataloged
        ? (param.enabledInEngine ?? spec.definition?.enabledInEngine ?? true)
        : false,
      ...(RF_METHODOLOGY_KEYS.has(param.key)
        ? { rfMethodology: normalizeRfMethodology(param.rfMethodology) }
        : {}),
    });
  }

  const errorKeys = Object.keys(fieldErrors);
  if (errorKeys.length > 0) {
    const firstKey = errorKeys[0];
    const summaryErrorAr =
      errorKeys.length === 1
        ? fieldErrors[firstKey]
        : `تعذر الحفظ لوجود ${errorKeys.length} حقول غير صالحة (${errorKeys.join('، ')}). راجع الأخطاء المحددة بجانب كل متغير قبل إعادة المحاولة.`;
    return {
      ok: false,
      fieldErrors,
      errorCount: errorKeys.length,
      summaryErrorAr,
    };
  }

  return {
    ok: true,
    params: nextParams,
    fieldErrors: {},
  };
}

/**
 * Validates and constructs a new global `MacroParameter` from modal draft inputs
 * using the exact same central parameter type contract and `% -> decimal` conversion as editing.
 * Custom parameters always have `enabledInEngine: false`.
 */
export function buildNewMacroParameterFromDraft(input: BuildNewMacroParamInput): BuildNewMacroParamResult {
  const trimmedKey = input.key.trim();
  const trimmedNameAr = input.nameAr.trim();
  const def = trimmedKey ? getParameterDefinition(trimmedKey) : null;

  const explicitCustomType: ParameterValueType =
    input.customValueType ?? (input.customIsPercentDecimal ? 'pct' : 'number');

  const fallbackMeta: Partial<MacroParameter> = def
    ? {
        nameAr: trimmedNameAr || def.nameAr,
        descriptionAr: def.descriptionAr,
        valueType: def.valueType,
        isPercentage: def.valueType === 'pct' || def.isPercentage === true,
        unit: def.unit,
      }
    : {
        nameAr: trimmedNameAr,
        valueType: explicitCustomType,
        isPercentage: explicitCustomType === 'pct',
        unit:
          explicitCustomType === 'pct'
            ? 'decimal'
            : explicitCustomType === 'multiple'
            ? 'multiple'
            : 'number',
      };

  const spec = getMacroParameterInputSpec(trimmedKey, fallbackMeta);

  if (!trimmedNameAr) {
    return {
      ok: false,
      code: 'missing_name',
      errorAr: 'يرجى إدخال التسمية العربية للمتغير قبل الحفظ.',
      spec,
    };
  }

  const validation = parseAndValidateMacroParameterDraft(trimmedKey, input.draftValue, {
    fallbackParam: fallbackMeta,
    displayLabel: `${trimmedKey} (${trimmedNameAr})`,
    scope: 'global',
  });

  if (!validation.ok) {
    return {
      ok: false,
      code: validation.code,
      errorAr: validation.errorAr,
      spec: validation.spec,
    };
  }

  const param: MacroParameter = {
    key: trimmedKey,
    nameAr: def?.nameAr || trimmedNameAr,
    descriptionAr:
      input.descriptionAr?.trim() || def?.descriptionAr || 'متغير كلي مضاف عبر لوحة الإدارة',
    value: validation.storedValue,
    category: def?.category || 'macro_inflation',
    valueType: validation.spec.resolvedValueType,
    isPercentage: validation.spec.resolvedIsPercentage,
    parameterTypeSource: validation.spec.typeSource,
    unit: validation.spec.storageUnit,
    enabledInEngine: def ? def.enabledInEngine : false,
    ...(def?.modeNoteAr ? { modeNoteAr: def.modeNoteAr } : {}),
    ...(RF_METHODOLOGY_KEYS.has(trimmedKey)
      ? { rfMethodology: normalizeRfMethodology(input.rfMethodology) }
      : {}),
  };

  return {
    ok: true,
    param,
    normalizedDraft: validation.normalizedDraft,
    spec: validation.spec,
  };
}

/**
 * Returns registry definitions eligible for global `macro_params` that are not yet present.
 */
export function getMissingGlobalParameterDefinitions(existingParams: MacroParameter[]): ParameterRegistryDefinition[] {
  const existingKeys = new Set(existingParams.map((p) => p.key));
  return PARAMETER_REGISTRY.filter(
    (def) => def.allowedScopes.includes('global') && !existingKeys.has(def.key)
  );
}
