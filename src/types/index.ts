/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CurrencyCode } from './financial';

// Re-export Company and financial governance types
export type {
  Company,
  CompanyMetadataPatch,
  SectorClassification,
  MarketPriceSource,
  AssumptionPriority,
  AssumptionSource,
  BetaStatus,
  BetaAssumptionRecord,
  DividendRecordType,
  DividendApprovalStatus,
  DividendDistributionSemantics,
  DividendYearStatusValue,
  DividendYearStatusRecord,
  NetIncomeCommonBasis,
  CommonEquityBasis,
  MetricCompletenessStatus,
  EpsPeriodKind,
  ReportedVsAccountingEpsComparison,
  AuditedMetricItem,
  MissingCommonFieldItem,
  MissingAccountingEpsFieldItem,
  RequestedQuarterlyEditTarget,
  WeightedAvgSharesBasis,
  MetricAuditBundle,
  RimAuditYearRow,
  RimFadeYearRow,
  RimAuditSummary,
  RimRetentionPolicy,
  RimTerminalMethod,
  RimForwardRoeBasis,
  DividendRecord,
  DividendAggregationSummary,
  DdmBasisStatus,
  DdmSensitivityCell,
  DdmAuditSummary,
  SectorStatus,
  SectorPeLoadStatus,
  SectorDefinition,
  SectorMatchCandidate,
  SectorPeConflictEntry,
  EpsSelectionModelKey,
  EpsModelSelectionPolicyEntry,
  EpsSelectionPolicySummary,
  CompanyParameterOverride,
  TerminalValueMethod,
  ImportSourceType,
  ImportRejectedRow,
  ImportPreviewItem,
  ImportPreviewResult,
  ImportBatchReport,
  TombstoneRecord,
  ResolvedAssumption,
  ModelEligibilityStatus,
  ValuationSourcesSummary,
  CurrencyCode,
  AmountUnit,
  SharesUnit,
  CurrencyResolutionStatus,
  FcffDiagnosticItem,
  LegacyRfMethodology,
  RfMethodologyClassification,
  ModelWeightsBreakdown,
  DailyCellType,
  DailyRawCellValue,
  DailyTradingColumnSchema,
  DailyTradingSchemaRecord,
  InstrumentType,
  ManualCorrectionEntry,
  ManualCorrectionsMap,
  ManualCorrectionsWritePatch,
  MetadataFieldProvenance,
  MetadataConflictItem,
  DecisionItem,
  InvestmentStory,
  TradeLog,
} from './financial';

// --- 1. الأدوار والاشتراكات التجارية (RBAC & SaaS Tiers) ---
export type UserRole = 'admin' | 'data_entry' | 'assistant' | 'subscriber';
export type SubscriptionTier = 'free' | 'bronze' | 'silver' | 'gold' | 'institutional';

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  tier: SubscriptionTier;
  isActive: boolean;
  subscriptionExpiresAt?: string;
  createdAt: string;
  lastLoginAt: string;
}

// --- 2. المتغيرات الكلية والتقييمية القابلة للتوسع (Macro & Valuation Parameters) ---
export interface MacroParameter {
  key: string;              // e.g. TaxRate, Rf_Egypt_10Y, etc.
  nameAr: string;           // التسمية العربية
  descriptionAr: string;    // الشرح المحاسبي ودوره
  value: number;            // القيمة الرقمية
  category:
    | 'tax_rf'
    | 'risk_premiums'
    | 'growth'
    | 'wacc_modes'
    | 'weights'
    | 'macro_inflation'
    | 'beta'
    | 'terminal'
    | 'multiples';
  valueType?: import('../core/contracts/parameterRegistry').ParameterValueType | null;
  isPercentage?: boolean | null;
  parameterTypeSource?: import('../core/contracts/parameterTypeContract').ParameterTypeSource;
  unit?: string;
  currency?: CurrencyCode | string | null;
  forecastHorizonYears?: number | null;
  scope?: 'global' | 'company';
  ticker?: string | null;
  asOfDate?: string;
  source?: string;
  enabledInEngine?: boolean;
  modeNoteAr?: string;
  rfMethodology?: import('./financial').RfMethodologyClassification | import('./financial').LegacyRfMethodology;
  revision?: number;
  contentHash?: string;
  updatedAt?: string;
  serverUpdatedAt?: unknown;
}

