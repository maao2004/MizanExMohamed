/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type QuarterType = 'Q1' | 'Q2' | 'Q3' | 'FY';

export type SectorClassification = 'non_financial' | 'financial' | 'unknown';
export type MarketPriceSource = 'lastPrice' | 'closePrice';
export type AssumptionPriority = 'company_first' | 'global_first';
export type AssumptionSource = 'company' | 'global' | 'missing';
export type BetaStatus = 'actual' | 'defaulted_missing' | 'unavailable_error';
export type TerminalValueMethod = 'perpetuity_growth' | 'exit_multiple';
export type ImportSourceType = 'quarterly' | 'daily' | 'beta' | 'parameters' | 'dividend';
export type DividendRecordType = 'regular' | 'special';
export type DividendApprovalStatus = 'proposed' | 'approved' | 'paid' | 'cancelled';
export type DividendDistributionSemantics = 'annual_total' | 'standalone_event' | 'installment';
export type RimRetentionPolicy = 'rim_parameter' | 'historical_retention' | 'minimum';
export type NetIncomeCommonBasis = 'explicit_common' | 'attested_net_income_equals_common';
export type CommonEquityBasis = 'explicit_common' | 'attested_total_equals_common';
export type DividendYearStatusValue = 'unknown' | 'partial' | 'complete' | 'confirmed_no_dividend';
export type CurrencyCode = 'EGP' | 'USD';
export type AmountUnit = 'base' | 'EGP_base' | 'USD_base' | 'EGP_millions' | 'USD_millions' | 'unspecified';
export type SharesUnit = 'shares' | 'unspecified' | 'millions';
export type CurrencyResolutionStatus = 'valid' | 'unsupported' | 'missing';
export type InstrumentType = 'equity' | 'bond' | 'other' | 'unknown';
export type SectorStatus = 'active' | 'disabled';
export type SectorPeLoadStatus = 'loading' | 'ready' | 'error' | 'permission_denied';
export type WeightedAvgSharesBasis =
  import('../core/contracts/weightedAvgSharesBasis').WeightedAvgSharesBasis;
export type EffectiveWeightedAvgSharesBasis =
  | 'ytd_weighted_avg'
  | 'q1_standalone_equivalent_to_ytd';
export type AccountingEpsMissingField =
  | 'netIncomeCommonYTD'
  | 'netIncomeCommonBasis'
  | 'weightedAvgSharesYTD'
  | 'weightedAvgSharesBasis'
  | 'periodStartDate'
  | 'periodEndDate'
  | 'periodDays'
  | 'isCapitalActionAdjusted';
export type AccountingEpsBlockCode =
  | 'currency_blocked'
  | 'no_records'
  | 'missing_net_income_common'
  | 'missing_weighted_avg_shares'
  | 'invalid_weighted_avg_shares'
  | 'missing_shares_basis'
  | 'unrecognized_shares_basis'
  | 'end_of_period_proxy_blocked'
  | 'unadjusted_weighted_avg_blocked'
  | 'unknown_shares_basis_blocked'
  | 'standalone_quarter_non_q1_blocked'
  | 'standalone_q1_missing_dates'
  | 'standalone_q1_period_conflict'
  | 'ttm_missing_comparatives'
  | 'ttm_capital_action_conflict'
  | 'ttm_missing_period_days'
  | 'ttm_boundary_conflict'
  | 'ttm_invalid_window_days'
  | 'ttm_unadjusted_shares_change'
  | 'ttm_numeric_reconstruction_failed';
export type RimTerminalMethod = 1 | 2 | 3;
export type RimForwardRoeBasis =
  | 'explicit_expected_roe'
  | 'historical_common_roe_carryover'
  | 'unavailable';

export interface SectorDefinition {
  sectorId: string;
  nameAr: string;
  aliases: string[];
  classification: SectorClassification;
  multiple: number | null;
  multipleSource?: string | null;
  multipleAsOfDate?: string | null;
  status: SectorStatus;
  notes?: string | null;
  legacyDocId?: string | null;
  isLegacyFormat?: boolean;
  contentHash?: string;
  updatedAt?: string;
  updatedBy?: string;
  serverUpdatedAt?: unknown;
  isDeleted?: boolean;
}

export interface SectorMatchCandidate {
  sectorId: string;
  nameAr: string;
  classification: SectorClassification;
  multiple: number | null;
  status: SectorStatus;
  matchedBy: 'sectorId' | 'exact_name' | 'normalized_name' | 'alias';
}

export interface SectorPeConflictEntry {
  key: string;
  value: number | null;
  resolvedSectorId: string | null;
}

export interface DividendYearStatusRecord {
  id?: string;
  ticker: string;
  fiscalYear: number;
  status: DividendYearStatusValue;
  confirmedSource: string | null;
  confirmedAt: string | null;
  notes: string | null;
  contentHash?: string;
  updatedAt?: string;
  serverUpdatedAt?: unknown;
  updatedBy?: string;
  schemaVersion?: number;
  isDeleted?: boolean;
}

export interface ManualCorrectionEntry {
  field: string;
  originalValue: string | number | boolean | null;
  correctedValue: string | number | boolean | null;
  editedAt: string;
  reasonAr?: string;
}

export type ManualCorrectionsMap = Record<string, ManualCorrectionEntry>;

/**
 * Write-request patch map for `manualCorrections` aligned with the central nested-map contract:
 * - `ManualCorrectionEntry` upserts that field's active correction.
 * - Explicit `null` deletes ONLY that field's active correction on the server.
 * - Omitted keys preserve existing server entries non-destructively.
 * Never store `null` deletion markers inside the read model (`ManualCorrectionsMap`).
 */
export type ManualCorrectionsWritePatch = Record<string, ManualCorrectionEntry | null>;

export interface MetadataFieldProvenance {
  value: string | null;
  source: 'admin_override' | 'daily_trading' | 'quarterly_record' | 'sector_registry' | 'missing';
  asOfDate: string | null;
}

export interface MetadataConflictItem {
  ticker: string;
  field: 'isinCode' | 'sector' | 'shortName' | 'fullName' | 'market';
  values: Array<{ value: string; source: string; asOfDate: string | null }>;
  reasonAr: string;
}

export interface FcffDiagnosticItem {
  ticker: string;
  period: string;
  field: string;
  value?: string | number | null;
  reasonAr: string;
}
export type LegacyRfMethodology = 'sovereign_raw';
export type RfMethodologyClassification =
  | 'sovereign_yield'
  | 'default_free'
  | 'synthetic'
  | 'unspecified';

