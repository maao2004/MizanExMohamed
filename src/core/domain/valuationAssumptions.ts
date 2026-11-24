/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BetaAssumptionRecord,
  CompanyParameterOverride,
  DailyTradingRecord,
  MacroParameter,
  QuarterlyFinancialRecord,
} from '../../types';
import {
  AmountUnit,
  AssumptionPriority,
  BetaStatus,
  Company,
  CurrencyCode,
  CurrencyResolutionStatus,
  FinancialMetricsTTM,
  MarketPriceSource,
  ModelEligibilityStatus,
  ModelWeightsBreakdown,
  ResolvedAssumption,
  RfMethodologyClassification,
  SectorClassification,
  SectorDefinition,
  SectorPeConflictEntry,
  SectorPeLoadStatus,
  SharesUnit,
  TerminalValueMethod,
  ValuationResults,
  ValuationSourcesSummary,
} from '../../types/financial';
import {
  getParameterDefinition,
  normalizeRfMethodology,
  normalizeStrictCurrency,
  resolveSectorPeFromMap,
  resolveUnifiedSector,
  tryNormalizedTicker,
} from '../contracts';
import {
  DIVIDEND_DATE_POLICY_NOTE_AR,
  RIM_RETENTION_SELECTION_RULE_NOTE_AR,
} from './dividendAnalytics';

const finiteOrNull = (val: unknown): number | null =>
  typeof val === 'number' && Number.isFinite(val) ? val : null;

const positiveFiniteOrNull = (val: unknown): number | null =>
  typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;

export function normalizeCurrencyCode(
  currency?: string | null
): CurrencyCode | 'UNSUPPORTED' | 'MISSING' {
  const res = normalizeStrictCurrency(currency);
  if (res.status === 'valid' && res.code) return res.code;
  if (res.status === 'unsupported') return 'UNSUPPORTED';
  return 'MISSING';
}

export function deriveFinancialCurrencyAndUnit(
  records: ReadonlyArray<{
    year?: number;
    quarter?: string;
    financialUnit?: string | null;
    financialCurrency?: string | null;
  }>
): {
  currency: CurrencyCode | 'UNSUPPORTED' | null;
  status: CurrencyResolutionStatus;
  amountUnit: AmountUnit;
  rawCurrency: string | null;
  conflictReasonAr: string | null;
} {
  if (!records || records.length === 0) {
    return {
      currency: null,
      status: 'missing',
      amountUnit: 'unspecified',
      rawCurrency: null,
      conflictReasonAr: null,
    };
  }
  const ordered = [...records].sort(
    (a, b) => (a.year ?? 0) - (b.year ?? 0) || (QUARTER_ORDER[a.quarter ?? ''] ?? 0) - (QUARTER_ORDER[b.quarter ?? ''] ?? 0)
  );
  const currencies = new Set<string>();
  let perRecordUnitConflict: string | null = null;
  for (const r of ordered) {
    const unitUpper = r.financialUnit ? String(r.financialUnit).trim().toUpperCase() : '';
    const unitCur: 'EGP' | 'USD' | null =
      unitUpper.startsWith('USD') ? 'USD' : unitUpper.startsWith('EGP') ? 'EGP' : null;
    if (r.financialCurrency) {
      const n = normalizeCurrencyCode(r.financialCurrency);
      currencies.add(n);
      if ((n === 'EGP' || n === 'USD') && unitCur && n !== unitCur) {
        perRecordUnitConflict = `تعارض بين عملة القوائم (${n}) ووحدة القياس (${r.financialUnit}).`;
      }
    } else if (unitCur) {
      currencies.add(unitCur);
    }
  }
  if (perRecordUnitConflict) {
    return {
      currency: 'UNSUPPORTED',
      status: 'unsupported',
      amountUnit: 'unspecified',
      rawCurrency: ordered.at(-1)?.financialCurrency ?? null,
      conflictReasonAr: perRecordUnitConflict,
    };
  }
  if (currencies.has('UNSUPPORTED')) {
    return {
      currency: 'UNSUPPORTED',
      status: 'unsupported',
      amountUnit: 'unspecified',
      rawCurrency: ordered.at(-1)?.financialCurrency ?? null,
      conflictReasonAr: 'عملة القوائم المالية المسجلة في quarterly_financial_records غير مدعومة (المدعوم EGP أو USD فقط).',
    };
  }
  if (currencies.size > 1) {
    return {
      currency: 'UNSUPPORTED',
      status: 'unsupported',
      amountUnit: 'unspecified',
      rawCurrency: null,
      conflictReasonAr: 'تضارب عملات القوائم عبر فترات quarterly_financial_records لنفس السهم.',
    };
  }
  const latest = ordered.at(-1)!;
  const rawLatestUnit = latest.financialUnit ? String(latest.financialUnit).trim() : '';
  const resolvedUnit: AmountUnit =
    rawLatestUnit === 'USD_millions' ||
    rawLatestUnit === 'EGP_millions' ||
    rawLatestUnit === 'base' ||
    rawLatestUnit === 'EGP_base' ||
    rawLatestUnit === 'USD_base'
      ? rawLatestUnit
      : 'unspecified';

  const latestUnitUpper = rawLatestUnit.toUpperCase();
  const latestCurrencyRaw =
    latest.financialCurrency ??
    (latestUnitUpper.startsWith('USD') ? 'USD' : latestUnitUpper.startsWith('EGP') ? 'EGP' : null);
  const normalized = normalizeCurrencyCode(latestCurrencyRaw);
  if (normalized === 'EGP' || normalized === 'USD') {
    return {
      currency: normalized,
      status: 'valid',
      amountUnit: resolvedUnit === 'unspecified' ? 'base' : resolvedUnit,
      rawCurrency: latestCurrencyRaw,
      conflictReasonAr: null,
    };
  }
  if (normalized === 'UNSUPPORTED') {
    return {
      currency: 'UNSUPPORTED',
      status: 'unsupported',
      amountUnit: 'unspecified',
      rawCurrency: latestCurrencyRaw,
      conflictReasonAr: `عملة القوائم المالية غير مدعومة (${String(latestCurrencyRaw)}).`,
    };
  }
  return {
    currency: null,
    status: 'missing',
    amountUnit: resolvedUnit,
    rawCurrency: null,
    conflictReasonAr: null,
  };
}