// --- 3. سجلات التداول اليومية (Daily Trading Data - Dynamic Full-Column Schema) ---
// القاعدة: BLANK (null) تعني غير متاح ومفصولة تماماً عن 0 الفعلي.
export interface DailyTradingRecord {
  ticker: string;                           // الرمز (e.g. COMI)
  shortName: string | null;                 // الإسم المختصر
  tradeDate: string;                        // YYYY-MM-DD مأخوذ من اسم الملف مثل 2026-11-8.xlsx
  lastPrice: number | null;                 // أخر
  changePct: number | null;                 // التغير%
  tradesCount: number | null;               // الصفقات
  openPrice: number | null;                 // فتح
  closePrice: number | null;                // إقفال اليوم
  turnoverValue: number | null;             // قيمة التداول
  netLiquidity: number | null;              // صافي السيولة
  volume: number | null;                    // حجم التداول
  avgVolume5D: number | null;               // متوسط الحجم 5 أيام
  avgVolume30D: number | null;              // متوسط حجم التداول خلال 30 يوم
  avgVolume90D: number | null;              // متوسط حجم التداول خلال 90 يوم
  lowPrice: number | null;                  // الأدنى
  highPrice: number | null;                 // أعلى
  sector: string | null;                    // القطاع
  totalBids: number | null;                 // اجمالي الطلبات
  bidsCount: number | null;                 // عدد الطلبات
  offersCount: number | null;               // عدد العروض
  totalOffers: number | null;               // اجمالي العروض
  avgVolume: number | null;                 // متوسط حجم التدول
  high52W: number | null;                   // الأعلى خلال 52 أسبوع
  low52W: number | null;                    // الأدنى خلال 52 أسبوع
  prevClose: number | null;                 // إقفال سابق
  marketCapThousands: number | null;        // رأس مال السوق بالألأف (قيمة المزود كما أُدخلت)
  vwap: number | null;                      // متوسط السعر المرجح
  peRatio: number | null;                   // مضاعف ربحية السهم
  pbRatio?: number | null;                  // مضاعف القيمة الدفترية اليومي (تُخزن بشفافية دون تحويل تلقائي لأوزان التقييم)
  listedShares: number | null;              // الأسهم المدرجة
  isinCode: string | null;                  // الكود الدولي
  inflowOrders: number | null;              // أوامر السيولة الداخلة
  inflowVolume: number | null;              // حجم السيولة الداخلة
  inflowLiquidity: number | null;           // السيولة الداخلة
  askTrades: number | null;                 // صفقات العرض
  askTradesVolume: number | null;           // حجم صفقات العرض
  outflowLiquidity: number | null;          // السيولة الخارجة
  fullName: string | null;                  // الاسم
  market: string | null;                    // السوق
  volChange5DPct: number | null;            // % التغير في حجم التداول لـ 5 أيام
  volChange30DPct: number | null;           // تغير الحجم 30 يوم %
  volChange90DPct: number | null;           // تغير الحجم 90 يوم %
  schemaId?: string | null;                 // مرجع مخطط الأعمدة الكامل في daily_trading_schemas
  rawCells?: Record<string, import('./financial').DailyRawCellValue>; // جميع خلايا الصف الأصلية مفهرسة بـ colId الموضعي
  rawRowHeadersMissingCount?: number;       // عدد الخلايا المعبأة بعد آخر عنوان عمود
  formulaMissingCachedCount?: number;       // عدد خلايا الصيغ التي تفتقد قيمة مخبأة
  originalValues?: Record<string, string | number | boolean | null>;
  manualCorrections?: import('./financial').ManualCorrectionsMap;
  contentHash?: string;
  serverUpdatedAt?: unknown;
  updatedAt: string;
}