export interface BetaAssumptionRecord {
  ticker: string;
  beta: number;
  asOfDate: string;
  source: string;
  contentHash?: string;
  updatedAt?: string;
  serverUpdatedAt?: unknown;
  updatedBy?: string;
  importId?: string;
  sourceFile?: string;
  sourceSheet?: string;
  sourceRow?: number;
  schemaVersion?: number;
  isDeleted?: boolean;
}

export interface DividendRecord {
  ticker: string;
  fiscalYear: number;
  cashDps: number;
  asOfDate: string;
  distributionId: string;
  recordType: DividendRecordType;
  approvalStatus: DividendApprovalStatus;
  distributionSemantics: DividendDistributionSemantics;
  exDividendDate?: string | null;
  paymentDate?: string | null;
  recordDate?: string | null;
  totalDistributionAmount?: number | null;
  eligibleSharesCount?: number | null;
  currency?: CurrencyCode | null;
  source?: string | null;
  parentAnnouncementId?: string | null;
  notes?: string | null;
  contentHash?: string;
  updatedAt?: string;
  serverUpdatedAt?: unknown;
  updatedBy?: string;
  importId?: string;
  sourceFile?: string;
  sourceSheet?: string;
  sourceRow?: number;
  schemaVersion?: number;
  isDeleted?: boolean;
}

export type DdmBasisStatus =
  | 'eligible_annual_total'
  | 'eligible_complete_year'
  | 'blocked_partial_year'
  | 'blocked_unconfirmed_events'
  | 'blocked_confirmed_no_dividend'
  | 'blocked_special_only'
  | 'blocked_missing';

export interface DdmSensitivityCell {
  ke: number;
  growth: number;
  spread: number;
  fairValue: number | null;
  isValid: boolean;
  invalidReasonAr: string | null;
}

export interface DdmAuditSummary {
  d0: number | null;
  d1: number | null;
  growth: number | null;
  growthSource?: 'company' | 'global' | 'missing' | 'loading_unconfirmed' | 'sensitivity_draft';
  growthSourceLabelAr?: string;
  growthAsOfDate?: string | null;
  growthDocumentarySource?: string | null;
  growthCompanyValue?: number | null;
  growthCompanyDocumentarySource?: string | null;
  growthCompanyAsOfDate?: string | null;
  growthGlobalValue?: number | null;
  growthGlobalDocumentarySource?: string | null;
  growthGlobalAsOfDate?: string | null;
  growthOverriddenByPriority?: boolean;
  growthPriority?: AssumptionPriority;
  isSensitivityDraft?: boolean;
  companyOverridesConfirmed?: boolean;
  macroParamsConfirmed?: boolean;
  costOfEquity: number | null;
  keMode?: number | null;
  keModeLabelAr?: string;
  keFormulaAr?: string;
  keMissingInputs?: string[];
  keMinusG: number | null;
  ddmFairValue: number | null;
  eligible: boolean;
  basisStatus: DdmBasisStatus;
  exclusionReasonAr: string | null;
  remediationAr?: string | null;
  basisFiscalYear: number | null;
  displayLatestEventsYear: number | null;
  latestPositiveDividendYear: number | null;
  source: 'dividend_records' | 'confirmed_no_dividend' | 'missing';
  completenessStatus: DividendYearStatusValue;
  inputMethod: 'annual_total' | 'aggregated_complete_year' | null;
  perShareNoteAr: string;
  dataCompletenessNoteAr: string;
  stabilityWarningAr: string | null;
  suitabilityNoteAr: string | null;
  ddmVsRetentionDifferenceReasonAr?: string | null;
  sensitivityKeAxis: number[];
  sensitivityGrowthAxis: number[];
  sensitivityMatrix: DdmSensitivityCell[][];
}

export interface DividendAggregationSummary {
  ticker: string;
  cutoffDate: string | null;
  valuationDate?: string | null;
  targetFiscalYear: number | null;
  displayLatestEventsYear?: number | null;
  latestPositiveDividendYear?: number | null;
  ddmBasisFiscalYear?: number | null;
  retentionFiscalYear?: number | null;
  fiscalYearDataAgeYears?: number | null;
  yearResolutionNoteAr?: string | null;
  source: 'dividend_records' | 'confirmed_no_dividend' | 'missing';
  dividendYearStatus: DividendYearStatusValue;
  dividendYearStatusSource?: string | null;
  dividendYearStatusConfirmedAt?: string | null;
  dividendYearStatusNotes?: string | null;
  regularDps: number | null;
  specialDps: number | null;
  totalDps: number | null;
  ddmEligible?: boolean;
  ddmBasisStatus?: DdmBasisStatus;
  ddmIneligibleReasonAr?: string | null;
  ddmInputMethod?: 'annual_total' | 'aggregated_complete_year' | null;
  dividendStabilityWarningAr?: string | null;
  dividendSuitabilityNoteAr?: string | null;
  paidRegularDps?: number | null;
  paidSpecialDps?: number | null;
  paidTotalDps?: number | null;
  paidAttributableDividends?: number | null;
  paidRecordsCount?: number;
  paidMissingPaymentDateCount?: number;
  totalAttributableDividends: number | null;
  attributableBasis?: 'total_distribution_amount' | 'cash_dps_x_eligible_shares' | 'confirmed_no_dividend' | 'unavailable';
  attributableUnavailableReasonAr?: string | null;
  fiscalYearIncomeUsed?: number | null;
  fiscalYearIncomeSource?: 'netIncomeCommonYTD' | 'netProfitYTD_attested_common' | 'netProfitYTD' | 'unavailable';
  payoutUnavailableReasonAr?: string | null;
  completedFiscalYear?: number | null;
  interimFiscalYears?: number[];
  historicalPayoutRatio: number | null;
  historicalRetentionRatio: number | null;
  partialPayoutRatio?: number | null;
  partialRetentionRatio?: number | null;
  historicalRetentionSuitableForRim?: boolean;
  historicalRetentionRimBlockReasonAr?: string | null;
  ddmVsRetentionDifferenceReasonAr?: string | null;
  dividendDatePolicyNoteAr?: string;
  currency: CurrencyCode | null;
  matchedRecordIds: string[];
  matchedRecordsCount: number;
  excludedFutureCount: number;
  excludedProposedCount?: number;
  excludedCancelledCount: number;
  excludedCurrencyMismatchCount: number;
  excludedDeduplicatedCount: number;
  statusCutoffExcludedCount?: number;
  statusMissingDateCount?: number;
  legacyFallbackUsed: boolean;
  legacyFallbackBlockedReasonAr?: string | null;
  warningsAr: string[];
}