export const RIM_METHODOLOGY_NOTE_AR =
  'يعتمد نموذج الدخل المتبقي (RIM) أفق توقع صريحاً من 5 سنوات باستخدام RIM_Expected_ROE (أو العائد التاريخي للأسهم العادية عند غيابه) ونسبة الاحتجاز المختارة، متبوعاً بطريقة قيمة نهائية صريحة (RIM_Terminal_Method: 1=بقاء الدخل المتبقي دائماً، 2=تلاشي ROE تدريجياً، 3=استمرار ROE ونمو القيمة الدفترية) دون أي افتراضات صامتة.';

/**
 * فصل صارم بين «قطاع غير معروف» و«شركة غير مالية» و«قطاع مالي / بنوك» عبر سجل القطاعات الموحّد (sectorPE).
 * لا يتم افتراض كون الشركة غير مالية تلقائياً عند غياب التصنيف الموثق أو تعذر تحميل sectorPE.
 */
export function classifyCompanySector(
  sector?: string | null,
  explicitClassification?: SectorClassification | null,
  options?: {
    sectorId?: string | null;
    sectorDefinitions?: SectorDefinition[] | null;
    sectorPeConfirmed?: boolean;
    sectorPeStatus?: SectorPeLoadStatus;
  }
): SectorClassification {
  return resolveUnifiedSector(sector, explicitClassification, options).classification;
}

export function getSectorClassificationLabelAr(classification: SectorClassification): string {
  switch (classification) {
    case 'non_financial':
      return 'شركة غير مالية (مؤهلة لـ DCF عند توفر FCFF)';
    case 'financial':
      return 'قطاع مالي / بنوك (DCF مستبعد)';
    default:
      return 'قطاع غير معروف (يلزم تحديد التصنيف قبل تشغيل DCF)';
  }
}

/**
 * اشتقاق السعر السوقي عند القراءة/العرض فقط مع توثيق نوع السعر وتاريخه،
 * دون استبدال أو كتابة lastPrice داخل حقل closePrice في قاعدة البيانات.
 */
export function resolveMarketPriceFromDaily(daily?: DailyTradingRecord | null): {
  price: number | null;
  source: MarketPriceSource | null;
  tradeDate: string | null;
} {
  if (!daily) {
    return { price: null, source: null, tradeDate: null };
  }
  const lastPrice = positiveFiniteOrNull(daily.lastPrice);
  if (lastPrice !== null) {
    return { price: lastPrice, source: 'lastPrice', tradeDate: daily.tradeDate };
  }
  const closePrice = positiveFiniteOrNull(daily.closePrice);
  if (closePrice !== null) {
    return { price: closePrice, source: 'closePrice', tradeDate: daily.tradeDate };
  }
  return { price: null, source: null, tradeDate: daily.tradeDate ?? null };
}

export interface BetaResolutionResult {
  ticker: string;
  betaRaw: number | null;
  status: BetaStatus;
  asOfDate: string | null;
  source: string | null;
  noteAr: string;
  policyConflictAr?: string | null;
  macroBetaDefaultValue?: number | null;
}

/**
 * حسم بيتا الخام (Beta Raw) بصرامة:
 * - عند توفر سجل صالح في beta_assumptions (بما فيه 0 أو السالب) => actual.
 * - عند تعذر تأكيد المجموعة أو خطأ الاتصال/الصلاحية/تلف السجل => unavailable_error (بيتا null، لا تُستخدم 1 أبداً).
 * - فقط عند تأكيد الخادم لسلامة المجموعة وعدم وجود سجل للسهم => defaulted_missing (= 1.00 وفق سياسة المنصة؛ وإذا وجدت Beta_Default != 1 في macro_params يُسجل تعارض صريح).
 */
export function resolveBetaAssumption(params: {
  ticker: string;
  betaRecord?: BetaAssumptionRecord | null;
  betaConfirmed: boolean;
  betaError?: string | null;
  globalBetaDefault?: number | null;
}): BetaResolutionResult {
  const tk = tryNormalizedTicker(params.ticker) || params.ticker.toUpperCase();
  const defaultVal = finiteOrNull(params.globalBetaDefault);
  const hasMacroBetaConflict = defaultVal !== null && Math.abs(defaultVal - 1) > 1e-9;
  const policyConflictAr = hasMacroBetaConflict
    ? `تعارض سياسة بيتا في macro_params: المعامل العام Beta_Default محفوظ بقيمة (${defaultVal}) تخالف السياسة القياسية المعتمدة (1.00 عند تأكيد غياب السجل)؛ تم الالتزام بالقيمة 1.00 مع ضرورة مراجعة macro_params.`
    : null;

  if (params.betaError || !params.betaConfirmed) {
    return {
      ticker: tk,
      betaRaw: null,
      status: 'unavailable_error',
      asOfDate: null,
      source: null,
      noteAr: params.betaError
        ? `تعذر تأكيد سجل بيتا من الخادم (${params.betaError})؛ لم يتم تطبيق البيتا الافتراضية 1.`
        : 'سجل بيتا في beta_assumptions قيد التأكيد من الخادم ولم يتم افتراض 1.',
      policyConflictAr,
      macroBetaDefaultValue: defaultVal,
    };
  }

  const rec = params.betaRecord;
  if (rec) {
    if (typeof rec.beta === 'number' && Number.isFinite(rec.beta)) {
      return {
        ticker: tk,
        betaRaw: Object.is(rec.beta, -0) ? 0 : rec.beta,
        status: 'actual',
        asOfDate: rec.asOfDate || null,
        source: rec.source || 'beta_assumptions',
        noteAr: `بيتا فعلية موثقة من beta_assumptions (${rec.source || 'غير محدد'} — ${rec.asOfDate || 'بدون تاريخ'})`,
        policyConflictAr,
        macroBetaDefaultValue: defaultVal,
      };
    }
    return {
      ticker: tk,
      betaRaw: null,
      status: 'unavailable_error',
      asOfDate: rec.asOfDate || null,
      source: rec.source || null,
      noteAr: 'سجل بيتا الموجود للسهم تالف أو يحتوي قيمة غير رقمية؛ لم يتم استبداله بـ 1.',
      policyConflictAr,
      macroBetaDefaultValue: defaultVal,
    };
  }

  return {
    ticker: tk,
    betaRaw: 1,
    status: 'defaulted_missing',
    asOfDate: null,
    source: 'سياسة المنصة القياسية (1.00 عند تأكيد غياب السجل)',
    noteAr: `بيتا مفترضة = 1 بعد تأكيد الخادم عدم وجود سجل للسهم ${tk} في beta_assumptions.`,
    policyConflictAr,
    macroBetaDefaultValue: defaultVal,
  };
}

export interface ResolvedAssumptionBundle {
  priority: AssumptionPriority;
  map: Record<string, ResolvedAssumption>;
  list: ResolvedAssumption[];
  invalidGlobalParameters: Array<{ key: string; reasonAr: string }>;
}

