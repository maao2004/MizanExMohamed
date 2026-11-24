/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getValuationLabField,
  sanitizeCompanyMetadataPatch,
  VALUATION_LAB_FIELD_REGISTRY,
  validateValuationLabFieldValue,
} from '../src/core/contracts';
import {
  analyzeLegacyMigration,
  resolveBetaAssumption,
  resolveValuationAssumptions,
} from '../src/core/domain';
import { resolveDividendAnalyticsForStock } from '../src/core/domain/dividendAnalytics';
import { DIVIDEND_COMPLETENESS_BASIS_RULES } from '../src/core/domain/dividendYearResolver';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import type {
  BetaAssumptionRecord,
  Company,
  CompanyParameterOverride,
  MacroParameter,
  QuarterlyFinancial,
  QuarterlyFinancialRecord,
} from '../src/types';

function makeBaseCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'comi',
    ticker: 'COMI',
    nameAr: 'التجاري الدولي',
    nameEn: 'CIB',
    sector: 'تجارة وتوزيع',
    sectorClassification: 'non_financial',
    marketPrice: 80,
    currency: 'EGP',
    sharesOutstanding: 100_000_000,
    beta: null,
    riskFreeRate: null,
    equityRiskPremium: null,
    costOfDebt: null,
    taxRate: null,
    targetDebtRatio: null,
    sustainableGrowthRate: null,
    shortTermGrowthRate: null,
    targetPE: null,
    targetPB: null,
    ...overrides,
  };
}

function makeBaseQuarterly(overrides: Partial<QuarterlyFinancial> = {}): QuarterlyFinancial {
  return {
    id: 'comi_2025_fy',
    companyId: 'comi',
    year: 2025,
    quarter: 'FY',
    revenueYTD: 10_000_000_000,
    grossProfitYTD: 4_000_000_000,
    operatingProfitYTD: 2_500_000_000,
    netProfitYTD: 1_800_000_000,
    operatingCashFlowYTD: 2_200_000_000,
    capexYTD: 300_000_000,
    depreciationAmortizationYTD: 200_000_000,
    changeOperatingNwcYTD: 100_000_000,
    valuationTaxRate: 0.225,
    valuationSource: 'القوائم المدققة 2025',
    financialCurrency: 'EGP',
    financialUnit: 'base',
    netIncomeCommonYTD: 1_800_000_000,
    dividendsPaidYTD: null,
    totalAssets: 25_000_000_000,
    totalDebt: 2_000_000_000,
    cashAndEquivalents: 3_000_000_000,
    totalEquity: 10_000_000_000,
    sharesCount: 100_000_000,
    reportedEps: 18,
    reportedEpsSource: 'قائمة الدخل 2025',
    reportedEpsPeriod: 'FY 2025',
    ...overrides,
  };
}

function makeBaseParams(): Record<string, number> {
  return {
    Rf_Egypt_10Y: 0.24,
    Rf_USD_10Y: 0.045,
    ERP_Developed: 0.05,
    CRP_Egypt: 0.06,
    Country_Risk_Lambda: 1,
    r_Mode: 1,
    WACC_Mode: 1,
    Cost_of_Debt: 0.2,
    TaxRate: 0.225,
    Terminal_Growth: 0.05,
    Forecast_Years: 5,
    Growth_Y1: 0.1,
    Growth_Y2: 0.09,
    Growth_Y3: 0.08,
    Growth_Y4: 0.07,
    Growth_Y5: 0.06,
    DDM_Growth: 0.05,
    RIM_Retention: 0.5,
    Beta_Raw_Weight: 0.67,
    Beta_Anchor: 1,
    Weight_DCF: 35,
    Weight_DDM: 20,
    Weight_RIM: 25,
    Weight_Relative: 10,
    Weight_Graham: 10,
  };
}