export interface CompanyParameterOverride {
  key: string;
  nameAr?: string;
  value: number;
  description?: string;
  scope: 'company';
  ticker: string;
  valueType?: 'pct' | 'integer' | 'multiple' | 'mode' | 'number' | null;
  isPercentage?: boolean | null;
  parameterTypeSource?: 'registry' | 'explicit' | 'unspecified';
  unit?: string;
  currency?: CurrencyCode | string | null;
  forecastHorizonYears?: number | null;
  asOfDate?: string;
  source?: string;
  rfMethodology?: RfMethodologyClassification | LegacyRfMethodology;
  revision?: number;
  contentHash?: string;
  updatedAt?: string;
  serverUpdatedAt?: unknown;
  updatedBy?: string;
  isDeleted?: boolean;
}

export interface TombstoneRecord {
  id: string;
  collection: string;
  docId: string;
  ticker?: string | null;
  deletedAt: string;
  serverUpdatedAt?: unknown;
  deletedBy?: string | null;
  expiresAtMs: number;
}

export type DailyCellType = 's' | 'n' | 'b' | 'd' | 'e' | 'z';

export interface DailyRawCellValue {
  v: string | number | boolean | null;
  t: DailyCellType;
  w?: string | null;
  f?: string | null;
  formulaMissingCachedResult?: boolean;
}

export interface DailyTradingColumnSchema {
  colId: string;
  index: number;
  colLetter: string;
  headerName: string | null;
  normalizedHeader: string | null;
  mappedField: string | null;
  isDuplicateHeader?: boolean;
}

export interface DailyTradingSchemaRecord {
  schemaId: string;
  tradeDate?: string | null;
  sourceFile?: string | null;
  sourceSheet?: string | null;
  totalColumns: number;
  columns: DailyTradingColumnSchema[];
  contentHash?: string;
  updatedAt: string;
  serverUpdatedAt?: unknown;
}

export interface ImportRejectedRow {
  rowNumber: number;
  column: string;
  ticker?: string;
  reasonAr: string;
}

export interface ImportPreviewItem<T = Record<string, any>> {
  docId: string;
  label: string;
  status: 'insert' | 'update' | 'unchanged';
  record: T;
  contentHash: string;
  existingHash?: string | null;
  baseRevision?: number | null;
  changedFields?: string[];
  sourceRow?: number;
}

export interface ImportPreviewResult<T = Record<string, any>> {
  sourceType: ImportSourceType;
  fileName: string;
  sheetName: string;
  tradeDate?: string | null;
  dailySchema?: DailyTradingSchemaRecord | null;
  totalRows: number;
  inserts: ImportPreviewItem<T>[];
  updates: ImportPreviewItem<T>[];
  unchanged: ImportPreviewItem<T>[];
  rejected: ImportRejectedRow[];
  warnings: string[];
  importId: string;
  requiresSemanticsConfirmation?: boolean;
  defaultSemanticsUsed?: DividendDistributionSemantics;
  requiresApprovalConfirmation?: boolean;
  rowsMissingApprovalCount?: number;
}

export interface ImportBatchReport {
  importId: string;
  sourceType: ImportSourceType;
  totalBatches: number;
  completedBatches: number;
  failedBatchIndex: number | null;
  insertedCount: number;
  updatedCount: number;
  skippedUnchangedCount: number;
  failedError: string | null;
  remainingItemsCount: number;
}

export interface ResolvedAssumption {
  key: string;
  registryKey?: string;
  labelAr: string;
  value: number | null;
  source: AssumptionSource;
  companyValue: number | null;
  companyAsOfDate?: string | null;
  companyParameterSource?: string | null;
  globalValue: number | null;
  globalAsOfDate?: string | null;
  globalParameterSource?: string | null;
  isOverriddenByPriority: boolean;
  unitOrFormat?: 'pct' | 'multiple' | 'number' | 'mode';
  unit?: string | null;
  currency?: CurrencyCode | null;
  forecastHorizonYears?: number | null;
  asOfDate?: string | null;
  parameterSource?: string | null;
  enabledInEngine?: boolean;
  modeNoteAr?: string;
  rfMethodology?: RfMethodologyClassification;
}

export type RelativeWeightScopeState = 'company' | 'global' | 'missing' | 'loading_unconfirmed';
export type RelativeWeightValidity = 'valid' | 'missing' | 'loading_unconfirmed' | 'negative';
export type RelativeValuationBlendingStatus =
  | 'blended_both'
  | 'single_pe_only'
  | 'single_pb_only'
  | 'blocked_weights'
  | 'loading_unconfirmed'
  | 'blocked_currency'
  | 'unavailable';

export interface RelativeWeightDiagnostic {
  registryKey: 'Relative_PE_Weight' | 'Relative_PB_Weight';
  resolvedKey: 'relativePeWeight' | 'relativePbWeight';
  shortLabelAr: string;
  labelAr: string;
  meaningAr: string;
  rawValue: number | null;
  normalizedSharePct: number | null;
  scope: RelativeWeightScopeState;
  scopeLabelAr: string;
  documentarySource: string | null;
  asOfDate: string | null;
  companyValue: number | null;
  companyDocumentarySource: string | null;
  companyAsOfDate: string | null;
  globalValue: number | null;
  globalDocumentarySource: string | null;
  globalAsOfDate: string | null;
  isOverriddenByPriority: boolean;
  priorityExplanationAr: string | null;
  validity: RelativeWeightValidity;
  issueAr: string | null;
}

export interface RelativeValuationAudit {
  status: RelativeValuationBlendingStatus;
  statusLabelAr: string;
  priority: AssumptionPriority;
  priorityLabelAr: string;
  peImplied: number | null;
  pbImplied: number | null;
  relativeFairValue: number | null;
  blendingApplied: boolean;
  blendingRequired: boolean;
  weightsSum: number | null;
  formulaNoteAr: string;
  meaningNoteAr: string;
  peWeight: RelativeWeightDiagnostic;
  pbWeight: RelativeWeightDiagnostic;
  companyOverridesConfirmed: boolean;
  macroParamsConfirmed: boolean;
  loadingUnconfirmedScopes: Array<'company_assumptions' | 'macro_params'>;
  blockingReasonAr: string | null;
  remediationAr: string | null;
}