interface PairMeta {
  asOfDate?: string | null;
  source?: string | null;
  rfMethodology?: RfMethodologyClassification;
  unit?: string | null;
  currency?: CurrencyCode | null;
  forecastHorizonYears?: number | null;
}

function resolvePair(params: {
  key: string;
  registryKey?: string;
  labelAr: string;
  companyValue: number | null;
  globalValue: number | null;
  priority: AssumptionPriority;
  unitOrFormat?: ResolvedAssumption['unitOrFormat'];
  companyMeta?: PairMeta;
  globalMeta?: PairMeta;
}): ResolvedAssumption {
  const cVal = finiteOrNull(params.companyValue);
  const gVal = finiteOrNull(params.globalValue);
  const def = params.registryKey ? getParameterDefinition(params.registryKey) : null;
  const enabledInEngine = def ? def.enabledInEngine : true;
  const modeNoteAr = def?.modeNoteAr;

  const companyDocumentarySource =
    typeof params.companyMeta?.source === 'string' && params.companyMeta.source.trim()
      ? params.companyMeta.source.trim()
      : null;
  const companyAsOfDate =
    typeof params.companyMeta?.asOfDate === 'string' && params.companyMeta.asOfDate.trim()
      ? params.companyMeta.asOfDate.trim()
      : null;
  const globalDocumentarySource =
    typeof params.globalMeta?.source === 'string' && params.globalMeta.source.trim()
      ? params.globalMeta.source.trim()
      : null;
  const globalAsOfDate =
    typeof params.globalMeta?.asOfDate === 'string' && params.globalMeta.asOfDate.trim()
      ? params.globalMeta.asOfDate.trim()
      : null;

  const sharedScopeMeta = {
    registryKey: params.registryKey,
    companyAsOfDate: cVal !== null ? companyAsOfDate : null,
    companyParameterSource: cVal !== null ? companyDocumentarySource : null,
    globalAsOfDate: gVal !== null ? globalAsOfDate : null,
    globalParameterSource: gVal !== null ? globalDocumentarySource : null,
  };

  if (params.priority === 'global_first') {
    if (gVal !== null) {
      return {
        key: params.key,
        ...sharedScopeMeta,
        labelAr: params.labelAr,
        value: gVal,
        source: 'global',
        companyValue: cVal,
        globalValue: gVal,
        isOverriddenByPriority: cVal !== null && cVal !== gVal,
        unitOrFormat: params.unitOrFormat,
        unit: params.globalMeta?.unit ?? null,
        currency: params.globalMeta?.currency ?? null,
        forecastHorizonYears: params.globalMeta?.forecastHorizonYears ?? null,
        asOfDate: globalAsOfDate,
        parameterSource: globalDocumentarySource,
        enabledInEngine,
        modeNoteAr,
        rfMethodology: params.globalMeta?.rfMethodology,
      };
    }
    if (cVal !== null) {
      return {
        key: params.key,
        ...sharedScopeMeta,
        labelAr: params.labelAr,
        value: cVal,
        source: 'company',
        companyValue: cVal,
        globalValue: null,
        isOverriddenByPriority: false,
        unitOrFormat: params.unitOrFormat,
        unit: params.companyMeta?.unit ?? null,
        currency: params.companyMeta?.currency ?? null,
        forecastHorizonYears: params.companyMeta?.forecastHorizonYears ?? null,
        asOfDate: companyAsOfDate,
        parameterSource: companyDocumentarySource,
        enabledInEngine,
        modeNoteAr,
        rfMethodology: params.companyMeta?.rfMethodology,
      };
    }
    return {
      key: params.key,
      ...sharedScopeMeta,
      labelAr: params.labelAr,
      value: null,
      source: 'missing',
      companyValue: null,
      globalValue: null,
      isOverriddenByPriority: false,
      unitOrFormat: params.unitOrFormat,
      asOfDate: null,
      parameterSource: null,
      enabledInEngine,
      modeNoteAr,
    };
  }

  // company_first
  if (cVal !== null) {
    return {
      key: params.key,
      ...sharedScopeMeta,
      labelAr: params.labelAr,
      value: cVal,
      source: 'company',
      companyValue: cVal,
      globalValue: gVal,
      isOverriddenByPriority: false,
      unitOrFormat: params.unitOrFormat,
      unit: params.companyMeta?.unit ?? null,
      currency: params.companyMeta?.currency ?? null,
      forecastHorizonYears: params.companyMeta?.forecastHorizonYears ?? null,
      asOfDate: companyAsOfDate,
      parameterSource: companyDocumentarySource,
      enabledInEngine,
      modeNoteAr,
      rfMethodology: params.companyMeta?.rfMethodology,
    };
  }
  if (gVal !== null) {
    return {
      key: params.key,
      ...sharedScopeMeta,
      labelAr: params.labelAr,
      value: gVal,
      source: 'global',
      companyValue: null,
      globalValue: gVal,
      isOverriddenByPriority: false,
      unitOrFormat: params.unitOrFormat,
      unit: params.globalMeta?.unit ?? null,
      currency: params.globalMeta?.currency ?? null,
      forecastHorizonYears: params.globalMeta?.forecastHorizonYears ?? null,
      asOfDate: globalAsOfDate,
      parameterSource: globalDocumentarySource,
      enabledInEngine,
      modeNoteAr,
      rfMethodology: params.globalMeta?.rfMethodology,
    };
  }
  return {
    key: params.key,
    ...sharedScopeMeta,
    labelAr: params.labelAr,
    value: null,
    source: 'missing',
    companyValue: null,
    globalValue: null,
    isOverriddenByPriority: false,
    unitOrFormat: params.unitOrFormat,
    asOfDate: null,
    parameterSource: null,
    enabledInEngine,
    modeNoteAr,
  };
}

