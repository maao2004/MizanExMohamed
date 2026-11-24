import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRecordBusinessHash,
  isValidCalendarDate,
  parseStrictPercentage,
} from '../src/core/contracts';
import { computeComprehensiveValuation } from '../src/core/math/valuation';
import { resolveBetaAssumption } from '../src/core/domain/valuationAssumptions';
import { FirestoreSessionManager } from '../src/core/domain/firestoreSessionManager';
import {
  buildImportPreview,
  executeChunkedImportBatches,
  getSafeChunkSize,
} from '../src/core/imports';

const BASE_ENGINE_MACROS: Record<string, number> = {
  TaxRate: 0.225,
  Rf_Egypt_10Y: 0.251,
  ERP_Developed: 0.0421,
  CRP_Egypt: 0.076,
  Beta_Default: 1.0,
  Terminal_Growth: 0.05,
  Exit_Multiple: 6,
  Forecast_Years: 5,
  Cost_of_Debt: 0.15,
  Growth_Y1: 0.2,
  Growth_Y2: 0.18,
  Growth_Y3: 0.15,
  Growth_Y4: 0.12,
  Growth_Y5: 0.1,
  WACC_Mode: 1,
  DDM_Growth: 0.08,
  r_Mode: 1,
  Weight_DCF: 0.5,
  Weight_DDM: 0.2,
  Weight_Relative: 0.1,
  Weight_Graham: 0.1,
  Weight_RIM: 0.1,
  Beta_Raw_Weight: 1,
  Beta_Anchor: 1,
  Country_Risk_Lambda: 1,
  RIM_Retention: 0.6,
  Relative_PE_Weight: 0.5,
  Relative_PB_Weight: 0.5,
};

