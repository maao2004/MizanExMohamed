import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';

import {
  applyDividendRecordsAtomicTx,
  applyDividendYearStatusAtomicTx,
  buildDividendDocId,
  buildDividendYearStatusDocId,
  DIVIDEND_YEAR_LOCKS_COLLECTION,
  DividendGovernanceConflictError,
  stripLegacyQuarterlyDpsFromRecord,
  validateDividendRecords,
  validateDividendYearStatusPayload,
  validateRecords,
} from '../src/core/contracts';
import {
  resolveDividendAnalyticsForStock,
} from '../src/core/domain/dividendAnalytics';
import { parseQuarterlyFinancialsExcelDetailed } from '../src/core/imports';
import { mapQuarterlySnapshot, mapFinancialsSnapshot } from '../src/services/firebase/firestoreTransforms';
import { CacheService } from '../src/services/storage/cacheService';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { buildCompanyValuationWorkbook, parseFinancialsExcelFile } from '../src/utils/excelExport';
import { DdmAuditCard } from '../src/components/DdmAuditCard';
import { ValuationView } from '../src/components/ValuationView';
import type {
  Company,
  DividendRecord,
  DividendYearStatusRecord,
  QuarterlyFinancialRecord,
} from '../src/types';
import type { QuarterlyFinancial } from '../src/types/financial';

const BASE_MACROS: Record<string, number> = {
  TaxRate: 0.225,
  Rf_Egypt_10Y: 0.2,
  ERP_Developed: 0.05,
  CRP_Egypt: 0.05,
  Beta_Default: 1.0,
  Terminal_Growth: 0.05,
  Exit_Multiple: 6,
  Forecast_Years: 3,
  Cost_of_Debt: 0.16,
  Growth_Y1: 0.12,
  Growth_Y2: 0.1,
  Growth_Y3: 0.08,
  WACC_Mode: 1,
  DDM_Growth: 0.06,
  r_Mode: 1,
  Weight_DCF: 40,
  Weight_DDM: 20,
  Weight_RIM: 20,
  Weight_Relative: 10,
  Weight_Graham: 10,
  Beta_Raw_Weight: 1,
  Beta_Anchor: 1,
  Country_Risk_Lambda: 1,
  RIM_Retention: 0.6,
  Relative_PE_Weight: 0.5,
  Relative_PB_Weight: 0.5,
};

function makeWorkbookFile(rows: unknown[][], sheetName = 'QuarterlyFinancials', fileName = 'Quarterly.xlsx'): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([arr], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function makeQuarter(overrides: Partial<QuarterlyFinancial> = {}): QuarterlyFinancial {
  return {
    id: 'COMI_2025_FY',
    companyId: 'comi',
    year: 2025,
    quarter: 'FY',
    periodDate: '2025-12-31',
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 500_000_000,
    operatingProfitYTD: 400_000_000,
    netProfitYTD: 250_000_000,
    netIncomeCommonYTD: 250_000_000,
    netIncomeCommonBasis: 'explicit_common',
    operatingCashFlowYTD: 300_000_000,
    capexYTD: 50_000_000,
    dividendsPaidYTD: 100_000_000,
    totalAssets: 2_000_000_000,
    totalDebt: 200_000_000,
    cashAndEquivalents: 300_000_000,
    totalEquity: 1_000_000_000,
    sharesCount: 100_000_000,
    financialCurrency: 'EGP',
    financialUnit: 'base',
    isAudited: true,
    ...overrides,
  };
}

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'comi',
    ticker: 'COMI',
    nameAr: 'البنك التجاري الدولي',
    nameEn: 'CIB Egypt',
    sector: 'بنوك',
    sectorId: 'banks',
    sectorClassification: 'financial',
    marketPrice: 80,
    marketPriceSource: 'lastPrice',
    latestTradeDate: '2026-04-01',
    sharesOutstanding: 100_000_000,
    beta: 1.0,
    riskFreeRate: 0.2,
    equityRiskPremium: 0.05,
    costOfDebt: 0.16,
    taxRate: 0.225,
    targetDebtRatio: null,
    sustainableGrowthRate: 0.05,
    shortTermGrowthRate: null,
    targetPE: 8,
    targetPB: 1.5,
    currency: 'EGP',
    ...overrides,
  };
}

