/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AssumptionPriority,
  BetaStatus,
  CompanyParameterOverride,
  MacroParameter,
} from '../../types';
import {
  AmountUnit,
  AssumptionSource,
  CommonEquityBasis,
  CurrencyCode,
  CurrencyResolutionStatus,
  DdmAuditSummary,
  DdmBasisStatus,
  DdmSensitivityCell,
  DividendAggregationSummary,
  MetricAuditBundle,
  ModelEligibilityStatus,
  RelativeValuationAudit,
  ResolvedAssumption,
  RfMethodologyClassification,
  RimAuditSummary,
  RimAuditYearRow,
  RimFadeYearRow,
  RimForwardRoeBasis,
  RimRetentionPolicy,
  RimTerminalMethod,
  SectorClassification,
  SectorDefinition,
  SectorPeConflictEntry,
  SectorPeLoadStatus,
  SharesUnit,
  TerminalValueMethod,
} from '../../types/financial';
import { normalizeRfMethodology } from '../contracts';
import { resolveRimRetentionValue } from '../domain/dividendAnalytics';
import { buildRelativeValuationAudit } from '../domain/relativeValuationAudit';
import {
  classifyCompanySector,
  normalizeCurrencyCode,
  resolveValuationAssumptions,
  RIM_METHODOLOGY_NOTE_AR,
} from '../domain/valuationAssumptions';

export interface ValuationEngineInputs {
  ticker: string;
  marketPrice: number | null;
  sharesOutstanding: number | null;
  betaRaw: number | null;
  betaStatus?: BetaStatus;
  betaMeta?: { asOfDate?: string | null; source?: string | null };
  betaSourceNoteAr?: string;
  betaPolicyConflictAr?: string | null;
  disableLegacyCompanyFallback?: boolean;
  riskFreeRate?: number | null;
  equityRiskPremium?: number | null;
  costOfDebt?: number | null;
  taxRate?: number | null;
  terminalGrowth?: number | null;
  terminalValueMethod?: TerminalValueMethod;
  ebitdaTTM?: number | null;
  netIncomeTTM: number | null;
  ocfTTM: number | null;
  capexTTM: number | null;
  fcfTTM: number | null;
  totalEquity: number | null;
  totalDebt: number | null;
  cash: number | null;
  dpsRegular?: number | null;
  dpsSpecial?: number | null;
  dividendSummary?: DividendAggregationSummary | null;
  rimRetentionPolicy?: RimRetentionPolicy;
  historicalRetentionRatio?: number | null;
  historicalRetentionSuitableForRim?: boolean;
  historicalRetentionRimBlockReasonAr?: string | null;
  sector: string;
  rawSector?: string | null;
  sectorId?: string | null;
  sectorClassification?: SectorClassification;
  sectorPE?: number | null;
  sectorPB?: number | null;
  companyTargetPE?: number | null;
  companyTargetPB?: number | null;
  sectorPEMap?: Record<string, number>;
  sectorDefinitions?: SectorDefinition[] | null;
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
  companyOverridesMap?: Record<string, CompanyParameterOverride | number>;
  companyOverridesConfirmed?: boolean;
  macroParamsConfirmed?: boolean;
  sensitivityDraftKeys?: string[];
  macroMetaMap?: Record<
    string,
    Pick<
      MacroParameter,
      'asOfDate' | 'source' | 'enabledInEngine' | 'rfMethodology' | 'unit' | 'currency' | 'forecastHorizonYears'
    >
  >;
  assumptionPriority?: AssumptionPriority;
  financialCurrency?: CurrencyCode | string | null;
  financialCurrencyStatus?: CurrencyResolutionStatus;
  marketPriceCurrency?: CurrencyCode | string | null;
  amountUnit?: AmountUnit | string | null;
  sharesUnit?: SharesUnit;
  projectedTerminalEbitda?: number | null;
  projectedTerminalEbitdaMeta?: {
    currency?: CurrencyCode | string | null;
    unit?: string | null;
    forecastHorizonYears?: number | null;
    asOfDate?: string | null;
  };
  fcffTTM?: number | null;
  epsUsed?: number | null;
  epsBasis?: 'analytical_net_income_eop_shares' | 'analytical_common_ni_eop_shares' | 'unavailable';
  bvpsUsed?: number | null;
  bvpsBasis?: CommonEquityBasis | 'total_equity_unattested' | 'unavailable';
  bvpsBasisLabelAr?: string;
  roeUsed?: number | null;
  roeBasis?: string;
  roeBasisLabelAr?: string;
  metricAudit?: MetricAuditBundle | null;
}

export interface DcfDetails {
  baseFcff: number;
  wacc: number;
  forecastYears: number;
  terminalValueMethod: TerminalValueMethod;
  terminalGrowth: number | null;
  exitMultiple: number | null;
  projectedTerminalEbitda: number | null;
  terminalInputsSummary: string;
  netDebt: number;
  years: {
    year: number;
    growth: number;
    fcff: number;
    discountFactor: number;
    presentValue: number;
  }[];
  pvForecastFlows: number;
  enterpriseValue: number;
  equityValue: number;
  terminalValue: number;
  presentTerminalValue: number;
  terminalShareOfEvPct: number | null;
}

export interface EngineOutputs {
  dcfDetails: DcfDetails | null;
  betaRaw: number | null;
  betaAdjusted: number | null;
  betaAnalyticalOverride: number | null;
  effectiveBetaForKe: number | null;
  betaStatus: BetaStatus;
  betaSourceNoteAr: string;
  betaPolicyConflictAr: string | null;
  costOfEquity: number | null;
  wacc: number | null;
  financialCurrency: CurrencyCode | 'UNSUPPORTED' | null;
  financialCurrencyStatus: CurrencyResolutionStatus;
  marketPriceCurrency: CurrencyCode | 'UNSUPPORTED' | null;
  amountUnit: AmountUnit;
  sharesUnit: SharesUnit;
  keCurrency: CurrencyCode | null;
  waccCurrency: CurrencyCode | null;
  rfMethodology: RfMethodologyClassification;
  rfResolvedKey: 'Rf_Egypt_10Y' | 'Rf_USD_10Y' | 'company_metadata' | null;
  rfResolvedScope: AssumptionSource;
  invalidGlobalParameters: Array<{ key: string; reasonAr: string }>;
  currencyConsistencyBlockedReasonAr: string | null;
  rimMethodologyNoteAr: string;
  rimRetentionPolicy: RimRetentionPolicy;
  activeRimRetentionUsed: number | null;
  historicalRetentionRatio: number | null;
  dividendSummary: DividendAggregationSummary | null;
  ddmAudit: DdmAuditSummary;
  rimAudit: RimAuditSummary;
  relativeAudit: RelativeValuationAudit;
  metricAudit: MetricAuditBundle | null;
  epsTTM: number | null;
  bvps: number | null;
  roe: number | null;
  dcfValue: number | null;
  ddmValue: number | null;
  rimValue: number | null;
  relativeValue: number | null;
  grahamValue: number | null;
  weights: { dcf: number; ddm: number; rim: number; relative: number; graham: number };
  configuredWeights: { dcf: number; ddm: number; rim: number; relative: number; graham: number };
  modelNotes: string[];
  modelStatuses: ModelEligibilityStatus[];
  resolvedAssumptions: Record<string, ResolvedAssumption>;
  assumptionPriority: AssumptionPriority;
  sectorClassification: SectorClassification;
  sectorPeMatchedKey: string | null;
  sectorPeLookupReasonAr: string;
  sectorPeConflictDetected: boolean;
  sectorPeConflictingEntries?: SectorPeConflictEntry[];
  compositeFairValue: number | null;
  marginOfSafetyPct: number | null;
  upsidePotentialPct: number | null;
}

const finiteOrNull = (val: unknown): number | null =>
  typeof val === 'number' && Number.isFinite(val) ? val : null;