export type MetricCompletenessStatus =
  | 'complete'
  | 'unattested'
  | 'partial'
  | 'mismatch'
  | 'unavailable';

export type EpsPeriodKind =
  | 'standalone_quarter'
  | 'YTD'
  | 'FY'
  | 'TTM'
  | 'needs_review'
  | 'unknown';

export type ReportedEpsPeriodType =
  import('../core/contracts/reportedEpsPeriod').ReportedEpsPeriodType;

export type ReportedEpsFiscalQuarter =
  import('../core/contracts/reportedEpsPeriod').ReportedEpsFiscalQuarter;

export interface ReportedVsAccountingEpsComparison {
  status: 'aligned' | 'discrepancy' | 'withheld_period_or_basis_mismatch' | 'unavailable';
  reportedEps: number | null;
  reportedEpsPeriod: string | null;
  reportedEpsPeriodType?: ReportedEpsPeriodType | null;
  reportedEpsPeriodStart?: string | null;
  reportedEpsPeriodEnd?: string | null;
  reportedEpsSource: string | null;
  reportedEpsAdjusted: boolean | null;
  accountingEps: number | null;
  accountingEpsPeriod: string | null;
  accountingEpsPeriodStart?: string | null;
  accountingEpsPeriodEnd?: string | null;
  accountingEpsAdjusted: boolean | null;
  q1BoundaryOverlap?: boolean;
  tolerance: number;
  absoluteDifference: number | null;
  relativeDifferencePct: number | null;
  messageAr: string;
  remediationAr?: string | null;
}

export interface AuditedMetricItem {
  key: string;
  nameAr: string;
  value: number | null;
  formattedValue: string;
  equationAr: string;
  numeratorLabelAr: string;
  numeratorValue: number | null;
  denominatorLabelAr: string;
  denominatorValue: number | null;
  basisCode: string;
  basisLabelAr: string;
  periodLabel: string | null;
  periodKind: EpsPeriodKind;
  completenessStatus: MetricCompletenessStatus;
  isActionAdjusted?: boolean | null;
  originalSharesBasis?: string | null;
  originalSharesBasisLabelAr?: string | null;
  effectiveSharesBasis?: EffectiveWeightedAvgSharesBasis | null;
  effectiveSharesBasisLabelAr?: string | null;
  usedQ1DocumentedEquivalence?: boolean;
  remediationAr?: string | null;
  usedByModels: string[];
  notesAr: string[];
  unavailableReasonAr: string | null;
}

export interface PeriodSharesBasisEligibilityDecision {
  eligible: boolean;
  decision: 'eligible' | 'blocked';
  periodLabel: string;
  year: number;
  quarter: QuarterType;
  denominatorValue: number | null;
  originalSharesBasis: WeightedAvgSharesBasis | string | null;
  originalSharesBasisLabelAr: string;
  effectiveSharesBasis: EffectiveWeightedAvgSharesBasis | null;
  effectiveSharesBasisLabelAr: string;
  usedQ1DocumentedEquivalence: boolean;
  periodStartDate: string | null;
  periodEndDate: string | null;
  periodDays: number | null;
  blockedCode: AccountingEpsBlockCode | null;
  reasonAr: string;
  missingField: AccountingEpsMissingField | null;
  missingExcelColumn: string | null;
  remediationAr: string | null;
  sharesBasisNoteAr: string | null;
}

export interface AccountingEpsEligibilityDecision {
  eligible: boolean;
  decision: 'eligible' | 'blocked';
  accountingEpsValue: number | null;
  numeratorValue: number | null;
  numeratorBasis: NetIncomeCommonBasis | 'mixed_common' | 'unavailable';
  denominatorValue: number | null;
  originalSharesBasis: WeightedAvgSharesBasis | string | null;
  originalSharesBasisLabelAr: string;
  effectiveSharesBasis: EffectiveWeightedAvgSharesBasis | null;
  effectiveSharesBasisLabelAr: string;
  usedQ1DocumentedEquivalence: boolean;
  periodLabel: string | null;
  periodStartDate: string | null;
  periodEndDate: string | null;
  periodDays: number | null;
  isActionAdjusted: boolean | null;
  blockedCode: AccountingEpsBlockCode | null;
  reasonAr: string;
  missingField: AccountingEpsMissingField | null;
  missingExcelColumn: string | null;
  missingPeriod?: { period: string; year: number; quarter: QuarterType } | null;
  remediationAr: string | null;
  notesAr: string[];
}

export type EpsSelectionModelKey = 'targetPE' | 'graham' | 'marketPE';

export interface EpsModelSelectionPolicyEntry {
  model: EpsSelectionModelKey;
  nameAr: string;
  source: string;
  period: string | null;
  incomeScope: 'net_income_common_ttm' | 'consolidated_net_income_ttm' | 'unavailable';
  sharesBasis: 'current_eop_shares' | 'weighted_avg_shares' | 'unavailable';
  selectedValue: number | null;
  eligible: boolean;
  reasonAr: string;
  missingFields: string[];
}

export interface EpsSelectionPolicySummary {
  valuationEpsValue: number | null;
  valuationEpsBasisLabelAr: string;
  consolidatedAnalyticalEpsRef: number | null;
  perModel: {
    targetPE: EpsModelSelectionPolicyEntry;
    graham: EpsModelSelectionPolicyEntry;
    marketPE: EpsModelSelectionPolicyEntry;
  };
}

export interface MissingCommonFieldItem {
  period: string;
  year: number;
  quarter: QuarterType;
  field: 'equityCommon' | 'equityCommonBasis' | 'netIncomeCommonYTD' | 'netIncomeCommonBasis';
  excelColumn: string;
  labelAr: string;
  reasonAr: string;
  affectedModels: string[];
}

export interface MissingAccountingEpsFieldItem {
  period: string;
  year: number;
  quarter: QuarterType;
  field:
    | 'weightedAvgSharesYTD'
    | 'weightedAvgSharesBasis'
    | 'periodStartDate'
    | 'periodEndDate'
    | 'periodDays'
    | 'isCapitalActionAdjusted';
  excelColumn: string;
  labelAr: string;
  reasonAr: string;
  remediationAr?: string | null;
  affectedModels: string[];
}

export interface RequestedQuarterlyEditTarget {
  ticker: string;
  year: number;
  quarter: QuarterType;
  field: string;
  labelAr?: string;
}

