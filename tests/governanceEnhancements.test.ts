import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';

import {
  indexDailySchemas,
  resolveDailyCellDisplay,
  resolveUnifiedDailyColumns,
} from '../src/core/domain/dailyColumnResolver';
import { deriveStockUniverseDiagnostics } from '../src/core/domain/stockDerived';
import { analyzeLegacyMigration } from '../src/core/domain/legacyMigrationTool';
import { resolveDividendAnalyticsForStock } from '../src/core/domain/dividendAnalytics';
import { FirestoreSessionManager } from '../src/core/domain/firestoreSessionManager';
import { parseDpsActualExcelFile, buildImportPreview } from '../src/core/imports';
import { resolveSectorPeFromMap, resolveUnifiedSector } from '../src/core/contracts';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { buildDailyTradingWorkbook, buildQuarterlyRecordsWorkbook } from '../src/utils/excelExport';
import { QuarterlyRecordsTable } from '../src/modules/data-hub/QuarterlyRecordsTable';
import { DailyTradingTable } from '../src/modules/data-hub/DailyTradingTable';
import { RecordDetailsModal } from '../src/modules/data-hub/RecordDetailsModal';
import { AdminDashboard } from '../src/modules/admin/AdminDashboard';
import { DashboardView } from '../src/components/DashboardView';
import { ValuationSourcesCard } from '../src/components/ValuationSourcesCard';
import type {
  Company,
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  DividendRecord,
  QuarterlyFinancialRecord,
  SectorDefinition,
} from '../src/types';