// --- 4. القوائم المالية الربع سنوية (Quarterly Financials - 26 Columns Standard) ---
export interface QuarterlyFinancialRecord {
  // Optional explicit FCFF bridge; legacy records remain valid but cannot enable DCF.
  depreciationAmortizationYTD?: number | null;
  changeOperatingNwcYTD?: number | null; // cumulative increase consumes cash; a decrease is negative
  valuationTaxRate?: number | null; // decimal, 0.225 = 22.5%; applies to EBIT, not reported profit tax
  valuationSource?: string | null;
  financialUnit?: string | null;
  financialCurrency?: CurrencyCode | string | null;
  netIncomeCommonYTD?: number | null;
  netIncomeCommonBasis?: import('./financial').NetIncomeCommonBasis | null;
  netIncomeCommonNote?: string | null;
  equityCommon?: number | null;
  equityCommonBasis?: import('./financial').CommonEquityBasis | null;
  equityCommonNote?: string | null;
  weightedAvgSharesYTD?: number | null;
  weightedAvgSharesBasis?: import('./financial').WeightedAvgSharesBasis | null;
  periodStartDate?: string | null;
  periodEndDate?: string | null;
  periodDays?: number | null;
  reportedEps?: number | null;
  reportedEpsSource?: string | null;
  reportedEpsPeriodType?: import('./financial').ReportedEpsPeriodType | null;
  reportedEpsFiscalYear?: number | null;
  reportedEpsFiscalQuarter?: import('./financial').ReportedEpsFiscalQuarter | null;
  reportedEpsPeriodStart?: string | null;
  reportedEpsPeriodEnd?: string | null;
  reportedEpsPeriod?: string | null;
  isCapitalActionAdjusted?: boolean | null;

  ticker: string;                           // الرمز
  stockName: string;                        // StockName
  yearQuarter: string;                      // YearQuarter e.g. 2024Q3
  year: number;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'FY';
  shares: number;                           // Shares (عدد الأسهم الكامل)
  intangibleAssets: number | null;          // IntangibleAssets
  totalAssets: number | null;              // TotalAssets
  equity: number | null;                    // Equity
  totalDebtWithoutTX: number | null;        // TotalDebtWithoutTX
  totalLiabilities: number | null;          // TotalLiabilities
  revenueYTD: number | null;                // RevenueYTD
  grossProfitYTD: number | null;            // GrossProfitYTD
  ebitYTD: number | null;                   // EBIT_YTD
  pbtYTD: number | null;                    // PBT_YTD
  netIncomeYTD: number | null;              // NetIncomeYTD
  ocfYTD: number | null;                    // OCF_YTD
  netInvestingCfYTD: number | null;         // NetInvestingCF_YTD
  dividendsPaidYTD: number | null;          // DividendsPaidYTD (تراكمي لا يجمع)
  cash: number | null;                      // Cash
  interestExpenseYTD: number | null;        // InterestExpense_YTD
  financeCostsYTD: number | null;           // FinanceCosts_YTD
  interestIncomeYTD: number | null;         // InterestIncome_YTD
  taxExpenseYTD: number | null;             // TaxExpense_YTD
  interestPaidYTD: number | null;           // InterestPaid_YTD
  capexYTD: number | null;                  // CapEx_YTD
  dateInsertData: string;                   // DateInsertData
  extendedFields?: Record<string, any>;     // قابلية التوسع لأي أعمدة مستقبلية
  originalValues?: Record<string, string | number | boolean | null>;
  manualCorrections?: import('./financial').ManualCorrectionsMap;
  updatedAt: string;
}