export interface MetricAuditBundle {
  latestPeriod: string | null;
  sharesAlignmentStatus: 'aligned' | 'cross_source_mismatch' | 'unavailable';
  sharesAlignmentNoteAr: string | null;
  quarterlyEopShares: number | null;
  quarterlyEopSharesPeriod: string | null;
  dailyListedShares: number | null;
  dailyListedSharesDate: string | null;
  effectiveAnalyticalShares: number | null;
  effectiveAnalyticalSharesSource: 'quarterly_record' | 'company_metadata' | 'daily_listed_shares' | 'missing';
  netIncomeTTM: number | null;
  netIncomeCommonLatestPeriod: number | null;
  netIncomeCommonLatestBasis: NetIncomeCommonBasis | 'unavailable';
  netIncomeCommonTTM: number | null;
  netIncomeCommonTtmBasis: NetIncomeCommonBasis | 'mixed_common' | 'unavailable';
  netIncomeCommonTtmUnavailableReasonAr: string | null;
  equityBasisForValuation: CommonEquityBasis | 'total_equity_unattested' | 'unavailable';
  commonEquityLatest: number | null;
  totalEquityLatest: number | null;
  reportedEps: AuditedMetricItem;
  accountingEpsLatest: AuditedMetricItem;
  accountingEpsTTM: AuditedMetricItem;
  accountingEpsLatestEligibility?: AccountingEpsEligibilityDecision;
  accountingEpsTtmEligibility?: AccountingEpsEligibilityDecision;
  analyticalEpsTTM: AuditedMetricItem;
  analyticalCommonEpsTTM: AuditedMetricItem;
  valuationEps: AuditedMetricItem;
  epsSelectionPolicy: EpsSelectionPolicySummary;
  reportedVsAccountingComparison: ReportedVsAccountingEpsComparison;
  commonBvps: AuditedMetricItem;
  totalEquityBvps: AuditedMetricItem;
  valuationBvps: AuditedMetricItem;
  roeCommonEop: AuditedMetricItem;
  roeTotalEop: AuditedMetricItem;
  roeAverageEquity: AuditedMetricItem;
  valuationRoe: AuditedMetricItem;
  missingCommonFields: MissingCommonFieldItem[];
  missingAccountingEpsFields?: MissingAccountingEpsFieldItem[];
  summaryNotesAr: string[];
}

export interface RimAuditYearRow {
  year: number;
  openingBvps: number;
  expectedEps: number;
  retentionRatio: number;
  impliedDps: number;
  equityCharge: number;
  residualIncome: number;
  closingBvps: number;
  discountFactor: number;
  presentValueRi: number;
}

export interface RimFadeYearRow {
  year: number;
  openingBvps: number;
  roeRate: number;
  expectedEps: number;
  retentionRatio: number;
  impliedDps: number;
  equityCharge: number;
  residualIncome: number;
  closingBvps: number;
  discountFactor: number;
  presentValueRi: number;
}

export interface RimAuditSummary {
  eligible: boolean;
  exclusionReasonAr: string | null;
  openingBvps: number | null;
  bvpsBasis: string;
  bvpsBasisLabelAr: string;
  roeUsed: number | null;
  roeBasis: string;
  roeBasisLabelAr: string;
  forwardRoeUsed?: number | null;
  forwardRoeBasis?: RimForwardRoeBasis;
  forwardRoeBasisLabelAr?: string;
  costOfEquity: number | null;
  retentionUsed: number | null;
  retentionPolicy: RimRetentionPolicy;
  terminalMethod?: RimTerminalMethod | null;
  terminalMethodLabelAr?: string;
  terminalRoeUsed?: number | null;
  terminalRetentionUsed?: number | null;
  terminalGrowthRateB?: number | null;
  fadeYears?: number | null;
  fadeSchedule?: RimFadeYearRow[];
  fadeScheduleStatus?: 'applicable' | 'not_applicable' | 'unavailable';
  postFadeContinuationTv?: number | null;
  pvPostFadeContinuationTv?: number | null;
  terminalFormulaAr?: string | null;
  terminalShareOfRimPct?: number | null;
  terminalShareFormulaAr?: string | null;
  rawClippedToZero?: boolean;
  rawClippedReasonAr?: string | null;
  effectiveSharesUsed?: number | null;
  effectiveSharesSourceLabelAr?: string | null;
  historicalRetentionRatio?: number | null;
  consistencyChecksAr?: string[];
  years: RimAuditYearRow[];
  pvResidualIncome5Y: number | null;
  terminalClosingBvps: number | null;
  terminalRi: number | null;
  pvTerminalRi: number | null;
  rawRimFairValue: number | null;
  rimFairValue: number | null;
  impliedPB: number | null;
  cleanSurplusVerified: boolean;
  methodologyNotesAr: string[];
}

export interface ModelEligibilityStatus {
  model: 'dcf' | 'ddm' | 'rim' | 'relative' | 'graham';
  nameAr: string;
  status: 'available' | 'excluded';
  fairValue: number | null;
  weightPct: number;
  reasonAr: string | null;
  inputBasisSummaryAr?: string | null;
}

export interface ModelWeightsBreakdown {
  dcf: number;
  ddm: number;
  rim: number;
  relative: number;
  graham: number;
}