export function computeComprehensiveValuation(
  inputs: ValuationEngineInputs,
  paramsMap: Record<string, number>
): EngineOutputs {
  const getParam = (key: string): number | null => finiteOrNull(paramsMap[key]);
  const resolveWeight = (key: string): number => {
    const ov = inputs.companyOverridesMap?.[key];
    const companyVal = typeof ov === 'number' ? finiteOrNull(ov) : ov && !ov.isDeleted ? finiteOrNull(ov.value) : null;
    const globalVal = getParam(key);
    const chosen =
      (inputs.assumptionPriority ?? 'company_first') === 'global_first'
        ? globalVal ?? companyVal
        : companyVal ?? globalVal;
    return Math.max(0, chosen ?? 0);
  };

  const priority: AssumptionPriority = inputs.assumptionPriority ?? 'company_first';
  const sectorClassification = classifyCompanySector(
    inputs.sector,
    inputs.sectorClassification ?? null,
    {
      sectorId: inputs.sectorId ?? null,
      sectorDefinitions: inputs.sectorDefinitions,
      sectorPeConfirmed: inputs.sectorPeConfirmed,
      sectorPeStatus: inputs.sectorPeStatus,
    }
  );
  const tvMethod: TerminalValueMethod = inputs.terminalValueMethod ?? 'perpetuity_growth';

  const companyTargetPE =
    inputs.companyTargetPE !== undefined ? inputs.companyTargetPE : inputs.sectorPE ?? null;
  const companyTargetPB =
    inputs.companyTargetPB !== undefined ? inputs.companyTargetPB : inputs.sectorPB ?? null;

  const resolvedBundle = resolveValuationAssumptions({
    company: {
      sector: inputs.sector,
      rawSector: inputs.rawSector ?? null,
      sectorId: inputs.sectorId ?? null,
      beta: inputs.betaRaw,
      riskFreeRate: inputs.riskFreeRate ?? null,
      equityRiskPremium: inputs.equityRiskPremium ?? null,
      costOfDebt: inputs.costOfDebt ?? null,
      taxRate: inputs.taxRate ?? null,
      sustainableGrowthRate: inputs.terminalGrowth ?? null,
      targetPE: companyTargetPE,
      targetPB: companyTargetPB,
    },
    paramsMap,
    companyOverridesMap: inputs.companyOverridesMap,
    macroMetaMap: inputs.macroMetaMap,
    betaMeta: inputs.betaMeta,
    sectorPEMap: inputs.sectorPEMap,
    sectorDefinitions: inputs.sectorDefinitions,
    sectorPeConfirmed: inputs.sectorPeConfirmed,
    sectorPeStatus: inputs.sectorPeStatus,
    priority,
    disableLegacyCompanyFallback: inputs.disableLegacyCompanyFallback,
  });

  const resolved = resolvedBundle.map;
  const shares =
    inputs.sharesOutstanding !== null &&
    Number.isFinite(inputs.sharesOutstanding) &&
    inputs.sharesOutstanding > 0
      ? inputs.sharesOutstanding
      : NaN;

  const modelNotes: string[] = [];

  const taxRate = resolved.taxRate.value;
  const rfEG = resolved.riskFreeRate.value;
  const rfUSD = resolved.riskFreeRateUSD.value;
  const erp = resolved.equityRiskPremium.value;
  const crp = resolved.countryRiskPremium.value;
  const costOfDebt = resolved.costOfDebt.value;
  const terminalGrowth = resolved.terminalGrowth.value;
  const exitMultiple = resolved.exitMultiple.value;
  const rawForecastYears = resolved.forecastYears.value;

  const rMode = resolved.rMode.value;
  const waccMode = resolved.waccMode.value;
  const lambda = resolved.countryRiskLambda.value;
  const rawWeight = resolved.betaRawWeight.value;
  const betaAnchor = resolved.betaAnchor.value;

  const keCurrency: CurrencyCode | null =
    rMode === 2 ? 'USD' : rMode === 1 || rMode === 3 ? 'EGP' : null;
  const waccCurrency: CurrencyCode | null =
    waccMode === 3 ? 'USD' : waccMode === 1 || waccMode === 2 ? 'EGP' : null;

  const hasExplicitFinCurrency =
    'financialCurrency' in inputs || inputs.financialCurrencyStatus !== undefined;
  let financialCurrency: CurrencyCode | 'UNSUPPORTED' | null;
  let financialCurrencyStatus: CurrencyResolutionStatus;
  if (!hasExplicitFinCurrency) {
    financialCurrency = 'EGP';
    financialCurrencyStatus = 'valid';
  } else if (inputs.financialCurrencyStatus === 'unsupported') {
    financialCurrency = 'UNSUPPORTED';
    financialCurrencyStatus = 'unsupported';
  } else if (inputs.financialCurrencyStatus === 'missing') {
    financialCurrency = null;
    financialCurrencyStatus = 'missing';
  } else {
    const finNorm = normalizeCurrencyCode(inputs.financialCurrency);
    if (finNorm === 'EGP' || finNorm === 'USD') {
      financialCurrency = finNorm;
      financialCurrencyStatus = 'valid';
    } else if (finNorm === 'UNSUPPORTED') {
      financialCurrency = 'UNSUPPORTED';
      financialCurrencyStatus = 'unsupported';
    } else {
      financialCurrency = null;
      financialCurrencyStatus = 'missing';
    }
  }

  const amountUnitRaw = inputs.amountUnit;
  const amountUnit: AmountUnit =
    amountUnitRaw === 'EGP_millions' ||
    amountUnitRaw === 'USD_millions' ||
    amountUnitRaw === 'base' ||
    amountUnitRaw === 'EGP_base' ||
    amountUnitRaw === 'USD_base' ||
    amountUnitRaw === 'unspecified'
      ? amountUnitRaw
      : financialCurrency === 'EGP' || financialCurrency === 'USD'
      ? 'base'
      : 'unspecified';

  const sharesUnit: SharesUnit =
    inputs.sharesUnit ?? (Number.isFinite(shares) ? 'shares' : 'unspecified');

  let marketPriceCurrency: CurrencyCode | 'UNSUPPORTED' | null;
  if ('marketPriceCurrency' in inputs) {
    const mNorm = normalizeCurrencyCode(inputs.marketPriceCurrency);
    marketPriceCurrency =
      mNorm === 'EGP' || mNorm === 'USD'
        ? mNorm
        : mNorm === 'UNSUPPORTED'
        ? 'UNSUPPORTED'
        : null;
  } else {
    marketPriceCurrency =
      financialCurrency === 'EGP' || financialCurrency === 'USD' ? financialCurrency : null;
  }

  const finCurrencyConflict =
    financialCurrencyStatus === 'unsupported' || financialCurrency === 'UNSUPPORTED';
  const effectiveFinCurrency: CurrencyCode | null =
    financialCurrency === 'EGP' || financialCurrency === 'USD'
      ? financialCurrency
      : financialCurrencyStatus === 'missing'
      ? 'EGP'
      : null;
  const finCurrencyValid = !finCurrencyConflict && effectiveFinCurrency !== null;

  // Bind rfMethodology strictly to whichever Rf parameter is actually active for Ke/WACC
  const usesUsdRf = rMode === 2 || (rMode === null && waccMode === 3);
  const activeRfAssumption = usesUsdRf ? resolved.riskFreeRateUSD : resolved.riskFreeRate;
  const rfResolvedScope: AssumptionSource = activeRfAssumption?.source ?? 'missing';
  const rfResolvedKey: EngineOutputs['rfResolvedKey'] =
    activeRfAssumption?.value === null
      ? null
      : usesUsdRf
      ? 'Rf_USD_10Y'
      : activeRfAssumption.source === 'company' && !inputs.companyOverridesMap?.Rf_Egypt_10Y
      ? 'company_metadata'
      : 'Rf_Egypt_10Y';
  const rfMethodology: RfMethodologyClassification =
    activeRfAssumption?.rfMethodology
      ? normalizeRfMethodology(activeRfAssumption.rfMethodology)
      : 'unspecified';

  const invalidGlobalParameters = resolvedBundle.invalidGlobalParameters;
  for (const inv of invalidGlobalParameters) {
    modelNotes.push(inv.reasonAr);
  }

  // 1. Beta Raw & Blume-adjusted Beta
  const betaStatus: BetaStatus =
    inputs.betaStatus === 'unavailable_error'
      ? 'unavailable_error'
      : resolved.beta.value === null
      ? 'unavailable_error'
      : inputs.betaStatus ?? 'actual';
  const betaRaw = betaStatus === 'unavailable_error' ? null : resolved.beta.value;
  const betaSourceNoteAr =
    inputs.betaSourceNoteAr ||
    (betaStatus === 'actual'
      ? `بيتا فعلية (${betaRaw}) من سجل السهم`
      : betaStatus === 'defaulted_missing'
      ? `بيتا مفترضة = ${betaRaw} بعد تأكيد غياب سجل السهم`
      : 'سجل بيتا غير مؤكد من الخادم أو غير متاح');

  let betaAdjusted: number | null = null;
  if (betaRaw === null) {
    modelNotes.push(betaSourceNoteAr);
  } else if (rawWeight === null) {
    modelNotes.push('وزن بيتا التاريخية (Beta_Raw_Weight) غير محفوظ في المتغيرات الكلية.');
  } else if (rawWeight === 1) {
    betaAdjusted = betaRaw;
  } else if (betaAnchor === null) {
    modelNotes.push('نقطة ارتكاز بيتا (Beta_Anchor) غير محفوظة في المتغيرات الكلية.');
  } else {
    betaAdjusted = rawWeight * betaRaw + (1 - rawWeight) * betaAnchor;
  }

  const betaPolicyConflictAr = inputs.betaPolicyConflictAr ?? null;
  if (betaPolicyConflictAr) {
    modelNotes.push(betaPolicyConflictAr);
  }

  // Optional analytical beta override (Beta_Analytical) is strictly separate from beta_assumptions raw/Blume beta
  const betaAnalyticalOverride = finiteOrNull(resolved.betaAnalytical?.value);
  const effectiveBetaForKe = betaAnalyticalOverride ?? betaAdjusted;

  // 2. Cost of Equity (Ke) — يطلب فقط معاملات النمط النشط
  let costOfEquity: number | null = null;
  const keMissingInputs: string[] = [];
  if (effectiveBetaForKe === null) {
    keMissingInputs.push('Beta / Beta_Analytical');
  }
  if (erp === null) {
    keMissingInputs.push('ERP_Developed');
  }

  let keModeLabelAr = 'غير محدد (r_Mode غير محفوظ)';
  let keFormulaAr = 'غير متاحة — يتطلب حفظ r_Mode في المتغيرات الكلية.';

  if (rMode === null) {
    keMissingInputs.push('r_Mode');
    modelNotes.push('نمط معدل الخصم (r_Mode) غير محفوظ في المتغيرات الكلية.');
  } else if (rMode === 1) {
    keModeLabelAr = 'النمط 1 — محلي بالجنيه مع علاوة مخاطر الدولة (EGP + CRP)';
    keFormulaAr = 'Ke = Rf_Egypt_10Y + Beta_eff × ERP_Developed + Country_Risk_Lambda × CRP_Egypt';
    if (rfEG === null) keMissingInputs.push('Rf_Egypt_10Y');
    if (crp === null) keMissingInputs.push('CRP_Egypt');
    if (lambda === null) keMissingInputs.push('Country_Risk_Lambda');
    if (effectiveBetaForKe !== null && erp !== null) {
      if (rfEG === null || crp === null || lambda === null) {
        modelNotes.push('حساب Ke بالنمط (r_Mode=1) يتطلب حفظ Rf_Egypt_10Y وCRP_Egypt وCountry_Risk_Lambda.');
      } else {
        costOfEquity = rfEG + effectiveBetaForKe * erp + lambda * crp;
      }
    } else if (effectiveBetaForKe !== null && erp === null) {
      modelNotes.push('علاوة مخاطر السوق (ERP) غير متاحة لحساب تكلفة حقوق الملكية (Ke).');
    }
  } else if (rMode === 3) {
    keModeLabelAr = 'النمط 3 — محلي بالجنيه بدون علاوة مخاطر الدولة (EGP بدون CRP)';
    keFormulaAr = 'Ke = Rf_Egypt_10Y + Beta_eff × ERP_Developed';
    if (rfEG === null) keMissingInputs.push('Rf_Egypt_10Y');
    if (effectiveBetaForKe !== null && erp !== null) {
      if (rfEG === null) {
        modelNotes.push('حساب Ke بالنمط (r_Mode=3: محلي بدون CRP) يتطلب حفظ Rf_Egypt_10Y.');
      } else {
        costOfEquity = rfEG + effectiveBetaForKe * erp;
      }
    } else if (effectiveBetaForKe !== null && erp === null) {
      modelNotes.push('علاوة مخاطر السوق (ERP) غير متاحة لحساب تكلفة حقوق الملكية (Ke).');
    }
  } else if (rMode === 2) {
    keModeLabelAr = 'النمط 2 — دولاري مع علاوة مخاطر الدولة (USD + CRP)';
    keFormulaAr = 'Ke = Rf_USD_10Y + Beta_eff × ERP_Developed + Country_Risk_Lambda × CRP_Egypt';
    if (rfUSD === null) keMissingInputs.push('Rf_USD_10Y');
    if (crp === null) keMissingInputs.push('CRP_Egypt');
    if (lambda === null) keMissingInputs.push('Country_Risk_Lambda');
    if (effectiveBetaForKe !== null && erp !== null) {
      if (rfUSD === null || crp === null || lambda === null) {
        modelNotes.push('حساب Ke بالنمط الدولاري (r_Mode=2) يتطلب حفظ Rf_USD_10Y وCRP_Egypt وCountry_Risk_Lambda.');
      } else {
        costOfEquity = rfUSD + effectiveBetaForKe * erp + lambda * crp;
      }
    } else if (effectiveBetaForKe !== null && erp === null) {
      modelNotes.push('علاوة مخاطر السوق (ERP) غير متاحة لحساب تكلفة حقوق الملكية (Ke).');
    }
  } else {
    keModeLabelAr = `نمط غير مدعوم (r_Mode=${rMode})`;
    keFormulaAr = 'غير صالحة — القيم المدعومة لـ r_Mode هي 1 أو 2 أو 3 فقط.';
    keMissingInputs.push('r_Mode (1|2|3)');
    modelNotes.push(`نمط معدل الخصم r_Mode=${rMode} غير مدعوم (القيم المدعومة: 1، 2، 3).`);
  }

  // 3. WACC & Currency Consistency Checks
  const marketPrice =
    inputs.marketPrice !== null && Number.isFinite(inputs.marketPrice) && inputs.marketPrice > 0
      ? inputs.marketPrice
      : null;

  const effectiveMarketPriceCurrency: CurrencyCode | 'UNSUPPORTED' =
    marketPriceCurrency === 'UNSUPPORTED' ? 'UNSUPPORTED' : (marketPriceCurrency ?? 'EGP');

  const marketCurrencyMatchesFin =
    finCurrencyValid &&
    effectiveMarketPriceCurrency !== 'UNSUPPORTED' &&
    effectiveMarketPriceCurrency === effectiveFinCurrency;

  let currencyConsistencyBlockedReasonAr: string | null = null;
  if (finCurrencyConflict) {
    currencyConsistencyBlockedReasonAr =
      'عملة القوائم المالية غير مدعومة أو متضاربة في السجلات (المعتمد EGP و USD فقط)؛ تم إيقاف النماذج دون تحويل صامت إلى EGP.';
  } else if (marketPrice !== null && marketPriceCurrency === 'UNSUPPORTED') {
    currencyConsistencyBlockedReasonAr =
      'عملة السعر السوقي غير مدعومة؛ تم إيقاف WACC وDCF والمقارنة مع السعر السوقي.';
  } else if (marketPrice !== null && effectiveMarketPriceCurrency !== effectiveFinCurrency) {
    currencyConsistencyBlockedReasonAr = `عدم تطابق العملة بين السعر السوقي (${effectiveMarketPriceCurrency}) والقوائم المالية (${effectiveFinCurrency})؛ يُمنع الخلط أو التحويل الآلي بسعر الصرف.`;
  }

  if (currencyConsistencyBlockedReasonAr) {
    modelNotes.push(currencyConsistencyBlockedReasonAr);
  }

  const totalDebt = finiteOrNull(inputs.totalDebt);
  const totalEquityMarket =
    marketPrice !== null && Number.isFinite(shares) && marketCurrencyMatchesFin
      ? marketPrice * shares
      : NaN;
  const capitalValid =
    totalDebt !== null &&
    totalDebt >= 0 &&
    Number.isFinite(totalEquityMarket) &&
    totalEquityMarket > 0;

  let waccKe: number | null = null;
  if (waccMode !== null && effectiveBetaForKe !== null && erp !== null) {
    if (waccMode === 1 && rfEG !== null && crp !== null && lambda !== null) {
      waccKe = rfEG + effectiveBetaForKe * erp + lambda * crp;
    } else if (waccMode === 2 && rfEG !== null) {
      waccKe = rfEG + effectiveBetaForKe * erp;
    } else if (waccMode === 3 && rfUSD !== null && crp !== null && lambda !== null) {
      waccKe = rfUSD + effectiveBetaForKe * erp + lambda * crp;
    }
  }

  const afterTaxKd =
    costOfDebt !== null && taxRate !== null && taxRate >= 0 && taxRate <= 1
      ? costOfDebt * (1 - taxRate)
      : null;

  const wacc =
    finCurrencyValid &&
    marketCurrencyMatchesFin &&
    waccCurrency === effectiveFinCurrency &&
    waccKe !== null &&
    waccKe > 0 &&
    capitalValid &&
    afterTaxKd !== null &&
    costOfDebt !== null &&
    costOfDebt >= 0 &&
    Number.isFinite(afterTaxKd)
      ? (totalEquityMarket * waccKe + totalDebt! * afterTaxKd) / (totalEquityMarket + totalDebt!)
      : null;

  // 4. Fundamental Ratios (Strict Common-Attested Gates when MetricAudit or unattested basis supplied)
  const epsBlockedAsConsolidated =
    inputs.metricAudit !== undefined && inputs.metricAudit !== null
      ? inputs.metricAudit.valuationEps.value === null
      : inputs.epsBasis === 'analytical_net_income_eop_shares';
  const bvpsBlockedAsUnattested =
    inputs.metricAudit !== undefined && inputs.metricAudit !== null
      ? inputs.metricAudit.valuationBvps.value === null
      : inputs.bvpsBasis === 'total_equity_unattested';

  const epsTTM = !finCurrencyValid || epsBlockedAsConsolidated
    ? null
    : inputs.metricAudit?.valuationEps !== undefined
    ? finiteOrNull(inputs.metricAudit.valuationEps.value)
    : inputs.epsUsed !== undefined
    ? finiteOrNull(inputs.epsUsed)
    : inputs.netIncomeTTM !== null && Number.isFinite(shares)
    ? inputs.netIncomeTTM / shares
    : null;

  const bvps = !finCurrencyValid || bvpsBlockedAsUnattested
    ? null
    : inputs.metricAudit?.valuationBvps !== undefined
    ? finiteOrNull(inputs.metricAudit.valuationBvps.value)
    : inputs.bvpsUsed !== undefined
    ? finiteOrNull(inputs.bvpsUsed)
    : inputs.totalEquity !== null && Number.isFinite(shares)
    ? inputs.totalEquity / shares
    : null;

  const roe =
    !finCurrencyValid || epsBlockedAsConsolidated || bvpsBlockedAsUnattested
      ? null
      : inputs.metricAudit?.valuationRoe !== undefined
      ? finiteOrNull(inputs.metricAudit.valuationRoe.value)
      : inputs.roeUsed !== undefined
      ? finiteOrNull(inputs.roeUsed)
      : inputs.netIncomeTTM !== null && inputs.totalEquity !== null && inputs.totalEquity > 0
      ? inputs.netIncomeTTM / inputs.totalEquity
      : null;

  const bvpsBasis =
    inputs.metricAudit?.equityBasisForValuation ??
    inputs.bvpsBasis ??
    (bvps !== null ? 'explicit_common' : 'unavailable');
  const bvpsBasisLabelAr =
    inputs.metricAudit?.valuationBvps.basisLabelAr ??
    inputs.bvpsBasisLabelAr ??
    (bvps !== null
      ? 'حقوق المساهمين العاديين الموثقة في نهاية الفترة (Common Equity ÷ EOP Shares)'
      : 'غير متاح');
  const roeBasis =
    inputs.metricAudit?.valuationRoe.basisCode ??
    inputs.roeBasis ??
    (roe !== null ? 'common_eop_equity' : 'unavailable');
  const roeBasisLabelAr =
    inputs.metricAudit?.valuationRoe.basisLabelAr ??
    inputs.roeBasisLabelAr ??
    (roe !== null
      ? 'عائد تاريخي على حقوق المساهمين العاديين نهاية الفترة (NetIncomeCommon_TTM ÷ EquityCommon_EOP)'
      : 'غير متاح');

  const netDebt =
    finCurrencyValid &&
    inputs.totalDebt !== null &&
    Number.isFinite(inputs.totalDebt) &&
    inputs.cash !== null &&
    Number.isFinite(inputs.cash) &&
    inputs.cash >= 0
      ? inputs.totalDebt - inputs.cash
      : null;

  // 5. Model 1: DCF — Forecast_Years ديناميكي + Terminal Value صريح
  let dcfValue: number | null = null;
  let dcfDetails: DcfDetails | null = null;
  let dcfReasonAr: string | null = null;
  const isDcfSectorEligible = sectorClassification === 'non_financial';
  const baseFcf = inputs.fcffTTM ?? null;

  const validForecastYears =
    rawForecastYears !== null && Number.isInteger(rawForecastYears) && rawForecastYears >= 1 && rawForecastYears <= 20
      ? rawForecastYears
      : null;

  const dcfGrowthRates: (number | null)[] = [];
  const missingGrowthKeys: string[] = [];
  if (validForecastYears !== null) {
    for (let yr = 1; yr <= validForecastYears; yr++) {
      const resolvedGrowth = resolved[`growthY${yr}`]?.value ?? getParam(`Growth_Y${yr}`);
      if (resolvedGrowth === null || resolvedGrowth <= -1) {
        missingGrowthKeys.push(`Growth_Y${yr}`);
      }
      dcfGrowthRates.push(resolvedGrowth);
    }
  }
  const hasAllDcfGrowthRates =
    validForecastYears !== null &&
    dcfGrowthRates.length === validForecastYears &&
    dcfGrowthRates.every((g): g is number => g !== null && g > -1);

  const ebitdaTTM = finiteOrNull(inputs.ebitdaTTM);
  const explicitProjectedTerminalEbitda =
    finiteOrNull(inputs.projectedTerminalEbitda) ?? resolved.projectedTerminalEbitda?.value ?? null;
  const explicitProjectedMeta =
    inputs.projectedTerminalEbitda !== undefined && inputs.projectedTerminalEbitda !== null
      ? inputs.projectedTerminalEbitdaMeta
      : {
          currency: resolved.projectedTerminalEbitda?.currency ?? null,
          unit: resolved.projectedTerminalEbitda?.unit ?? null,
          forecastHorizonYears: resolved.projectedTerminalEbitda?.forecastHorizonYears ?? null,
          asOfDate: resolved.projectedTerminalEbitda?.asOfDate ?? null,
        };
  const explicitEbitdaGrowthRate = resolved.ebitdaGrowthRate?.value ?? null;

  const resolveExitTerminalEbitda = (): {
    ebitda: number | null;
    summary: string;
    missingReasonAr: string | null;
  } => {
    if (explicitProjectedTerminalEbitda !== null) {
      if (explicitProjectedTerminalEbitda <= 0) {
        return {
          ebitda: null,
          summary: '',
          missingReasonAr: 'DCF مستبعد: قيمة Projected_Terminal_EBITDA يجب أن تكون أكبر من صفر.',
        };
      }
      if (explicitProjectedMeta?.currency) {
        const pCur = normalizeCurrencyCode(explicitProjectedMeta.currency);
        if (pCur !== effectiveFinCurrency) {
          return {
            ebitda: null,
            summary: '',
            missingReasonAr: `DCF مستبعد: عملة Projected_Terminal_EBITDA (${pCur}) لا تطابق عملة القوائم المالية (${effectiveFinCurrency ?? 'غير محدد'}).`,
          };
        }
      }
      if (explicitProjectedMeta?.unit) {
        const metaUnitUpper = String(explicitProjectedMeta.unit).trim().toUpperCase();
        const impliedMetaCur = metaUnitUpper.startsWith('USD') ? 'USD' : metaUnitUpper.startsWith('EGP') ? 'EGP' : null;
        if (impliedMetaCur && effectiveFinCurrency && impliedMetaCur !== effectiveFinCurrency) {
          return {
            ebitda: null,
            summary: '',
            missingReasonAr: `DCF مستبعد: وحدة Projected_Terminal_EBITDA (${explicitProjectedMeta.unit}) تتعارض مع عملة القوائم المالية (${effectiveFinCurrency}).`,
          };
        }
      }
      if (
        explicitProjectedMeta?.forecastHorizonYears != null &&
        validForecastYears !== null &&
        explicitProjectedMeta.forecastHorizonYears !== validForecastYears
      ) {
        return {
          ebitda: null,
          summary: '',
          missingReasonAr: `DCF مستبعد: قيمة Projected_Terminal_EBITDA مرتبطة بأفق ${explicitProjectedMeta.forecastHorizonYears} سنوات وليس Forecast_Years النشط (${validForecastYears})؛ يلزم تحديثها لتطابق الأفق.`,
        };
      }
      return {
        ebitda: explicitProjectedTerminalEbitda,
        summary: 'Projected_Terminal_EBITDA الصريحة',
        missingReasonAr: null,
      };
    }

    if (ebitdaTTM === null || ebitdaTTM <= 0) {
      return {
        ebitda: null,
        summary: '',
        missingReasonAr:
          'DCF مستبعد: طريقة Exit_Multiple تتطلب Projected_Terminal_EBITDA > 0 أو EBITDA_TTM موجبة (EBIT + D&A) مع معدل نمو EBITDA صريح.',
      };
    }

    if (validForecastYears !== null) {
      const yearlyRates: (number | null)[] = [];
      for (let yr = 1; yr <= validForecastYears; yr++) {
        yearlyRates.push(resolved[`ebitdaGrowthY${yr}`]?.value ?? getParam(`EBITDA_Growth_Y${yr}`));
      }
      if (yearlyRates.every((r): r is number => r !== null && r > -1)) {
        const projected = yearlyRates.reduce((acc, gRate) => acc * (1 + gRate), ebitdaTTM);
        return {
          ebitda: projected,
          summary: `إسقاط EBITDA_TTM عبر EBITDA_Growth_Y1..Y${validForecastYears}`,
          missingReasonAr: null,
        };
      }
    }

    if (explicitEbitdaGrowthRate !== null && explicitEbitdaGrowthRate > -1 && validForecastYears !== null) {
      return {
        ebitda: ebitdaTTM * Math.pow(1 + explicitEbitdaGrowthRate, validForecastYears),
        summary: `إسقاط EBITDA_TTM بمعدل EBITDA_Growth_Rate (${(explicitEbitdaGrowthRate * 100).toFixed(2)}%)`,
        missingReasonAr: null,
      };
    }

    return {
      ebitda: null,
      summary: '',
      missingReasonAr:
        'DCF مستبعد: طريقة Exit_Multiple تتطلب إدخال Projected_Terminal_EBITDA أو معدل نمو EBITDA صريح (EBITDA_Growth_Rate أو EBITDA_Growth_Y1..YN)؛ لا يتم إسقاط EBITDA بمعدلات نمو FCFF ولا الرجوع إلى perpetuity_growth.',
    };
  };

  const exitEbitdaResolution = tvMethod === 'exit_multiple' ? resolveExitTerminalEbitda() : null;

  if (!finCurrencyValid) {
    dcfReasonAr = currencyConsistencyBlockedReasonAr || 'DCF مستبعد: عملة القوائم المالية غير مدعومة أو متضاربة.';
  } else if (!marketCurrencyMatchesFin && marketPrice !== null) {
    dcfReasonAr =
      currencyConsistencyBlockedReasonAr ||
      'DCF مستبعد: عملة السعر السوقي لا تطابق عملة القوائم المالية؛ يتعذر حساب أوزان رأس المال لـ WACC.';
  } else if (sectorClassification === 'financial') {
    dcfReasonAr = 'DCF مستبعد: الشركة مصنفة ضمن القطاع المالي / البنوك ولا يناسبها التدفق النقدي الحر للشركة.';
  } else if (sectorClassification === 'unknown') {
    dcfReasonAr = 'DCF مستبعد: تصنيف نشاط الشركة غير محدد (قطاع غير معروف)؛ يلزم توثيق كون الشركة غير مالية قبل التفعيل.';
  } else if (waccMode === null) {
    dcfReasonAr = 'DCF مستبعد: نمط حساب WACC (WACC_Mode) غير محفوظ في المتغيرات الكلية.';
  } else if (waccCurrency === null) {
    dcfReasonAr = `DCF مستبعد: نمط حساب WACC (WACC_Mode=${waccMode}) غير مدعوم.`;
  } else if (waccCurrency !== effectiveFinCurrency) {
    dcfReasonAr = `DCF مستبعد: القوائم المالية بعملة ${effectiveFinCurrency} ومعدل خصم WACC بعملة ${waccCurrency} (WACC_Mode=${waccMode}) ولا يُحوَّل آلياً بسعر الصرف.`;
  } else if (baseFcf === null) {
    dcfReasonAr = 'DCF غير متاح: FCFF موثق غير متوفر؛ لا يُستبدل بصافي الربح أو FCF.';
  } else if (baseFcf <= 0) {
    dcfReasonAr = 'DCF مستبعد: FCFF_TTM غير موجب؛ نموذج الإسقاط الحالي لا يعالج التحول من التدفقات السالبة.';
  } else if (netDebt === null) {
    dcfReasonAr = 'DCF مستبعد: صافي الدين غير متاح؛ يلزم تسجيل الدين والنقد، ولو صفراً.';
  } else if (rawForecastYears === null) {
    dcfReasonAr = 'DCF مستبعد: عدد سنوات التوقع (Forecast_Years) غير محفوظ في المتغيرات الكلية أو خصائص السهم.';
  } else if (validForecastYears === null) {
    dcfReasonAr = `DCF مستبعد: Forecast_Years=${rawForecastYears} يجب أن يكون عدداً صحيحاً بين 1 و 20.`;
  } else if (!hasAllDcfGrowthRates) {
    dcfReasonAr = `DCF مستبعد: معدلات نمو FCFF غير مكتملة لسنوات التوقع (${missingGrowthKeys.join('، ')})؛ لا يُكرر آخر معدل صامتاً.`;
  } else if (wacc === null || wacc <= 0) {
    dcfReasonAr = 'DCF مستبعد: WACC غير متاح (يلزم سعر سوقي موثق ودين وبيتا وافتراضات تكلفة رأس المال حسب النمط النشط).';
  } else if (tvMethod === 'perpetuity_growth') {
    if (terminalGrowth === null) {
      dcfReasonAr = 'DCF مستبعد: معدل النمو النهائي (Terminal_Growth) غير متاح (ولا يُستبدل بـ Exit_Multiple صامتاً).';
    } else if (terminalGrowth <= -1) {
      dcfReasonAr = 'DCF مستبعد: قيمة Terminal_Growth غير صالحة.';
    } else if (wacc <= terminalGrowth) {
      dcfReasonAr = 'DCF مستبعد: يجب أن يكون WACC أعلى من معدل النمو النهائي.';
    }
  } else if (tvMethod === 'exit_multiple') {
    if (exitMultiple === null || exitMultiple <= 0) {
      dcfReasonAr = 'DCF مستبعد: طريقة مضاعف الخروج المختارة تتطلب Exit_Multiple > 0 (لا يُستبدل بـ Terminal_Growth صامتاً).';
    } else if (exitEbitdaResolution?.missingReasonAr) {
      dcfReasonAr = exitEbitdaResolution.missingReasonAr;
    }
  }

  if (dcfReasonAr) {
    modelNotes.push(dcfReasonAr);
  }

  const canComputeTerminal =
    tvMethod === 'perpetuity_growth'
      ? terminalGrowth !== null && terminalGrowth > -1 && wacc !== null && wacc > terminalGrowth
      : exitMultiple !== null &&
        exitMultiple > 0 &&
        exitEbitdaResolution !== null &&
        exitEbitdaResolution.ebitda !== null &&
        exitEbitdaResolution.ebitda > 0;

  if (
    finCurrencyValid &&
    marketCurrencyMatchesFin &&
    isDcfSectorEligible &&
    waccCurrency !== null &&
    waccCurrency === effectiveFinCurrency &&
    baseFcf !== null &&
    baseFcf > 0 &&
    netDebt !== null &&
    Number.isFinite(shares) &&
    wacc !== null &&
    wacc > 0 &&
    validForecastYears !== null &&
    hasAllDcfGrowthRates &&
    canComputeTerminal
  ) {
    const growthRates = dcfGrowthRates as number[];
    const years: DcfDetails['years'] = [];
    let pvSum = 0;
    let currentFcf = baseFcf;
    for (let t = 1; t <= validForecastYears; t++) {
      const gYear = growthRates[t - 1];
      currentFcf *= 1 + gYear;
      const df = Math.pow(1 + wacc, t);
      pvSum += currentFcf / df;
      years.push({
        year: t,
        growth: gYear,
        fcff: currentFcf,
        discountFactor: 1 / df,
        presentValue: currentFcf / df,
      });
    }

    let tv = 0;
    let projectedTerminalEbitda: number | null = null;
    let terminalInputsSummary = `نمو دائم (Terminal_Growth = ${((terminalGrowth ?? 0) * 100).toFixed(2)}%)`;
    if (tvMethod === 'exit_multiple') {
      projectedTerminalEbitda = exitEbitdaResolution!.ebitda!;
      tv = projectedTerminalEbitda * exitMultiple!;
      terminalInputsSummary = `${exitEbitdaResolution!.summary} × مضاعف (${exitMultiple!.toFixed(2)}x)`;
    } else {
      tv = (currentFcf * (1 + terminalGrowth!)) / (wacc - terminalGrowth!);
    }
    const pvTv = tv / Math.pow(1 + wacc, validForecastYears);
    const enterpriseValue = pvSum + pvTv;
    const equityVal = enterpriseValue - netDebt;
    const terminalShareOfEvPct = enterpriseValue > 0 ? (pvTv / enterpriseValue) * 100 : null;
    if ([enterpriseValue, equityVal, tv, pvTv].every(Number.isFinite) && years.every((y) => Number.isFinite(y.fcff))) {
      dcfValue = Math.max(0, equityVal / shares);
      dcfDetails = {
        baseFcff: baseFcf,
        wacc,
        forecastYears: validForecastYears,
        terminalValueMethod: tvMethod,
        terminalGrowth: tvMethod === 'perpetuity_growth' ? terminalGrowth : null,
        exitMultiple: tvMethod === 'exit_multiple' ? exitMultiple : null,
        projectedTerminalEbitda,
        terminalInputsSummary,
        netDebt,
        years,
        pvForecastFlows: pvSum,
        enterpriseValue,
        equityValue: equityVal,
        terminalValue: tv,
        presentTerminalValue: pvTv,
        terminalShareOfEvPct,
      };
    }
  }

  // 6. Model 2: DDM (Gordon Growth) — Regular-only + Complete/annual_total Gate + DdmAuditSummary
  let ddmValue: number | null = null;
  let ddmReasonAr: string | null = null;
  const hasDividendSummary = Boolean(inputs.dividendSummary);
  const rawRegularDps =
    inputs.dpsRegular !== undefined
      ? finiteOrNull(inputs.dpsRegular)
      : hasDividendSummary
      ? finiteOrNull(inputs.dividendSummary!.regularDps)
      : null;
  const specialDpsHint = inputs.dpsSpecial ?? inputs.dividendSummary?.specialDps ?? null;
  const ddmGrowth = resolved.ddmGrowth.value;

  const inferredBasisStatus: DdmBasisStatus =
    inputs.dividendSummary?.ddmBasisStatus ??
    (rawRegularDps !== null && rawRegularDps > 0
      ? 'eligible_annual_total'
      : specialDpsHint !== null && specialDpsHint > 0
      ? 'blocked_special_only'
      : rawRegularDps !== null && rawRegularDps <= 0
      ? 'blocked_confirmed_no_dividend'
      : 'blocked_missing');

  const ddmSummaryEligible =
    inputs.dividendSummary?.ddmEligible !== undefined
      ? inputs.dividendSummary.ddmEligible
      : rawRegularDps !== null && rawRegularDps > 0;

  const ddmCompanyOverridesConfirmed = inputs.companyOverridesConfirmed ?? true;
  const ddmMacroParamsConfirmed = inputs.macroParamsConfirmed ?? true;
  const isDdmGrowthSensitivityDraft =
    Boolean(inputs.sensitivityDraftKeys?.includes('DDM_Growth')) && ddmGrowth !== null;
  const ddmGrowthLoadingUnconfirmed =
    ddmGrowth === null && (!ddmCompanyOverridesConfirmed || !ddmMacroParamsConfirmed);
  const ddmGrowthSource: NonNullable<DdmAuditSummary['growthSource']> =
    isDdmGrowthSensitivityDraft
      ? 'sensitivity_draft'
      : resolved.ddmGrowth.source === 'company'
      ? 'company'
      : resolved.ddmGrowth.source === 'global'
      ? 'global'
      : ddmGrowthLoadingUnconfirmed
      ? 'loading_unconfirmed'
      : 'missing';
  const ddmGrowthSourceLabelAr =
    ddmGrowthSource === 'sensitivity_draft'
      ? 'مسودة حساسية مؤقتة (محلي في الذاكرة — غير محفوظة)'
      : ddmGrowthSource === 'company'
      ? 'تخصيص الشركة (company_assumptions)'
      : ddmGrowthSource === 'global'
      ? 'المتغيرات الكلية (macro_params)'
      : ddmGrowthSource === 'loading_unconfirmed'
      ? 'قيد تأكيد التحميل من الخادم'
      : 'غير محفوظ في تخصيص الشركة أو المتغيرات الكلية';
  let ddmRemediationAr: string | null = null;

  if (!finCurrencyValid) {
    ddmReasonAr = 'DDM مستبعد: عملة القوائم المالية غير مدعومة أو متضاربة.';
    ddmRemediationAr = 'صحّح عملة القوائم المالية المسجلة للشركة (EGP أو USD) قبل تفعيل التقييم.';
  } else if (keCurrency !== null && keCurrency !== effectiveFinCurrency) {
    ddmReasonAr = `DDM مستبعد: القوائم المالية والتوزيعات بعملة ${effectiveFinCurrency} وتكلفة حقوق الملكية Ke بعملة ${keCurrency} (r_Mode=${rMode}) ولا يُحوَّل آلياً بسعر الصرف.`;
    ddmRemediationAr = `تأكد من توافق نمط معدل الخصم (r_Mode) مع عملة القوائم المالية (${effectiveFinCurrency}).`;
    modelNotes.push(ddmReasonAr);
  } else if (
    inputs.dividendSummary?.currency &&
    effectiveFinCurrency &&
    inputs.dividendSummary.currency !== effectiveFinCurrency
  ) {
    ddmReasonAr = `DDM مستبعد: عملة التوزيعات (${inputs.dividendSummary.currency}) لا تطابق عملة القوائم المالية (${effectiveFinCurrency}).`;
    ddmRemediationAr = 'راجع عملة سجل التوزيعات في مركز البيانات لتطابق عملة القوائم المالية.';
    modelNotes.push(ddmReasonAr);
  } else if (!ddmSummaryEligible) {
    ddmReasonAr =
      inputs.dividendSummary?.ddmIneligibleReasonAr ||
      (specialDpsHint !== null && specialDpsHint > 0 && (rawRegularDps === null || rawRegularDps <= 0)
        ? 'DDM مستبعد: السهم لديه توزيعات استثنائية (special) فقط دون توزيع منتظم (regular)، والتوزيعات الاستثنائية لا تُغذّي نموذج جوردون.'
        : rawRegularDps !== null && rawRegularDps <= 0
        ? 'DDM مستبعد: التوزيع النقدي المنتظم المؤكد يساوي صفراً (لا ينطبق نموذج جوردون عند التوزيع الصفري، ولا تُضمّن التوزيعات الاستثنائية).'
        : 'DDM مستبعد: التوزيع النقدي السنوي المنتظم غير متاح.');
    ddmRemediationAr =
      'راجع سجلات التوزيعات الفعلية (DPS_Actual) وحالة اكتمال السنة في مركز البيانات لتوثيق التوزيع المنتظم للسنة المكتملة.';
  } else if (rawRegularDps === null) {
    ddmReasonAr =
      specialDpsHint !== null && specialDpsHint > 0
        ? 'DDM مستبعد: السهم لديه توزيعات استثنائية (special) فقط دون توزيع منتظم (regular)، والتوزيعات الاستثنائية لا تُغذّي نموذج جوردون.'
        : 'DDM مستبعد: التوزيع النقدي السنوي المنتظم غير متاح.';
    ddmRemediationAr =
      'أدخل أو استورد سجل التوزيعات المنتظمة (DPS_Actual) وتأكيد اكتمال السنة في مركز البيانات.';
  } else if (rawRegularDps <= 0) {
    ddmReasonAr =
      'DDM مستبعد: التوزيع النقدي المنتظم المؤكد يساوي صفراً (لا ينطبق نموذج جوردون عند التوزيع الصفري، ولا تُضمّن التوزيعات الاستثنائية).';
    ddmRemediationAr =
      'لا ينطبق نموذج DDM على سهم بدون توزيع نقدي منتظم؛ يُكتفى بباقي النماذج المؤهلة أو مراجعة سجل التوزيعات إذا وُجد توزيع منتظم غير مسجل.';
  } else if (ddmGrowth === null) {
    if (ddmGrowthLoadingUnconfirmed) {
      ddmReasonAr =
        'DDM معلّق مؤقتاً: حالة تحميل معدل نمو التوزيعات (DDM_Growth) غير مؤكدة من الخادم بعد (company_assumptions أو macro_params).';
      ddmRemediationAr =
        'انتظر اكتمال مزامنة تخصيصات الشركة والمتغيرات الكلية من الخادم قبل الجزم بغياب DDM_Growth.';
    } else {
      ddmReasonAr =
        'DDM مستبعد: معدل نمو التوزيعات (DDM_Growth) غير محفوظ في تخصيص الشركة (company_assumptions) أو المتغيرات الكلية (macro_params).';
      ddmRemediationAr =
        'احفظ تخصيص DDM_Growth لهذه الشركة داخل تبويب DDM (في company_assumptions) أو احفظ مرجعاً عاماً في macro_params (للمدير فقط).';
    }
    modelNotes.push(ddmReasonAr);
  } else if (costOfEquity === null) {
    const missingText =
      keMissingInputs.length > 0 ? ` — المدخلات الناقصة للنمط النشط: ${keMissingInputs.join('، ')}` : '';
    ddmReasonAr = `DDM مستبعد: تكلفة حقوق الملكية (Ke) غير متاحة${missingText}.`;
    ddmRemediationAr =
      'استكمل مدخلات تكلفة حقوق الملكية (Ke) النشطة حسب r_Mode (مثل Rf وERP وبيتا وCRP عند تفعيلها) ليحسب المحرك Ke تلقائياً.';
  } else if (costOfEquity <= ddmGrowth) {
    ddmReasonAr = `DDM مستبعد: يجب أن تكون تكلفة حقوق الملكية (Ke = ${(costOfEquity * 100).toFixed(2)}%) أعلى من معدل نمو التوزيعات (DDM_Growth = ${(ddmGrowth * 100).toFixed(2)}%)؛ لأن المقام (Ke − g) يجب أن يكون موجباً في معادلة جوردون.`;
    ddmRemediationAr =
      'خفّض فرضية معدل النمو المستدام (DDM_Growth) عبر تخصيص الشركة أو المرجع العام لتصبح أقل من Ke، أو راجع مدخلات Ke إذا كانت غير مكتملة.';
    modelNotes.push(ddmReasonAr);
  } else {
    ddmValue = (rawRegularDps * (1 + ddmGrowth)) / (costOfEquity - ddmGrowth);
  }

  const d1Computed =
    rawRegularDps !== null && rawRegularDps > 0 && ddmGrowth !== null && ddmGrowth > -1
      ? rawRegularDps * (1 + ddmGrowth)
      : null;
  const keMinusG =
    costOfEquity !== null && ddmGrowth !== null ? costOfEquity - ddmGrowth : null;

  const canBuildLocalDdmSensitivity =
    ddmSummaryEligible &&
    rawRegularDps !== null &&
    rawRegularDps > 0 &&
    costOfEquity !== null &&
    ddmGrowth !== null;

  const sensitivityKeAxis = canBuildLocalDdmSensitivity
    ? [-0.04, -0.02, 0, 0.02, 0.04].map((d) => costOfEquity! + d)
    : [];
  const sensitivityGrowthAxis = canBuildLocalDdmSensitivity
    ? [-0.02, -0.01, 0, 0.01, 0.02].map((d) => ddmGrowth! + d)
    : [];
  const ddmSensitivityMatrix: DdmSensitivityCell[][] = canBuildLocalDdmSensitivity
    ? sensitivityKeAxis.map((keVal) =>
        sensitivityGrowthAxis.map((gVal) => {
          const spread = keVal - gVal;
          if (gVal <= -1) {
            return {
              ke: keVal,
              growth: gVal,
              spread,
              fairValue: null,
              isValid: false,
              invalidReasonAr: 'غير صالح: g ≤ -100%',
            };
          }
          if (keVal <= 0) {
            return {
              ke: keVal,
              growth: gVal,
              spread,
              fairValue: null,
              isValid: false,
              invalidReasonAr: 'غير صالح: Ke ≤ 0',
            };
          }
          if (spread <= 0) {
            return {
              ke: keVal,
              growth: gVal,
              spread,
              fairValue: null,
              isValid: false,
              invalidReasonAr: 'غير صالح: Ke ≤ g',
            };
          }
          return {
            ke: keVal,
            growth: gVal,
            spread,
            fairValue: (rawRegularDps! * (1 + gVal)) / spread,
            isValid: true,
            invalidReasonAr: null,
          };
        })
      )
    : [];

  const basisStatusText = inputs.dividendSummary?.dividendYearStatus ?? 'unknown';
  const basisFiscalYear =
    inputs.dividendSummary?.ddmBasisFiscalYear ??
    inputs.dividendSummary?.targetFiscalYear ??
    null;
  const displayLatestEventsYear =
    inputs.dividendSummary?.displayLatestEventsYear ?? basisFiscalYear;
  const latestPositiveDividendYear =
    inputs.dividendSummary?.latestPositiveDividendYear ?? null;
  const ageNote =
    inputs.dividendSummary?.fiscalYearDataAgeYears != null &&
    inputs.dividendSummary.fiscalYearDataAgeYears > 1
      ? ` — عمر البيانات: ${inputs.dividendSummary.fiscalYearDataAgeYears} سنة.`
      : '';

  const ddmAudit: DdmAuditSummary = {
    d0: rawRegularDps,
    d1: d1Computed,
    growth: ddmGrowth,
    growthSource: ddmGrowthSource,
    growthSourceLabelAr: ddmGrowthSourceLabelAr,
    growthAsOfDate: isDdmGrowthSensitivityDraft ? null : (resolved.ddmGrowth.asOfDate ?? null),
    growthDocumentarySource: isDdmGrowthSensitivityDraft
      ? 'مسودة حساسية مؤقتة (محلي — بدون حفظ)'
      : (resolved.ddmGrowth.parameterSource ?? null),
    growthCompanyValue: resolved.ddmGrowth.companyValue,
    growthCompanyDocumentarySource: resolved.ddmGrowth.companyParameterSource ?? null,
    growthCompanyAsOfDate: resolved.ddmGrowth.companyAsOfDate ?? null,
    growthGlobalValue: resolved.ddmGrowth.globalValue,
    growthGlobalDocumentarySource: resolved.ddmGrowth.globalParameterSource ?? null,
    growthGlobalAsOfDate: resolved.ddmGrowth.globalAsOfDate ?? null,
    growthOverriddenByPriority: isDdmGrowthSensitivityDraft
      ? false
      : Boolean(resolved.ddmGrowth.isOverriddenByPriority),
    growthPriority: priority,
    isSensitivityDraft: isDdmGrowthSensitivityDraft,
    companyOverridesConfirmed: ddmCompanyOverridesConfirmed,
    macroParamsConfirmed: ddmMacroParamsConfirmed,
    costOfEquity,
    keMode: rMode,
    keModeLabelAr,
    keFormulaAr,
    keMissingInputs,
    keMinusG,
    ddmFairValue: ddmValue,
    eligible: ddmValue !== null,
    basisStatus: inferredBasisStatus,
    exclusionReasonAr: ddmValue !== null ? null : ddmReasonAr,
    remediationAr: ddmValue !== null ? null : ddmRemediationAr,
    basisFiscalYear,
    displayLatestEventsYear,
    latestPositiveDividendYear,
    source: inputs.dividendSummary?.source ?? (rawRegularDps !== null ? 'dividend_records' : 'missing'),
    completenessStatus: basisStatusText,
    inputMethod:
      inputs.dividendSummary?.ddmInputMethod ??
      (rawRegularDps !== null && rawRegularDps > 0 ? 'annual_total' : null),
    perShareNoteAr:
      'حصة السهم D0 تمثل التوزيع المنتظم للسهم الواحد بقيمته الأساسية من DPS_Actual دون أي ضرب في عدد الأسهم.',
    dataCompletenessNoteAr:
      inputs.dividendSummary?.yearResolutionNoteAr ??
      `حالة اكتمال بيانات السنة${basisFiscalYear ? ` (${basisFiscalYear})` : ''}: ${basisStatusText}${
        inputs.dividendSummary?.dividendYearStatusSource
          ? ` (${inputs.dividendSummary.dividendYearStatusSource})`
          : ''
      }${ageNote}`,
    stabilityWarningAr: inputs.dividendSummary?.dividendStabilityWarningAr ?? null,
    suitabilityNoteAr:
      inputs.dividendSummary?.dividendSuitabilityNoteAr ??
      'يُفصل تقييم اكتمال البيانات المحاسبية عن ملاءمة فرضية النمو الثابت في نموذج جوردون.',
    ddmVsRetentionDifferenceReasonAr:
      inputs.dividendSummary?.ddmVsRetentionDifferenceReasonAr ?? null,
    sensitivityKeAxis,
    sensitivityGrowthAxis,
    sensitivityMatrix: ddmSensitivityMatrix,
  };

  // 7. Model 3: RIM (Residual Income Model) — Forward ROE (independent) + Explicit Terminal Method (zero silent defaults)
  let rimValue: number | null = null;
  let rimReasonAr: string | null = null;
  const rimRetentionPolicy: RimRetentionPolicy = inputs.rimRetentionPolicy ?? 'rim_parameter';
  const historicalRetentionRatio = finiteOrNull(
    inputs.historicalRetentionRatio ?? inputs.dividendSummary?.historicalRetentionRatio ?? null
  );
  const rimRetentionResolution = resolveRimRetentionValue({
    policy: rimRetentionPolicy,
    rimRetentionParam: resolved.rimRetention.value,
    rimRetentionResolved: resolved.rimRetention,
    assumptionPriority: priority,
    historicalRetentionRatio,
    historicalRetentionSuitableForRim:
      inputs.historicalRetentionSuitableForRim ??
      inputs.dividendSummary?.historicalRetentionSuitableForRim,
    historicalRetentionBlockReasonAr:
      inputs.historicalRetentionRimBlockReasonAr ??
      inputs.dividendSummary?.historicalRetentionRimBlockReasonAr ??
      null,
  });
  const rimRetention = rimRetentionResolution.retention;

  const explicitForwardRoe = finiteOrNull(resolved.rimExpectedRoe?.value);
  const forwardRoeUsed: number | null = explicitForwardRoe !== null ? explicitForwardRoe : roe;
  const forwardRoeBasis: RimForwardRoeBasis =
    explicitForwardRoe !== null
      ? 'explicit_expected_roe'
      : roe !== null
      ? 'historical_common_roe_carryover'
      : 'unavailable';
  const forwardRoeBasisLabelAr =
    forwardRoeBasis === 'explicit_expected_roe'
      ? `عائد مستقبلي متوقع صريح (RIM_Expected_ROE = ${(explicitForwardRoe! * 100).toFixed(2)}%)`
      : forwardRoeBasis === 'historical_common_roe_carryover'
      ? `ترحيل العائد التاريخي للأسهم العادية (${(roe! * 100).toFixed(2)}% لغياب RIM_Expected_ROE)`
      : 'غير متاح';

  const rawTerminalMethod = finiteOrNull(resolved.rimTerminalMethod?.value);
  const terminalMethod: RimTerminalMethod | null =
    rawTerminalMethod === 1 || rawTerminalMethod === 2 || rawTerminalMethod === 3
      ? rawTerminalMethod
      : null;
  const terminalMethodLabelAr =
    terminalMethod === 1
      ? '1 — بقاء الدخل المتبقي دائماً (RI₆ ÷ Ke)'
      : terminalMethod === 2
      ? '2 — تلاشي ROE تدريجياً نحو Ke أو RIM_Terminal_ROE'
      : terminalMethod === 3
      ? '3 — استمرار العائد ونمو القيمة الدفترية (g_B = ROE_term × b_term)'
      : 'غير محددة (يلزم RIM_Terminal_Method = 1 أو 2 أو 3)';

  const rawTermRoe = finiteOrNull(resolved.rimTerminalRoe?.value);
  const rawTermRet = finiteOrNull(resolved.rimTerminalRetention?.value);
  const rawFadeYears = finiteOrNull(resolved.rimFadeYears?.value);

  const rimYears: RimAuditYearRow[] = [];
  const fadeSchedule: RimFadeYearRow[] = [];
  const consistencyChecksAr: string[] = [];
  let pvRiSum5Y: number | null = null;
  let terminalClosingBvps: number | null = null;
  let terminalRiValue: number | null = null;
  let pvTerminalRiValue: number | null = null;
  let postFadeContinuationTv: number | null = null;
  let pvPostFadeContinuationTv: number | null = null;
  let terminalFormulaAr: string | null = null;
  let rawRimFairValue: number | null = null;
  let rawClippedToZero = false;
  let rawClippedReasonAr: string | null = null;
  let terminalRoeUsed: number | null = null;
  let terminalRetentionUsed: number | null = null;
  let terminalGrowthRateB: number | null = null;
  let fadeYearsUsed: number | null = null;
  let terminalShareOfRimPct: number | null = null;
  let terminalShareFormulaAr: string | null = null;
  let cleanSurplusVerified = false;
  const rimNotesAr: string[] = [RIM_METHODOLOGY_NOTE_AR];

  const effectiveSharesUsed = finiteOrNull(
    inputs.metricAudit?.effectiveAnalyticalShares ?? inputs.sharesOutstanding
  );
  const effectiveSharesSourceLabelAr =
    inputs.metricAudit?.effectiveAnalyticalSharesSource === 'quarterly_record'
      ? `أسهم نهاية الفترة الفصلية (${inputs.metricAudit.quarterlyEopSharesPeriod ?? 'أحدث فترة'})`
      : inputs.metricAudit?.effectiveAnalyticalSharesSource === 'daily_listed_shares'
      ? `الأسهم المدرجة يومياً (${inputs.metricAudit.dailyListedSharesDate ?? 'أحدث جلسة'})`
      : inputs.metricAudit?.effectiveAnalyticalSharesSource === 'company_metadata'
      ? 'سجل الشركة الأساسي (sharesOutstanding)'
      : effectiveSharesUsed !== null
      ? 'عدد الأسهم المعتمد للتقييم'
      : 'غير متاح';

  if (!finCurrencyValid) {
    rimReasonAr = 'RIM مستبعد: عملة القوائم المالية غير مدعومة أو متضاربة.';
  } else if (keCurrency !== null && keCurrency !== effectiveFinCurrency) {
    rimReasonAr = `RIM مستبعد: القوائم المالية والقيمة الدفترية بعملة ${effectiveFinCurrency} وتكلفة حقوق الملكية Ke بعملة ${keCurrency} (r_Mode=${rMode}) ولا يُحوَّل آلياً بسعر الصرف.`;
    modelNotes.push(rimReasonAr);
  } else if (bvpsBasis === 'total_equity_unattested' || bvpsBlockedAsUnattested) {
    rimReasonAr =
      inputs.metricAudit?.valuationBvps.unavailableReasonAr ||
      'RIM مستبعد: حقوق المساهمين العاديين (EquityCommon / attested_total_equals_common) غير موثقة؛ لا يُستخدم إجمالي حقوق الملكية غير المفصول عن الأقلية في B0.';
  } else if (bvps === null || bvps <= 0) {
    rimReasonAr =
      bvps !== null && bvps <= 0
        ? 'RIM مستبعد: القيمة الدفترية للأسهم العادية (Common BVPS) غير موجبة (<= 0).'
        : 'RIM مستبعد: القيمة الدفترية للأسهم العادية (Common BVPS) غير متاحة.';
  } else if (forwardRoeUsed === null) {
    rimReasonAr =
      inputs.metricAudit?.valuationRoe.unavailableReasonAr ||
      'RIM مستبعد: العائد على حقوق المساهمين العاديين (سواء RIM_Expected_ROE أو ROE التاريخي العادي) غير متاح.';
  } else if (costOfEquity === null || costOfEquity <= 0) {
    rimReasonAr = 'RIM مستبعد: تكلفة حقوق الملكية (Ke) غير متاحة.';
  } else if (rimRetention === null) {
    rimReasonAr = rimRetentionResolution.noteAr
      ? rimRetentionResolution.noteAr.startsWith('RIM مستبعد:')
        ? rimRetentionResolution.noteAr
        : `RIM مستبعد: ${rimRetentionResolution.noteAr}`
      : 'RIM مستبعد: نسبة الاحتجاز المطلوبة وفق السياسة المختارة غير متاحة في المصادر المعتمدة.';
    modelNotes.push(rimReasonAr);
  } else if (terminalMethod === null) {
    rimReasonAr =
      'RIM مستبعد: طريقة القيمة النهائية (RIM_Terminal_Method = 1 أو 2 أو 3) غير محددة في المعاملات؛ لا يوجد اختيار افتراضي صامت.';
    modelNotes.push(rimReasonAr);
  } else {
    // Validate Method 2 & 3 parameters cleanly BEFORE accepting
    let terminalValidationError: string | null = null;
    if (terminalMethod === 2) {
      if (rawFadeYears === null || !Number.isInteger(rawFadeYears) || rawFadeYears < 1 || rawFadeYears > 20) {
        terminalValidationError =
          'RIM مستبعد: طريقة التلاشي (RIM_Terminal_Method = 2) تتطلب إدخال RIM_Fade_Years كعدد صحيح بين 1 و 20.';
      } else {
        fadeYearsUsed = rawFadeYears;
        terminalRoeUsed = rawTermRoe !== null ? rawTermRoe : costOfEquity;
        terminalRetentionUsed = rawTermRet !== null ? rawTermRet : rimRetention;
        if (Math.abs(terminalRoeUsed - costOfEquity) > 1e-12) {
          if (rawTermRet === null) {
            terminalValidationError =
              'RIM مستبعد: عند اختلاف RIM_Terminal_ROE عن Ke في طريقة التلاشي (2) يلزم إدخال RIM_Terminal_Retention لحساب القيمة المستمرة بعد التلاشي.';
          } else {
            terminalGrowthRateB = terminalRoeUsed * rawTermRet;
            if (terminalGrowthRateB >= costOfEquity) {
              terminalValidationError = `RIM مستبعد: معدل نمو القيمة الدفترية النهائي g_B = ${(terminalGrowthRateB * 100).toFixed(2)}% يساوي أو يتجاوز Ke = ${(costOfEquity * 100).toFixed(2)}%.`;
            }
          }
        } else {
          terminalGrowthRateB = terminalRoeUsed * terminalRetentionUsed;
        }
      }
    } else if (terminalMethod === 3) {
      if (rawTermRoe === null || rawTermRet === null) {
        terminalValidationError =
          'RIM مستبعد: طريقة الاستمرار (RIM_Terminal_Method = 3) تتطلب إدخال RIM_Terminal_ROE وRIM_Terminal_Retention صراحةً (دون افتراض صامت).';
      } else if (rawTermRet < 0 || rawTermRet > 1) {
        terminalValidationError =
          'RIM مستبعد: قيمة RIM_Terminal_Retention يجب أن تقع بين 0 و 1.';
      } else {
        terminalRoeUsed = rawTermRoe;
        terminalRetentionUsed = rawTermRet;
        terminalGrowthRateB = rawTermRoe * rawTermRet;
        if (terminalGrowthRateB >= costOfEquity) {
          terminalValidationError = `RIM مستبعد: معدل نمو القيمة الدفترية النهائي g_B = ROE_term × b_term (${(terminalGrowthRateB * 100).toFixed(2)}%) يجب أن يكون أقل من Ke (${(costOfEquity * 100).toFixed(2)}%).`;
        }
      }
    } else {
      terminalRoeUsed = forwardRoeUsed;
      terminalRetentionUsed = null;
      terminalGrowthRateB = null;
    }

    if (terminalValidationError) {
      rimReasonAr = terminalValidationError;
      modelNotes.push(terminalValidationError);
    } else {
      const projectionRoe = forwardRoeUsed;
      let pvRiSum = 0;
      let projBvps = bvps;
      let allCleanSurplusOk = true;
      let allEquityChargeOnOpeningOk = true;
      for (let t = 1; t <= 5; t++) {
        const openingBvps = projBvps;
        const expectedEps = projectionRoe * openingBvps;
        const impliedDps = expectedEps * (1 - rimRetention);
        const equityCharge = costOfEquity * openingBvps;
        const residualIncome = (projectionRoe - costOfEquity) * openingBvps;
        const closingBvps = openingBvps + expectedEps - impliedDps;
        const expectedCleanGrowth = openingBvps * (1 + projectionRoe * rimRetention);
        if (
          !Number.isFinite(closingBvps) ||
          Math.abs(closingBvps - expectedCleanGrowth) > 1e-6 * Math.max(1, Math.abs(closingBvps))
        ) {
          allCleanSurplusOk = false;
        }
        if (
          !Number.isFinite(equityCharge) ||
          Math.abs(equityCharge - costOfEquity * openingBvps) > 1e-9 * Math.max(1, Math.abs(equityCharge))
        ) {
          allEquityChargeOnOpeningOk = false;
        }
        const discountFactor = Math.pow(1 + costOfEquity, t);
        const presentValueRi = residualIncome / discountFactor;
        pvRiSum += presentValueRi;
        rimYears.push({
          year: t,
          openingBvps,
          expectedEps,
          retentionRatio: rimRetention,
          impliedDps,
          equityCharge,
          residualIncome,
          closingBvps,
          discountFactor,
          presentValueRi,
        });
        projBvps = closingBvps;
      }

      pvRiSum5Y = pvRiSum;
      terminalClosingBvps = projBvps;

      let terminalRi = 0;
      let pvTerminalRi = 0;

      if (terminalMethod === 1) {
        terminalFormulaAr = 'PV_TV = ((ROE_proj − Ke) × B₅ ÷ Ke) ÷ (1 + Ke)⁵';
        terminalRi = ((projectionRoe - costOfEquity) * projBvps) / costOfEquity;
        pvTerminalRi = terminalRi / Math.pow(1 + costOfEquity, 5);
        consistencyChecksAr.push(
          'نمط 1 (بقاء RI ثابتاً): يفترض استمرار الدخل المتبقي بعد السنة 5 ثابتاً بلا نمو إضافي (PV_TV = (ROE_proj - Ke) × B5 / Ke ÷ (1+Ke)^5).'
        );
      } else if (terminalMethod === 2) {
        const fyCount = fadeYearsUsed!;
        const targetTermRoe = terminalRoeUsed!;
        const fadeRet = terminalRetentionUsed!;
        let fadeOpeningBvps = projBvps;
        let pvFadeSum = 0;
        let lastFadeRi = 0;

        for (let k = 1; k <= fyCount; k++) {
          const roeK = projectionRoe + ((targetTermRoe - projectionRoe) * k) / fyCount;
          const expectedEpsK = roeK * fadeOpeningBvps;
          const impliedDpsK = expectedEpsK * (1 - fadeRet);
          const equityChargeK = costOfEquity * fadeOpeningBvps;
          const riK = (roeK - costOfEquity) * fadeOpeningBvps;
          const closingBvpsK = fadeOpeningBvps + expectedEpsK - impliedDpsK;
          const expectedCleanK = fadeOpeningBvps * (1 + roeK * fadeRet);
          if (
            !Number.isFinite(closingBvpsK) ||
            Math.abs(closingBvpsK - expectedCleanK) > 1e-6 * Math.max(1, Math.abs(closingBvpsK))
          ) {
            allCleanSurplusOk = false;
          }
          if (
            !Number.isFinite(equityChargeK) ||
            Math.abs(equityChargeK - costOfEquity * fadeOpeningBvps) >
              1e-9 * Math.max(1, Math.abs(equityChargeK))
          ) {
            allEquityChargeOnOpeningOk = false;
          }
          const dfK = Math.pow(1 + costOfEquity, 5 + k);
          const pvK = riK / dfK;
          pvFadeSum += pvK;
          lastFadeRi = riK;
          fadeSchedule.push({
            year: 5 + k,
            openingBvps: fadeOpeningBvps,
            roeRate: roeK,
            expectedEps: expectedEpsK,
            retentionRatio: fadeRet,
            impliedDps: impliedDpsK,
            equityCharge: equityChargeK,
            residualIncome: riK,
            closingBvps: closingBvpsK,
            discountFactor: dfK,
            presentValueRi: pvK,
          });
          fadeOpeningBvps = closingBvpsK;
        }

        let postFadeContTv = 0;
        let pvPostFadeContTv = 0;
        if (Math.abs(targetTermRoe - costOfEquity) > 1e-12 && terminalGrowthRateB !== null) {
          postFadeContTv =
            ((targetTermRoe - costOfEquity) * fadeOpeningBvps) / (costOfEquity - terminalGrowthRateB);
          pvPostFadeContTv = postFadeContTv / Math.pow(1 + costOfEquity, 5 + fyCount);
          terminalFormulaAr = `تلاشي خطي على مدى ${fyCount} سنوات (Y6..Y${5 + fyCount}) + قيمة مستمرة ((ROE_term − Ke) × B_${5 + fyCount} ÷ (Ke − g_B)) ÷ (1 + Ke)^${5 + fyCount}`;
        } else {
          terminalFormulaAr = `تلاشي خطي لـ ROE نحو Ke على مدى ${fyCount} سنوات (Y6..Y${5 + fyCount}) مع خصم كل سنة بـ (1 + Ke)^(5+k) وانعدام الفائض بعدها`;
        }
        postFadeContinuationTv = postFadeContTv;
        pvPostFadeContinuationTv = pvPostFadeContTv;
        terminalRi = postFadeContTv !== 0 ? postFadeContTv : lastFadeRi;
        pvTerminalRi = pvFadeSum + pvPostFadeContTv;
        consistencyChecksAr.push(
          `نمط 2 (تلاشي ROE): يتلاشى العائد خطياً على مدى ${fyCount} سنوات من ${(projectionRoe * 100).toFixed(2)}% إلى ${(targetTermRoe * 100).toFixed(2)}% (قيمة مستمرة بعد التلاشي = ${pvPostFadeContTv.toFixed(2)} مخصومة عند السنة ${5 + fyCount}).`
        );
      } else {
        // terminalMethod === 3
        const tRoe = terminalRoeUsed!;
        const gB = terminalGrowthRateB!;
        terminalFormulaAr = 'PV_TV = ((ROE_term − Ke) × B₅ ÷ (Ke − g_B)) ÷ (1 + Ke)⁵ حيث g_B = ROE_term × b_term';
        terminalRi = ((tRoe - costOfEquity) * projBvps) / (costOfEquity - gB);
        pvTerminalRi = terminalRi / Math.pow(1 + costOfEquity, 5);
        consistencyChecksAr.push(
          `نمط 3 (استمرار النمو الدائم): g_B = ${(gB * 100).toFixed(2)}% < Ke (${(costOfEquity * 100).toFixed(2)}%)، القيمة المستمرة مخصومة بـ (1+Ke)^5 ومتسقة مع Clean Surplus.`
        );
      }

      const candidateRaw = bvps + pvRiSum + pvTerminalRi;
      const anyRowNonFinite =
        rimYears.some(
          (r) =>
            !Number.isFinite(r.openingBvps) ||
            !Number.isFinite(r.closingBvps) ||
            !Number.isFinite(r.residualIncome) ||
            !Number.isFinite(r.presentValueRi)
        ) ||
        fadeSchedule.some(
          (r) =>
            !Number.isFinite(r.openingBvps) ||
            !Number.isFinite(r.closingBvps) ||
            !Number.isFinite(r.residualIncome) ||
            !Number.isFinite(r.presentValueRi)
        );

      if (
        anyRowNonFinite ||
        !Number.isFinite(pvRiSum) ||
        !Number.isFinite(terminalRi) ||
        !Number.isFinite(pvTerminalRi) ||
        !Number.isFinite(candidateRaw)
      ) {
        rimReasonAr =
          'RIM مستبعد: ناتج الحساب غير منتهٍ أو غير صالح عددياً (NaN/Infinity) ولا يدخل في القيمة العادلة المركبة.';
        modelNotes.push(rimReasonAr);
        rimValue = null;
        rawRimFairValue = null;
        pvRiSum5Y = null;
        terminalRiValue = null;
        pvTerminalRiValue = null;
        postFadeContinuationTv = null;
        pvPostFadeContinuationTv = null;
        terminalShareOfRimPct = null;
        terminalShareFormulaAr = null;
        cleanSurplusVerified = false;
      } else {
        terminalRiValue = terminalRi;
        pvTerminalRiValue = pvTerminalRi;
        rawRimFairValue = candidateRaw;
        if (rawRimFairValue < 0) {
          rimValue = 0;
          rawClippedToZero = true;
          rawClippedReasonAr = `القيمة الخام المحسوبة سالبة (${rawRimFairValue.toFixed(2)})؛ تم ضبط القيمة العادلة النهائية للسهم عند 0.00 وفق مبدأ المسؤولية المحدودة لحملة الأسهم العادية.`;
          consistencyChecksAr.push(`تنبيه القص الصفري: ${rawClippedReasonAr}`);
        } else {
          rimValue = rawRimFairValue;
        }
        cleanSurplusVerified = allCleanSurplusOk;
        terminalShareOfRimPct =
          rawRimFairValue > 0 ? (pvTerminalRi / rawRimFairValue) * 100 : null;
        terminalShareFormulaAr =
          rawRimFairValue > 0
            ? 'PV(Terminal RI) ÷ Raw RIM Fair Value × 100'
            : 'غير قابلة للاحتساب لأن المقام (الناتج الخام لـ RIM) يساوي صفراً أو سالباً.';

        // Verify horizon continuity (Y1..Y5 & Y5->Y6 fade continuity with zero duplicated/skipped years)
        let horizonContinuityOk =
          rimYears.length === 5 && rimYears.every((r, idx) => r.year === idx + 1);
        for (let i = 1; i < rimYears.length; i++) {
          if (
            Math.abs(rimYears[i].openingBvps - rimYears[i - 1].closingBvps) >
            1e-6 * Math.max(1, Math.abs(rimYears[i].openingBvps))
          ) {
            horizonContinuityOk = false;
          }
        }
        if (terminalMethod === 2 && fadeSchedule.length > 0) {
          const y5Closing = rimYears[4]?.closingBvps ?? projBvps;
          if (
            Math.abs(fadeSchedule[0].openingBvps - y5Closing) >
            1e-6 * Math.max(1, Math.abs(y5Closing))
          ) {
            horizonContinuityOk = false;
          }
          for (let i = 0; i < fadeSchedule.length; i++) {
            if (fadeSchedule[i].year !== 6 + i) horizonContinuityOk = false;
            if (
              i > 0 &&
              Math.abs(fadeSchedule[i].openingBvps - fadeSchedule[i - 1].closingBvps) >
                1e-6 * Math.max(1, Math.abs(fadeSchedule[i].openingBvps))
            ) {
              horizonContinuityOk = false;
            }
          }
        }

        consistencyChecksAr.push(
          `توافق الأساس المحاسبي وفصل المدخلات: حقوق الملكية (${bvpsBasisLabelAr}) | العائد التاريخي (${roeBasisLabelAr}) | أفق التوقع يستخدم تقديرات مستقبلية وضمنية (${forwardRoeBasisLabelAr}).`
        );
        consistencyChecksAr.push(
          allEquityChargeOnOpeningOk
            ? 'تحقق تكلفة الملكية: تم احتساب عبء حقوق الملكية على القيمة الدفترية الافتتاحية (Ke × B_{t-1}) في جميع السنوات.'
            : 'تنبيه: تعذر التحقق من احتساب عبء حقوق الملكية على القيمة الدفترية الافتتاحية.'
        );
        consistencyChecksAr.push(
          allCleanSurplusOk
            ? 'تم التحقق من تطابق الفائض النظيف (Clean Surplus: B_t = B_{t-1} + EPS_t - DPS_t) عبر جميع السنوات.'
            : 'تنبيه: تعذر التحقق من تطابق الفائض النظيف (Clean Surplus).'
        );
        consistencyChecksAr.push(
          horizonContinuityOk
            ? terminalMethod === 2
              ? `استمرارية الأفق وتوقيت الخصم: Y5 الختامية تساوي Y6 الافتتاحية دون تكرار أو قفز سنوات، بخصم (1+Ke)^(5+k) لسنوات التلاشي و(1+Ke)^${5 + (fadeYearsUsed ?? 0)} للقيمة المستمرة.`
              : 'استمرارية الأفق وتوقيت الخصم: سنوات التوقع متصلة Y1..Y5 دون فجوات، والقيمة النهائية مرتكزة على B₅ ومخصومة بـ (1+Ke)^5.'
            : 'تنبيه: تم رصد عدم اتصال في تسلسل القيمة الدفترية أو ترقيم السنوات.'
        );
        if (terminalShareOfRimPct !== null && terminalShareOfRimPct > 70) {
          consistencyChecksAr.push(
            `تنبيه اعتماد نهائي: القيمة النهائية تشكل ${terminalShareOfRimPct.toFixed(1)}% من إجمالي قيمة RIM؛ يوصى بمراجعة افتراضات المرحلة النهائية.`
          );
        }
        if (explicitForwardRoe !== null && roe !== null && Math.abs(explicitForwardRoe - roe) > 0.05) {
          consistencyChecksAr.push(
            `ملاحظة فصل العائد: العائد المستقبلي RIM_Expected_ROE (${(explicitForwardRoe * 100).toFixed(2)}%) يختلف عن ROE التاريخي (${(roe * 100).toFixed(2)}%).`
          );
        }
        if (
          Math.abs(projectionRoe - costOfEquity) < 1e-12 &&
          (terminalMethod === 1 || Math.abs((terminalRoeUsed ?? costOfEquity) - costOfEquity) < 1e-12)
        ) {
          rimNotesAr.push(
            'عند تساوي العائد مع تكلفة حقوق الملكية (ROE = Ke) ينعدم الدخل المتبقي وتقترب القيمة العادلة من B0.'
          );
        }
      }
    }
  }

  const fadeScheduleStatus: 'applicable' | 'not_applicable' | 'unavailable' =
    terminalMethod === 1 || terminalMethod === 3
      ? 'not_applicable'
      : terminalMethod === 2 && rimValue !== null && fadeSchedule.length > 0
      ? 'applicable'
      : 'unavailable';

  const rimAudit: RimAuditSummary = {
    eligible: rimValue !== null,
    exclusionReasonAr: rimValue !== null ? null : rimReasonAr,
    openingBvps: bvps,
    bvpsBasis,
    bvpsBasisLabelAr,
    roeUsed: roe,
    roeBasis,
    roeBasisLabelAr,
    forwardRoeUsed,
    forwardRoeBasis,
    forwardRoeBasisLabelAr,
    costOfEquity,
    retentionUsed: rimRetention,
    retentionPolicy: rimRetentionPolicy,
    historicalRetentionRatio,
    terminalMethod,
    terminalMethodLabelAr,
    terminalRoeUsed,
    terminalRetentionUsed,
    terminalGrowthRateB,
    fadeYears: fadeYearsUsed,
    fadeSchedule,
    fadeScheduleStatus,
    postFadeContinuationTv,
    pvPostFadeContinuationTv,
    terminalFormulaAr,
    terminalShareOfRimPct,
    terminalShareFormulaAr,
    rawClippedToZero,
    rawClippedReasonAr,
    effectiveSharesUsed,
    effectiveSharesSourceLabelAr,
    consistencyChecksAr,
    years: rimYears,
    pvResidualIncome5Y: pvRiSum5Y,
    terminalClosingBvps,
    terminalRi: terminalRiValue,
    pvTerminalRi: pvTerminalRiValue,
    rawRimFairValue,
    rimFairValue: rimValue,
    impliedPB: rimValue !== null && bvps !== null && bvps > 0 ? rimValue / bvps : null,
    cleanSurplusVerified,
    methodologyNotesAr: rimNotesAr,
  };

  // 8. Model 4: Relative Valuation — بدون أي أوزان صامتة وباشتراط أسس الأسهم العادية الموثقة
  let relativeValue: number | null = null;
  let relativeReasonAr: string | null = null;
  const targetPeVal = resolved.targetPE.value;
  const targetPbVal = resolved.targetPB.value;
  const peImplied =
    finCurrencyValid && epsTTM !== null && epsTTM > 0 && targetPeVal !== null && targetPeVal > 0
      ? epsTTM * targetPeVal
      : null;
  const pbImplied =
    finCurrencyValid && bvps !== null && bvps > 0 && targetPbVal !== null && targetPbVal > 0
      ? bvps * targetPbVal
      : null;

  let unavailableRelativeReasonAr: string | null = null;
  if (!finCurrencyValid) {
    relativeReasonAr = 'التقييم النسبي مستبعد: عملة القوائم المالية غير مدعومة أو متضاربة.';
  } else if (currencyConsistencyBlockedReasonAr) {
    relativeReasonAr = currencyConsistencyBlockedReasonAr;
  } else if (peImplied !== null && pbImplied !== null) {
    const relPeW = resolved.relativePeWeight.value;
    const relPbW = resolved.relativePbWeight.value;
    if (relPeW !== null && relPbW !== null && relPeW >= 0 && relPbW >= 0 && relPeW + relPbW > 0) {
      const totalRelW = relPeW + relPbW;
      relativeValue = (peImplied * relPeW + pbImplied * relPbW) / totalRelW;
    }
  } else if (peImplied !== null) {
    relativeValue = peImplied;
  } else if (pbImplied !== null) {
    relativeValue = pbImplied;
  } else {
    const blockedReasons: string[] = [];
    if (targetPeVal !== null && targetPeVal > 0 && epsTTM === null) {
      blockedReasons.push(
        inputs.metricAudit?.valuationEps.unavailableReasonAr ||
          'Target_PE معلّق لغياب NetIncomeCommon_TTM الموثق (لا يُستخدم صافي الربح الموحد في التقييم).'
      );
    }
    if (targetPbVal !== null && targetPbVal > 0 && bvps === null) {
      blockedReasons.push(
        inputs.metricAudit?.valuationBvps.unavailableReasonAr ||
          'Target_PB معلّق لغياب EquityCommon الموثق (لا يُستخدم إجمالي حقوق الملكية دون إقرار).'
      );
    }
    unavailableRelativeReasonAr =
      blockedReasons.length > 0
        ? `التقييم النسبي مستبعد: ${blockedReasons.join(' | ')}`
        : 'التقييم النسبي غير متاح: مضاعف القطاع أو السهم المستهدف (P/E أو P/B) غير محفوظ أو الأساس المحاسبي العادي غير موجب.';
    relativeReasonAr = unavailableRelativeReasonAr;
    if (epsTTM !== null || bvps !== null || blockedReasons.length > 0) {
      modelNotes.push(relativeReasonAr);
    }
  }

  const relativeAudit = buildRelativeValuationAudit({
    resolvedPeWeight: resolved.relativePeWeight,
    resolvedPbWeight: resolved.relativePbWeight,
    priority,
    peImplied,
    pbImplied,
    relativeFairValue: relativeValue,
    finCurrencyValid,
    currencyConsistencyBlockedReasonAr,
    companyOverridesConfirmed: inputs.companyOverridesConfirmed,
    macroParamsConfirmed: inputs.macroParamsConfirmed,
    unavailableReasonAr: unavailableRelativeReasonAr,
  });

  if (relativeValue === null && relativeAudit.blockingReasonAr && !relativeReasonAr) {
    relativeReasonAr = relativeAudit.blockingReasonAr;
    modelNotes.push(relativeReasonAr);
  }

  // 9. Model 5: Graham (Strictly requires attested Common EPS & Common BVPS > 0)
  let grahamValue: number | null = null;
  let grahamReasonAr: string | null = null;
  if (!finCurrencyValid) {
    grahamReasonAr = 'جراهام مستبعد: عملة القوائم المالية غير مدعومة أو متضاربة.';
  } else if (currencyConsistencyBlockedReasonAr) {
    grahamReasonAr = currencyConsistencyBlockedReasonAr;
  } else if (epsTTM !== null && epsTTM > 0 && bvps !== null && bvps > 0) {
    const candidateGraham = Math.sqrt(22.5 * epsTTM * bvps);
    if (Number.isFinite(candidateGraham)) {
      grahamValue = candidateGraham;
    } else {
      grahamReasonAr = 'جراهام مستبعد: ناتج الحساب غير منتهٍ أو غير صالح عددياً.';
    }
  } else if (epsBlockedAsConsolidated || bvpsBlockedAsUnattested) {
    const parts: string[] = [];
    if (epsBlockedAsConsolidated) {
      parts.push('صافي ربح المساهمين العاديين NetIncomeCommon_TTM غير موثق');
    }
    if (bvpsBlockedAsUnattested) {
      parts.push('حقوق المساهمين العاديين EquityCommon غير موثقة');
    }
    grahamReasonAr = `جراهام مستبعد: يتطلب ربحية وقيمة دفترية موثقة للأسهم العادية (${parts.join('، ')}).`;
  } else {
    grahamReasonAr = 'جراهام مستبعد: يتطلب ربحية أسهم عادية (Common EPS_TTM) موجبة وقيمة دفترية عادية (Common BVPS) موجبة.';
  }

  // 10. Composite Fair Value with Strictly Stored Weights + Configured Weight Tracking
  const wDCF = resolveWeight('Weight_DCF');
  const wDDM = resolveWeight('Weight_DDM');
  const wRelative = resolveWeight('Weight_Relative');
  const wGraham = resolveWeight('Weight_Graham');
  const wRIM = resolveWeight('Weight_RIM');

  const rawWeightSum = wDCF + wDDM + wRIM + wRelative + wGraham;
  const configuredWeights = {
    dcf: rawWeightSum > 0 ? (wDCF / rawWeightSum) * 100 : 0,
    ddm: rawWeightSum > 0 ? (wDDM / rawWeightSum) * 100 : 0,
    rim: rawWeightSum > 0 ? (wRIM / rawWeightSum) * 100 : 0,
    relative: rawWeightSum > 0 ? (wRelative / rawWeightSum) * 100 : 0,
    graham: rawWeightSum > 0 ? (wGraham / rawWeightSum) * 100 : 0,
  };

  let activeWeightSum = 0;
  if (dcfValue !== null && Number.isFinite(dcfValue)) activeWeightSum += wDCF;
  if (ddmValue !== null && Number.isFinite(ddmValue)) activeWeightSum += wDDM;
  if (rimValue !== null && Number.isFinite(rimValue)) activeWeightSum += wRIM;
  if (relativeValue !== null && Number.isFinite(relativeValue)) activeWeightSum += wRelative;
  if (grahamValue !== null && Number.isFinite(grahamValue)) activeWeightSum += wGraham;

  let compositeFairValue: number | null = 0;
  if (activeWeightSum > 0) {
    if (dcfValue !== null && Number.isFinite(dcfValue)) compositeFairValue += dcfValue * (wDCF / activeWeightSum);
    if (ddmValue !== null && Number.isFinite(ddmValue)) compositeFairValue += ddmValue * (wDDM / activeWeightSum);
    if (rimValue !== null && Number.isFinite(rimValue)) compositeFairValue += rimValue * (wRIM / activeWeightSum);
    if (relativeValue !== null && Number.isFinite(relativeValue))
      compositeFairValue += relativeValue * (wRelative / activeWeightSum);
    if (grahamValue !== null && Number.isFinite(grahamValue))
      compositeFairValue += grahamValue * (wGraham / activeWeightSum);
    if (!Number.isFinite(compositeFairValue)) {
      compositeFairValue = null;
    }
  } else {
    compositeFairValue = null;
    modelNotes.push('لا توجد نماذج متاحة بأوزان محفوظة لحساب القيمة العادلة المرجحة.');
  }

  const weights = {
    dcf: dcfValue !== null && activeWeightSum > 0 ? (wDCF / activeWeightSum) * 100 : 0,
    ddm: ddmValue !== null && activeWeightSum > 0 ? (wDDM / activeWeightSum) * 100 : 0,
    rim: rimValue !== null && activeWeightSum > 0 ? (wRIM / activeWeightSum) * 100 : 0,
    relative: relativeValue !== null && activeWeightSum > 0 ? (wRelative / activeWeightSum) * 100 : 0,
    graham: grahamValue !== null && activeWeightSum > 0 ? (wGraham / activeWeightSum) * 100 : 0,
  };

  const rimInputSummaryAr = rimAudit.eligible
    ? `B0 = ${bvps!.toFixed(2)} (${bvpsBasisLabelAr}) · ROE المستقبلي = ${(forwardRoeUsed! * 100).toFixed(2)}% (${forwardRoeBasisLabelAr}) · احتجاز = ${(rimRetention! * 100).toFixed(1)}% · طريقة TV: ${terminalMethodLabelAr}`
    : null;
  const relInputSummaryAr =
    relativeValue !== null
      ? peImplied !== null && pbImplied !== null
        ? `Target_PE (${targetPeVal!.toFixed(2)}x × Common EPS ${epsTTM!.toFixed(2)}) + Target_PB (${targetPbVal!.toFixed(2)}x × Common BVPS ${bvps!.toFixed(2)} · ${bvpsBasisLabelAr})`
        : peImplied !== null
        ? `Target_PE فقط (${targetPeVal!.toFixed(2)}x × Common EPS ${epsTTM!.toFixed(2)})${
            targetPbVal !== null && targetPbVal > 0 && (bvps === null || bvps <= 0)
              ? ' — تم تعطيل Target_PB لعدم توثيق/موجبية Common BVPS'
              : ''
          }`
        : `Target_PB فقط (${targetPbVal!.toFixed(2)}x × Common BVPS ${bvps!.toFixed(2)} · ${bvpsBasisLabelAr})${
            targetPeVal !== null && targetPeVal > 0 && (epsTTM === null || epsTTM <= 0)
              ? ' — تم تعطيل Target_PE لعدم توثيق/موجبية Common EPS'
              : ''
          }`
      : null;
  const grahamInputSummaryAr =
    grahamValue !== null
      ? `√(22.5 × Common EPS ${epsTTM!.toFixed(2)} × Common BVPS ${bvps!.toFixed(2)} [${bvpsBasisLabelAr}])`
      : null;

  const modelStatuses: ModelEligibilityStatus[] = [
    {
      model: 'dcf',
      nameAr: 'التدفق النقدي المخصوم (DCF)',
      status: dcfValue !== null ? 'available' : 'excluded',
      fairValue: dcfValue,
      weightPct: weights.dcf,
      reasonAr: dcfValue !== null ? null : dcfReasonAr,
      inputBasisSummaryAr:
        dcfValue !== null ? `FCFF_TTM (${baseFcf!.toLocaleString('en-US')}) ÷ أسهم نهاية الفترة` : null,
    },
    {
      model: 'ddm',
      nameAr: 'خصم التوزيعات (DDM)',
      status: ddmValue !== null ? 'available' : 'excluded',
      fairValue: ddmValue,
      weightPct: weights.ddm,
      reasonAr: ddmValue !== null ? null : ddmReasonAr,
      inputBasisSummaryAr:
        ddmValue !== null && rawRegularDps !== null
          ? `D0 = ${rawRegularDps.toFixed(2)} (${inferredBasisStatus}) · Ke = ${((costOfEquity ?? 0) * 100).toFixed(2)}%`
          : null,
    },
    {
      model: 'rim',
      nameAr: 'الدخل المتبقي (RIM)',
      status: rimValue !== null ? 'available' : 'excluded',
      fairValue: rimValue,
      weightPct: weights.rim,
      reasonAr: rimValue !== null ? null : rimReasonAr,
      inputBasisSummaryAr: rimInputSummaryAr,
    },
    {
      model: 'relative',
      nameAr: 'التقييم النسبي بالمضاعفات',
      status: relativeValue !== null ? 'available' : 'excluded',
      fairValue: relativeValue,
      weightPct: weights.relative,
      reasonAr: relativeValue !== null ? null : relativeReasonAr,
      inputBasisSummaryAr: relInputSummaryAr,
    },
    {
      model: 'graham',
      nameAr: 'صيغة جراهام (Graham)',
      status: grahamValue !== null ? 'available' : 'excluded',
      fairValue: grahamValue,
      weightPct: weights.graham,
      reasonAr: grahamValue !== null ? null : grahamReasonAr,
      inputBasisSummaryAr: grahamInputSummaryAr,
    },
  ];

  const marginOfSafetyPct =
    compositeFairValue !== null &&
    compositeFairValue > 0 &&
    marketPrice !== null &&
    marketCurrencyMatchesFin
      ? ((compositeFairValue - marketPrice) / compositeFairValue) * 100
      : null;

  const upsidePotentialPct =
    compositeFairValue !== null &&
    marketPrice !== null &&
    marketPrice > 0 &&
    marketCurrencyMatchesFin
      ? ((compositeFairValue - marketPrice) / marketPrice) * 100
      : null;

  return {
    dcfDetails,
    modelNotes,
    modelStatuses,
    resolvedAssumptions: resolved,
    assumptionPriority: priority,
    sectorClassification,
    sectorPeMatchedKey: resolvedBundle.sectorPeMatchedKey,
    sectorPeLookupReasonAr: resolvedBundle.sectorPeLookupReasonAr,
    sectorPeConflictDetected: resolvedBundle.sectorPeConflictDetected,
    sectorPeConflictingEntries: resolvedBundle.sectorPeConflictingEntries,
    betaRaw,
    betaAdjusted,
    betaAnalyticalOverride,
    effectiveBetaForKe,
    betaStatus,
    betaSourceNoteAr,
    betaPolicyConflictAr,
    weights,
    configuredWeights,
    costOfEquity,
    wacc,
    financialCurrency,
    financialCurrencyStatus,
    marketPriceCurrency,
    amountUnit,
    sharesUnit,
    keCurrency,
    waccCurrency,
    rfMethodology,
    rfResolvedKey,
    rfResolvedScope,
    invalidGlobalParameters,
    currencyConsistencyBlockedReasonAr,
    rimMethodologyNoteAr: RIM_METHODOLOGY_NOTE_AR,
    rimRetentionPolicy,
    activeRimRetentionUsed: rimRetention,
    historicalRetentionRatio,
    dividendSummary: inputs.dividendSummary ?? null,
    ddmAudit,
    rimAudit,
    relativeAudit,
    metricAudit: inputs.metricAudit ?? null,
    epsTTM,
    bvps,
    roe,
    dcfValue,
    ddmValue,
    rimValue,
    relativeValue,
    grahamValue,
    compositeFairValue,
    marginOfSafetyPct,
    upsidePotentialPct,
  };
}