/**
 * Explicit write-request payload for `quarterly_record` / `bulk_quarterly`:
 * Supports explicit `null` deletion markers inside `manualCorrections` (and map-level `null` clears)
 * required by the server's non-destructive nested-map contract, without weakening the read-model
 * `QuarterlyFinancialRecord` type or storing deletion markers inside client state/cache.
 */
export type QuarterlyFinancialRecordWritePayload = Omit<
  QuarterlyFinancialRecord,
  'manualCorrections' | 'originalValues' | 'extendedFields'
> & {
  manualCorrections?: import('./financial').ManualCorrectionsWritePatch | null;
  originalValues?: Record<string, string | number | boolean | null> | null;
  extendedFields?: Record<string, any> | null;
};

// --- 5. مصفوفة فحص جودة واكتمال بيانات السهم الـ 9 (Data Health & Quality Checks) ---
export type HealthCheckCategory = 'السلامة' | 'الاكتمال' | 'الاتساق' | 'المنطق' | 'التقييم';
export type HealthCheckStatus =
  | 'pass'
  | 'warning'
  | 'fail'
  | 'incomplete'
  | 'not_applicable';

export const HEALTH_CHECK_STATUS_META: Record<
  HealthCheckStatus,
  { labelAr: string; shortLabelAr: string; descriptionAr: string }
> = {
  pass: {
    labelAr: 'مطابق (ناجح)',
    shortLabelAr: 'مطابق',
    descriptionAr: 'الشرط محقق بناءً على بيانات موثقة.',
  },
  fail: {
    labelAr: 'مخالفة شرط',
    shortLabelAr: 'مخالفة شرط',
    descriptionAr: 'قيمة مرصودة تخالف الشرط المحاسبي أو المنطقي.',
  },
  incomplete: {
    labelAr: 'مدخلات غير مكتملة',
    shortLabelAr: 'غير مكتمل',
    descriptionAr: 'تعذر تقييم الشرط لنقص بيانات مدخلة؛ لا يُعد مخالفة موثقة.',
  },
  not_applicable: {
    labelAr: 'غير منطبق',
    shortLabelAr: 'غير منطبق',
    descriptionAr: 'الفحص لا ينطبق وفق سياسة القطاع أو طريقة التقييم النشطة.',
  },
  warning: {
    labelAr: 'تنبيه مراجعة',
    shortLabelAr: 'تنبيه',
    descriptionAr: 'حالة تتطلب مراجعة دون تصنيفها كمخالفة محاسبية قاطعة.',
  },
};

export interface StockHealthCheckItem {
  id: string;
  name: string;                             // e.g. OCF_TTM موجب
  category: HealthCheckCategory;
  order: number;
  status: HealthCheckStatus;
  actualValue: string | number;
  expectedRule: string;
  detailsAr: string;
}

// --- 6. الشركة وبيانات التقييم المجمعة ---
export interface StockProfile {
  ticker: string;
  nameAr: string;
  nameEn: string;
  sector: string;
  marketPrice: number | null;
  sharesOutstanding: number | null;
  betaRaw: number | null;
  betaAdjusted: number | null;
  latestTradeDate: string | null;
  updatedAt: string;
}

// --- 7. نتائج التقييم الخماسي ---
export interface ComprehensiveValuation {
  ticker: string;
  dcfValue: number | null;
  ddmValue: number | null;
  rimValue: number | null;
  relativeValue: number | null;
  grahamValue: number | null;
  compositeFairValue: number | null;
  marketPrice: number | null;
  marginOfSafetyPct: number | null;
  upsidePotentialPct: number | null;
  waccUsed: number | null;
  keUsed: number | null;
  weights: {
    dcf: number;
    ddm: number;
    rim: number;
    relative: number;
    graham: number;
  };
  scenarios: {
    bear: { value: number | null; marginOfSafety: number | null };
    base: { value: number | null; marginOfSafety: number | null };
    bull: { value: number | null; marginOfSafety: number | null };
  };
}