export interface ValuationSourcesSummary {
  ticker: string;
  latestFinancialPeriod: string | null;
  latestFinancialPeriodDate: string | null;
  marketPrice: number | null;
  marketPriceDate: string | null;
  marketPriceSource: MarketPriceSource | null;
  marketPriceCurrency?: CurrencyCode | 'UNSUPPORTED' | null;
  sharesOutstanding: number | null;
  sharesSource: 'quarterly_record' | 'company_metadata' | 'daily_listed_shares' | 'missing';
  sharesPeriod: string | null;
  sharesUnit?: SharesUnit;
  sharesIsEndOfPeriodNoteAr: string;
  epsBasisLabelAr?: string;
  reportedEps?: number | null;
  reportedEpsSource?: string | null;
  reportedEpsPeriodType?: ReportedEpsPeriodType | null;
  reportedEpsFiscalYear?: number | null;
  reportedEpsFiscalQuarter?: ReportedEpsFiscalQuarter | null;
  reportedEpsPeriodStart?: string | null;
  reportedEpsPeriodEnd?: string | null;
  reportedEpsPeriod?: string | null;
  roeBasisLabelAr?: string;
  roeAverageEquity?: number | null;
  fcffSource: string | null;
  fcffUnit: string | null;
  fcffStatus: 'available' | 'available_undocumented' | 'unavailable';
  fcffDocumentationWarningAr?: string | null;
  providerMarketCapThousands?: number | null;
  sectorClassification: SectorClassification;
  sectorName: string;
  sectorId?: string | null;
  rawSector?: string | null;
  sectorSource?: string | null;
  sectorDate?: string | null;
  sectorClassificationSource?: string | null;
  sectorPeMatchedKey?: string | null;
  sectorPeLookupReasonAr?: string | null;
  sectorPeConflictDetected?: boolean;
  sectorPeConflictingEntries?: SectorPeConflictEntry[];
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
  sectorPeError?: string | null;
  dcfSectorEligibilityReasonAr?: string | null;
  valuationDate?: string | null;
  priceSessionDate?: string | null;
  historicalRestatementLimitationAr?: string;
  dividendDatePolicyNoteAr?: string;
  assumptionPriority: AssumptionPriority;
  betaRaw: number | null;
  betaAdjusted: number | null;
  betaAnalyticalOverride?: number | null;
  betaAnalyticalAsOfDate?: string | null;
  betaAnalyticalSource?: string | null;
  effectiveBetaForKe?: number | null;
  betaStatus: BetaStatus;
  betaAsOfDate: string | null;
  betaSource: string | null;
  betaSourceNoteAr: string;
  betaPolicyConflictAr?: string | null;
  terminalValueMethod: TerminalValueMethod;
  forecastYears: number | null;
  financialCurrency?: CurrencyCode | 'UNSUPPORTED' | null;
  financialCurrencyStatus?: CurrencyResolutionStatus;
  projectedCashflowCurrency?: CurrencyCode | null;
  amountUnit?: AmountUnit;
  keCurrency?: CurrencyCode | null;
  waccCurrency?: CurrencyCode | null;
  rfMethodology?: RfMethodologyClassification;
  rfResolvedKey?: 'Rf_Egypt_10Y' | 'Rf_USD_10Y' | 'company_metadata' | null;
  rfResolvedScope?: AssumptionSource;
  rimMethodologyNoteAr?: string;
  configuredWeights?: ModelWeightsBreakdown;
  activeWeights?: ModelWeightsBreakdown;
  activeModelCount?: number;
  singleModelWarningAr?: string | null;
  invalidGlobalParameters?: Array<{ key: string; reasonAr: string }>;
  currencyConsistencyBlockedReasonAr?: string | null;
  assumptionsUsed: ResolvedAssumption[];
  inactiveParameters: ResolvedAssumption[];
  modelStatuses: ModelEligibilityStatus[];
  dividendSummary?: DividendAggregationSummary | null;
  ddmAudit?: DdmAuditSummary | null;
  rimAudit?: RimAuditSummary | null;
  relativeAudit?: RelativeValuationAudit | null;
  metricAudit?: MetricAuditBundle | null;
  bvpsBasisLabelAr?: string;
  rimRetentionPolicy?: RimRetentionPolicy;
  rimRetentionPolicySource?: string | null;
  rimRetentionSelectionRuleNoteAr?: string;
  activeRimRetentionUsed?: number | null;
  historicalPayoutRatio?: number | null;
  historicalRetentionRatio?: number | null;
  historicalRetentionSuitableForRim?: boolean;
  historicalRetentionRimBlockReasonAr?: string | null;
  companyOverridesConfirmed?: boolean;
  macroParamsConfirmed?: boolean;
}

export interface Company {
  id: string;
  ticker: string;              // e.g. COMI
  nameAr: string;              // البنك التجاري الدولي
  nameEn: string;              // Commercial International Bank
  shortName?: string | null;
  fullName?: string | null;
  isinCode?: string | null;
  market?: string | null;
  instrumentType?: InstrumentType;
  sector: string;              // القطاع المعتمد أو المشتق
  rawSector?: string | null;
  sectorId?: string | null;
  sectorSource?: string | null;
  sectorDate?: string | null;
  sectorClassification?: SectorClassification; // تصنيف ملاءمة النشاط (غير مالي / مالي / غير معروف)
  metadataProvenance?: Record<string, MetadataFieldProvenance>;
  metadataConflicts?: MetadataConflictItem[];
  marketPrice: number | null;         // السعر السوقي بالجنيه (EGP) من التداول اليومي فقط
  marketPriceSource?: MarketPriceSource | null; // مصدر السعر المشتق عند القراءة (آخر سعر أو إقفال اليوم)
  latestTradeDate?: string | null;    // تاريخ أحدث سجل تداول يومي مشتق
  sharesOutstanding: number | null;   // عدد الأسهم القائمة (بالقيمة الأساسية الكاملة)
  sharesSource?: 'quarterly_record' | 'company_metadata' | 'daily_listed_shares' | 'missing';
  sharesPeriod?: string | null;
  beta: number | null;                // بيتا السهم
  riskFreeRate: number | null;        // معدل العائد الخالي من المخاطر
  equityRiskPremium: number | null;   // علاوة مخاطر السوق
  costOfDebt: number | null;          // تكلفة الدين قبل الضريبة (Kd)
  taxRate: number | null;             // معدل ضريبة الدخل
  targetDebtRatio: number | null;     // نسبة الدين إلى رأس المال المستهدفة
  sustainableGrowthRate: number | null; // معدل النمو طويل الأجل المستدام (g)
  shortTermGrowthRate: number | null;   // معدل النمو المتوقع على المدى القريب
  targetPE: number | null;            // مضاعف الربحية المستهدف للتقييم النسبي
  targetPB: number | null;            // مضاعف القيمة الدفترية المستهدف
  currency: string;            // EGP
  marketPriceCurrency?: CurrencyCode | 'UNSUPPORTED' | null;
  rimRetentionPolicy?: RimRetentionPolicy;
  rimRetentionPolicySource?: string | null;
  description?: string;
  website?: string;
  updatedAt?: string;
}

export type CompanyMetadataPatch = {
  id: string;
  ticker: string;
} & Partial<Omit<Company, 'id' | 'ticker'>>;

