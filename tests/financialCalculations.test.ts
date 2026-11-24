import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTTMMetrics,
  computeStandaloneQuarters,
  readYtdTTM,
  runValuationModels,
} from '../src/utils/financialCalculations';
import { computeComprehensiveValuation } from '../src/core/math/valuation';
import { Company, QuarterlyFinancial } from '../src/types/financial';

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'testco',
    ticker: 'TEST.CA',
    nameAr: 'شركة اختبار',
    nameEn: 'Test Co',
    sector: 'الصناعة',
    sectorClassification: 'non_financial',
    marketPrice: 20,
    sharesOutstanding: 100,
    beta: 1.0,
    riskFreeRate: 0.251,
    equityRiskPremium: 0.0421,
    costOfDebt: 0.15,
    taxRate: 0.225,
    targetDebtRatio: 0.2,
    sustainableGrowthRate: 0.05,
    shortTermGrowthRate: 0.1,
    targetPE: 8,
    targetPB: 1.5,
    currency: 'EGP',
    ...overrides,
  };
}

function makeQuarter(overrides: Partial<QuarterlyFinancial> = {}): QuarterlyFinancial {
  return {
    id: 'testco_2025_fy',
    companyId: 'testco',
    year: 2025,
    quarter: 'FY',
    periodDate: '2025-12-31',
    revenueYTD: 1000,
    grossProfitYTD: 400,
    operatingProfitYTD: 250,
    netProfitYTD: 200,
    operatingCashFlowYTD: 260,
    capexYTD: 60,
    dividendsPaidYTD: 50,
    totalAssets: 2000,
    totalDebt: 300,
    cashAndEquivalents: 100,
    totalEquity: 1200,
    sharesCount: 100,
    isAudited: true,
    depreciationAmortizationYTD: 40,
    changeOperatingNwcYTD: 20,
    valuationTaxRate: 0.225,
    valuationSource: 'قوائم مالية مدققة',
    financialUnit: 'EGP_millions',
    ...overrides,
  };
}

const TEST_MACRO_PARAMS: Record<string, number> = {
  r_Mode: 1,
  WACC_Mode: 1,
  Country_Risk_Lambda: 1,
  Beta_Raw_Weight: 0.67,
  Beta_Anchor: 1,
  Relative_PE_Weight: 0.6,
  Relative_PB_Weight: 0.4,
  TaxRate: 0.225,
  Rf_Egypt_10Y: 0.251,
  ERP_Developed: 0.0421,
  CRP_Egypt: 0,
  Cost_of_Debt: 0.15,
  Terminal_Growth: 0.05,
  Forecast_Years: 5,
  Growth_Y1: 0.12,
  Growth_Y2: 0.10,
  Growth_Y3: 0.08,
  Growth_Y4: 0.06,
  Growth_Y5: 0.05,
  DDM_Growth: 0.05,
  RIM_Retention: 0.50,
  Weight_DCF: 35,
  Weight_DDM: 15,
  Weight_RIM: 20,
  Weight_Relative: 20,
  Weight_Graham: 10,
};