function readCompanyOverride(
  overrides: Record<string, CompanyParameterOverride | number> | undefined,
  key: string
): {
  value: number | null;
  asOfDate?: string | null;
  source?: string | null;
  rfMethodology?: RfMethodologyClassification;
  unit?: string | null;
  currency?: CurrencyCode | null;
  forecastHorizonYears?: number | null;
} {
  if (!overrides || !(key in overrides)) return { value: null };
  const entry = overrides[key];
  if (typeof entry === 'number') {
    return { value: finiteOrNull(entry), asOfDate: null, source: null };
  }
  if (entry && typeof entry === 'object' && !entry.isDeleted) {
    const parsedCurrency = entry.currency ? normalizeCurrencyCode(entry.currency) : 'MISSING';
    const docSource =
      typeof entry.source === 'string' && entry.source.trim().length > 0
        ? entry.source.trim()
        : null;
    const docDate =
      typeof entry.asOfDate === 'string' && entry.asOfDate.trim().length > 0
        ? entry.asOfDate.trim()
        : null;
    return {
      value: finiteOrNull(entry.value),
      asOfDate: docDate,
      source: docSource,
      rfMethodology: entry.rfMethodology ? normalizeRfMethodology(entry.rfMethodology) : undefined,
      unit: entry.unit ?? null,
      currency: parsedCurrency === 'EGP' || parsedCurrency === 'USD' ? parsedCurrency : null,
      forecastHorizonYears:
        typeof entry.forecastHorizonYears === 'number' && Number.isInteger(entry.forecastHorizonYears)
          ? entry.forecastHorizonYears
          : null,
    };
  }
  return { value: null };
}

/**
 * طبقة موحدة لحسم افتراضات التقييم ومصادرها عبر جميع الشاشات والمحرك والتصدير.
 */