export interface QuarterlyFinancial {
  // Optional explicit FCFF bridge; legacy records remain valid but cannot enable DCF.
  depreciationAmortizationYTD?: number | null;
  changeOperatingNwcYTD?: number | null; // cumulative increase consumes cash; a decrease is negative
  valuationTaxRate?: number | null; // decimal, 0.225 = 22.5%; applies to EBIT, not reported profit tax
  valuationSource?: string | null;
  financialUnit?: string | null;
  financialCurrency?: CurrencyCode | string | null;
  // Optional GAAP/reported EPS & capital-action metadata (never summed naively across quarters)
  netIncomeCommonYTD?: number | null;
  netIncomeCommonBasis?: NetIncomeCommonBasis | null;
  netIncomeCommonNote?: string | null;
  commonEquity?: number | null;
  commonEquityBasis?: CommonEquityBasis | null;
  commonEquityNote?: string | null;
  weightedAvgSharesYTD?: number | null;
  weightedAvgSharesBasis?: WeightedAvgSharesBasis | null;
  periodStartDate?: string | null;
  periodEndDate?: string | null;
  periodDays?: number | null;
  reportedEps?: number | null;
  reportedEpsSource?: string | null;
  reportedEpsPeriodType?: ReportedEpsPeriodType | null;
  reportedEpsFiscalYear?: number | null;
  reportedEpsFiscalQuarter?: ReportedEpsFiscalQuarter | null;
  reportedEpsPeriodStart?: string | null;
  reportedEpsPeriodEnd?: string | null;
  reportedEpsPeriod?: string | null;
  isCapitalActionAdjusted?: boolean | null;

  id: string;
  companyId: string;
  year: number;
  quarter: QuarterType;
  periodDate: string;          // YYYY-MM-DD
  
  // Rule: BLANK means unentered (null), strictly distinct from 0.
  // Monetary figures are read in their entered base values (default EGP).
  revenueYTD: number | null;
  grossProfitYTD: number | null;
  operatingProfitYTD: number | null; // EBIT YTD
  netProfitYTD: number | null;
  operatingCashFlowYTD: number | null;
  capexYTD: number | null;
  
  // DividendsPaidYTD: Cumulative dividends paid YTD (قيمة تراكمية لا تُجمع عبر الأرباع)
  dividendsPaidYTD: number | null;
  
  // Balance Sheet (Latest snapshot at quarter end):
  totalAssets: number | null;
  totalDebt: number | null;
  cashAndEquivalents: number | null;
  totalEquity: number | null;
  sharesCount: number | null;
  
  isAudited: boolean;
  notes?: string;
  updatedAt?: string;
}

export interface FinancialMetricsTTM {
  revenueTTM: number | null;
  grossProfitTTM: number | null;
  operatingProfitTTM: number | null;
  netIncomeTTM: number | null;
  operatingCashFlowTTM: number | null;
  capexTTM: number | null;
  fcfTTM: number | null;      // OCF_TTM - CapEx_TTM
  depreciationAmortizationTTM?: number | null;
  ebitdaTTM?: number | null;
  nopatTTM?: number | null;
  changeOperatingNwcTTM?: number | null;
  totalDebtLatest?: number | null;
  cashLatest?: number | null;
  fcffNotes?: string[];
  fcffDiagnostics?: FcffDiagnosticItem[];
  fcffDocumentationWarningAr?: string | null;
  fcffTTM: number | null;     // Free Cash Flow to Firm
  epsTTM: number | null;      // Valuation EPS = Attested Common Net Income TTM / End-of-Period Shares
  analyticalConsolidatedEpsTTM?: number | null; // Reference only: Consolidated NI TTM / EOP Shares
  analyticalCommonEpsTTM?: number | null;
  epsBasis?: 'analytical_net_income_eop_shares' | 'analytical_common_ni_eop_shares' | 'unavailable';
  epsBasisLabelAr?: string;
  reportedEps?: number | null;
  reportedEpsSource?: string | null;
  reportedEpsPeriodType?: ReportedEpsPeriodType | null;
  reportedEpsFiscalYear?: number | null;
  reportedEpsFiscalQuarter?: ReportedEpsFiscalQuarter | null;
  reportedEpsPeriodStart?: string | null;
  reportedEpsPeriodEnd?: string | null;
  reportedEpsPeriod?: string | null;
  accountingEpsLatest?: number | null;
  accountingEpsTTM?: number | null;
  bvps: number | null;        // Strict Valuation BVPS = Attested Common Equity / EOP Shares
  commonBvps?: number | null;
  totalEquityBvps?: number | null; // Reference only: Total Equity EOP / EOP Shares
  bvpsBasis?: CommonEquityBasis | 'total_equity_unattested' | 'unavailable';
  bvpsBasisLabelAr?: string;
  roe: number | null;         // Valuation ROE strictly aligned with Common Equity basis
  roeBasis?: string;
  roeBasisLabelAr?: string;
  roeAverageEquity?: number | null; // Strict chronological start & end equity average when both exist
  metricAudit?: MetricAuditBundle | null;
  roic: number | null;        // Return on Invested Capital
  peTTM: number | null;       // Market Price / Valuation Common EPS
  peConsolidatedRef?: number | null; // Reference only: Market Price / Consolidated EPS
  pbTTM: number | null;       // Market Price / Attested Common BVPS
  pbTotalEquityRef?: number | null;  // Reference only: Market Price / Total Equity BVPS
  evToEbitda: number | null;
  dividendYield: number | null;
  dividendYieldRegular?: number | null;
  dividendYieldTotal?: number | null;
  // Derived total actual cash DPS from DPS_Actual (regular + special), never quarterly legacy
  dpsCurrent: number | null;
  dpsRegular?: number | null;
  dpsSpecial?: number | null;
  paidRegularDps?: number | null;
  paidSpecialDps?: number | null;
  paidTotalDps?: number | null;
  paidAttributableDividends?: number | null;
  totalAttributableDividends?: number | null;
  historicalPayoutRatio?: number | null;
  historicalRetentionRatio?: number | null;
  partialPayoutRatio?: number | null;
  partialRetentionRatio?: number | null;
  dividendSummary?: DividendAggregationSummary | null;
  wacc: number | null;
  costOfEquity: number | null;
  netDebt: number | null;
  marketCap?: number | null;
  providerMarketCapThousands?: number | null;
  financialCurrency?: CurrencyCode | 'UNSUPPORTED' | null;
  financialCurrencyStatus?: CurrencyResolutionStatus;
  marketPriceCurrency?: CurrencyCode | 'UNSUPPORTED' | null;
  financialUnit?: AmountUnit | string | null;
  sharesUnit?: SharesUnit;
}

export type AuditSeverity = 'critical' | 'warning' | 'info';

