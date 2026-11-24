/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AssumptionPriority,
  BetaStatus,
  Company,
  FcffDiagnosticItem,
  FinancialMetricsTTM,
  QuarterlyFinancial,
  SectorDefinition,
  SectorPeLoadStatus,
  SensitivityMatrixCell,
  TerminalValueMethod,
  ValuationResults,
} from '../types/financial';
import {
  BetaAssumptionRecord,
  CompanyParameterOverride,
  DailyTradingRecord,
  DividendRecord,
  DividendYearStatusRecord,
  MacroParameter,
  QuarterlyFinancialRecord,
  RimRetentionPolicy,
} from '../types';
import { computeComprehensiveValuation, ValuationEngineInputs } from '../core/math/valuation';
import { resolveDividendAnalyticsForStock } from '../core/domain/dividendAnalytics';
import { resolveMetricAuditBundle } from '../core/domain/metricContracts';
import {
  BetaResolutionResult,
  buildValuationSourcesSummary,
  classifyCompanySector,
  deriveFinancialCurrencyAndUnit,
  normalizeCurrencyCode,
  resolveBetaAssumption,
} from '../core/domain/valuationAssumptions';

const QUARTER_ORDER: Record<string, number> = {
  Q1: 1,
  Q2: 2,
  Q3: 3,
  FY: 4,
};

export function readYtdTTM<T extends { year: number; quarter: string }>(
  records: T[],
  getter: (r: T) => number | null
): number | null {
  const ordered = [...records].sort(
    (a, b) => a.year - b.year || (QUARTER_ORDER[a.quarter] ?? 0) - (QUARTER_ORDER[b.quarter] ?? 0)
  );
  const latest = ordered.at(-1);
  if (!latest) return null;
  const current = getter(latest);
  if (current === null || !Number.isFinite(current)) return null;
  if (latest.quarter === 'FY') return current;
  const priorFY = ordered.find((r) => r.year === latest.year - 1 && r.quarter === 'FY');
  const priorComparable = ordered.find(
    (r) => r.year === latest.year - 1 && r.quarter === latest.quarter
  );
  if (!priorFY || !priorComparable) return null;
  const fy = getter(priorFY);
  const comp = getter(priorComparable);
  return fy !== null && comp !== null && Number.isFinite(fy) && Number.isFinite(comp)
    ? current + fy - comp
    : null;
}

export interface StandaloneQuarter {
  year: number;
  quarter: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  netProfit: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  fcf: number | null;
  dividendsPaidYTD: number | null;
  totalAssets: number | null;
  totalDebt: number | null;
  cashAndEquivalents: number | null;
  totalEquity: number | null;
  sharesCount: number | null;
}

/**
 * فك التراكم المحاسبي (De-cumulation of YTD into Standalone Quarters)
 * مع الحفاظ على قاعدة أن BLANK (null) تعني غير مدخل ولا تتحول تلقائياً إلى صفر.
 */
export function computeStandaloneQuarters(
  financials: QuarterlyFinancial[]
): StandaloneQuarter[] {
  const byYear: Record<number, QuarterlyFinancial[]> = {};
  for (const f of financials) {
    if (!byYear[f.year]) byYear[f.year] = [];
    byYear[f.year].push(f);
  }

  const standaloneList: StandaloneQuarter[] = [];

  for (const yearStr of Object.keys(byYear).sort((a, b) => Number(a) - Number(b))) {
    const year = Number(yearStr);
    const yearQuarters = byYear[year].sort(
      (a, b) => (QUARTER_ORDER[a.quarter] || 0) - (QUARTER_ORDER[b.quarter] || 0)
    );

    for (let i = 0; i < yearQuarters.length; i++) {
      const cur = yearQuarters[i];
      const prev = i > 0 ? yearQuarters[i - 1] : null;

      const decumulate = (curVal: number | null, prevVal: number | null): number | null => {
        if (curVal === null) return null;
        if (!prev || prevVal === null || QUARTER_ORDER[cur.quarter] !== QUARTER_ORDER[prev.quarter] + 1) {
          return null;
        }
        return curVal - prevVal;
      };

      const qRevenue = cur.quarter === 'Q1' ? cur.revenueYTD : decumulate(cur.revenueYTD, prev?.revenueYTD ?? null);
      const qGrossProfit = cur.quarter === 'Q1' ? cur.grossProfitYTD : decumulate(cur.grossProfitYTD, prev?.grossProfitYTD ?? null);
      const qOperatingProfit = cur.quarter === 'Q1' ? cur.operatingProfitYTD : decumulate(cur.operatingProfitYTD, prev?.operatingProfitYTD ?? null);
      const qNetProfit = cur.quarter === 'Q1' ? cur.netProfitYTD : decumulate(cur.netProfitYTD, prev?.netProfitYTD ?? null);
      const qOcf = cur.quarter === 'Q1' ? cur.operatingCashFlowYTD : decumulate(cur.operatingCashFlowYTD, prev?.operatingCashFlowYTD ?? null);
      const qCapex = cur.quarter === 'Q1' ? cur.capexYTD : decumulate(cur.capexYTD, prev?.capexYTD ?? null);

      const qFcf = qOcf !== null && qCapex !== null ? qOcf - qCapex : null;

      standaloneList.push({
        year,
        quarter: cur.quarter,
        revenue: qRevenue,
        grossProfit: qGrossProfit,
        operatingProfit: qOperatingProfit,
        netProfit: qNetProfit,
        operatingCashFlow: qOcf,
        capex: qCapex,
        fcf: qFcf,
        dividendsPaidYTD: cur.dividendsPaidYTD,
        totalAssets: cur.totalAssets,
        totalDebt: cur.totalDebt,
        cashAndEquivalents: cur.cashAndEquivalents,
        totalEquity: cur.totalEquity,
        sharesCount: cur.sharesCount,
      });
    }
  }

  return standaloneList;
}