function makeWorkbookFile(rows: unknown[][], sheetName = 'DPS_Actual', fileName = 'DPS_Actual.xlsx'): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([arr], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function makeDailyBase(overrides: Partial<DailyTradingRecord> = {}): DailyTradingRecord {
  return {
    ticker: 'COMI',
    shortName: 'التجاري الدولي',
    tradeDate: '2026-04-01',
    lastPrice: 80,
    changePct: 0,
    tradesCount: 100,
    openPrice: 79,
    closePrice: 80,
    turnoverValue: 1000000,
    netLiquidity: null,
    volume: 12500,
    avgVolume5D: null,
    avgVolume30D: null,
    avgVolume90D: null,
    lowPrice: 78,
    highPrice: 81,
    sector: 'بنوك',
    totalBids: null,
    bidsCount: null,
    offersCount: null,
    totalOffers: null,
    avgVolume: null,
    high52W: null,
    low52W: null,
    prevClose: 79,
    marketCapThousands: null,
    vwap: null,
    peRatio: null,
    listedShares: 1000000,
    isinCode: 'EGS60121C018',
    inflowOrders: null,
    inflowVolume: null,
    inflowLiquidity: null,
    askTrades: null,
    askTradesVolume: null,
    outflowLiquidity: null,
    fullName: 'البنك التجاري الدولي',
    market: 'EGX',
    volChange5DPct: null,
    volChange30DPct: null,
    volChange90DPct: null,
    updatedAt: '2026-04-01T15:00:00.000Z',
    ...overrides,
  };
}

function makeQuarterBase(overrides: Partial<QuarterlyFinancialRecord> = {}): QuarterlyFinancialRecord {
  return {
    ticker: 'ARCC',
    stockName: 'العربية للأسمنت',
    yearQuarter: '2025FY',
    year: 2025,
    quarter: 'FY',
    shares: 378_739_700,
    intangibleAssets: null,
    totalAssets: 5_000_000_000,
    equity: 2_000_000_000,
    totalDebtWithoutTX: 500_000_000,
    totalLiabilities: 3_000_000_000,
    revenueYTD: 4_000_000_000,
    grossProfitYTD: 1_200_000_000,
    ebitYTD: 900_000_000,
    pbtYTD: 800_000_000,
    netIncomeYTD: 600_000_000,
    ocfYTD: 850_000_000,
    netInvestingCfYTD: -100_000_000,
    dividendsPaidYTD: 200_000_000,
    cash: 400_000_000,
    interestExpenseYTD: 80_000_000,
    financeCostsYTD: 80_000_000,
    interestIncomeYTD: 10_000_000,
    taxExpenseYTD: 200_000_000,
    interestPaidYTD: 75_000_000,
    capexYTD: 120_000_000,
    dateInsertData: '2026-03-01',
    financialUnit: 'base',
    financialCurrency: 'EGP',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('Governance & Data Completeness Enhancements', () => {
  it('1) Multi-Schema Daily Column Unification isolates unmapped col_1 by schemaId, aligns shifted mappedField, and preserves manual edits & export metadata', async () => {
    const schemaA: DailyTradingSchemaRecord = {
      schemaId: 'schema_A',
      tradeDate: '2026-04-01',
      totalColumns: 3,
      updatedAt: '2026-04-01T10:00:00.000Z',
      columns: [
        { colId: 'col_1', index: 0, colLetter: 'A', headerName: 'الرمز', normalizedHeader: 'الرمز', mappedField: 'ticker' },
        { colId: 'col_2', index: 1, colLetter: 'B', headerName: 'آخر سعر', normalizedHeader: 'اخر سعر', mappedField: 'lastPrice' },
        { colId: 'col_3', index: 2, colLetter: 'C', headerName: 'ملاحظة أ', normalizedHeader: 'ملاحظة ا', mappedField: null },
      ],
    };
    const schemaB: DailyTradingSchemaRecord = {
      schemaId: 'schema_B',
      tradeDate: '2026-04-02',
      totalColumns: 3,
      updatedAt: '2026-04-02T10:00:00.000Z',
      columns: [
        { colId: 'col_1', index: 0, colLetter: 'A', headerName: 'ملاحظة ب', normalizedHeader: 'ملاحظة ب', mappedField: null },
        { colId: 'col_2', index: 1, colLetter: 'B', headerName: 'الرمز', normalizedHeader: 'الرمز', mappedField: 'ticker' },
        { colId: 'col_3', index: 2, colLetter: 'C', headerName: 'آخر سعر', normalizedHeader: 'اخر سعر', mappedField: 'lastPrice' },
      ],
    };

    const recA = makeDailyBase({
      tradeDate: '2026-04-01',
      schemaId: 'schema_A',
      lastPrice: 0,
      rawCells: {
        col_1: { v: 'COMI', t: 's' },
        col_2: { v: 0, t: 'n' },
        col_3: { v: 'قيمة أ', t: 's' },
      },
      manualCorrections: {
        lastPrice: {
          field: 'lastPrice',
          originalValue: 80,
          correctedValue: 0,
          editedAt: '2026-04-01T12:00:00.000Z',
        },
      },
      originalValues: { lastPrice: 80 },
    });

    const recB = makeDailyBase({
      tradeDate: '2026-04-02',
      schemaId: 'schema_B',
      lastPrice: 85,
      rawCells: {
        col_1: { v: 'قيمة ب', t: 's' },
        col_2: { v: 'COMI', t: 's' },
        col_3: { v: 85, t: 'n' },
      },
    });

    const recMissingSchema = makeDailyBase({
      tradeDate: '2026-04-03',
      schemaId: 'schema_MISSING',
      lastPrice: 88,
      rawCells: { col_99: { v: 'extra', t: 's' } },
    });

    const schemasMap: Record<string, DailyTradingSchemaRecord> = {
      schema_A: schemaA,
      schema_B: schemaB,
    };
    const schemaIndex = indexDailySchemas(schemasMap);
    const unified = resolveUnifiedDailyColumns([recA, recB, recMissingSchema], schemaIndex);

    assert.equal(unified.missingSchemaRecordCount, 1);

    // Mapped fields aligned across Schema A (col_2) and Schema B (col_3)
    const lastPriceCol = unified.columns.find((c) => c.mappedField === 'lastPrice');
    assert.ok(lastPriceCol);
    assert.equal(resolveDailyCellDisplay(recA, lastPriceCol, schemaIndex).kind, 'zero');
    assert.equal(resolveDailyCellDisplay(recB, lastPriceCol, schemaIndex).value, 85);

    // Unmapped col_1 in Schema B does NOT collide with Schema A's col_1 (ticker)
    const schemaBUnmappedCol = unified.columns.find((c) => c.colId === 'col_1' && c.schemaId === 'schema_B');
    assert.ok(schemaBUnmappedCol);
    assert.equal(resolveDailyCellDisplay(recB, schemaBUnmappedCol, schemaIndex).value, 'قيمة ب');
    assert.equal(resolveDailyCellDisplay(recA, schemaBUnmappedCol, schemaIndex).kind, 'blank');

    // Multi-schema Excel workbook preserves Daily_Trading + Export_Metadata without error
    const wb = await buildDailyTradingWorkbook([recA, recB, recMissingSchema], schemasMap);
    assert.ok(wb.SheetNames.includes('Daily_Trading'));
    assert.ok(wb.SheetNames.includes('Export_Metadata'));
    const dailyAoa = XLSX.utils.sheet_to_json(wb.Sheets['Daily_Trading'], { header: 1 }) as unknown[][];
    assert.equal(dailyAoa.length, 4);

    // Quarterly export also includes Export_Metadata
    const qWb = await buildQuarterlyRecordsWorkbook([makeQuarterBase()]);
    assert.ok(qWb.SheetNames.includes('Quarterly_Financials'));
    assert.ok(qWb.SheetNames.includes('Export_Metadata'));

    // Data Hub comprehensive tables & RecordDetailsModal render cleanly with zero [object Object] or summary toggles
    const qHtml = renderToStaticMarkup(
      React.createElement(QuarterlyRecordsTable, {
        selectedTicker: 'ARCC',
        records: [makeQuarterBase({ extendedFields: { customMetric: { nested: 42 } } as any })],
        userRole: 'admin',
        onRequestEdit: () => undefined,
        onRequestDelete: () => undefined,
      })
    );
    assert.doesNotMatch(qHtml, /\[object Object\]/);
    assert.doesNotMatch(qHtml, /summary_11|standard_26/);
    assert.match(qHtml, /customMetric/);

    const dHtml = renderToStaticMarkup(
      React.createElement(DailyTradingTable, {
        selectedTicker: 'COMI',
        records: [recA, recB, recMissingSchema],
        dailySchemas: schemasMap,
        userRole: 'admin',
        onRequestEdit: () => undefined,
        onRequestDelete: () => undefined,
      })
    );
    assert.doesNotMatch(dHtml, /\[object Object\]/);
    assert.doesNotMatch(dHtml, /summary_10|standard_40/);
    assert.match(dHtml, /مخطط أعمدة \(schemaId\) غير متاح محلياً/);

    const detailsHtml = renderToStaticMarkup(
      React.createElement(RecordDetailsModal, {
        isOpen: true,
        title: 'تفاصيل السجل',
        record: recA as Record<string, any>,
        onClose: () => undefined,
      })
    );
    assert.doesNotMatch(detailsHtml, /\[object Object\]/);
    assert.match(detailsHtml, /manualCorrections|التعديلات اليدوية/);
  });

  it('2) Security Identity, Unified Sector Registry & Dry-Run Legacy Migration Tool', () => {
    const sectorDefinitions: SectorDefinition[] = [
      {
        sectorId: 'building_materials',
        nameAr: 'مواد بناء',
        aliases: ['أسمنت', 'التشييد ومواد البناء'],
        classification: 'non_financial',
        multiple: 9.2,
        status: 'active',
      },
      {
        sectorId: 'telecom',
        nameAr: 'اتصالات',
        aliases: ['الاتصالات'],
        classification: 'non_financial',
        multiple: 11.0,
        status: 'active',
      },
    ];

    // 2a) Placeholder 'غير مصنف' in companies does NOT block daily sector 'مواد بناء' / 'أسمنت' resolved via sectorPE
    const arccQuarter = makeQuarterBase({ ticker: 'ARCC.CA', stockName: 'العربية للأسمنت' });
    const legacyCompanyMeta: Company = {
      id: 'arcc',
      ticker: 'ARCC',
      nameAr: 'العربية للأسمنت',
      nameEn: 'Arabian Cement',
      sector: 'غير مصنف',
      marketPrice: null,
      sharesOutstanding: null,
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
      currency: 'EGP',
    };
    const dailyCement = makeDailyBase({
      ticker: 'ARCC.CA',
      shortName: 'العربية للأسمنت',
      sector: 'أسمنت',
      isinCode: 'EGS3C251C013',
      tradeDate: '2026-04-02',
    });
    // Non-equity bond present in quarterly records must be excluded from stock universe
    const bondQuarter = makeQuarterBase({
      ticker: 'EGB0001',
      stockName: 'سندات خزانة 2028',
    });
    // ISIN conflict: same ISIN shared by two tickers
    const conflictQuarter = makeQuarterBase({ ticker: 'OTMT', stockName: 'شركة متعارضة' });
    const conflictDaily = makeDailyBase({
      ticker: 'OTMT',
      isinCode: 'EGS3C251C013',
      sector: 'اتصالات',
      tradeDate: '2026-04-01',
    });

    const diag = deriveStockUniverseDiagnostics(
      [arccQuarter, bondQuarter, conflictQuarter],
      [legacyCompanyMeta],
      [dailyCement, conflictDaily],
      {},
      { sectorDefinitions }
    );

    assert.equal(diag.stocks.length, 2);
    assert.equal(diag.excludedNonEquity.length, 1);
    assert.equal(diag.excludedNonEquity[0].ticker, 'EGB0001');
    assert.equal(diag.excludedNonEquity[0].instrumentType, 'bond');

    const arcc = diag.stocks.find((s) => s.ticker === 'ARCC')!;
    assert.equal(arcc.sectorId, 'building_materials');
    assert.equal(arcc.sector, 'مواد بناء');
    assert.equal(arcc.sectorClassification, 'non_financial');
    assert.equal(arcc.sectorSource, 'daily_trading');

    assert.ok(diag.metadataConflicts.some((c) => c.field === 'isinCode'));

    // Sector P/E lookup resolves exclusively via official sectorPE registry (canonical + aliases)
    const peLookup = resolveSectorPeFromMap(
      { 'مواد بناء': 9.2 },
      'أسمنت',
      'building_materials',
      sectorDefinitions
    );
    assert.equal(peLookup.multiple, 9.2);
    assert.equal(peLookup.matchedKey, 'مواد بناء');
    assert.equal(peLookup.matchedSectorId, 'building_materials');

    // Empty sector and unmapped sector without sectorPE entry must stay unknown
    const uSec = resolveUnifiedSector('', null, { sectorDefinitions });
    assert.equal(uSec.classification, 'unknown');
    assert.equal(uSec.source, 'missing');
    const uUnmapped = resolveUnifiedSector('التشييد ومواد البناء', null);
    assert.equal(uUnmapped.classification, 'unknown');
    assert.equal(uUnmapped.source, 'unmapped');

    // Dry-Run Legacy Migration Tool produces read-only diagnostic report from sectorPE definitions
    const unmappedCompany: Company = {
      ...legacyCompanyMeta,
      id: 'unmp',
      ticker: 'UNMP',
      sector: 'قطاع_غير_قياسي',
    };
    const report = analyzeLegacyMigration({
      companies: [legacyCompanyMeta, unmappedCompany],
      sectorPEMap: { 'مواد بناء': 9.2, قطاع_غير_قياسي: 7.0 },
      sectorDefinitions: [
        ...sectorDefinitions,
        {
          sectorId: 'legacy_key',
          nameAr: 'قطاع قديم',
          aliases: [],
          classification: 'unknown',
          multiple: 7.0,
          status: 'active',
          legacyDocId: 'legacy_key',
          isLegacyFormat: true,
        },
      ],
      quarterlyRecords: [makeQuarterBase({ financialUnit: 'EGP_millions' })],
      dailyRecords: [dailyCement],
      conflicts: diag.metadataConflicts,
    });
    assert.equal(report.dryRunOnly, true);
    assert.equal(report.summaryCounts.companiesPlaceholderSector, 1);
    assert.equal(report.summaryCounts.companiesEnrichableFromDaily, 1);
    assert.equal(report.summaryCounts.sectorPeRichDocsCount, 2);
    assert.equal(report.summaryCounts.sectorPeLegacyFormatCount, 1);
    assert.equal(report.summaryCounts.sectorPeUnmappedKeys, 1);
    assert.equal(report.summaryCounts.legacyMillionUnitRecordsCount, 1);
    assert.equal(report.companyChanges[0].action, 'enrich_sector_from_daily');
    assert.equal(report.companyChanges[0].proposedSectorId, 'building_materials');

    // AdminDashboard renders sector governance & dry-run section cleanly
    const adminHtml = renderToStaticMarkup(
      React.createElement(AdminDashboard, {
        macroParams: [],
        onSaveMacroParams: async () => undefined,
        sectorPEMap: { 'التشييد ومواد البناء': 9.2 },
        onSaveSectorPE: async () => undefined,
        stocks: diag.stocks,
        companiesMeta: [legacyCompanyMeta],
        quarterlyRecords: [arccQuarter],
        dailyRecords: [dailyCement],
        universeDiagnostics: diag,
        users: [],
        onSaveUsers: () => undefined,
        currentUser: {
          id: 'u1',
          email: 'admin@test.local',
          displayName: 'مدير',
          role: 'admin',
          tier: 'institutional',
          isActive: true,
          createdAt: '',
          lastLoginAt: '',
        },
        onSwitchUser: () => undefined,
      })
    );
    assert.match(adminHtml, /Admin Management Console/);
  });

  it('3) Dividend & Retention Governance: proposed excluded, blank ApprovalStatus confirmation, tombstones, valuationDate, and FY net income denominator', async () => {
    // 3a) Blank ApprovalStatus triggers confirmation requirement in parser & preview
    const dpsFile = makeWorkbookFile([
      ['Ticker', 'FiscalYear', 'CashDPS', 'AsOfDate', 'RecordType', 'ApprovalStatus', 'Semantics', 'DistributionId'],
      ['COMI', 2025, 2.0, '2026-03-15', 'regular', '', 'annual_total', 'D_BLANK_APP'],
    ]);
    const parsed = await parseDpsActualExcelFile(dpsFile, {
      defaultSemantics: 'annual_total',
      defaultApprovalStatus: 'proposed',
    });
    assert.equal(parsed.requiresApprovalConfirmation, true);
    assert.equal(parsed.rowsMissingApprovalCount, 1);
    assert.equal(parsed.records[0].approvalStatus, 'proposed');

    const preview = buildImportPreview({
      sourceType: 'dividend',
      fileName: 'DPS_Actual.xlsx',
      sheetName: 'DPS_Actual',
      totalRows: 1,
      parsedRecords: parsed.records,
      rejected: parsed.rejected,
      warnings: parsed.warnings,
      existingDocsMap: new Map(),
      requiresApprovalConfirmation: parsed.requiresApprovalConfirmation,
      rowsMissingApprovalCount: parsed.rowsMissingApprovalCount,
    });
    assert.equal(preview.requiresApprovalConfirmation, true);
    assert.equal(preview.rowsMissingApprovalCount, 1);

    // 3b) Proposed records excluded from regularDps/DDM/payout; valuationDate separated from latestTradeDate; interim vs FY
    const proposedRec: DividendRecord = {
      ticker: 'COMI',
      fiscalYear: 2025,
      cashDps: 3.0,
      asOfDate: '2026-03-01',
      distributionId: 'PROP_2025',
      recordType: 'regular',
      approvalStatus: 'proposed',
      distributionSemantics: 'annual_total',
      totalDistributionAmount: 300_000_000,
      currency: 'EGP',
    };
    const interimOnlyQuarter = {
      year: 2025,
      quarter: 'Q3' as const,
      sharesCount: 100_000_000,
      netProfitYTD: 400_000_000,
      financialCurrency: 'EGP' as const,
    };

    const proposedSummary = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [proposedRec],
      quarterlyRecords: [interimOnlyQuarter],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      valuationDate: '2026-04-01',
    });
    assert.equal(proposedSummary.regularDps, null);
    assert.equal(proposedSummary.excludedProposedCount, 1);
    assert.equal(proposedSummary.legacyFallbackUsed, false);

    // Approved dividend with interim-only financial year cannot fabricate payout from Q3 YTD
    const approvedRec: DividendRecord = { ...proposedRec, approvalStatus: 'approved', distributionId: 'APP_2025' };
    const interimSummary = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: [approvedRec],
      quarterlyRecords: [interimOnlyQuarter],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      valuationDate: '2026-04-01',
    });
    assert.equal(interimSummary.regularDps, 3.0);
    assert.equal(interimSummary.totalAttributableDividends, 300_000_000);
    assert.equal(interimSummary.historicalPayoutRatio, null);
    assert.deepEqual(interimSummary.interimFiscalYears, [2025]);
    assert.match(interimSummary.payoutUnavailableReasonAr ?? '', /FY 2025/);

    // 3c) Tombstone removes deleted dividend record in session manager and never falls back to legacy quarterly.dpsCurrent
    const mgr = new FirestoreSessionManager();
    const token = mgr.beginSession('u1');
    mgr.applyManualSyncResult(token, {
      quarterly: [],
      companies: [],
      daily: [],
      stories: {},
      decisions: {},
      trades: [],
      macro: [],
      sectorPE: {},
      dividendRecords: [approvedRec],
      tombstones: [],
      isIncrementalDelta: false,
    });
    assert.equal(mgr.getState().dividendRecords.length, 1);

    mgr.applyManualSyncResult(token, {
      quarterly: [],
      companies: [],
      daily: [],
      stories: {},
      decisions: {},
      trades: [],
      macro: [],
      sectorPE: {},
      dividendRecords: [],
      tombstones: [
        {
          id: 'dividend_records__COMI_2025_regular_APP_2025',
          collection: 'dividend_records',
          docId: 'COMI_2025_regular_APP_2025',
          ticker: 'COMI',
          deletedAt: '2026-04-05T00:00:00.000Z',
          expiresAtMs: Date.now() + 60_000,
        },
      ],
      isIncrementalDelta: true,
    });
    assert.equal(mgr.getState().dividendRecords.length, 0);

    const noLegacyRes = resolveDividendAnalyticsForStock({
      ticker: 'COMI',
      dividendRecords: mgr.getState().dividendRecords,
      quarterlyRecords: [{ ...interimOnlyQuarter, quarter: 'FY', dpsCurrent: 1.5 } as any],
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      valuationDate: '2026-04-06',
    });
    assert.equal(noLegacyRes.source, 'missing');
    assert.equal(noLegacyRes.regularDps, null);
    assert.equal(noLegacyRes.legacyFallbackUsed, false);

    // 3d) Valuation engine separates valuationDate vs priceSessionDate and renders in ValuationSourcesCard & DashboardView
    const comiEmptySector: Company = {
      id: 'comi',
      ticker: 'COMI',
      nameAr: 'التجاري الدولي',
      nameEn: 'CIB',
      sector: '',
      sectorClassification: 'financial',
      marketPrice: 80,
      marketPriceSource: 'lastPrice',
      latestTradeDate: '2026-04-01',
      sharesOutstanding: 100_000_000,
      beta: 1.0,
      riskFreeRate: null,
      equityRiskPremium: null,
      costOfDebt: null,
      taxRate: null,
      targetDebtRatio: null,
      sustainableGrowthRate: null,
      shortTermGrowthRate: null,
      targetPE: null,
      targetPB: null,
      currency: 'EGP',
    };
    const comiQuarters = [
      {
        ticker: 'COMI',
        year: 2025,
        quarter: 'Q3' as const,
        period: 'Q3 2025',
        revenue: 3_000_000_000,
        grossProfit: 1_200_000_000,
        ebit: 800_000_000,
        netIncome: 400_000_000,
        operatingCashFlow: 500_000_000,
        capex: 80_000_000,
        totalAssets: 5_000_000_000,
        totalDebt: 200_000_000,
        totalEquity: 2_000_000_000,
        cash: 300_000_000,
        sharesCount: 100_000_000,
        financialCurrency: 'EGP' as const,
        dateInsertData: '2025-11-15',
      },
      {
        ticker: 'COMI',
        year: 2024,
        quarter: 'FY' as const,
        period: 'FY 2024',
        revenue: 3_500_000_000,
        grossProfit: 1_400_000_000,
        ebit: 900_000_000,
        netIncome: 600_000_000,
        operatingCashFlow: 700_000_000,
        capex: 100_000_000,
        totalAssets: 4_800_000_000,
        totalDebt: 200_000_000,
        totalEquity: 1_800_000_000,
        cash: 250_000_000,
        sharesCount: 100_000_000,
        financialCurrency: 'EGP' as const,
        dateInsertData: '2025-03-01',
      },
      {
        ticker: 'COMI',
        year: 2024,
        quarter: 'Q3' as const,
        period: 'Q3 2024',
        revenue: 2_500_000_000,
        grossProfit: 1_000_000_000,
        ebit: 650_000_000,
        netIncome: 400_000_000,
        operatingCashFlow: 450_000_000,
        capex: 70_000_000,
        totalAssets: 4_500_000_000,
        totalDebt: 200_000_000,
        totalEquity: 1_700_000_000,
        cash: 220_000_000,
        sharesCount: 100_000_000,
        financialCurrency: 'EGP' as const,
        dateInsertData: '2024-11-15',
      },
    ];
    const metrics = calculateTTMMetrics(comiEmptySector, comiQuarters, {
      dividendRecords: [approvedRec],
      cutoffDate: '2026-04-15',
    });
    const valuation = runValuationModels(
      comiEmptySector,
      metrics,
      undefined,
      {
        TaxRate: 0.225,
        Rf_Egypt_10Y: 0.2,
        ERP_Developed: 0.05,
        CRP_Egypt: 0.05,
        Country_Risk_Lambda: 1,
        r_Mode: 1,
        WACC_Mode: 1,
        Beta_Raw_Weight: 1,
        Beta_Anchor: 1,
        Terminal_Growth: 0.05,
        DDM_Growth: 0.05,
        RIM_Retention: 0.6,
        Weight_DCF: 0,
        Weight_DDM: 50,
        Weight_RIM: 50,
      },
      {
        quarterlyRecords: [makeQuarterBase({ ticker: 'COMI', year: 2025, quarter: 'Q3', yearQuarter: '2025Q3' })],
        betaRecord: { ticker: 'COMI', beta: 1.0, asOfDate: '2026-03-01', source: 'EGX' },
        betaConfirmed: true,
        rimRetentionPolicy: 'minimum',
        valuationDate: '2026-04-15',
      }
    );
    assert.equal(valuation.rimFairValue, null); // 'minimum' requires historicalRetentionRatio (unavailable for interim-only FY 2025)
    assert.equal(valuation.sourcesSummary?.valuationDate, '2026-04-15');
    assert.equal(valuation.sourcesSummary?.priceSessionDate, '2026-04-01');

    const cardHtml = renderToStaticMarkup(
      React.createElement(ValuationSourcesCard, { summary: valuation.sourcesSummary })
    );
    assert.match(cardHtml, /2026-04-15/);
    assert.match(cardHtml, /2026-04-01/);
    assert.match(cardHtml, /غير محدد/);

    // DashboardView fallback sector label renders cleanly
    const dashHtml = renderToStaticMarkup(
      React.createElement(DashboardView, {
        company: comiEmptySector,
        metrics: {
          ...metrics,
          wacc: valuation.engineOutputs?.wacc ?? null,
          costOfEquity: valuation.engineOutputs?.costOfEquity ?? null,
        },
        valuation,
        warnings: [],
        onNavigateToTab: () => undefined,
      })
    );
    assert.match(dashHtml, /غير محدد/);
  });
});