describe('financialCalculations & valuation engine', () => {
  it('computes TTM strictly as YTD_current + FY_prior - YTD_prior and returns null if comparable prior missing', () => {
    const records = [
      makeQuarter({ id: 'a1', year: 2024, quarter: 'Q2', revenueYTD: 400 }),
      makeQuarter({ id: 'a2', year: 2024, quarter: 'FY', revenueYTD: 1000 }),
      makeQuarter({ id: 'a3', year: 2025, quarter: 'Q2', revenueYTD: 550 }),
    ];
    assert.equal(readYtdTTM(records, (r) => r.revenueYTD), 1150);

    const incomplete = [
      makeQuarter({ id: 'b1', year: 2024, quarter: 'FY', revenueYTD: 1000 }),
      makeQuarter({ id: 'b2', year: 2025, quarter: 'Q2', revenueYTD: 550 }),
    ];
    assert.equal(readYtdTTM(incomplete, (r) => r.revenueYTD), null);
  });

  it('requires consecutive quarters when de-cumulating standalone quarters and preserves 0 vs null', () => {
    const q1 = makeQuarter({ id: 'c1', year: 2025, quarter: 'Q1', revenueYTD: 0, netProfitYTD: null });
    const q3 = makeQuarter({ id: 'c3', year: 2025, quarter: 'Q3', revenueYTD: 700, netProfitYTD: 100 });
    const standalone = computeStandaloneQuarters([q1, q3]);

    assert.equal(standalone[0].revenue, 0);
    assert.equal(standalone[0].netProfit, null);
    assert.equal(standalone[1].revenue, null); // Q3 cannot subtract Q1 when Q2 is missing
  });

  it('calculates documented FCFF, EBITDA, EV/EBITDA, and leaves ROIC null without invested-capital reconciliation', () => {
    const company = makeCompany();
    const fy = makeQuarter();
    const metrics = calculateTTMMetrics(company, [fy]);

    // NOPAT = 250 * (1 - 0.225) = 193.75; FCFF = 193.75 + 40 - 60 - 20 = 153.75
    assert.ok(metrics.nopatTTM !== null && Math.abs(metrics.nopatTTM - 193.75) < 1e-6);
    assert.ok(metrics.fcffTTM !== null && Math.abs(metrics.fcffTTM - 153.75) < 1e-6);
    // EBITDA = 250 + 40 = 290; EV = (20*100) + (300 - 100) = 2200; EV/EBITDA = 2200/290
    assert.ok(metrics.evToEbitda !== null && Math.abs(metrics.evToEbitda - 2200 / 290) < 1e-6);
    assert.equal(metrics.roic, null);
  });

  it('computes FCFF without financialUnit, warns on missing valuationSource without hiding FCFF, and returns per-component diagnostics when core inputs are missing', () => {
    const company = makeCompany();

    // Missing valuationTaxRate returns null with per-component diagnostic naming ticker, period, field, and BLANK
    const noTax = calculateTTMMetrics(company, [makeQuarter({ valuationTaxRate: null })]);
    assert.equal(noTax.fcffTTM, null);
    assert.ok(noTax.fcffDiagnostics && noTax.fcffDiagnostics.length > 0);
    assert.ok(noTax.fcffDiagnostics.some((d) => d.field === 'ValuationTaxRate' && d.ticker === 'TEST.CA'));
    assert.ok(noTax.fcffNotes.some((n) => n.includes('TEST.CA') && n.includes('FY 2025') && n.includes('ValuationTaxRate')));

    // Missing valuationSource still computes FCFF and emits a separate documentation warning
    const noSource = calculateTTMMetrics(company, [makeQuarter({ valuationSource: '' })]);
    assert.ok(noSource.fcffTTM !== null && Math.abs(noSource.fcffTTM - 153.75) < 1e-6);
    assert.ok(noSource.fcffDocumentationWarningAr && noSource.fcffDocumentationWarningAr.includes('ValuationSource'));

    // Missing financialUnit still computes FCFF cleanly
    const noUnit = calculateTTMMetrics(company, [makeQuarter({ financialUnit: null })]);
    assert.ok(noUnit.fcffTTM !== null && Math.abs(noUnit.fcffTTM - 153.75) < 1e-6);
  });

  it('Part 1 acceptance: reads base EGP amounts and full share counts with NO financialUnit/financialCurrency required', () => {
    const company = makeCompany({
      id: 'base',
      ticker: 'BASE',
      marketPrice: 10,
      sharesOutstanding: 1_000_000,
      currency: '',
      targetPE: 8,
      targetPB: 1.5,
    });
    const baseQuarterFields: Partial<QuarterlyFinancial> = {
      id: 'base_2025_fy',
      companyId: 'base',
      year: 2025,
      quarter: 'FY',
      sharesCount: 1_000_000,
      revenueYTD: 12_000_000,
      operatingProfitYTD: 2_800_000,
      netProfitYTD: 2_000_000,
      operatingCashFlowYTD: 2_400_000,
      capexYTD: 400_000,
      depreciationAmortizationYTD: 300_000,
      changeOperatingNwcYTD: 100_000,
      totalEquity: 5_000_000,
      totalDebt: 1_000_000,
      cashAndEquivalents: 500_000,
      valuationTaxRate: 0.225,
      valuationSource: '',
      financialUnit: null,
      financialCurrency: null,
    };

    // Unattested CommonEquity / NetIncomeCommon keep reference metrics available while withholding valuation EPS/BVPS
    const unattestedMetrics = calculateTTMMetrics(company, [makeQuarter(baseQuarterFields)]);
    assert.equal(unattestedMetrics.marketCap, 10_000_000);
    assert.equal(unattestedMetrics.analyticalConsolidatedEpsTTM, 2);
    assert.equal(unattestedMetrics.totalEquityBvps, 5);
    assert.equal(unattestedMetrics.epsTTM, null);
    assert.equal(unattestedMetrics.bvps, null);

    // With explicit attestation that netIncome & totalEquity equal common scope (and no financialUnit/currency)
    const fy = makeQuarter({
      ...baseQuarterFields,
      netIncomeCommonBasis: 'attested_net_income_equals_common',
      commonEquityBasis: 'attested_total_equals_common',
    });

    const metrics = calculateTTMMetrics(company, [fy]);
    assert.equal(metrics.marketCap, 10_000_000);
    assert.equal(metrics.epsTTM, 2);
    assert.equal(metrics.bvps, 5);
    assert.ok(metrics.fcffTTM !== null && Math.abs(metrics.fcffTTM - (2_800_000 * 0.775 + 300_000 - 400_000 - 100_000)) < 1e-6);
    assert.ok(metrics.fcffDocumentationWarningAr);

    const val = runValuationModels(company, metrics, undefined, TEST_MACRO_PARAMS, {
      quarterlyRecords: [
        {
          ticker: 'BASE',
          stockName: 'Base Co',
          yearQuarter: '2025FY',
          year: 2025,
          quarter: 'FY',
          shares: 1_000_000,
          intangibleAssets: null,
          totalAssets: 8_000_000,
          equity: 5_000_000,
          equityCommonBasis: 'attested_total_equals_common',
          totalDebtWithoutTX: 1_000_000,
          totalLiabilities: 3_000_000,
          revenueYTD: 12_000_000,
          grossProfitYTD: 5_000_000,
          ebitYTD: 2_800_000,
          pbtYTD: 2_600_000,
          netIncomeYTD: 2_000_000,
          netIncomeCommonBasis: 'attested_net_income_equals_common',
          ocfYTD: 2_400_000,
          netInvestingCfYTD: -400_000,
          dividendsPaidYTD: 0,
          cash: 500_000,
          interestExpenseYTD: 200_000,
          financeCostsYTD: 200_000,
          interestIncomeYTD: 0,
          taxExpenseYTD: 600_000,
          interestPaidYTD: 200_000,
          capexYTD: 400_000,
          dateInsertData: '2025-12-31',
          depreciationAmortizationYTD: 300_000,
          changeOperatingNwcYTD: 100_000,
          valuationTaxRate: 0.225,
          valuationSource: '',
          financialUnit: null,
          financialCurrency: null,
        },
      ],
      latestDaily: {
        ticker: 'BASE',
        shortName: 'Base Co',
        tradeDate: '2026-02-01',
        lastPrice: 10,
        changePct: 0,
        tradesCount: 100,
        openPrice: 10,
        closePrice: 10,
        turnoverValue: 100000,
        netLiquidity: 0,
        volume: 10000,
        avgVolume5D: null,
        avgVolume30D: null,
        avgVolume90D: null,
        lowPrice: 9.8,
        highPrice: 10.2,
        sector: 'الصناعة',
        totalBids: null,
        bidsCount: null,
        offersCount: null,
        totalOffers: null,
        avgVolume: null,
        high52W: null,
        low52W: null,
        prevClose: 10,
        marketCapThousands: 9999, // provider raw column must never overwrite engine Market Cap
        vwap: null,
        peRatio: null,
        listedShares: 1_000_000,
        isinCode: null,
        inflowOrders: null,
        inflowVolume: null,
        inflowLiquidity: null,
        askTrades: null,
        askTradesVolume: null,
        outflowLiquidity: null,
        fullName: null,
        market: null,
        volChange5DPct: null,
        volChange30DPct: null,
        volChange90DPct: null,
      },
    });
    assert.ok(val.dcfFairValue !== null && val.dcfFairValue > 0);
    assert.ok(val.relativeFairValue !== null && val.relativeFairValue > 0);
    assert.ok(val.compositeFairValue !== null && val.compositeFairValue > 0);
    assert.equal(val.sourcesSummary?.fcffStatus, 'available_undocumented');
    assert.equal(val.sourcesSummary?.providerMarketCapThousands, 9999);
  });

  it('excludes DCF for financial sector and WACC_Mode === 3, and matches DcfDetails when enabled', () => {
    const company = makeCompany();
    const fy = makeQuarter();
    const metrics = calculateTTMMetrics(company, [fy]);
    const res = runValuationModels(company, metrics, undefined, TEST_MACRO_PARAMS);

    assert.ok(res.dcfFairValue !== null && res.dcfDetails !== null);
    assert.ok(Math.abs(res.dcfFairValue - Math.max(0, res.dcfDetails.equityValue / company.sharesOutstanding!)) < 1e-9);

    const bankRes = runValuationModels(
      makeCompany({ sector: 'البنوك', sectorClassification: undefined }),
      metrics,
      undefined,
      TEST_MACRO_PARAMS
    );
    assert.equal(bankRes.dcfFairValue, null);
    assert.equal(bankRes.dcfDetails, null);

    const explicitFinancialRes = runValuationModels(
      makeCompany({ sector: 'خدمات', sectorClassification: 'financial' }),
      metrics,
      undefined,
      TEST_MACRO_PARAMS
    );
    assert.equal(explicitFinancialRes.dcfFairValue, null);
    assert.equal(explicitFinancialRes.dcfDetails, null);

    const usdModeRes = runValuationModels(company, metrics, undefined, {
      ...TEST_MACRO_PARAMS,
      WACC_Mode: 3,
    });
    assert.equal(usdModeRes.dcfFairValue, null);
  });

  it('excludes models instead of inventing unsourced macro/beta/price assumptions', () => {
    const emptyMacroEngine = computeComprehensiveValuation(
      {
        ticker: 'TEST',
        marketPrice: null,
        sharesOutstanding: 100,
        betaRaw: null,
        netIncomeTTM: 200,
        ocfTTM: 250,
        capexTTM: 50,
        fcfTTM: 200,
        fcffTTM: 150,
        totalEquity: 1200,
        totalDebt: 300,
        cash: 100,
        dpsRegular: 1,
        sector: 'الصناعة',
        sectorPE: null,
        sectorPB: null,
      },
      {}
    );
    assert.equal(emptyMacroEngine.betaAdjusted, null);
    assert.equal(emptyMacroEngine.costOfEquity, null);
    assert.equal(emptyMacroEngine.wacc, null);
    assert.equal(emptyMacroEngine.dcfValue, null);
    assert.equal(emptyMacroEngine.ddmValue, null);
    assert.equal(emptyMacroEngine.rimValue, null);
    assert.equal(emptyMacroEngine.relativeValue, null);
    assert.equal(emptyMacroEngine.compositeFairValue, null);
    assert.equal(emptyMacroEngine.marginOfSafetyPct, null);
    assert.equal(emptyMacroEngine.upsidePotentialPct, null);
    assert.ok(emptyMacroEngine.modelNotes.length > 0);
  });

  it('does not fabricate compositeFairValue from marketPrice or synthetic ROE/multiples when inputs are missing', () => {
    const emptyEngine = computeComprehensiveValuation(
      {
        ticker: 'EMPTY',
        marketPrice: 50,
        sharesOutstanding: 100,
        betaRaw: 1,
        netIncomeTTM: null,
        ocfTTM: null,
        capexTTM: null,
        fcfTTM: null,
        fcffTTM: null,
        totalEquity: null,
        totalDebt: null,
        cash: null,
        dpsRegular: null,
        sector: 'الصناعة',
        sectorPE: 0,
        sectorPB: 0,
      },
      {}
    );
    assert.equal(emptyEngine.dcfValue, null);
    assert.equal(emptyEngine.ddmValue, null);
    assert.equal(emptyEngine.rimValue, null);
    assert.equal(emptyEngine.relativeValue, null);
    assert.equal(emptyEngine.grahamValue, null);
    assert.equal(emptyEngine.compositeFairValue, null);
    assert.equal(emptyEngine.marginOfSafetyPct, null);
    assert.equal(emptyEngine.upsidePotentialPct, null);
  });

  it('recalculates scenario bands cleanly via valuation engine', () => {
    const company = makeCompany();
    const metrics = calculateTTMMetrics(company, [makeQuarter()]);
    const res = runValuationModels(company, metrics, undefined, TEST_MACRO_PARAMS);
    assert.ok(res.scenarios.base.fairValue !== null);
    assert.ok(res.scenarios.bull.fairValue !== null);
    assert.ok(res.scenarios.bear.fairValue !== null);
    assert.ok(res.scenarios.bull.fairValue! > res.scenarios.bear.fairValue!);
    assert.equal(res.sensitivityMatrix.length, 5);
    assert.equal(res.sensitivityMatrix[0].length, 5);
  });
});