export function resolveValuationAssumptions(params: {
  company: Pick<
    Company,
    | 'sector'
    | 'rawSector'
    | 'sectorId'
    | 'beta'
    | 'riskFreeRate'
    | 'equityRiskPremium'
    | 'costOfDebt'
    | 'taxRate'
    | 'sustainableGrowthRate'
    | 'targetPE'
    | 'targetPB'
  >;
  paramsMap: Record<string, number>;
  companyOverridesMap?: Record<string, CompanyParameterOverride | number>;
  macroMetaMap?: Record<
    string,
    Pick<
      MacroParameter,
      'asOfDate' | 'source' | 'enabledInEngine' | 'rfMethodology' | 'unit' | 'currency' | 'forecastHorizonYears'
    >
  >;
  betaMeta?: { asOfDate?: string | null; source?: string | null };
  sectorPEMap?: Record<string, number>;
  sectorDefinitions?: SectorDefinition[] | null;
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
  priority?: AssumptionPriority;
  disableLegacyCompanyFallback?: boolean;
}): ResolvedAssumptionBundle & {
  sectorPeMatchedKey: string | null;
  sectorPeLookupReasonAr: string;
  sectorPeConflictDetected: boolean;
  sectorPeConflictingEntries?: SectorPeConflictEntry[];
  sectorPeConfirmed: boolean;
  sectorPeStatus: SectorPeLoadStatus;
} {
  const priority: AssumptionPriority = params.priority ?? 'company_first';
  const pm = params.paramsMap || {};
  const co = params.companyOverridesMap;
  const gm = params.macroMetaMap || {};
  const disableLegacyFallback = params.disableLegacyCompanyFallback ?? co !== undefined;
  const invalidGlobalParameters: Array<{ key: string; reasonAr: string }> = [];

  if ('Projected_Terminal_EBITDA' in pm || 'Projected_Terminal_EBITDA' in gm) {
    invalidGlobalParameters.push({
      key: 'Projected_Terminal_EBITDA',
      reasonAr:
        'معامل Projected_Terminal_EBITDA مخصص لنطاق الشركة فقط (scope=company)؛ تم تجاهل القيمة العامة الموجودة في macro_params.',
    });
  }

  const sectorPeConfirmed = params.sectorPeConfirmed ?? true;
  const sectorPeStatus: SectorPeLoadStatus =
    params.sectorPeStatus ?? (sectorPeConfirmed ? 'ready' : 'error');

  const sectorPeLookup = resolveSectorPeFromMap(
    params.sectorPEMap,
    params.company.rawSector ?? params.company.sector,
    params.company.sectorId ?? null,
    params.sectorDefinitions,
    sectorPeConfirmed,
    sectorPeStatus
  );
  const sectorPeGlobal = finiteOrNull(sectorPeLookup.multiple);

  const getGlobal = (k: string) => {
    const def = getParameterDefinition(k);
    if (def && !def.allowedScopes.includes('global')) {
      return { val: null, meta: undefined };
    }
    const metaRaw = gm[k];
    const parsedCurrency = metaRaw?.currency ? normalizeCurrencyCode(metaRaw.currency) : 'MISSING';
    return {
      val: finiteOrNull(pm[k]),
      meta: metaRaw
        ? {
            asOfDate: metaRaw.asOfDate ?? null,
            source: metaRaw.source ?? null,
            rfMethodology: metaRaw.rfMethodology ? normalizeRfMethodology(metaRaw.rfMethodology) : undefined,
            unit: metaRaw.unit ?? null,
            currency: parsedCurrency === 'EGP' || parsedCurrency === 'USD' ? parsedCurrency : null,
            forecastHorizonYears:
              typeof metaRaw.forecastHorizonYears === 'number' && Number.isInteger(metaRaw.forecastHorizonYears)
                ? metaRaw.forecastHorizonYears
                : null,
          }
        : undefined,
    };
  };

  const pairFromRegistry = (
    resolvedKey: string,
    registryKey: string,
    labelAr: string,
    unitOrFormat: ResolvedAssumption['unitOrFormat'],
    legacyCompanyVal: number | null = null,
    overrideGlobal?: { val: number | null; meta?: PairMeta }
  ) => {
    const ov = readCompanyOverride(co, registryKey);
    const gl = overrideGlobal ?? getGlobal(registryKey);
    const cVal =
      ov.value !== null
        ? ov.value
        : disableLegacyFallback
        ? null
        : finiteOrNull(legacyCompanyVal);
    return resolvePair({
      key: resolvedKey,
      registryKey,
      labelAr,
      companyValue: cVal,
      globalValue: gl.val,
      priority,
      unitOrFormat,
      companyMeta:
        ov.value !== null
          ? {
              asOfDate: ov.asOfDate,
              source: ov.source,
              rfMethodology: ov.rfMethodology,
              unit: ov.unit,
              currency: ov.currency,
              forecastHorizonYears: ov.forecastHorizonYears,
            }
          : undefined,
      globalMeta: gl.meta,
    });
  };

  const list: ResolvedAssumption[] = [
    pairFromRegistry('riskFreeRate', 'Rf_Egypt_10Y', 'العائد الخالي من المخاطر (Rf_Egypt_10Y)', 'pct', params.company.riskFreeRate),
    pairFromRegistry('riskFreeRateUSD', 'Rf_USD_10Y', 'عائد الخزانة الأمريكية (Rf_USD_10Y)', 'pct', null),
    pairFromRegistry('equityRiskPremium', 'ERP_Developed', 'علاوة مخاطر السوق (ERP_Developed)', 'pct', params.company.equityRiskPremium),
    pairFromRegistry('countryRiskPremium', 'CRP_Egypt', 'علاوة مخاطر الدولة (CRP_Egypt)', 'pct', null),
    pairFromRegistry('countryRiskLambda', 'Country_Risk_Lambda', 'معامل التعرض لمخاطر الدولة (Lambda)', 'number', null),
    resolvePair({
      key: 'beta',
      labelAr: 'بيتا السهم الخام (Beta Raw)',
      companyValue: params.company.beta,
      globalValue: null,
      priority: 'company_first',
      unitOrFormat: 'number',
      companyMeta: params.betaMeta,
    }),
    pairFromRegistry('betaAnalytical', 'Beta_Analytical', 'تقدير بيتا التحليلي الاختياري (Beta_Analytical)', 'number', null),
    pairFromRegistry('betaDefault', 'Beta_Default', 'سياسة بيتا الافتراضية عند تأكيد الغياب (Beta_Default)', 'number', null),
    pairFromRegistry('betaRawWeight', 'Beta_Raw_Weight', 'وزن بيتا التاريخية (Beta_Raw_Weight)', 'number', null),
    pairFromRegistry('betaAnchor', 'Beta_Anchor', 'نقطة ارتكاز بيتا (Beta_Anchor)', 'number', null),
    pairFromRegistry('rMode', 'r_Mode', 'نمط معدل الخصم r (r_Mode: 1=EG+CRP | 2=USD | 3=EG بدون CRP)', 'mode', null),
    pairFromRegistry('waccMode', 'WACC_Mode', 'نمط حساب WACC (WACC_Mode: 1=EG+CRP | 2=EG بدون CRP | 3=USD)', 'mode', null),
    pairFromRegistry('costOfDebt', 'Cost_of_Debt', 'تكلفة الدين قبل الضريبة (Cost_of_Debt)', 'pct', params.company.costOfDebt),
    pairFromRegistry('taxRate', 'TaxRate', 'معدل الضريبة الهامشي (TaxRate)', 'pct', params.company.taxRate),
    pairFromRegistry('terminalGrowth', 'Terminal_Growth', 'النمو النهائي المستدام (Terminal_Growth)', 'pct', params.company.sustainableGrowthRate),
    pairFromRegistry('exitMultiple', 'Exit_Multiple', 'مضاعف الخروج النهائي (Exit_Multiple)', 'multiple', null),
    pairFromRegistry('projectedTerminalEbitda', 'Projected_Terminal_EBITDA', 'EBITDA النهائية المتوقعة (Projected_Terminal_EBITDA)', 'number', null),
    pairFromRegistry('ebitdaGrowthRate', 'EBITDA_Growth_Rate', 'نمو EBITDA السنوي (EBITDA_Growth_Rate)', 'pct', null),
    pairFromRegistry('forecastYears', 'Forecast_Years', 'عدد سنوات التوقع في DCF (Forecast_Years)', 'number', null),
    pairFromRegistry('ddmGrowth', 'DDM_Growth', 'نمو التوزيعات (DDM_Growth)', 'pct', null),
    pairFromRegistry('rimRetention', 'RIM_Retention', 'نسبة احتجاز الأرباح (RIM_Retention)', 'pct', null),
    pairFromRegistry('rimExpectedRoe', 'RIM_Expected_ROE', 'العائد المستقبلي المتوقع في RIM (RIM_Expected_ROE)', 'pct', null),
    pairFromRegistry('rimTerminalMethod', 'RIM_Terminal_Method', 'طريقة القيمة النهائية في RIM (1=بقاء RI، 2=تلاشي ROE، 3=نمو g_B)', 'mode', null),
    pairFromRegistry('rimTerminalRoe', 'RIM_Terminal_ROE', 'العائد النهائي المستدام في RIM (RIM_Terminal_ROE)', 'pct', null),
    pairFromRegistry('rimTerminalRetention', 'RIM_Terminal_Retention', 'نسبة الاحتجاز النهائية في RIM (RIM_Terminal_Retention)', 'pct', null),
    pairFromRegistry('rimFadeYears', 'RIM_Fade_Years', 'عدد سنوات تلاشي ROE في RIM (RIM_Fade_Years)', 'number', null),
    pairFromRegistry(
      'targetPE',
      'Target_PE',
      'مضاعف الربحية المستهدف (P/E)',
      'multiple',
      params.company.targetPE,
      {
        val: sectorPeGlobal,
        meta: sectorPeLookup.matchedKey
          ? { source: `مضاعف القطاع (${sectorPeLookup.matchedKey})` }
          : undefined,
      }
    ),
    pairFromRegistry('targetPB', 'Target_PB', 'مضاعف القيمة الدفترية (P/B)', 'multiple', params.company.targetPB, {
      val: null,
    }),
    pairFromRegistry(
      'relativePeWeight',
      'Relative_PE_Weight',
      getParameterDefinition('Relative_PE_Weight')?.nameAr ??
        'وزن دمج قيمة P/E في التقييم النسبي (Relative_PE_Weight)',
      'number',
      null
    ),
    pairFromRegistry(
      'relativePbWeight',
      'Relative_PB_Weight',
      getParameterDefinition('Relative_PB_Weight')?.nameAr ??
        'وزن دمج قيمة P/B في التقييم النسبي (Relative_PB_Weight)',
      'number',
      null
    ),
    pairFromRegistry('usDefaultSpread', 'US_Default_Spread', 'هامش تعثر الولايات المتحدة (غير مفعّل حسابياً)', 'pct', null),
    pairFromRegistry('sovereignDefaultSpread', 'Sovereign_Default_Spread', 'هامش التعثر السيادي لمصر (توثيقي فقط — غير مفعّل)', 'pct', null),
    pairFromRegistry('inflationEgyptLt', 'Inflation_Egypt_LT', 'التضخم طويل الأجل — مصر (غير مفعّل حسابياً)', 'pct', null),
    pairFromRegistry('inflationUsLt', 'Inflation_US_LT', 'التضخم طويل الأجل — أمريكا (غير مفعّل حسابياً)', 'pct', null),
  ];

  // Add Growth_Y1..Growth_YN and EBITDA_Growth_Y1..YN up to Forecast_Years (or 5 minimum for visibility)
  const fyCandidate = list.find((item) => item.key === 'forecastYears')?.value ?? null;
  const growthHorizon =
    typeof fyCandidate === 'number' && Number.isInteger(fyCandidate) && fyCandidate >= 1 && fyCandidate <= 20
      ? fyCandidate
      : 5;
  for (let yr = 1; yr <= growthHorizon; yr++) {
    list.push(
      pairFromRegistry(
        `growthY${yr}`,
        `Growth_Y${yr}`,
        `نمو تدفق FCFF المتوقع — السنة ${yr} (Growth_Y${yr})`,
        'pct',
        null
      )
    );
    list.push(
      pairFromRegistry(
        `ebitdaGrowthY${yr}`,
        `EBITDA_Growth_Y${yr}`,
        `نمو EBITDA المتوقع — السنة ${yr} (EBITDA_Growth_Y${yr})`,
        'pct',
        null
      )
    );
  }

  const map: Record<string, ResolvedAssumption> = {};
  for (const item of list) {
    map[item.key] = item;
  }

  return {
    priority,
    list,
    map,
    invalidGlobalParameters,
    sectorPeMatchedKey: sectorPeLookup.matchedKey,
    sectorPeLookupReasonAr: sectorPeLookup.reasonAr,
    sectorPeConflictDetected: Boolean(sectorPeLookup.conflictDetected),
    sectorPeConflictingEntries: sectorPeLookup.conflictingEntries,
    sectorPeConfirmed,
    sectorPeStatus,
  };
}