/**
 * حساب مؤشرات الاثني عشر شهراً الماضية (TTM) بدقة
 */
export function calculateTTMMetrics(
  company: Company,
  financials: QuarterlyFinancial[],
  options?: {
    dividendRecords?: DividendRecord[];
    dividendYearStatuses?: DividendYearStatusRecord[];
    latestDaily?: DailyTradingRecord;
    cutoffDate?: string | null;
    valuationDate?: string | null;
  }
): FinancialMetricsTTM {
  const sorted = [...financials]
    .filter((f) => f.companyId === company.id)
    .sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return (QUARTER_ORDER[a.quarter] || 0) - (QUARTER_ORDER[b.quarter] || 0);
    });

  const latestFinancial = sorted[sorted.length - 1];

  const previousFY = sorted.find(
    (f) => f.year === latestFinancial?.year - 1 && f.quarter === 'FY'
  );
  const previousComparable = sorted.find(
    (f) => f.year === latestFinancial?.year - 1 && f.quarter === latestFinancial?.quarter
  );
  const sumTTM = (getter: (f: QuarterlyFinancial) => number | null): number | null => {
    if (!latestFinancial) return null;
    const current = getter(latestFinancial);
    if (current === null || !Number.isFinite(current)) return null;
    if (latestFinancial.quarter === 'FY') return current;
    if (!previousFY || !previousComparable) return null;
    const fy = getter(previousFY);
    const comparable = getter(previousComparable);
    return fy !== null && comparable !== null && Number.isFinite(fy) && Number.isFinite(comparable)
      ? current + fy - comparable
      : null;
  };

  const revenueTTM = sumTTM((f) => f.revenueYTD);
  const grossProfitTTM = sumTTM((f) => f.grossProfitYTD);
  const operatingProfitTTM = sumTTM((f) => f.operatingProfitYTD);
  const netIncomeTTM = sumTTM((f) => f.netProfitYTD);
  const operatingCashFlowTTM = sumTTM((f) => f.operatingCashFlowYTD);
  const capexTTM = sumTTM((f) => f.capexYTD);

  const fcfTTM =
    operatingCashFlowTTM !== null && capexTTM !== null
      ? operatingCashFlowTTM - capexTTM
      : null;

  const finCurrencyInfo = deriveFinancialCurrencyAndUnit(sorted);
  const financialCurrency = finCurrencyInfo.currency;
  const financialCurrencyStatus = finCurrencyInfo.status;
  const financialUnit = finCurrencyInfo.amountUnit;
  const finCurrencyConflict =
    financialCurrencyStatus === 'unsupported' || financialCurrency === 'UNSUPPORTED';
  const effectiveFinCurrency: 'EGP' | 'USD' | null =
    financialCurrency === 'EGP' || financialCurrency === 'USD'
      ? financialCurrency
      : financialCurrencyStatus === 'missing'
      ? 'EGP'
      : null;
  const finCurrencyAllowed = !finCurrencyConflict && effectiveFinCurrency !== null;

  const marketCurrencyRaw = normalizeCurrencyCode(company.marketPriceCurrency ?? company.currency);
  const marketPriceCurrency =
    marketCurrencyRaw === 'EGP' || marketCurrencyRaw === 'USD'
      ? marketCurrencyRaw
      : marketCurrencyRaw === 'UNSUPPORTED'
      ? ('UNSUPPORTED' as const)
      : null;
  const effectiveMarketCurrency =
    marketPriceCurrency === 'UNSUPPORTED' ? 'UNSUPPORTED' : (marketPriceCurrency ?? 'EGP');

  const marketMatchesFinCurrency =
    finCurrencyAllowed &&
    effectiveMarketCurrency !== 'UNSUPPORTED' &&
    effectiveMarketCurrency === effectiveFinCurrency;

  // FCFF Bridge = EBIT*(1 - valuationTaxRate) + D&A - CapEx - DeltaNWC (computed independently of FinancialUnit & ValuationSource)
  const nopatTTM = finCurrencyAllowed
    ? readYtdTTM(sorted, (f) =>
        f.operatingProfitYTD !== null &&
        f.valuationTaxRate != null &&
        Number.isFinite(f.valuationTaxRate) &&
        f.valuationTaxRate >= 0 &&
        f.valuationTaxRate <= 1 &&
        (f.operatingProfitYTD >= 0 || f.valuationTaxRate === 0)
          ? f.operatingProfitYTD * (1 - f.valuationTaxRate)
          : null
      )
    : null;
  const depreciationAmortizationTTM = finCurrencyAllowed
    ? readYtdTTM(sorted, (f) =>
        f.depreciationAmortizationYTD != null && f.depreciationAmortizationYTD >= 0
          ? f.depreciationAmortizationYTD
          : null
      )
    : null;
  const changeOperatingNwcTTM = finCurrencyAllowed
    ? readYtdTTM(sorted, (f) => f.changeOperatingNwcYTD ?? null)
    : null;
  const documentedCapex = finCurrencyAllowed
    ? readYtdTTM(sorted, (f) =>
        f.capexYTD !== null && f.capexYTD >= 0 ? f.capexYTD : null
      )
    : null;

  const fcffTTM =
    nopatTTM !== null &&
    depreciationAmortizationTTM !== null &&
    depreciationAmortizationTTM >= 0 &&
    changeOperatingNwcTTM !== null &&
    documentedCapex !== null &&
    documentedCapex >= 0
      ? nopatTTM + depreciationAmortizationTTM - documentedCapex - changeOperatingNwcTTM
      : null;

  const fcffPeriodsUsed: QuarterlyFinancial[] = !latestFinancial
    ? []
    : latestFinancial.quarter === 'FY'
    ? [latestFinancial]
    : [latestFinancial, previousFY, previousComparable].filter(
        (p): p is QuarterlyFinancial => Boolean(p)
      );

  const undocumentedFcffPeriods =
    fcffTTM !== null ? fcffPeriodsUsed.filter((p) => !p.valuationSource?.trim()) : [];
  const fcffDocumentationWarningAr =
    undocumentedFcffPeriods.length > 0
      ? `تنبيه توثيق مصدر FCFF للسهم ${company.ticker}: حقل ValuationSource غير موثق في الفترة (${undocumentedFcffPeriods
          .map((p) => `${p.quarter} ${p.year}`)
          .join('، ')}). تم حساب القيمة من المدخلات الفعلية لكنها غير موثقة المصدر.`
      : null;

  const fcffDiagnostics: FcffDiagnosticItem[] = [];
  const fcffNotes: string[] = [];

  if (finCurrencyConflict) {
    fcffNotes.push(
      finCurrencyInfo.conflictReasonAr ||
        `تضارب أو عملة غير مدعومة في السجلات المالية للسهم ${company.ticker}.`
    );
  } else if (fcffTTM === null) {
    if (!latestFinancial) {
      const diag: FcffDiagnosticItem = {
        ticker: company.ticker,
        period: '-',
        field: 'QuarterlyFinancial',
        value: 'BLANK',
        reasonAr: 'لا توجد سجلات مالية ربع سنوية مسجلة للسهم.',
      };
      fcffDiagnostics.push(diag);
      fcffNotes.push(`[${diag.ticker}] ${diag.field}: ${diag.reasonAr}`);
    } else {
      const requiredPeriodSlots: Array<{ period: string; rec?: QuarterlyFinancial }> =
        latestFinancial.quarter === 'FY'
          ? [{ period: `${latestFinancial.quarter} ${latestFinancial.year}`, rec: latestFinancial }]
          : [
              { period: `${latestFinancial.quarter} ${latestFinancial.year}`, rec: latestFinancial },
              { period: `FY ${latestFinancial.year - 1}`, rec: previousFY },
              { period: `${latestFinancial.quarter} ${latestFinancial.year - 1}`, rec: previousComparable },
            ];

      for (const slot of requiredPeriodSlots) {
        if (!slot.rec) {
          fcffDiagnostics.push({
            ticker: company.ticker,
            period: slot.period,
            field: 'TTM_ComparablePeriod',
            value: 'BLANK',
            reasonAr: `الفترة المقارنة (${slot.period}) غير متوفرة لحساب TTM للسهم ${company.ticker}.`,
          });
        }
      }

      if (nopatTTM === null) {
        for (const slot of requiredPeriodSlots) {
          const rec = slot.rec;
          if (!rec) continue;
          if (rec.operatingProfitYTD === null || rec.operatingProfitYTD === undefined) {
            fcffDiagnostics.push({
              ticker: company.ticker,
              period: slot.period,
              field: 'EBIT_YTD',
              value: 'BLANK',
              reasonAr: 'الربح التشغيلي غير موجود (BLANK).',
            });
          }
          if (rec.valuationTaxRate === null || rec.valuationTaxRate === undefined) {
            fcffDiagnostics.push({
              ticker: company.ticker,
              period: slot.period,
              field: 'ValuationTaxRate',
              value: 'BLANK',
              reasonAr: 'ضريبة التقييم غير موجودة (BLANK).',
            });
          } else if (
            !Number.isFinite(rec.valuationTaxRate) ||
            rec.valuationTaxRate < 0 ||
            rec.valuationTaxRate > 1
          ) {
            fcffDiagnostics.push({
              ticker: company.ticker,
              period: slot.period,
              field: 'ValuationTaxRate',
              value: rec.valuationTaxRate,
              reasonAr: 'ضريبة التقييم خارج النطاق المسموح [0..1].',
            });
          } else if (rec.operatingProfitYTD !== null && rec.operatingProfitYTD < 0 && rec.valuationTaxRate > 0) {
            fcffDiagnostics.push({
              ticker: company.ticker,
              period: slot.period,
              field: 'EBIT_YTD',
              value: rec.operatingProfitYTD,
              reasonAr: 'خسارة تشغيلية (EBIT < 0) مع ضريبة تقييم > 0 تتطلب تسوية صريحة أو ضريبة 0.',
            });
          }
        }
      }

      if (depreciationAmortizationTTM === null) {
        for (const slot of requiredPeriodSlots) {
          const rec = slot.rec;
          if (!rec) continue;
          if (rec.depreciationAmortizationYTD == null) {
            fcffDiagnostics.push({
              ticker: company.ticker,
              period: slot.period,
              field: 'DA_YTD',
              value: 'BLANK',
              reasonAr: 'قيمة الإهلاك والاستنفاد غير موجودة (BLANK).',
            });
          } else if (rec.depreciationAmortizationYTD < 0) {
            fcffDiagnostics.push({
              ticker: company.ticker,
              period: slot.period,
              field: 'DA_YTD',
              value: rec.depreciationAmortizationYTD,
              reasonAr: 'قيمة DA_YTD سالبة غير صالحة (يجب أن تكون >= 0).',
            });
          }
        }
      }

      if (changeOperatingNwcTTM === null) {
        for (const slot of requiredPeriodSlots) {
          const rec = slot.rec;
          if (!rec) continue;
          if (rec.changeOperatingNwcYTD == null) {
            fcffDiagnostics.push({
              ticker: company.ticker,
              period: slot.period,
              field: 'DeltaOperatingNWC_YTD',
              value: 'BLANK',
              reasonAr: 'التغير في رأس المال العامل التشغيلي غير موجود (BLANK).',
            });
          }
        }
      }

      if (documentedCapex === null) {
        for (const slot of requiredPeriodSlots) {
          const rec = slot.rec;
          if (!rec) continue;
          if (rec.capexYTD == null) {
            fcffDiagnostics.push({
              ticker: company.ticker,
              period: slot.period,
              field: 'CapEx_YTD',
              value: 'BLANK',
              reasonAr: 'قيمة الإنفاق الرأسمالي غير موجودة (BLANK).',
            });
          } else if (rec.capexYTD < 0) {
            fcffDiagnostics.push({
              ticker: company.ticker,
              period: slot.period,
              field: 'CapEx_YTD',
              value: rec.capexYTD,
              reasonAr: 'قيمة CapEx_YTD سالبة غير صالحة؛ أدخل المدفوع كقيمة موجبة (>= 0).',
            });
          }
        }
      }

      for (const diag of fcffDiagnostics) {
        fcffNotes.push(
          `[${diag.ticker} · ${diag.period}] ${diag.field} (${diag.value ?? 'BLANK'}): ${diag.reasonAr}`
        );
      }
    }
  }

  if (fcffDocumentationWarningAr) {
    fcffNotes.push(fcffDocumentationWarningAr);
  }

  const shares =
    company.sharesOutstanding !== null &&
    Number.isFinite(company.sharesOutstanding) &&
    company.sharesOutstanding > 0
      ? company.sharesOutstanding
      : NaN;

  const currencySuffix =
    effectiveFinCurrency === 'EGP' ? 'ج.م' : effectiveFinCurrency === 'USD' ? 'USD' : '';

  const metricAudit = resolveMetricAuditBundle({
    company,
    financials: sorted,
    latestDaily: options?.latestDaily,
    netIncomeTTM,
    finCurrencyAllowed,
    currencySuffix,
  });

  const epsTTM = metricAudit.valuationEps.value;
  const analyticalConsolidatedEpsTTM = metricAudit.analyticalEpsTTM.value;
  const analyticalCommonEpsTTM = metricAudit.analyticalCommonEpsTTM.value;
  const bvps = metricAudit.valuationBvps.value;
  const totalEquityBvps = metricAudit.totalEquityBvps.value;
  const roe = metricAudit.valuationRoe.value;
  const roeAverageEquity = metricAudit.roeAverageEquity.value;

  const totalDebt = latestFinancial?.totalDebt ?? null;
  const cash = latestFinancial?.cashAndEquivalents ?? null;
  const netDebt =
    finCurrencyAllowed && totalDebt !== null && cash !== null ? totalDebt - cash : null;

  const costOfEquity =
    company.riskFreeRate !== null &&
    company.beta !== null &&
    company.equityRiskPremium !== null &&
    Number.isFinite(company.riskFreeRate) &&
    Number.isFinite(company.beta) &&
    Number.isFinite(company.equityRiskPremium)
      ? company.riskFreeRate + company.beta * company.equityRiskPremium
      : null;

  const wacc =
    marketMatchesFinCurrency &&
    costOfEquity !== null &&
    company.targetDebtRatio !== null &&
    company.costOfDebt !== null &&
    company.taxRate !== null &&
    Number.isFinite(company.targetDebtRatio) &&
    Number.isFinite(company.costOfDebt) &&
    Number.isFinite(company.taxRate)
      ? (1 - company.targetDebtRatio) * costOfEquity +
        company.targetDebtRatio * (company.costOfDebt * (1 - company.taxRate))
      : null;

  const validMarketPrice =
    company.marketPrice !== null && Number.isFinite(company.marketPrice) && company.marketPrice > 0
      ? company.marketPrice
      : null;
  const peTTM =
    marketMatchesFinCurrency && validMarketPrice !== null && epsTTM !== null && epsTTM > 0
      ? validMarketPrice / epsTTM
      : null;
  const peConsolidatedRef =
    marketMatchesFinCurrency &&
    validMarketPrice !== null &&
    analyticalConsolidatedEpsTTM !== null &&
    analyticalConsolidatedEpsTTM > 0
      ? validMarketPrice / analyticalConsolidatedEpsTTM
      : null;
  const pbTTM =
    marketMatchesFinCurrency && validMarketPrice !== null && bvps !== null && bvps > 0
      ? validMarketPrice / bvps
      : null;
  const pbTotalEquityRef =
    marketMatchesFinCurrency && validMarketPrice !== null && totalEquityBvps !== null && totalEquityBvps > 0
      ? validMarketPrice / totalEquityBvps
      : null;

  const marketCap =
    marketMatchesFinCurrency && validMarketPrice !== null && Number.isFinite(shares)
      ? validMarketPrice * shares
      : null;
  const enterpriseValue = marketCap !== null && netDebt !== null ? marketCap + netDebt : null;
  const ebitdaTTM =
    operatingProfitTTM !== null && depreciationAmortizationTTM !== null
      ? operatingProfitTTM + depreciationAmortizationTTM
      : null;
  const evToEbitda =
    marketMatchesFinCurrency && enterpriseValue !== null && ebitdaTTM !== null && ebitdaTTM > 0
      ? enterpriseValue / ebitdaTTM
      : null;

  const dividendSummary = resolveDividendAnalyticsForStock({
    ticker: company.ticker,
    dividendRecords: options?.dividendRecords,
    dividendYearStatuses: options?.dividendYearStatuses,
    quarterlyRecords: sorted,
    sharesOutstanding: Number.isFinite(shares) ? shares : null,
    netIncomeTTM,
    financialCurrency: effectiveFinCurrency,
    cutoffDate: options?.cutoffDate ?? null,
    valuationDate: options?.valuationDate ?? options?.cutoffDate ?? null,
  });

  const dpsRegular = dividendSummary.regularDps;
  const dpsSpecial = dividendSummary.specialDps;
  const dpsCurrent = dividendSummary.totalDps;

  const dividendYieldRegular =
    marketMatchesFinCurrency && dpsRegular !== null && validMarketPrice !== null
      ? (dpsRegular / validMarketPrice) * 100
      : null;
  const dividendYieldTotal =
    marketMatchesFinCurrency && dpsCurrent !== null && validMarketPrice !== null
      ? (dpsCurrent / validMarketPrice) * 100
      : null;
  const dividendYield = dividendYieldRegular;

  return {
    revenueTTM,
    grossProfitTTM,
    operatingProfitTTM,
    netIncomeTTM,
    operatingCashFlowTTM,
    capexTTM,
    fcfTTM,
    fcffTTM,
    nopatTTM,
    depreciationAmortizationTTM,
    ebitdaTTM,
    changeOperatingNwcTTM,
    fcffNotes,
    fcffDiagnostics,
    fcffDocumentationWarningAr,
    totalDebtLatest: totalDebt,
    cashLatest: cash,
    epsTTM,
    analyticalConsolidatedEpsTTM,
    analyticalCommonEpsTTM,
    epsBasis: epsTTM !== null ? 'analytical_common_ni_eop_shares' : 'unavailable',
    epsBasisLabelAr: metricAudit.valuationEps.basisLabelAr,
    reportedEps: latestFinancial?.reportedEps ?? null,
    reportedEpsSource: latestFinancial?.reportedEpsSource ?? null,
    reportedEpsPeriodType: latestFinancial?.reportedEpsPeriodType ?? null,
    reportedEpsFiscalYear: latestFinancial?.reportedEpsFiscalYear ?? null,
    reportedEpsFiscalQuarter: latestFinancial?.reportedEpsFiscalQuarter ?? null,
    reportedEpsPeriodStart: latestFinancial?.reportedEpsPeriodStart ?? null,
    reportedEpsPeriodEnd: latestFinancial?.reportedEpsPeriodEnd ?? null,
    reportedEpsPeriod:
      latestFinancial?.reportedEpsPeriodType
        ? (metricAudit.reportedEps.periodLabel ?? latestFinancial?.reportedEpsPeriod ?? null)
        : (latestFinancial?.reportedEpsPeriod ?? null),
    accountingEpsLatest: metricAudit.accountingEpsLatest.value,
    accountingEpsTTM: metricAudit.accountingEpsTTM.value,
    bvps,
    commonBvps: metricAudit.commonBvps.value,
    totalEquityBvps,
    bvpsBasis: metricAudit.equityBasisForValuation,
    bvpsBasisLabelAr: metricAudit.valuationBvps.basisLabelAr,
    roe,
    roeBasis: metricAudit.valuationRoe.basisCode,
    roeBasisLabelAr: metricAudit.valuationRoe.basisLabelAr,
    roeAverageEquity,
    metricAudit,
    roic: null,
    peTTM,
    peConsolidatedRef,
    pbTTM,
    pbTotalEquityRef,
    evToEbitda,
    dividendYield,
    dividendYieldRegular,
    dividendYieldTotal,
    dpsCurrent,
    dpsRegular,
    dpsSpecial,
    paidRegularDps: dividendSummary.paidRegularDps ?? null,
    paidSpecialDps: dividendSummary.paidSpecialDps ?? null,
    paidTotalDps: dividendSummary.paidTotalDps ?? null,
    paidAttributableDividends: dividendSummary.paidAttributableDividends ?? null,
    totalAttributableDividends: dividendSummary.totalAttributableDividends,
    historicalPayoutRatio: dividendSummary.historicalPayoutRatio,
    historicalRetentionRatio: dividendSummary.historicalRetentionRatio,
    partialPayoutRatio: dividendSummary.partialPayoutRatio ?? null,
    partialRetentionRatio: dividendSummary.partialRetentionRatio ?? null,
    dividendSummary,
    wacc,
    costOfEquity,
    netDebt,
    marketCap,
    financialCurrency,
    financialCurrencyStatus,
    marketPriceCurrency,
    financialUnit,
    sharesUnit: Number.isFinite(shares) ? 'shares' : 'unspecified',
  };
}