describe('Unified Parameter Save Paths, Beta Governance, Migration Audit & Dividend Basis Consistency', () => {
  it('1) VALUATION_LAB_FIELD_REGISTRY defines complete scope restrictions, destinations, and validation', () => {
    const rf = getValuationLabField('Rf_Egypt_10Y');
    assert.ok(rf);
    assert.equal(rf.saveDestination, 'company_assumptions');
    assert.deepEqual(rf.allowedScopes, ['company', 'global']);
    assert.equal(rf.supportsSensitivityDraft, true);

    const betaDefault = getValuationLabField('Beta_Default');
    assert.ok(betaDefault);
    assert.deepEqual(betaDefault.allowedScopes, ['global']);
    assert.equal(betaDefault.saveDestination, 'macro_params');

    const rfUsd = getValuationLabField('Rf_USD_10Y');
    assert.ok(rfUsd);
    assert.deepEqual(rfUsd.allowedScopes, ['global']);

    const betaField = getValuationLabField('Beta');
    assert.ok(betaField);
    assert.equal(betaField.saveDestination, 'beta_assumptions');
    assert.equal(betaField.validationRules.requiresSource, true);
    assert.equal(betaField.validationRules.requiresAsOfDate, true);

    const betaAnalytical = getValuationLabField('Beta_Analytical');
    assert.ok(betaAnalytical);
    assert.equal(betaAnalytical.saveDestination, 'company_assumptions');
    assert.deepEqual(betaAnalytical.allowedScopes, ['company']);

    const targetPe = getValuationLabField('Target_PE');
    assert.ok(targetPe);
    assert.deepEqual(targetPe.allowedScopes, ['company']);
    assert.equal(targetPe.legacyCompanyField, 'targetPE');

    const targetPb = getValuationLabField('Target_PB');
    assert.ok(targetPb);
    assert.deepEqual(targetPb.allowedScopes, ['company']);
    assert.equal(targetPb.legacyCompanyField, 'targetPB');

    assert.equal(VALUATION_LAB_FIELD_REGISTRY.length >= 13, true);
    assert.equal(validateValuationLabFieldValue('Rf_Egypt_10Y', 0.22).valid, true);
    assert.equal(validateValuationLabFieldValue('Rf_Egypt_10Y', 1.5).valid, false);
    assert.equal(validateValuationLabFieldValue('Target_PE', 0).valid, false);
    assert.equal(validateValuationLabFieldValue('Beta', 12).valid, false);
  });

  it('2) sanitizeCompanyMetadataPatch blocks non-null legacy valuation fields while allowing null cleanup', () => {
    for (const [legacyField, value] of [
      ['beta', 1.2],
      ['riskFreeRate', 0.24],
      ['equityRiskPremium', 0.05],
      ['costOfDebt', 0.2],
      ['taxRate', 0.225],
      ['sustainableGrowthRate', 0.05],
      ['targetPE', 10],
      ['targetPB', 1.8],
    ] as const) {
      assert.throws(
        () => sanitizeCompanyMetadataPatch({ ticker: 'COMI', [legacyField]: value }),
        /لا يُسمح بكتابة معامل التقييم/
      );
      const cleared = sanitizeCompanyMetadataPatch({ ticker: 'COMI', [legacyField]: null });
      assert.equal(cleared?.patch[legacyField], null);
    }
  });

  it('3) Beta governance: missing beta enforces 1 even when Beta_Default != 1, server errors stay null, and Beta_Analytical never alters historical betaRaw/betaAdjusted', () => {
    // a) Confirmed missing with Beta_Default != 1 in macro_params
    const missingWithConflict = resolveBetaAssumption({
      ticker: 'COMI',
      betaRecord: null,
      betaConfirmed: true,
      betaError: null,
      globalBetaDefault: 1.5,
    });
    assert.equal(missingWithConflict.status, 'defaulted_missing');
    assert.equal(missingWithConflict.betaRaw, 1);
    assert.ok(missingWithConflict.policyConflictAr);
    assert.match(missingWithConflict.policyConflictAr!, /1\.5/);

    // b) Server error / unconfirmed leaves betaRaw strictly null
    const errRes = resolveBetaAssumption({
      ticker: 'COMI',
      betaRecord: null,
      betaConfirmed: false,
      betaError: 'permission-denied',
    });
    assert.equal(errRes.status, 'unavailable_error');
    assert.equal(errRes.betaRaw, null);

    // c) Beta_Analytical overrides effectiveBetaForKe directly without changing betaRaw / betaAdjusted
    const company = makeBaseCompany();
    const financials = [makeBaseQuarterly()];
    const metrics = calculateTTMMetrics(company, financials);
    const baseParams = makeBaseParams();

    const betaRec: BetaAssumptionRecord = {
      id: 'comi',
      ticker: 'COMI',
      beta: 1.3,
      source: 'Reuters 5Y',
      asOfDate: '2026-03-01',
    };

    const withoutAnalytical = runValuationModels(company, metrics, undefined, baseParams, {
      betaRecord: betaRec,
      betaConfirmed: true,
      companyOverridesMap: {},
      disableLegacyCompanyFallback: true,
    });
    // Blume: 0.67 * 1.3 + 0.33 * 1 = 1.201
    assert.ok(Math.abs((withoutAnalytical.betaRaw ?? 0) - 1.3) < 1e-9);
    assert.ok(Math.abs((withoutAnalytical.betaAdjusted ?? 0) - 1.201) < 1e-6);
    assert.ok(Math.abs((withoutAnalytical.effectiveBetaForKe ?? 0) - 1.201) < 1e-6);

    const withAnalytical = runValuationModels(company, metrics, undefined, baseParams, {
      betaRecord: betaRec,
      betaConfirmed: true,
      companyOverridesMap: {
        Beta_Analytical: {
          ticker: 'COMI',
          key: 'Beta_Analytical',
          value: 0.85,
          source: 'تحليل حساسيات القطاع',
          asOfDate: '2026-04-01',
        },
      },
      disableLegacyCompanyFallback: true,
    });
    // Historical raw and Blume adjusted remain untouched!
    assert.ok(Math.abs((withAnalytical.betaRaw ?? 0) - 1.3) < 1e-9);
    assert.ok(Math.abs((withAnalytical.betaAdjusted ?? 0) - 1.201) < 1e-6);
    assert.ok(Math.abs((withAnalytical.betaAnalyticalOverride ?? 0) - 0.85) < 1e-9);
    assert.ok(Math.abs((withAnalytical.effectiveBetaForKe ?? 0) - 0.85) < 1e-9);
    // Ke = 0.24 + 0.85 * 0.05 + 1 * 0.06 = 0.3425
    assert.ok(Math.abs((withAnalytical.costOfEquity ?? 0) - 0.3425) < 1e-6);
  });

  it('4) Reverting/deleting company_assumptions falls back strictly by assumptionPriority without legacy companies.* fallback', () => {
    const companyWithLegacyFields = makeBaseCompany({
      riskFreeRate: 0.19, // stale legacy field inside companies doc
      targetPE: 12,
    });

    const overrides: Record<string, CompanyParameterOverride> = {
      Rf_Egypt_10Y: {
        ticker: 'COMI',
        key: 'Rf_Egypt_10Y',
        value: 0.27,
        source: 'تخصيص المحلل',
        asOfDate: '2026-04-01',
      },
    };

    const companyFirst = resolveValuationAssumptions({
      company: companyWithLegacyFields,
      paramsMap: { Rf_Egypt_10Y: 0.24 },
      companyOverridesMap: overrides,
      sectorPEMap: { 'تجارة وتوزيع': 8.5 },
      priority: 'company_first',
      disableLegacyCompanyFallback: true,
    });
    assert.equal(companyFirst.map.riskFreeRate.value, 0.27);
    assert.equal(companyFirst.map.riskFreeRate.source, 'company');
    // targetPE should NOT fall back to legacy company.targetPE=12; resolves to sectorPE=8.5
    assert.equal(companyFirst.map.targetPE.value, 8.5);
    assert.equal(companyFirst.map.targetPE.source, 'global');

    const globalFirst = resolveValuationAssumptions({
      company: companyWithLegacyFields,
      paramsMap: { Rf_Egypt_10Y: 0.24 },
      companyOverridesMap: overrides,
      priority: 'global_first',
      disableLegacyCompanyFallback: true,
    });
    assert.equal(globalFirst.map.riskFreeRate.value, 0.24);
    assert.equal(globalFirst.map.riskFreeRate.source, 'global');
    assert.equal(globalFirst.map.riskFreeRate.isOverriddenByPriority, true);

    // After delete (override removed), company_first reverts strictly to macro_params (0.24), never stale companies.riskFreeRate (0.19)
    const afterDelete = resolveValuationAssumptions({
      company: companyWithLegacyFields,
      paramsMap: { Rf_Egypt_10Y: 0.24 },
      companyOverridesMap: {},
      priority: 'company_first',
      disableLegacyCompanyFallback: true,
    });
    assert.equal(afterDelete.map.riskFreeRate.value, 0.24);
    assert.equal(afterDelete.map.riskFreeRate.source, 'global');
  });

  it('5) analyzeLegacyMigration audits legacy company parameters (including targetPE, targetPB, beta) and Beta_Default conflicts', () => {
    const companies: Company[] = [
      makeBaseCompany({
        ticker: 'COMI',
        id: 'comi',
        beta: 1.15,
        targetPE: 9.2,
        targetPB: 1.8,
        riskFreeRate: 0.25,
      }),
    ];
    const companyOverrides: CompanyParameterOverride[] = [
      { ticker: 'COMI', key: 'Target_PE', value: 9.2 }, // equal
      { ticker: 'COMI', key: 'Target_PB', value: 2.1 }, // conflict
    ];
    const betaAssumptions: BetaAssumptionRecord[] = [
      { id: 'comi', ticker: 'COMI', beta: 1.15, source: 'Reuters', asOfDate: '2026-03-01' },
    ];
    const macroParams: MacroParameter[] = [
      {
        key: 'Beta_Default',
        value: 1.25,
        unit: 'ratio',
        category: 'beta',
        description: 'bad',
        source: 'admin',
        asOfDate: '2026-03-01',
      },
    ];
    const quarterlyRecords: QuarterlyFinancialRecord[] = [];

    const report = analyzeLegacyMigration({
      companies,
      sectorPEMap: {},
      quarterlyRecords,
      dailyRecords: [],
      companyOverrides,
      betaAssumptions,
      macroParams,
    });

    assert.equal(report.betaDefaultAudit.status, 'conflict_non_one');
    assert.equal(report.summaryCounts.betaDefaultConflict, true);
    assert.equal(report.summaryCounts.legacyParamsReadyToMigrate, 1); // riskFreeRate
    assert.equal(report.summaryCounts.legacyParamsAlreadyMigrated, 2); // beta & targetPE
    assert.equal(report.summaryCounts.legacyParamsConflicts, 1); // targetPB

    const pbItem = report.legacyParameterMigrations.find((m) => m.legacyField === 'targetPB');
    assert.equal(pbItem?.targetKey, 'Target_PB');
    assert.equal(pbItem?.status, 'conflict_different_value');
  });

  it('6) Dividend basis consistency: DDM via annual_total when year status is unknown vs complete requirement for Retention/RIM', () => {
    assert.equal(DIVIDEND_COMPLETENESS_BASIS_RULES.ddmPermitsAnnualTotalWhenYearUnknown, true);
    assert.equal(
      DIVIDEND_COMPLETENESS_BASIS_RULES.retentionRequiresCompleteOrConfirmedNoDividend,
      true
    );

    const quarters = [makeBaseQuarterly()];
    const unknownSummary = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [
        {
          ticker: 'COMI',
          fiscalYear: 2025,
          recordType: 'regular',
          distributionId: 'annual_2025',
          cashDps: 2.5,
          currency: 'EGP',
          distributionSemantics: 'annual_total',
          approvalStatus: 'paid',
          asOfDate: '2026-03-20',
          paymentDate: '2026-04-05',
          totalDistributionAmount: 250_000_000,
          source: 'الجمعية العمومية',
        },
      ],
      dividendYearStatuses: [], // status = unknown
      quarterlyRecords: quarters,
      sharesOutstanding: 100_000_000,
      netIncomeTTM: 1_800_000_000,
      financialCurrency: 'EGP',
      valuationDate: '2026-04-15',
    });

    assert.equal(unknownSummary.ddmEligible, true);
    assert.equal(unknownSummary.ddmBasisStatus, 'eligible_annual_total');
    assert.equal(unknownSummary.dividendYearStatus, 'unknown');
    assert.equal(unknownSummary.historicalRetentionRatio, null);
    assert.equal(unknownSummary.historicalRetentionSuitableForRim, false);
    assert.ok(unknownSummary.ddmVsRetentionDifferenceReasonAr);
    assert.match(unknownSummary.ddmVsRetentionDifferenceReasonAr!, /annual_total/);

    // Once year status is formally marked complete <= valuationDate, Retention/RIM becomes suitable and difference note clears
    const completeSummary = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [
        {
          ticker: 'COMI',
          fiscalYear: 2025,
          recordType: 'regular',
          distributionId: 'annual_2025',
          cashDps: 2.5,
          currency: 'EGP',
          distributionSemantics: 'annual_total',
          approvalStatus: 'paid',
          asOfDate: '2026-03-20',
          paymentDate: '2026-04-05',
          totalDistributionAmount: 250_000_000,
          source: 'الجمعية العمومية',
        },
      ],
      dividendYearStatuses: [
        {
          id: 'comi_2025',
          ticker: 'COMI',
          fiscalYear: 2025,
          status: 'complete',
          confirmedAt: '2026-04-10',
          confirmedSource: 'مراجعة نهائية',
        },
      ],
      quarterlyRecords: quarters,
      sharesOutstanding: 100_000_000,
      netIncomeTTM: 1_800_000_000,
      financialCurrency: 'EGP',
      valuationDate: '2026-04-15',
    });

    assert.equal(completeSummary.ddmEligible, true);
    assert.equal(completeSummary.historicalRetentionSuitableForRim, true);
    assert.equal(completeSummary.ddmVsRetentionDifferenceReasonAr, null);
  });
});