const QUARTER_ORDER: Record<string, number> = {
  Q1: 1,
  Q2: 2,
  Q3: 3,
  FY: 4,
};

const INACTIVE_KEYS = new Set([
  'usDefaultSpread',
  'sovereignDefaultSpread',
  'inflationEgyptLt',
  'inflationUsLt',
]);

/**
 * بناء ملخص المصادر واكتمال مدخلات التقييم مباشرة من نفس المدخلات والمخرجات الفعلية.
 * خالٍ تماماً من أي درجات ثقة غير معتمدة (Confidence Score).
 */
export function buildValuationSourcesSummary(params: {
  company: Company;
  quarterlyRecords: QuarterlyFinancialRecord[];
  latestDaily?: DailyTradingRecord;
  metrics: FinancialMetricsTTM;
  valuation: ValuationResults;
  sectorClassification: SectorClassification;
  resolvedAssumptions: ResolvedAssumptionBundle & {
    sectorPeMatchedKey?: string | null;
    sectorPeLookupReasonAr?: string | null;
    sectorPeConflictDetected?: boolean;
    sectorPeConflictingEntries?: SectorPeConflictEntry[];
    sectorPeConfirmed?: boolean;
    sectorPeStatus?: SectorPeLoadStatus;
  };
  modelStatuses: ModelEligibilityStatus[];
  betaResolution?: BetaResolutionResult;
  terminalValueMethod?: TerminalValueMethod;
  valuationDate?: string | null;
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
  sectorPeError?: string | null;
  companyOverridesConfirmed?: boolean;
  macroParamsConfirmed?: boolean;
}): ValuationSourcesSummary {
  const {
    company,
    quarterlyRecords,
    latestDaily,
    metrics,
    valuation,
    sectorClassification,
    resolvedAssumptions,
    modelStatuses,
    betaResolution,
    valuationDate,
  } = params;

  const companyQuarters = [...quarterlyRecords].sort(
    (a, b) => a.year - b.year || (QUARTER_ORDER[a.quarter] ?? 0) - (QUARTER_ORDER[b.quarter] ?? 0)
  );
  const latestQuarter = companyQuarters.at(-1) ?? null;
  const latestSharesQuarter = [...companyQuarters]
    .reverse()
    .find((q) => typeof q.shares === 'number' && Number.isFinite(q.shares) && q.shares > 0) ?? null;

  const priceResolved = resolveMarketPriceFromDaily(latestDaily);

  let sharesSource: ValuationSourcesSummary['sharesSource'] = company.sharesSource ?? 'missing';
  let sharesPeriod: string | null = company.sharesPeriod ?? null;
  if (!company.sharesSource) {
    if (latestSharesQuarter) {
      sharesSource = 'quarterly_record';
      sharesPeriod = `${latestSharesQuarter.quarter} ${latestSharesQuarter.year}`;
    } else if (company.sharesOutstanding !== null && company.sharesOutstanding > 0) {
      sharesSource =
        latestDaily && positiveFiniteOrNull(latestDaily.listedShares) !== null
          ? 'daily_listed_shares'
          : 'company_metadata';
      sharesPeriod =
        sharesSource === 'daily_listed_shares' ? latestDaily?.tradeDate ?? null : null;
    }
  }

  const betaStatus: BetaStatus =
    betaResolution?.status ?? valuation.betaStatus ?? (company.beta !== null ? 'actual' : 'unavailable_error');
  const betaRaw = betaResolution ? betaResolution.betaRaw : valuation.betaRaw ?? company.beta ?? null;
  const betaAdjusted = valuation.betaAdjusted ?? null;
  const betaAnalyticalAssumption = resolvedAssumptions.map.betaAnalytical;
  const betaAnalyticalOverride =
    valuation.betaAnalyticalOverride ??
    valuation.engineOutputs?.betaAnalyticalOverride ??
    betaAnalyticalAssumption?.value ??
    null;
  const effectiveBetaForKe =
    valuation.effectiveBetaForKe ??
    valuation.engineOutputs?.effectiveBetaForKe ??
    (betaAnalyticalOverride !== null ? betaAnalyticalOverride : betaAdjusted);
  const betaAsOfDate = betaResolution?.asOfDate ?? null;
  const betaSource = betaResolution?.source ?? null;
  const betaSourceNoteAr =
    betaResolution?.noteAr ??
    valuation.betaSourceNoteAr ??
    (betaStatus === 'actual'
      ? 'بيتا فعلية مسجلة'
      : betaStatus === 'defaulted_missing'
      ? 'بيتا مفترضة = 1 بعد تأكيد غياب السجل'
      : 'سجل بيتا غير مؤكد من الخادم');
  const betaPolicyConflictAr =
    betaResolution?.policyConflictAr ??
    valuation.betaPolicyConflictAr ??
    valuation.engineOutputs?.betaPolicyConflictAr ??
    null;

  const tvMethod: TerminalValueMethod =
    valuation.dcfDetails?.terminalValueMethod ?? params.terminalValueMethod ?? 'perpetuity_growth';
  const forecastYears =
    valuation.dcfDetails?.forecastYears ??
    (resolvedAssumptions.map.forecastYears?.value ?? null);

  const finCurrencyDerived = deriveFinancialCurrencyAndUnit(quarterlyRecords);
  const financialCurrency: CurrencyCode | 'UNSUPPORTED' | null =
    valuation.engineOutputs?.financialCurrency ??
    metrics.financialCurrency ??
    finCurrencyDerived.currency ??
    null;
  const financialCurrencyStatus: CurrencyResolutionStatus =
    valuation.engineOutputs?.financialCurrencyStatus ??
    metrics.financialCurrencyStatus ??
    finCurrencyDerived.status;
  const amountUnit: AmountUnit =
    (metrics.financialUnit as AmountUnit) ||
    finCurrencyDerived.amountUnit ||
    'base';
  const sharesUnit: SharesUnit =
    sharesSource !== 'missing' && company.sharesOutstanding ? 'shares' : 'unspecified';

  const marketCurrencyRaw = normalizeCurrencyCode(company.currency);
  const marketPriceCurrency: CurrencyCode | 'UNSUPPORTED' | null =
    valuation.engineOutputs?.marketPriceCurrency ??
    metrics.marketPriceCurrency ??
    (marketCurrencyRaw === 'MISSING' ? null : marketCurrencyRaw);

  const keCurrency: CurrencyCode | null = valuation.engineOutputs?.keCurrency ?? null;
  const waccCurrency: CurrencyCode | null = valuation.engineOutputs?.waccCurrency ?? null;
  const projectedCashflowCurrency: CurrencyCode | null =
    financialCurrency === 'EGP' || financialCurrency === 'USD'
      ? financialCurrency
      : financialCurrencyStatus === 'missing'
      ? 'EGP'
      : null;

  const rfMethodology: RfMethodologyClassification =
    valuation.engineOutputs?.rfMethodology ??
    'unspecified';
  const rfResolvedKey = valuation.engineOutputs?.rfResolvedKey ?? null;
  const rfResolvedScope = valuation.engineOutputs?.rfResolvedScope ?? 'missing';
  const rimMethodologyNoteAr =
    valuation.engineOutputs?.rimMethodologyNoteAr ?? RIM_METHODOLOGY_NOTE_AR;

  const configuredWeights: ModelWeightsBreakdown = valuation.configuredWeights ??
    valuation.engineOutputs?.configuredWeights ?? { dcf: 0, ddm: 0, rim: 0, relative: 0, graham: 0 };
  const activeWeights: ModelWeightsBreakdown = valuation.weights;
  const activeModelCount = modelStatuses.filter((m) => m.status === 'available' && m.weightPct > 0).length;
  const singleModelWarningAr =
    activeModelCount === 1
      ? 'تنبيه: تعتمد القيمة العادلة المرجحة حالياً على نموذج تقييم واحد متاح فقط؛ القيمة المجمعة مطابقة لهذا النموذج الوحيد.'
      : null;

  return {
    ticker: company.ticker,
    latestFinancialPeriod: latestQuarter ? `${latestQuarter.quarter} ${latestQuarter.year}` : null,
    latestFinancialPeriodDate: latestQuarter?.dateInsertData ?? null,
    marketPrice: priceResolved.price ?? company.marketPrice,
    marketPriceDate: priceResolved.tradeDate ?? company.latestTradeDate ?? null,
    marketPriceSource: priceResolved.source ?? company.marketPriceSource ?? null,
    marketPriceCurrency,
    sharesOutstanding: company.sharesOutstanding,
    sharesSource,
    sharesPeriod,
    sharesUnit,
    sharesIsEndOfPeriodNoteAr:
      'الأسهم المستخدمة تمثل عدد الأسهم في نهاية الفترة المسجلة وليست متوسطاً مرجحاً تاريخياً.',
    epsBasisLabelAr:
      metrics.epsBasisLabelAr ??
      'ربحية الأسهم العادية المعتمدة للتقييم (NetIncomeCommon_TTM ÷ أسهم نهاية الفترة)',
    reportedEps: metrics.reportedEps ?? latestQuarter?.reportedEps ?? null,
    reportedEpsSource: metrics.reportedEpsSource ?? latestQuarter?.reportedEpsSource ?? null,
    reportedEpsPeriodType:
      metrics.reportedEpsPeriodType ?? latestQuarter?.reportedEpsPeriodType ?? null,
    reportedEpsFiscalYear:
      metrics.reportedEpsFiscalYear ?? latestQuarter?.reportedEpsFiscalYear ?? null,
    reportedEpsFiscalQuarter:
      metrics.reportedEpsFiscalQuarter ?? latestQuarter?.reportedEpsFiscalQuarter ?? null,
    reportedEpsPeriodStart:
      metrics.reportedEpsPeriodStart ?? latestQuarter?.reportedEpsPeriodStart ?? null,
    reportedEpsPeriodEnd:
      metrics.reportedEpsPeriodEnd ?? latestQuarter?.reportedEpsPeriodEnd ?? null,
    reportedEpsPeriod: metrics.reportedEpsPeriod ?? latestQuarter?.reportedEpsPeriod ?? null,
    roeBasisLabelAr:
      metrics.roeBasisLabelAr ?? 'عائد على حقوق المساهمين العاديين نهاية الفترة (NetIncomeCommon_TTM ÷ EquityCommon_EOP)',
    roeAverageEquity: metrics.roeAverageEquity ?? null,
    fcffSource: latestQuarter?.valuationSource?.trim() || null,
    fcffUnit: latestQuarter?.financialUnit || (financialCurrency ? 'base' : null),
    fcffStatus:
      metrics.fcffTTM !== null
        ? metrics.fcffDocumentationWarningAr || !latestQuarter?.valuationSource?.trim()
          ? 'available_undocumented'
          : 'available'
        : 'unavailable',
    fcffDocumentationWarningAr: metrics.fcffDocumentationWarningAr ?? null,
    providerMarketCapThousands:
      metrics.providerMarketCapThousands ?? positiveFiniteOrNull(latestDaily?.marketCapThousands),
    sectorClassification,
    sectorName: company.sector || company.rawSector || 'غير محدد',
    sectorId: company.sectorId ?? null,
    rawSector: company.rawSector ?? (company.sector || null),
    sectorSource: company.sectorSource ?? null,
    sectorDate: company.sectorDate ?? null,
    sectorClassificationSource:
      (params.sectorPeConfirmed ?? resolvedAssumptions.sectorPeConfirmed) === false ||
      params.sectorPeStatus === 'error' ||
      params.sectorPeStatus === 'permission_denied'
        ? 'registry_unavailable'
        : company.sectorClassification === 'financial' || company.sectorClassification === 'non_financial'
        ? company.metadataProvenance?.sector?.source === 'admin_override'
          ? 'admin_override'
          : company.sectorId
          ? 'sector_registry'
          : 'admin_override'
        : 'unresolved',
    sectorPeMatchedKey: resolvedAssumptions.sectorPeMatchedKey ?? null,
    sectorPeLookupReasonAr: resolvedAssumptions.sectorPeLookupReasonAr ?? null,
    sectorPeConflictDetected: Boolean(resolvedAssumptions.sectorPeConflictDetected),
    sectorPeConflictingEntries: resolvedAssumptions.sectorPeConflictingEntries,
    sectorPeConfirmed: params.sectorPeConfirmed ?? resolvedAssumptions.sectorPeConfirmed ?? true,
    sectorPeStatus: params.sectorPeStatus ?? resolvedAssumptions.sectorPeStatus ?? 'ready',
    sectorPeError: params.sectorPeError ?? null,
    dcfSectorEligibilityReasonAr:
      sectorClassification === 'non_financial'
        ? 'القطاع مصنف كنشاط غير مالي (مؤهل لـ DCF عند توفر FCFF موثق).'
        : sectorClassification === 'financial'
        ? 'القطاع مصنف ضمن القطاع المالي/البنوك؛ مستبعد من DCF.'
        : (params.sectorPeConfirmed ?? resolvedAssumptions.sectorPeConfirmed) === false
        ? 'تعذر تأكيد سجل القطاعات (sectorPE) من الخادم؛ تم تعليق DCF لحين التحقق.'
        : 'القطاع غير معروف أو غير مربوط بسجل القطاعات (sectorPE)؛ تم تعليق DCF حتى التوثيق.',
    valuationDate: valuationDate ?? metrics.dividendSummary?.valuationDate ?? metrics.dividendSummary?.cutoffDate ?? null,
    priceSessionDate: priceResolved.tradeDate ?? company.latestTradeDate ?? null,
    historicalRestatementLimitationAr: valuationDate
      ? 'حدود التقييم التاريخي: يتم تصفية جلسات التداول وتوزيعات الأرباح حتى تاريخ التقييم المحدد، بينما تعكس القوائم الربع سنوية السجلات المعتمدة الحالية ولا تحتفظ بسجل كامل لإعادات العرض التاريخية (Point-in-Time Restatements).'
      : undefined,
    dividendDatePolicyNoteAr:
      valuation.engineOutputs?.dividendSummary?.dividendDatePolicyNoteAr ??
      metrics.dividendSummary?.dividendDatePolicyNoteAr ??
      DIVIDEND_DATE_POLICY_NOTE_AR,
    assumptionPriority: resolvedAssumptions.priority,
    betaRaw,
    betaAdjusted,
    betaAnalyticalOverride,
    betaAnalyticalAsOfDate: betaAnalyticalAssumption?.asOfDate ?? null,
    betaAnalyticalSource: betaAnalyticalAssumption?.parameterSource ?? null,
    effectiveBetaForKe,
    betaStatus,
    betaAsOfDate,
    betaSource,
    betaSourceNoteAr,
    betaPolicyConflictAr,
    terminalValueMethod: tvMethod,
    forecastYears,
    financialCurrency,
    financialCurrencyStatus,
    projectedCashflowCurrency,
    amountUnit,
    keCurrency,
    waccCurrency,
    rfMethodology,
    rfResolvedKey,
    rfResolvedScope,
    rimMethodologyNoteAr,
    configuredWeights,
    activeWeights,
    activeModelCount,
    singleModelWarningAr,
    invalidGlobalParameters:
      valuation.engineOutputs?.invalidGlobalParameters ?? resolvedAssumptions.invalidGlobalParameters,
    currencyConsistencyBlockedReasonAr:
      valuation.engineOutputs?.currencyConsistencyBlockedReasonAr ?? finCurrencyDerived.conflictReasonAr ?? null,
    assumptionsUsed: resolvedAssumptions.list.filter(
      (a) => !INACTIVE_KEYS.has(a.key) && a.value !== null
    ),
    inactiveParameters: resolvedAssumptions.list.filter(
      (a) => INACTIVE_KEYS.has(a.key) && a.value !== null
    ),
    modelStatuses,
    dividendSummary: valuation.engineOutputs?.dividendSummary ?? metrics.dividendSummary ?? null,
    ddmAudit: valuation.ddmAudit ?? valuation.engineOutputs?.ddmAudit ?? null,
    rimAudit: valuation.rimAudit ?? valuation.engineOutputs?.rimAudit ?? null,
    relativeAudit: valuation.relativeAudit ?? valuation.engineOutputs?.relativeAudit ?? null,
    metricAudit:
      valuation.metricAudit ??
      valuation.engineOutputs?.metricAudit ??
      metrics.metricAudit ??
      null,
    bvpsBasisLabelAr:
      metrics.bvpsBasisLabelAr ??
      valuation.engineOutputs?.rimAudit?.bvpsBasisLabelAr ??
      metrics.metricAudit?.valuationBvps.basisLabelAr,
    rimRetentionPolicy: valuation.rimRetentionPolicy ?? valuation.engineOutputs?.rimRetentionPolicy ?? 'rim_parameter',
    rimRetentionPolicySource: company.rimRetentionPolicySource ?? null,
    rimRetentionSelectionRuleNoteAr: RIM_RETENTION_SELECTION_RULE_NOTE_AR,
    activeRimRetentionUsed: valuation.activeRimRetentionUsed ?? valuation.engineOutputs?.activeRimRetentionUsed ?? null,
    historicalPayoutRatio: metrics.historicalPayoutRatio ?? metrics.dividendSummary?.historicalPayoutRatio ?? null,
    historicalRetentionRatio:
      valuation.historicalRetentionRatio ??
      valuation.engineOutputs?.historicalRetentionRatio ??
      metrics.historicalRetentionRatio ??
      null,
    historicalRetentionSuitableForRim:
      valuation.engineOutputs?.dividendSummary?.historicalRetentionSuitableForRim ??
      metrics.dividendSummary?.historicalRetentionSuitableForRim,
    historicalRetentionRimBlockReasonAr:
      valuation.engineOutputs?.dividendSummary?.historicalRetentionRimBlockReasonAr ??
      metrics.dividendSummary?.historicalRetentionRimBlockReasonAr ??
      null,
    companyOverridesConfirmed:
      params.companyOverridesConfirmed ??
      valuation.ddmAudit?.companyOverridesConfirmed ??
      valuation.relativeAudit?.companyOverridesConfirmed ??
      true,
    macroParamsConfirmed:
      params.macroParamsConfirmed ??
      valuation.ddmAudit?.macroParamsConfirmed ??
      valuation.relativeAudit?.macroParamsConfirmed ??
      true,
  };
}