/**
 * محرك التقييم المالي الخماسي (5-Pillar Valuation Engine)
 */
export function runValuationModels(
  company: Company,
  metrics: FinancialMetricsTTM,
  customWeights?: { dcf: number; ddm: number; rim: number; relative: number; graham: number },
  params: Record<string, number> = {},
  options?: {
    priority?: AssumptionPriority;
    sectorPEMap?: Record<string, number>;
    sectorDefinitions?: SectorDefinition[] | null;
    sectorPeConfirmed?: boolean;
    sectorPeStatus?: SectorPeLoadStatus;
    sectorPeError?: string | null;
    quarterlyRecords?: QuarterlyFinancialRecord[];
    latestDaily?: DailyTradingRecord;
    betaRecord?: BetaAssumptionRecord | null;
    betaConfirmed?: boolean;
    betaError?: string | null;
    companyOverridesMap?: Record<string, CompanyParameterOverride | number>;
    macroMetaMap?: Record<
      string,
      Pick<
        MacroParameter,
        'asOfDate' | 'source' | 'enabledInEngine' | 'rfMethodology' | 'unit' | 'currency' | 'forecastHorizonYears'
      >
    >;
    companyOverridesConfirmed?: boolean;
    macroParamsConfirmed?: boolean;
    sensitivityDraftKeys?: string[];
    terminalValueMethod?: TerminalValueMethod;
    rimRetentionPolicy?: RimRetentionPolicy;
    valuationDate?: string | null;
    disableLegacyCompanyFallback?: boolean;
  }
): ValuationResults {
  const priority: AssumptionPriority = options?.priority ?? 'company_first';
  const sectorPEMap = options?.sectorPEMap;
  const sectorClassification = classifyCompanySector(
    company.rawSector ?? company.sector,
    company.sectorClassification ?? null,
    {
      sectorId: company.sectorId ?? null,
      sectorDefinitions: options?.sectorDefinitions,
      sectorPeConfirmed: options?.sectorPeConfirmed,
      sectorPeStatus: options?.sectorPeStatus,
    }
  );

  const shares =
    company.sharesOutstanding !== null && Number.isFinite(company.sharesOutstanding) && company.sharesOutstanding > 0
      ? company.sharesOutstanding
      : null;

  let betaRawResolved: number | null = company.beta;
  let betaStatus: BetaStatus = company.beta !== null ? 'actual' : 'unavailable_error';
  let betaMeta: { asOfDate?: string | null; source?: string | null } | undefined;
  let betaResolution: BetaResolutionResult | undefined;

  if (options?.betaConfirmed !== undefined || options?.betaRecord !== undefined) {
    betaResolution = resolveBetaAssumption({
      ticker: company.ticker,
      betaRecord: options.betaRecord ?? null,
      betaConfirmed: options.betaConfirmed ?? true,
      betaError: options.betaError ?? null,
      globalBetaDefault: params['Beta_Default'] ?? null,
    });
    betaRawResolved = betaResolution.betaRaw;
    betaStatus = betaResolution.status;
    betaMeta = {
      asOfDate: betaResolution.asOfDate,
      source: betaResolution.source,
    };
  }

  const ebitdaTTM =
    metrics.ebitdaTTM !== undefined
      ? metrics.ebitdaTTM
      : metrics.operatingProfitTTM !== null &&
        metrics.depreciationAmortizationTTM !== null &&
        metrics.depreciationAmortizationTTM !== undefined
      ? metrics.operatingProfitTTM + metrics.depreciationAmortizationTTM
      : null;

  // Authoritative currency & unit derived from quarterly_financial_records (via options.quarterlyRecords or metrics),
  // NEVER falling back to company.currency.
  const qrCurrencyInfo =
    options?.quarterlyRecords && options.quarterlyRecords.length > 0
      ? deriveFinancialCurrencyAndUnit(options.quarterlyRecords)
      : null;
  const derivedFinancialCurrency =
    qrCurrencyInfo?.currency ?? metrics.financialCurrency ?? null;
  const derivedFinancialCurrencyStatus =
    qrCurrencyInfo?.status ?? metrics.financialCurrencyStatus ?? 'missing';
  const derivedAmountUnit =
    qrCurrencyInfo?.amountUnit ??
    (metrics.financialUnit as any) ??
    'unspecified';

  const marketCurrencyRaw = normalizeCurrencyCode(company.marketPriceCurrency ?? company.currency);
  const derivedMarketPriceCurrency =
    metrics.marketPriceCurrency !== undefined
      ? metrics.marketPriceCurrency
      : marketCurrencyRaw === 'EGP' || marketCurrencyRaw === 'USD'
      ? marketCurrencyRaw
      : marketCurrencyRaw === 'UNSUPPORTED'
      ? ('UNSUPPORTED' as const)
      : null;

  const baseInput: ValuationEngineInputs = {
    ticker: company.ticker,
    marketPrice: company.marketPrice,
    sharesOutstanding: shares,
    betaRaw: betaRawResolved,
    betaStatus,
    betaMeta,
    betaSourceNoteAr: betaResolution?.noteAr,
    betaPolicyConflictAr: betaResolution?.policyConflictAr ?? null,
    disableLegacyCompanyFallback: options?.disableLegacyCompanyFallback,
    riskFreeRate: company.riskFreeRate,
    equityRiskPremium: company.equityRiskPremium,
    costOfDebt: company.costOfDebt,
    taxRate: company.taxRate,
    terminalGrowth: company.sustainableGrowthRate,
    terminalValueMethod: options?.terminalValueMethod ?? 'perpetuity_growth',
    financialCurrency: derivedFinancialCurrency,
    financialCurrencyStatus: derivedFinancialCurrencyStatus,
    marketPriceCurrency: derivedMarketPriceCurrency,
    amountUnit: derivedAmountUnit,
    sharesUnit: metrics.sharesUnit ?? (shares !== null ? 'shares' : 'unspecified'),
    ebitdaTTM,
    netIncomeTTM: metrics.netIncomeTTM,
    ocfTTM: metrics.operatingCashFlowTTM,
    capexTTM: metrics.capexTTM,
    fcfTTM: metrics.fcfTTM,
    fcffTTM: metrics.fcffTTM,
    totalEquity: metrics.bvps !== null && shares !== null ? metrics.bvps * shares : null,
    epsUsed: metrics.epsTTM,
    epsBasis: metrics.epsBasis,
    bvpsUsed: metrics.bvps,
    bvpsBasis: metrics.bvpsBasis,
    bvpsBasisLabelAr: metrics.bvpsBasisLabelAr,
    roeUsed: metrics.roe,
    roeBasis: metrics.roeBasis,
    roeBasisLabelAr: metrics.roeBasisLabelAr,
    metricAudit: metrics.metricAudit ?? null,
    totalDebt: metrics.totalDebtLatest ?? null,
    cash: metrics.cashLatest ?? null,
    dpsRegular: metrics.dpsRegular ?? null,
    dpsSpecial: metrics.dpsSpecial ?? null,
    dividendSummary: metrics.dividendSummary ?? null,
    rimRetentionPolicy: options?.rimRetentionPolicy ?? company.rimRetentionPolicy ?? 'rim_parameter',
    historicalRetentionRatio: metrics.historicalRetentionRatio ?? null,
    sector: company.sector,
    rawSector: company.rawSector ?? null,
    sectorId: company.sectorId ?? null,
    sectorClassification,
    companyTargetPE: company.targetPE,
    companyTargetPB: company.targetPB,
    sectorPEMap,
    sectorDefinitions: options?.sectorDefinitions,
    sectorPeConfirmed: options?.sectorPeConfirmed,
    sectorPeStatus: options?.sectorPeStatus,
    companyOverridesMap: options?.companyOverridesMap,
    companyOverridesConfirmed: options?.companyOverridesConfirmed,
    macroParamsConfirmed: options?.macroParamsConfirmed,
    sensitivityDraftKeys: options?.sensitivityDraftKeys,
    macroMetaMap: options?.macroMetaMap,
    assumptionPriority: priority,
  };

  const effective: Record<string, number> = { ...params };
  if (customWeights) {
    for (const [key, value] of Object.entries(customWeights)) {
      effective[
        `Weight_${key === 'relative' ? 'Relative' : key === 'graham' ? 'Graham' : key.toUpperCase()}`
      ] = value;
    }
  }

  const base = computeComprehensiveValuation(baseInput, effective);
  const g = base.resolvedAssumptions.terminalGrowth?.value ?? null;
  const rMode = base.resolvedAssumptions.rMode?.value ?? null;
  const baseRfEG = base.resolvedAssumptions.riskFreeRate?.value ?? null;
  const baseRfUSD = base.resolvedAssumptions.riskFreeRateUSD?.value ?? null;
  const baseDdmGrowth = base.resolvedAssumptions.ddmGrowth?.value ?? null;

  const setShiftedParam = (
    targetOverrides: Record<string, CompanyParameterOverride | number> | undefined,
    targetGlobal: Record<string, number>,
    key: string,
    val: number
  ): Record<string, CompanyParameterOverride | number> => {
    const nextOverrides: Record<string, CompanyParameterOverride | number> = targetOverrides
      ? { ...targetOverrides }
      : {};
    targetGlobal[key] = val;
    if (key in nextOverrides) {
      const existing = nextOverrides[key];
      if (typeof existing === 'number') {
        nextOverrides[key] = val;
      } else if (existing && typeof existing === 'object') {
        nextOverrides[key] = { ...existing, value: val };
      }
    }
    return nextOverrides;
  };

  const buildShiftedRun = (growthTarget: number, rfShift: number) => {
    const nextAssumptions: Record<string, number> = {
      ...effective,
    };
    let nextOverrides: Record<string, CompanyParameterOverride | number> | undefined =
      baseInput.companyOverridesMap ? { ...baseInput.companyOverridesMap } : undefined;
    const nextInputs: ValuationEngineInputs = {
      ...baseInput,
      terminalGrowth: growthTarget,
    };
    nextOverrides = setShiftedParam(nextOverrides, nextAssumptions, 'Terminal_Growth', growthTarget);
    if (baseDdmGrowth !== null) {
      const shiftedDdm = baseDdmGrowth + (g !== null ? growthTarget - g : 0);
      nextOverrides = setShiftedParam(nextOverrides, nextAssumptions, 'DDM_Growth', shiftedDdm);
    }
    if (rMode === 2) {
      if (baseRfUSD !== null) {
        nextOverrides = setShiftedParam(nextOverrides, nextAssumptions, 'Rf_USD_10Y', baseRfUSD + rfShift);
      }
    } else {
      if (baseRfEG !== null) {
        const shiftedRf = baseRfEG + rfShift;
        nextOverrides = setShiftedParam(nextOverrides, nextAssumptions, 'Rf_Egypt_10Y', shiftedRf);
        nextInputs.riskFreeRate = shiftedRf;
      }
    }
    nextInputs.companyOverridesMap = nextOverrides;
    return computeComprehensiveValuation(nextInputs, nextAssumptions);
  };

  const scenario = (name: string, title: string, delta: number) => {
    if (g === null || base.costOfEquity === null) {
      return {
        name,
        nameAr: title,
        fairValue: delta === 0 ? base.compositeFairValue : null,
        marginOfSafetyPct: delta === 0 ? base.marginOfSafetyPct : null,
        growthRate: g !== null ? g + delta : null,
        discountRate: base.costOfEquity,
        descriptionAr:
          'يتطلب إعادة حساب السيناريو توفر معدل الخصم (Ke) ومعدل النمو المستدام (Terminal_Growth) في الافتراضات المعتمدة.',
      };
    }

    const result = delta === 0 ? base : buildShiftedRun(g + delta, -delta);
    return {
      name,
      nameAr: title,
      fairValue: result.compositeFairValue,
      marginOfSafetyPct: result.marginOfSafetyPct,
      growthRate: g + delta,
      discountRate: result.costOfEquity,
      descriptionAr:
        'إعادة حساب النماذج المتاحة بتغيير افتراضات النمو والعائد الخالي من المخاطر؛ ليست توقعاً مؤكداً.',
    };
  };

  const growthRates = g !== null ? [g - 0.02, g - 0.01, g, g + 0.01, g + 0.02] : [];
  const discountRates =
    base.costOfEquity !== null ? [-0.04, -0.02, 0, 0.02, 0.04].map((d) => base.costOfEquity! + d) : [];

  const sensitivityMatrix: SensitivityMatrixCell[][] =
    base.costOfEquity !== null && g !== null
      ? discountRates.map((discount) =>
          growthRates.map((growth) => {
            const shift = discount - base.costOfEquity!;
            const isBaseCell = Math.abs(growth - g) < 1e-12 && Math.abs(shift) < 1e-12;
            const v = isBaseCell ? base : buildShiftedRun(growth, shift);
            const diff = v.upsidePotentialPct;
            return {
              growthRate: growth,
              discountRate: discount,
              fairValue: v.compositeFairValue,
              diffPct: diff,
              status: (diff !== null && diff > 35
                ? 'deeply_undervalued'
                : diff !== null && diff > 12
                ? 'undervalued'
                : diff !== null && diff < -15
                ? 'overvalued'
                : 'fair') as SensitivityMatrixCell['status'],
            };
          })
        )
      : [];

  const partialResult: ValuationResults = {
    dcfFairValue: base.dcfValue,
    ddmFairValue: base.ddmValue,
    rimFairValue: base.rimValue,
    relativeFairValue: base.relativeValue,
    grahamFairValue: base.grahamValue,
    compositeFairValue: base.compositeFairValue,
    marketPrice: company.marketPrice,
    marginOfSafetyPct: base.marginOfSafetyPct,
    upsidePotentialPct: base.upsidePotentialPct,
    dcfDetails: base.dcfDetails,
    engineOutputs: base,
    ddmAudit: base.ddmAudit,
    rimAudit: base.rimAudit,
    relativeAudit: base.relativeAudit,
    metricAudit: base.metricAudit ?? metrics.metricAudit ?? null,
    costOfEquity: base.costOfEquity,
    wacc: base.wacc,
    modelNotes: base.modelNotes,
    resolvedAssumptions: base.resolvedAssumptions,
    modelStatuses: base.modelStatuses,
    assumptionPriority: base.assumptionPriority,
    betaRaw: base.betaRaw,
    betaAdjusted: base.betaAdjusted,
    betaAnalyticalOverride: base.betaAnalyticalOverride,
    effectiveBetaForKe: base.effectiveBetaForKe,
    betaStatus: base.betaStatus,
    betaSourceNoteAr: base.betaSourceNoteAr,
    betaPolicyConflictAr: base.betaPolicyConflictAr,
    currencyConsistencyBlockedReasonAr: base.currencyConsistencyBlockedReasonAr,
    rimRetentionPolicy: base.rimRetentionPolicy,
    activeRimRetentionUsed: base.activeRimRetentionUsed,
    historicalRetentionRatio: base.historicalRetentionRatio,
    weights: base.weights,
    configuredWeights: base.configuredWeights,
    scenarios: {
      bear: scenario('Bear', 'متحفظ', -0.02),
      base: scenario('Base', 'أساسي', 0),
      bull: scenario('Bull', 'متفائل', 0.02),
    },
    sensitivityMatrix,
    growthRates,
    discountRates,
  };

  if (options?.quarterlyRecords) {
    partialResult.sourcesSummary = buildValuationSourcesSummary({
      company,
      quarterlyRecords: options.quarterlyRecords,
      latestDaily: options.latestDaily,
      metrics: {
        ...metrics,
        costOfEquity: base.costOfEquity,
        wacc: base.wacc,
      },
      valuation: partialResult,
      sectorClassification,
      resolvedAssumptions: {
        priority: base.assumptionPriority,
        map: base.resolvedAssumptions,
        list: Object.values(base.resolvedAssumptions),
        invalidGlobalParameters: base.invalidGlobalParameters,
        sectorPeMatchedKey: base.sectorPeMatchedKey,
        sectorPeLookupReasonAr: base.sectorPeLookupReasonAr,
        sectorPeConflictDetected: base.sectorPeConflictDetected,
        sectorPeConflictingEntries: base.sectorPeConflictingEntries,
      },
      modelStatuses: base.modelStatuses,
      betaResolution,
      terminalValueMethod: options?.terminalValueMethod,
      valuationDate: options?.valuationDate ?? metrics.dividendSummary?.valuationDate ?? null,
      sectorPeConfirmed: options?.sectorPeConfirmed,
      sectorPeStatus: options?.sectorPeStatus,
      sectorPeError: options?.sectorPeError,
      companyOverridesConfirmed: options?.companyOverridesConfirmed,
      macroParamsConfirmed: options?.macroParamsConfirmed,
    });
  }

  return partialResult;
}