export interface AuditWarningRecordTarget {
  ticker: string;
  year: number;
  quarter: QuarterType;
  periodLabelAr: string;
  field: string;
  fieldLabelAr: string;
  roleAr?: string;
}

export interface AuditWarningDetectedField {
  labelAr: string;
  value: string;
}

export interface AuditWarning {
  id: string;
  type: 'revenue_drop' | 'capex_drop' | 'profit_exceeds_revenue' | 'unusual_repetition' | 'blank_zero_confusion' | 'negative_equity' | 'cashflow_divergence';
  title: string;
  severity: AuditSeverity;
  period: string;             // e.g. الربع الثاني 2024
  companyTicker: string;
  detectedValues: Record<string, any>;
  detectedFields?: AuditWarningDetectedField[];
  relatedRecords?: AuditWarningRecordTarget[];
  reasonAr: string;           // سبب الاشتباه
  reviewActionAr: string;     // ما الذي يجب مراجعته بدقة دون تعديل آلي
  createdAt: string;
}

export interface SensitivityMatrixCell {
  growthRate: number;         // e.g. 0.04
  discountRate: number;       // e.g. 0.22 (WACC or Ke)
  fairValue: number | null;          // Computed fair value EGP
  status: 'deeply_undervalued' | 'undervalued' | 'fair' | 'overvalued';
  diffPct: number | null;            // (FairValue - MarketPrice) / MarketPrice
}

export interface ScenarioBand {
  name: string;
  nameAr: string;
  fairValue: number | null;
  marginOfSafetyPct: number | null;
  growthRate: number | null;
  discountRate: number | null;
  descriptionAr: string;
}

export interface ValuationResults {
  dcfDetails?: import('../core/math/valuation').DcfDetails | null;
  engineOutputs?: import('../core/math/valuation').EngineOutputs | null;
  costOfEquity?: number | null;
  wacc?: number | null;
  modelNotes?: string[];
  resolvedAssumptions?: Record<string, ResolvedAssumption>;
  modelStatuses?: ModelEligibilityStatus[];
  sourcesSummary?: ValuationSourcesSummary;
  ddmAudit?: DdmAuditSummary | null;
  rimAudit?: RimAuditSummary | null;
  relativeAudit?: RelativeValuationAudit | null;
  metricAudit?: MetricAuditBundle | null;
  rimRetentionPolicy?: RimRetentionPolicy;
  activeRimRetentionUsed?: number | null;
  historicalRetentionRatio?: number | null;
  assumptionPriority?: AssumptionPriority;
  betaRaw?: number | null;
  betaAdjusted?: number | null;
  betaAnalyticalOverride?: number | null;
  effectiveBetaForKe?: number | null;
  betaStatus?: BetaStatus;
  betaSourceNoteAr?: string;
  betaPolicyConflictAr?: string | null;
  currencyConsistencyBlockedReasonAr?: string | null;
  configuredWeights?: {
    dcf: number;
    ddm: number;
    rim: number;
    relative: number;
    graham: number;
  };
  // Individual Models
  dcfFairValue: number | null;
  ddmFairValue: number | null;
  rimFairValue: number | null;
  relativeFairValue: number | null;
  grahamFairValue: number | null;
  
  // Composite & Verdict
  compositeFairValue: number | null;
  marketPrice: number | null;
  marginOfSafetyPct: number | null;   // (FairValue - MarketPrice) / FairValue * 100
  upsidePotentialPct: number | null;  // (FairValue - MarketPrice) / MarketPrice * 100
  
  // Model weights (percentages summing to 100)
  weights: {
    dcf: number;
    ddm: number;
    rim: number;
    relative: number;
    graham: number;
  };
  
  // Scenarios
  scenarios: {
    bear: ScenarioBand;
    base: ScenarioBand;
    bull: ScenarioBand;
  };
  
  // 2D Sensitivity Matrix
  sensitivityMatrix: SensitivityMatrixCell[][];
  growthRates: number[];
  discountRates: number[];
}

export interface InvestmentStory {
  companyId: string;
  ticker: string;
  businessOverview: string;
  economicMoat: {
    rating: 'واسع (Wide)' | 'متوسط (Narrow)' | 'منعدم (None)';
    description: string;
    advantages: string[];      // تسعير، شبكة، كفاءة تكلفة، حقوق ملكية فكرية
  };
  investmentThesis: string;   // أطروحة الاستثمار الرئيسية
  catalysts: string[];        // محفزات النمو وإعادة التقييم
  risks: string[];            // المخاطر التشغيلية والماكرو (التضخم، الفائدة، الجنيه)
  managementScore?: string;   // تقييم كفاءة الإدارة
  analystVerdict: string;     // خلاصة التقرير
  updatedAt: string;
}

export type FundamentalVerdict = 'شراء قوي (خصم عميق)' | 'أقل من القيمة العادلة' | 'قريب من القيمة العادلة' | 'مبالغ في تقييمه';
export type TimingVerdict = 'إشارة دخول نشطة / زخم إيجابي' | 'قريب من قاع سعري / تجميع' | 'حيادي / انتظار محفز' | 'تشبع شرائي / تصحيح متوقع';
export type FinalDecision = 'شراء تراكمي' | 'شراء حذر' | 'شراء جزئي' | 'مراقبة لصيقة' | 'احتفاظ' | 'تخفيف / جني أرباح' | 'تجنب';

export interface DecisionItem {
  companyId: string;
  ticker: string;
  fundamentalVerdict: FundamentalVerdict;
  valuationReasonAr: string;
  
  timingVerdict: TimingVerdict;
  timingReasonAr: string;
  
  finalDecision: FinalDecision;
  targetEntryRange: string;    // e.g. 78.00 - 82.50 ج.م
  stopLossPrice: number;
  targetExitPrice: number;
  riskRewardRatio: number;
  notes: string;
  updatedAt: string;
}

export interface TradeLog {
  id: string;
  companyId: string;
  ticker: string;
  companyName: string;
  action: 'شراء' | 'بيع' | 'تجميع' | 'وقف خسارة';
  plannedEntryPrice: number;
  executedPrice?: number;
  targetFairValue: number;
  stopLoss: number;
  portfolioWeightPct: number;
  status: 'مخطط' | 'قيد التنفيذ' | 'مفعل' | 'مغلق';
  entryDate: string;
  exitDate?: string;
  returnPct?: number;
  notes: string;
  updatedAt?: string;
}