describe('Legacy DPS_Current Termination, Central Fiscal Year Resolver, Cutoff Policy & DDM Audit', () => {
  it('Case 1: Latest confirmed_no_dividend year beats older positive dividend year while preserving latestPositiveDividendYear', () => {
    const div2024: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2024,
      cashDps: 2.5,
      asOfDate: '2025-03-25',
      distributionId: 'ANN_2024',
      recordType: 'regular',
      approvalStatus: 'paid',
      paymentDate: '2025-04-10',
      distributionSemantics: 'annual_total',
      totalDistributionAmount: 250_000_000,
      currency: 'EGP',
    };
    const status2024: DividendYearStatusRecord = {
      ticker: 'COMI',
      fiscalYear: 2024,
      status: 'complete',
      confirmedSource: 'EGX AGM',
      confirmedAt: '2025-03-28',
      notes: null,
    };
    const status2025NoDiv: DividendYearStatusRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      status: 'confirmed_no_dividend',
      confirmedSource: 'AGM Resolution 2026',
      confirmedAt: '2026-03-20',
      notes: 'ترحيل كامل الأرباح',
    };

    const res = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [div2024],
      dividendYearStatuses: [status2024, status2025NoDiv],
      quarterlyRecords: [
        makeQuarter({ year: 2024, periodDate: '2024-12-31', netIncomeCommonYTD: 500_000_000 }),
        makeQuarter({ year: 2025, periodDate: '2025-12-31', netIncomeCommonYTD: 600_000_000 }),
      ],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });

    assert.equal(res.source, 'confirmed_no_dividend');
    assert.equal(res.targetFiscalYear, 2025);
    assert.equal(res.ddmBasisFiscalYear, 2025);
    assert.equal(res.retentionFiscalYear, 2025);
    assert.equal(res.latestPositiveDividendYear, 2024);
    assert.equal(res.regularDps, 0);
    assert.equal(res.historicalPayoutRatio, 0);
    assert.equal(res.historicalRetentionRatio, 1);
    assert.equal(res.ddmEligible, false);
    assert.equal(res.ddmBasisStatus, 'blocked_confirmed_no_dividend');
  });

  it('Case 2: Newer partial/unknown year shows in displayLatestEventsYear while DDM & retention fall back to latest valid year with age warning', () => {
    const div2024: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2024,
      cashDps: 2.0,
      asOfDate: '2025-03-15',
      distributionId: 'ANN_2024',
      recordType: 'regular',
      approvalStatus: 'paid',
      paymentDate: '2025-04-01',
      distributionSemantics: 'annual_total',
      totalDistributionAmount: 200_000_000,
      currency: 'EGP',
    };
    const div2025Partial: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      cashDps: 0.75,
      asOfDate: '2026-02-10',
      distributionId: 'Q1_2025_TRANCHE',
      recordType: 'regular',
      approvalStatus: 'approved',
      distributionSemantics: 'installment',
      totalDistributionAmount: 75_000_000,
      currency: 'EGP',
    };

    const res = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [div2024, div2025Partial],
      dividendYearStatuses: [
        {
          ticker: 'COMI',
          fiscalYear: 2024,
          status: 'complete',
          confirmedSource: 'EGX AGM',
          confirmedAt: '2025-03-20',
          notes: null,
        },
        {
          ticker: 'COMI',
          fiscalYear: 2025,
          status: 'partial',
          confirmedSource: null,
          confirmedAt: null,
          notes: 'دفعة أولى فقط',
        },
      ],
      quarterlyRecords: [
        makeQuarter({ year: 2024, periodDate: '2024-12-31', netIncomeCommonYTD: 400_000_000 }),
        makeQuarter({ year: 2025, periodDate: '2025-12-31', netIncomeCommonYTD: 500_000_000 }),
      ],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });

    assert.equal(res.displayLatestEventsYear, 2025);
    assert.equal(res.targetFiscalYear, 2024);
    assert.equal(res.ddmBasisFiscalYear, 2024);
    assert.equal(res.retentionFiscalYear, 2024);
    assert.equal(res.fiscalYearDataAgeYears, 2);
    assert.equal(res.regularDps, 2.0);
    assert.equal(res.ddmEligible, true);
    assert.ok(Math.abs((res.historicalPayoutRatio ?? 0) - 0.5) < 1e-9);
    assert.ok(Math.abs((res.historicalRetentionRatio ?? 0) - 0.5) < 1e-9);
    assert.ok(res.yearResolutionNoteAr && res.yearResolutionNoteAr.includes('2025') && res.yearResolutionNoteAr.includes('2024'));
  });

  it('Case 3: Cutoff governs confirmedAt on formal statuses and paymentDate on paid dividends', () => {
    const divPaidOnTimeMissingDate: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2024,
      cashDps: 1.5,
      asOfDate: '2025-03-01',
      distributionId: 'PAID_NO_DATE',
      recordType: 'regular',
      approvalStatus: 'paid',
      paymentDate: null,
      distributionSemantics: 'annual_total',
      currency: 'EGP',
    };
    const div2024CompleteStatus: DividendYearStatusRecord = {
      ticker: 'COMI',
      fiscalYear: 2024,
      status: 'complete',
      confirmedSource: 'EGX',
      confirmedAt: '2025-03-20',
      notes: null,
    };
    // Future confirmation date relative to 2026-04-01 cutoff -> MUST be excluded!
    const futureNoDivStatus: DividendYearStatusRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      status: 'confirmed_no_dividend',
      confirmedSource: 'Future AGM',
      confirmedAt: '2026-05-01',
      notes: null,
    };
    // Undated formal status -> MUST NOT be trusted as proof!
    const undatedCompleteStatus: DividendYearStatusRecord = {
      ticker: 'COMI',
      fiscalYear: 2023,
      status: 'complete',
      confirmedSource: 'Undated Check',
      confirmedAt: null,
      notes: null,
    };

    const res = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [divPaidOnTimeMissingDate],
      dividendYearStatuses: [div2024CompleteStatus, futureNoDivStatus, undatedCompleteStatus],
      quarterlyRecords: [makeQuarter({ year: 2024, periodDate: '2024-12-31' })],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });

    assert.equal(res.targetFiscalYear, 2024);
    assert.equal(res.statusCutoffExcludedCount, 1);
    assert.equal(res.statusMissingDateCount, 1);
    assert.equal(res.paidMissingPaymentDateCount, 1);
    assert.equal(res.paidRecordsCount, 0);
    assert.equal(res.paidTotalDps, null);
    assert.ok(res.warningsAr.some((w) => w.includes('2025') && w.includes('2026-05-01')));
    assert.ok(res.warningsAr.some((w) => w.includes('confirmedAt')));
    assert.ok(res.warningsAr.some((w) => w.includes('paymentDate')));
  });

  it('DDM Eligibility Gate blocks unconfirmed installment/standalone_event and detects >50% dividend swings/suspensions', () => {
    const unconfirmedInstallment: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      cashDps: 1.2,
      asOfDate: '2026-03-01',
      distributionId: 'TRANCHE_ONLY',
      recordType: 'regular',
      approvalStatus: 'approved',
      distributionSemantics: 'installment',
      currency: 'EGP',
    };

    const blocked = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [unconfirmedInstallment],
      dividendYearStatuses: [],
      quarterlyRecords: [makeQuarter()],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });

    // Regular DPS stays visible for review, but DDM is strictly blocked without complete status or annual_total
    assert.equal(blocked.regularDps, 1.2);
    assert.equal(blocked.ddmEligible, false);
    assert.equal(blocked.ddmBasisStatus, 'blocked_unconfirmed_events');
    assert.match(blocked.ddmIneligibleReasonAr ?? '', /installment|annual_total/);

    // Stability warning: 2023=4.00 -> 2024=1.00 (-75% swing) -> 2025=1.10 (eligible but volatile!)
    const multiYearRecords: DividendRecord[] = [
      {
        ticker: 'COMI',
        fiscalYear: 2023,
        cashDps: 4.0,
        asOfDate: '2024-03-15',
        distributionId: 'ANN_2023',
        recordType: 'regular',
        approvalStatus: 'paid',
        paymentDate: '2024-04-01',
        distributionSemantics: 'annual_total',
        currency: 'EGP',
      },
      {
        ticker: 'COMI',
        fiscalYear: 2024,
        cashDps: 1.0,
        asOfDate: '2025-03-15',
        distributionId: 'ANN_2024',
        recordType: 'regular',
        approvalStatus: 'paid',
        paymentDate: '2025-04-01',
        distributionSemantics: 'annual_total',
        currency: 'EGP',
      },
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 1.1,
        asOfDate: '2026-03-15',
        distributionId: 'ANN_2025',
        recordType: 'regular',
        approvalStatus: 'approved',
        distributionSemantics: 'annual_total',
        currency: 'EGP',
      },
    ];
    const multiYearStatuses: DividendYearStatusRecord[] = [
      { ticker: 'COMI', fiscalYear: 2023, status: 'complete', confirmedSource: 'EGX', confirmedAt: '2024-03-20', notes: null },
      { ticker: 'COMI', fiscalYear: 2024, status: 'complete', confirmedSource: 'EGX', confirmedAt: '2025-03-20', notes: null },
      { ticker: 'COMI', fiscalYear: 2025, status: 'complete', confirmedSource: 'EGX', confirmedAt: '2026-03-20', notes: null },
    ];

    const volatileSummary = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: multiYearRecords,
      dividendYearStatuses: multiYearStatuses,
      quarterlyRecords: [makeQuarter()],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      cutoffDate: '2026-04-01',
    });

    assert.equal(volatileSummary.ddmEligible, true);
    assert.ok(volatileSummary.dividendStabilityWarningAr && volatileSummary.dividendStabilityWarningAr.includes('75%'));
    assert.match(volatileSummary.dividendSuitabilityNoteAr ?? '', /اكتمال|ملاءمة/);
  });

  it('Ingest & Snapshot stripping: ignores DPS_Current on Excel import without extendedFields leak and strips uncleaned docs', async () => {
    const file = makeWorkbookFile([
      [
        'Ticker',
        'StockName',
        'YearQuarter',
        'Year',
        'Quarter',
        'Shares',
        'TotalAssets',
        'Equity',
        'TotalDebtWithoutTX',
        'TotalLiabilities',
        'RevenueYTD',
        'GrossProfitYTD',
        'EBIT_YTD',
        'PBT_YTD',
        'NetIncomeYTD',
        'OCF_YTD',
        'NetInvestingCF_YTD',
        'DividendsPaidYTD',
        'Cash',
        'DPS_Current',
        'DateInsertData',
        'CustomKPI',
      ],
      ['COMI', 'CIB', '2025FY', 2025, 'FY', 100, 1000, 500, 100, 500, 400, 200, 150, 140, 100, 120, -20, 30, 80, 9.99, '2026-03-01', 42],
    ]);

    const parsed = await parseQuarterlyFinancialsExcelDetailed(file);
    assert.equal(parsed.records.length, 1);
    assert.ok(parsed.warnings.some((w) => w.includes('DPS_Current') && w.includes('DPS_Actual')));
    const parsedRec = parsed.records[0] as Record<string, any>;
    assert.equal('dpsCurrent' in parsedRec, false);
    assert.equal('DPS_Current' in parsedRec, false);
    assert.equal(parsedRec.extendedFields?.CustomKPI, 42);
    assert.equal('DPS_Current' in (parsedRec.extendedFields ?? {}), false);
    assert.equal('dpsCurrent' in (parsedRec.extendedFields ?? {}), false);

    // 19-column legacy Excel template handled in parseFinancialsExcelFile without column shift corruption
    const legacy19ColFile = makeWorkbookFile([
      [
        'Ticker', 'Year', 'Quarter', 'Period', 'Revenue', 'Gross', 'EBIT', 'Net', 'OCF', 'CapEx', 'DivPaid',
        'DPS_Current',
        'TotalAssets', 'TotalDebt', 'Cash', 'TotalEquity', 'Shares', 'Audited', 'Notes',
      ],
      ['COMI', 2025, 'FY', '2025-12-31', 1000, 500, 400, 250, 300, 50, 100, 8.88, 2000, 200, 300, 1000, 100, 'TRUE', 'legacy shift check'],
    ]);
    const legacyParsed = await parseFinancialsExcelFile(legacy19ColFile, 'comi');
    assert.equal(legacyParsed.length, 1);
    assert.equal(legacyParsed[0].totalAssets, 2000);
    assert.equal(legacyParsed[0].totalEquity, 1000);
    assert.equal(legacyParsed[0].sharesCount, 100);
    assert.equal((legacyParsed[0] as any).dpsCurrent, undefined);

    // Snapshot transforms & stripLegacyQuarterlyDpsFromRecord strip uncleaned top-level and nested keys while keeping siblings
    const stripped = stripLegacyQuarterlyDpsFromRecord({
      ticker: 'COMI',
      dpsCurrent: 1.5,
      DPS_Current: 1.5,
      dps_current: 1.5,
      extendedFields: {
        dpsCurrent: 2,
        DPS_Current: 3,
        CustomMetric: 'keep',
      },
    } as Record<string, any>);
    assert.equal('dpsCurrent' in stripped, false);
    assert.equal('DPS_Current' in stripped, false);
    assert.equal('dps_current' in stripped, false);
    assert.deepEqual(stripped.extendedFields, { CustomMetric: 'keep' });

    const mockSnap = {
      forEach(cb: (d: { id: string; data: () => Record<string, any> }) => void) {
        cb({
          id: 'COMI_2025_FY',
          data: () => ({
            ticker: 'COMI',
            year: 2025,
            quarter: 'FY',
            dpsCurrent: 5.5,
            DPS_Current: 5.5,
            extendedFields: { DPS_Current: 5.5, CustomTag: 'ok' },
          }),
        });
      },
    } as any;
    const mappedQ = mapQuarterlySnapshot(mockSnap);
    assert.equal((mappedQ[0] as any).dpsCurrent, undefined);
    assert.deepEqual(mappedQ[0].extendedFields, { CustomTag: 'ok' });

    const mappedF = mapFinancialsSnapshot(mockSnap);
    assert.equal((mappedF[0] as any).dpsCurrent, undefined);

    // CacheService save & get strips legacy DPS keys
    const origStorage = (globalThis as any).localStorage;
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    };
    try {
      CacheService.setScope({ projectId: 'test', databaseId: 'default', uid: 'u1' });
      CacheService.saveQuarterlyFinancialRecords([{ ticker: 'COMI', year: 2025, quarter: 'FY', dpsCurrent: 3 } as any]);
      const loaded = CacheService.getQuarterlyFinancialRecords();
      assert.equal((loaded[0] as any).dpsCurrent, undefined);
    } finally {
      (globalThis as any).localStorage = origStorage;
    }

    // Server validateRecords tolerates legacy optional stripped inputs without requiring dpsCurrent
    const [validatedQ] = validateRecords([
      {
        ticker: 'COMI',
        stockName: 'CIB',
        yearQuarter: '2025FY',
        year: 2025,
        quarter: 'FY',
        shares: 100,
        revenueYTD: 100,
        netIncomeYTD: 20,
        ocfYTD: 25,
        capexYTD: 5,
        totalAssets: 200,
        totalDebtWithoutTX: 20,
        equity: 120,
        cash: 30,
        dateInsertData: '2026-03-01',
        DPS_Current: 99,
        extendedFields: { dpsCurrent: 99, KeepField: 12 },
      },
    ], true);
    assert.equal('dpsCurrent' in validatedQ, false);
    assert.equal('DPS_Current' in validatedQ, false);
    assert.equal(validatedQ.extendedFields?.KeepField, 12);
    assert.equal('dpsCurrent' in (validatedQ.extendedFields ?? {}), false);
  });

  it('DdmAuditCard SSR, ValuationView DDM tab, and buildCompanyValuationWorkbook DDM_Audit sheet export cleanly', async () => {
    const company = makeCompany();
    const divRec: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      cashDps: 2.0,
      asOfDate: '2026-03-20',
      distributionId: 'ANN_2025',
      recordType: 'regular',
      approvalStatus: 'paid',
      paymentDate: '2026-03-28',
      distributionSemantics: 'annual_total',
      totalDistributionAmount: 200_000_000,
      currency: 'EGP',
    };
    const status2025: DividendYearStatusRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      status: 'complete',
      confirmedSource: 'EGX AGM',
      confirmedAt: '2026-03-22',
      notes: null,
    };

    const metrics = calculateTTMMetrics(company, [makeQuarter()], {
      dividendRecords: [divRec],
      dividendYearStatuses: [status2025],
      cutoffDate: '2026-04-01',
    });
    const valuation = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      quarterlyRecords: [],
      betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-03-01', source: 'EGX' },
      betaConfirmed: true,
      valuationDate: '2026-04-01',
    });

    assert.ok(valuation.ddmAudit);
    assert.equal(valuation.ddmAudit.eligible, true);
    assert.equal(valuation.ddmAudit.d0, 2.0);
    assert.equal(valuation.ddmAudit.sensitivityMatrix.length, 5);

    const cardHtml = renderToStaticMarkup(
      React.createElement(DdmAuditCard, {
        ddmAudit: valuation.ddmAudit,
        finCurrencyLabel: 'ج.م',
      })
    );
    assert.match(cardHtml, /DDM_Audit/);
    assert.match(cardHtml, /Ke \\ g/);

    const viewHtml = renderToStaticMarkup(
      React.createElement(ValuationView, {
        company,
        metrics: {
          ...metrics,
          wacc: valuation.engineOutputs?.wacc ?? null,
          costOfEquity: valuation.engineOutputs?.costOfEquity ?? null,
        },
        valuation,
        assumptionPriority: 'company_first',
        onChangePriority: () => undefined,
        rimRetentionPolicy: 'rim_parameter',
        onChangeRimRetentionPolicy: () => undefined,
        onUpdateCompanyParams: () => undefined,
      })
    );
    assert.match(viewHtml, /2\. نموذج DDM \(خصم التوزيعات\)/);

    const wb = await buildCompanyValuationWorkbook(company, [makeQuarter()], metrics, valuation, []);
    assert.ok(wb.SheetNames.includes('DDM_Audit'));
    const ddmAuditRows = XLSX.utils.sheet_to_json(wb.Sheets['DDM_Audit'], { header: 1 }) as unknown[][];
    const joined = ddmAuditRows.map((r) => r.join(' | ')).join('\n');
    assert.match(joined, /Ke \\ g/);
    assert.match(joined, /D0/);
  });

  it('Atomic dividend transaction coordinators reject conflicting year statuses and manage dividend_year_locks', async () => {
    const db = new Map<string, Record<string, any>>();
    const createTxTarget = () => ({
      async getDoc(col: string, id: string) {
        return db.get(`${col}/${id}`);
      },
      async getActiveDividendsForYear(ticker: string, fiscalYear: number) {
        const prefix = `dividend_records/${ticker}_${fiscalYear}_`;
        const matches: Record<string, any>[] = [];
        for (const [k, v] of db.entries()) {
          if (k.startsWith(prefix)) matches.push(v);
        }
        return matches;
      },
      setDoc(col: string, id: string, data: Record<string, any>, merge: boolean) {
        const k = `${col}/${id}`;
        db.set(k, merge ? { ...(db.get(k) ?? {}), ...data } : data);
      },
    });

    const [validDiv] = validateDividendRecords([
      {
        ticker: 'COMI',
        fiscalYear: 2025,
        cashDps: 2.0,
        asOfDate: '2026-03-20',
        recordType: 'regular',
        approvalStatus: 'approved',
        distributionSemantics: 'annual_total',
        distributionId: 'FY2025_ANN',
        currency: 'EGP',
      },
    ]);

    const txRes = await applyDividendRecordsAtomicTx(createTxTarget(), {
      records: [validDiv],
      stamp: { updatedAt: '2026-03-21T00:00:00.000Z', updatedBy: 'admin_1' },
      operationType: 'bulk_dividend',
    });
    assert.equal(txRes.insertedCount, 1);

    const lockKey = `${DIVIDEND_YEAR_LOCKS_COLLECTION}/${buildDividendYearStatusDocId('COMI', 2025)}`;
    assert.ok(db.has(lockKey));
    assert.equal(db.get(lockKey)?.lastOperation, 'bulk_dividend');
    assert.ok(db.has(`dividend_records/${buildDividendDocId(validDiv)}`));

    // Now attempting confirmed_no_dividend on COMI 2025 inside atomic status tx MUST throw conflict error!
    const noDivPayload = validateDividendYearStatusPayload({
      ticker: 'COMI',
      fiscalYear: 2025,
      status: 'confirmed_no_dividend',
      confirmedSource: 'Mistake Board',
      confirmedAt: '2026-03-25',
    });

    await assert.rejects(
      () =>
        applyDividendYearStatusAtomicTx(createTxTarget(), {
          validated: noDivPayload,
          stamp: { updatedAt: '2026-03-25T00:00:00.000Z', updatedBy: 'admin_1' },
        }),
      (err: unknown) => err instanceof DividendGovernanceConflictError && err.code === 'failed-precondition'
    );

    // Opposite direction: confirmed_no_dividend set on 2024 -> importing approved dividend for 2024 throws conflict error!
    const valid2024NoDiv = validateDividendYearStatusPayload({
      ticker: 'COMI',
      fiscalYear: 2024,
      status: 'confirmed_no_dividend',
      confirmedSource: 'AGM 2025',
      confirmedAt: '2025-03-25',
    });
    const statusRes = await applyDividendYearStatusAtomicTx(createTxTarget(), {
      validated: valid2024NoDiv,
      stamp: { updatedAt: '2025-03-25T00:00:00.000Z', updatedBy: 'admin_1' },
    });
    assert.equal(statusRes.insertedCount, 1);

    const [div2024] = validateDividendRecords([
      {
        ticker: 'COMI',
        fiscalYear: 2024,
        cashDps: 1.0,
        asOfDate: '2025-03-10',
        recordType: 'regular',
        approvalStatus: 'paid',
        paymentDate: '2025-03-28',
        distributionSemantics: 'annual_total',
        distributionId: 'FY2024_CONFLICT',
        currency: 'EGP',
      },
    ]);
    await assert.rejects(
      () =>
        applyDividendRecordsAtomicTx(createTxTarget(), {
          records: [div2024],
          stamp: { updatedAt: '2026-03-26T00:00:00.000Z', updatedBy: 'admin_1' },
          operationType: 'dividend_record',
        }),
      (err: unknown) => err instanceof DividendGovernanceConflictError && err.code === 'failed-precondition'
    );
  });
});