describe('Mizan Stage 2-3 Governance, Valuation & Import Engine Tests', () => {
  it('1) Strict Beta Policy: actual vs confirmed missing (=1) vs connection error (unavailable_error)', () => {
    const actualZero = resolveBetaAssumption({
      ticker: 'COMI.CA',
      betaRecord: {
        ticker: 'COMI',
        beta: 0,
        asOfDate: '2026-01-01',
        source: 'EGX 5Y',
      },
      betaConfirmed: true,
    });
    assert.equal(actualZero.status, 'actual');
    assert.equal(actualZero.betaRaw, 0);

    const confirmedAbsent = resolveBetaAssumption({
      ticker: 'ABUK',
      betaRecord: null,
      betaConfirmed: true,
      globalBetaDefault: 1,
    });
    assert.equal(confirmedAbsent.status, 'defaulted_missing');
    assert.equal(confirmedAbsent.betaRaw, 1);

    const unconfirmedOrError = resolveBetaAssumption({
      ticker: 'ABUK',
      betaRecord: null,
      betaConfirmed: false,
      betaError: 'تعذر قراءة beta_assumptions',
      globalBetaDefault: 1,
    });
    assert.equal(unconfirmedOrError.status, 'unavailable_error');
    assert.equal(unconfirmedOrError.betaRaw, null);

    // Valuation engine must block Ke/WACC/DCF/DDM/RIM on betaStatus='unavailable_error'
    const blocked = computeComprehensiveValuation(
      {
        ticker: 'ABUK',
        marketPrice: 50,
        sharesOutstanding: 100,
        betaRaw: 1, // Even if stale number passed, betaStatus=unavailable_error must override
        betaStatus: 'unavailable_error',
        netIncomeTTM: 500,
        ocfTTM: 600,
        capexTTM: 100,
        fcfTTM: 500,
        fcffTTM: 450,
        ebitdaTTM: 700,
        totalEquity: 2000,
        totalDebt: 200,
        cash: 300,
        dpsRegular: 2,
        sector: 'الأسمدة',
        sectorClassification: 'non_financial',
        companyTargetPE: 8,
        companyTargetPB: 2,
      },
      BASE_ENGINE_MACROS
    );
    assert.equal(blocked.betaRaw, null);
    assert.equal(blocked.betaAdjusted, null);
    assert.equal(blocked.costOfEquity, null);
    assert.equal(blocked.wacc, null);
    assert.equal(blocked.dcfValue, null);
    assert.equal(blocked.ddmValue, null);
    assert.equal(blocked.rimValue, null);
  });

  it('2) Dynamic Forecast_Years (3 & 7) and strict incomplete growth rejection', () => {
    const baseInput = {
      ticker: 'TMGH',
      marketPrice: 50,
      sharesOutstanding: 100,
      betaRaw: 1.1,
      betaStatus: 'actual' as const,
      netIncomeTTM: 600,
      ocfTTM: 700,
      capexTTM: 100,
      fcfTTM: 600,
      fcffTTM: 500,
      ebitdaTTM: 900,
      totalEquity: 3000,
      totalDebt: 400,
      cash: 200,
      dpsRegular: 1,
      sector: 'العقارات',
      sectorClassification: 'non_financial' as const,
    };

    const threeYear = computeComprehensiveValuation(baseInput, {
      ...BASE_ENGINE_MACROS,
      Forecast_Years: 3,
    });
    assert.ok(threeYear.dcfDetails);
    assert.equal(threeYear.dcfDetails.forecastYears, 3);
    assert.equal(threeYear.dcfDetails.years.length, 3);
    assert.ok(threeYear.dcfValue !== null);

    const sevenYear = computeComprehensiveValuation(baseInput, {
      ...BASE_ENGINE_MACROS,
      Forecast_Years: 7,
      Growth_Y6: 0.08,
      Growth_Y7: 0.06,
    });
    assert.ok(sevenYear.dcfDetails);
    assert.equal(sevenYear.dcfDetails.forecastYears, 7);
    assert.equal(sevenYear.dcfDetails.years.length, 7);
    assert.ok(sevenYear.dcfValue !== null);

    // Incomplete Growth_Y7 when Forecast_Years=7 -> DCF excluded cleanly
    const incompleteSeven = computeComprehensiveValuation(baseInput, {
      ...BASE_ENGINE_MACROS,
      Forecast_Years: 7,
      Growth_Y6: 0.08,
    });
    assert.equal(incompleteSeven.dcfValue, null);
    assert.equal(
      incompleteSeven.modelStatuses.find((m) => m.model === 'dcf')?.status,
      'excluded'
    );
  });

  it('3) Explicit TerminalValueMethod: exit_multiple decouples from FCFF Growth_Y* and never falls back to Terminal_Growth', () => {
    const input = {
      ticker: 'SWDY',
      marketPrice: 40,
      sharesOutstanding: 100,
      betaRaw: 1.0,
      betaStatus: 'actual' as const,
      terminalValueMethod: 'exit_multiple' as const,
      netIncomeTTM: 500,
      ocfTTM: 600,
      capexTTM: 100,
      fcfTTM: 500,
      fcffTTM: 400,
      ebitdaTTM: 800,
      totalEquity: 2500,
      totalDebt: 300,
      cash: 200,
      dpsRegular: 1,
      sector: 'الصناعة',
      sectorClassification: 'non_financial' as const,
    };

    // Without Projected_Terminal_EBITDA or EBITDA_Growth_*, exit_multiple must NOT reuse FCFF Growth_Y*
    const missingEbitdaProjection = computeComprehensiveValuation(input, {
      ...BASE_ENGINE_MACROS,
      Forecast_Years: 2,
      Growth_Y1: 0.1,
      Growth_Y2: 0.1,
      Exit_Multiple: 7,
    });
    assert.equal(missingEbitdaProjection.dcfValue, null);
    assert.equal(
      missingEbitdaProjection.modelStatuses.find((m) => m.model === 'dcf')?.status,
      'excluded'
    );

    // Explicit EBITDA_Growth_Rate (independent of FCFF Growth_Y1/Y2) computes TV = 800 * (1.06^2) * 7
    const exitRun = computeComprehensiveValuation(input, {
      ...BASE_ENGINE_MACROS,
      Forecast_Years: 2,
      Growth_Y1: 0.25,
      Growth_Y2: 0.20,
      EBITDA_Growth_Rate: 0.06,
      Exit_Multiple: 7,
    });
    assert.ok(exitRun.dcfDetails);
    assert.equal(exitRun.dcfDetails.terminalValueMethod, 'exit_multiple');
    assert.ok(Math.abs(exitRun.dcfDetails.terminalValue - 800 * 1.06 * 1.06 * 7) < 1e-6);
    assert.ok(exitRun.dcfValue !== null);

    // Missing Exit_Multiple in exit_multiple mode -> MUST exclude DCF instead of falling back to Terminal_Growth
    const macrosNoExit = { ...BASE_ENGINE_MACROS, EBITDA_Growth_Rate: 0.06 };
    delete (macrosNoExit as Record<string, number>).Exit_Multiple;
    const missingExit = computeComprehensiveValuation(input, macrosNoExit);
    assert.equal(missingExit.dcfValue, null);
    assert.equal(
      missingExit.modelStatuses.find((m) => m.model === 'dcf')?.status,
      'excluded'
    );
  });

  it('4) Strict percentage parsing, calendar validation & deterministic content hashing', () => {
    assert.equal(parseStrictPercentage('22.5%', { rejectAmbiguousNumeric: true }).value, 0.225);
    assert.equal(parseStrictPercentage('٢٢.٥٪', { rejectAmbiguousNumeric: true }).value, 0.225);
    assert.equal(parseStrictPercentage(0.225, { rejectAmbiguousNumeric: true }).value, 0.225);
    assert.throws(
      () => parseStrictPercentage(22.5, { rejectAmbiguousNumeric: true }),
      /ملتبسة/
    );

    assert.equal(isValidCalendarDate('2026-02-28'), true);
    assert.equal(isValidCalendarDate('2026-02-30'), false);
    assert.equal(isValidCalendarDate('2026-13-01'), false);

    const h1 = computeRecordBusinessHash('beta', {
      ticker: 'COMI',
      beta: 1.05,
      asOfDate: '2026-01-01',
      source: 'EGX',
    });
    const h2 = computeRecordBusinessHash('beta', {
      source: 'EGX',
      asOfDate: '2026-01-01',
      beta: 1.05,
      ticker: 'COMI',
    });
    assert.equal(h1, h2);
    assert.match(h1, /^mzh1_/);
  });

  it('5) Import preview diffing + chunked batch runner with partial-failure resume', async () => {
    assert.equal(getSafeChunkSize('quarterly'), 180);
    assert.equal(getSafeChunkSize('parameters'), 240);
    assert.equal(getSafeChunkSize('daily'), 350);
    assert.equal(getSafeChunkSize('beta'), 350);

    const unchangedHash = computeRecordBusinessHash('beta', {
      ticker: 'COMI',
      beta: 1.1,
      asOfDate: '2026-01-01',
      source: 'EGX',
    });
    const oldFawryHash = computeRecordBusinessHash('beta', {
      ticker: 'FWRY',
      beta: 1.2,
      asOfDate: '2026-01-01',
      source: 'EGX',
    });

    const existingDocsMap = new Map<string, Record<string, any>>([
      [
        'COMI',
        {
          ticker: 'COMI',
          beta: 1.1,
          asOfDate: '2026-01-01',
          source: 'EGX',
          contentHash: unchangedHash,
        },
      ],
      [
        'FWRY',
        {
          ticker: 'FWRY',
          beta: 1.2,
          asOfDate: '2026-01-01',
          source: 'EGX',
          contentHash: oldFawryHash,
        },
      ],
    ]);

    // 352 records: 1 unchanged, 1 update, 350 inserts -> total 351 writes => 2 batches (350 + 1)
    const parsedRecords = [
      { ticker: 'COMI', beta: 1.1, asOfDate: '2026-01-01', source: 'EGX', sourceRow: 2 },
      { ticker: 'FWRY', beta: 1.35, asOfDate: '2026-02-01', source: 'EGX', sourceRow: 3 },
      ...Array.from({ length: 350 }, (_, idx) => ({
        ticker: `STK${idx}`,
        beta: 0.9,
        asOfDate: '2026-02-01',
        source: 'EGX',
        sourceRow: idx + 4,
      })),
    ];

    const preview = buildImportPreview({
      sourceType: 'beta',
      fileName: 'Beta_Assumptions.xlsx',
      sheetName: 'Beta_Assumptions',
      totalRows: 352,
      parsedRecords,
      rejected: [],
      warnings: [],
      existingDocsMap,
    });

    assert.equal(preview.unchanged.length, 1);
    assert.equal(preview.updates.length, 1);
    assert.deepEqual(preview.updates[0].changedFields?.sort(), ['asOfDate', 'beta']);
    assert.equal(preview.inserts.length, 350);

    // Fail on chunk index 1, then resume cleanly without re-sending chunk 0
    const sentChunkIndices: number[] = [];
    const firstAttempt = await executeChunkedImportBatches({
      preview,
      sendChunk: async (items, idx) => {
        sentChunkIndices.push(idx);
        if (idx === 1) throw new Error('Simulated timeout on batch 2');
        return {
          insertedCount: items.length - 1,
          updatedCount: 1,
          skippedUnchangedCount: 0,
        };
      },
    });

    assert.equal(firstAttempt.failedBatchIndex, 1);
    assert.equal(firstAttempt.completedBatches, 1);
    assert.equal(firstAttempt.remainingItemsCount, 1);

    const resumed = await executeChunkedImportBatches({
      preview,
      startChunkIndex: firstAttempt.failedBatchIndex!,
      priorReport: firstAttempt,
      sendChunk: async (items, idx) => {
        sentChunkIndices.push(idx);
        return {
          insertedCount: items.length,
          updatedCount: 0,
          skippedUnchangedCount: 0,
        };
      },
    });

    assert.deepEqual(sentChunkIndices, [0, 1, 1]);
    assert.equal(resumed.failedBatchIndex, null);
    assert.equal(resumed.completedBatches, 2);
    assert.equal(resumed.insertedCount, 350);
    assert.equal(resumed.updatedCount, 1);
    assert.equal(resumed.skippedUnchangedCount, 1);
  });

  it('6) FirestoreSessionManager isolates beta errors and applies incremental delta + tombstones', () => {
    const mgr = new FirestoreSessionManager();
    const token = mgr.beginSession('user_1');

    // Error on beta_assumptions sets betaError=true and keeps betaConfirmed=false
    const errRes = mgr.applyConnectionError(
      token,
      'beta_assumptions',
      { code: 'permission-denied', message: 'Missing permission' },
      false,
      true
    );
    assert.equal(errRes.accepted, true);
    assert.equal(errRes.state.betaError, true);
    assert.equal(errRes.state.betaConfirmed, false);

    // Confirmed server snapshot updates quarterly and beta cleanly
    mgr.applyQuarterlySnapshot(
      token,
      [
        {
          ticker: 'COMI',
          year: 2025,
          quarter: 'FY',
          shares: 100,
          revenueYTD: 1000,
          grossProfitYTD: 500,
          ebitYTD: 300,
          pbtYTD: 250,
          netIncomeYTD: 200,
          ocfYTD: 220,
          netInvestingCfYTD: -40,
          dividendsPaidYTD: 50,
          cash: 300,
          equity: 1500,
          totalDebtWithoutTX: 100,
          totalAssets: 2500,
          totalLiabilities: 1000,
          intangibleAssets: 0,
          financeCostsYTD: 10,
          interestExpenseYTD: 10,
          interestIncomeYTD: 20,
          taxExpenseYTD: 50,
          interestPaidYTD: 10,
          capexYTD: 30,
          dateInsertData: '2026-01-01',
        },
      ],
      { fromCache: false, hasPendingWrites: false },
      true
    );

    mgr.applyBetaSnapshot(
      token,
      [
        { ticker: 'COMI', beta: 1.05, asOfDate: '2026-01-01', source: 'EGX' },
        { ticker: 'ETEL', beta: 0.85, asOfDate: '2026-01-01', source: 'EGX' },
      ],
      { fromCache: false, hasPendingWrites: false }
    );

    // Incremental delta updates COMI beta & tombstones ETEL
    const deltaRes = mgr.applyManualSyncResult(token, {
      isIncrementalDelta: true,
      quarterly: [],
      companies: [],
      daily: [],
      stories: {},
      decisions: {},
      trades: [],
      macro: [],
      betaAssumptions: [{ ticker: 'COMI', beta: 1.12, asOfDate: '2026-02-01', source: 'EGX Updated' }],
      companyOverrides: [],
      tombstones: [
        {
          id: 'beta_assumptions__ETEL',
          collection: 'beta_assumptions',
          docId: 'ETEL',
          deletedAt: '2026-02-01T00:00:00Z',
        },
      ],
    });

    assert.equal(deltaRes.accepted, true);
    assert.equal(deltaRes.state.betaAssumptions.length, 1);
    assert.equal(deltaRes.state.betaAssumptions[0].ticker, 'COMI');
    assert.equal(deltaRes.state.betaAssumptions[0].beta, 1.12);
  });
});
