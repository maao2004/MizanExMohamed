/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo } from 'react';
import {
  AssumptionPriority,
  BetaAssumptionRecord,
  CompanyParameterOverride,
  DailyTradingRecord,
  DecisionItem,
  InvestmentStory,
  MacroParameter,
  RimRetentionPolicy,
  TerminalValueMethod,
} from '../types';
import { SyncCollectionState } from '../core/domain/firestoreSessionManager';
import {
  deriveFinancialsFromQuarterlyRecords,
  deriveStockUniverseDiagnostics,
  resolveSelectedTicker,
  tryNormalizedTicker,
} from '../core/domain/stockDerived';
import { runStockHealthChecks } from '../core/math/healthChecks';
import { runDataQualityAudit } from '../utils/auditEngine';
import { calculateTTMMetrics, runValuationModels } from '../utils/financialCalculations';

interface UseStockValuationParams {
  syncState: SyncCollectionState;
  selectedTicker: string | null;
  onChangeSelectedTicker: (ticker: string | null) => void;
  assumptionPriority: AssumptionPriority;
  terminalValueMethod: TerminalValueMethod;
  rimRetentionPolicy?: RimRetentionPolicy;
  valuationDate?: string | null;
}

export function useStockValuation({
  syncState,
  selectedTicker,
  onChangeSelectedTicker,
  assumptionPriority,
  terminalValueMethod,
  rimRetentionPolicy,
  valuationDate = null,
}: UseStockValuationParams) {
  const {
    companiesMeta,
    stories,
    decisions,
    macroParams,
    sectorDefinitions,
    sectorPEMap,
    dailyRecords,
    quarterlyRecords,
    betaAssumptions,
    dividendRecords,
    dividendYearStatuses,
    companyOverrides,
    companyOverridesConfirmed,
    macroParamsConfirmed,
    betaConfirmed,
    betaError,
    sectorPeConfirmed,
    sectorPeStatus,
    sectorPeError,
  } = syncState;

  const activeValuationDate =
    valuationDate && /^\d{4}-\d{2}-\d{2}$/.test(valuationDate) ? valuationDate : null;

  const latestDailyMap = useMemo(() => {
    const map: Record<string, DailyTradingRecord> = {};
    for (const r of dailyRecords) {
      if (activeValuationDate && r.tradeDate && r.tradeDate > activeValuationDate) continue;
      const tk = tryNormalizedTicker(r.ticker);
      if (!tk) continue;
      const existing = map[tk];
      if (!existing || r.tradeDate > existing.tradeDate) {
        map[tk] = { ...r, ticker: tk };
      }
    }
    return map;
  }, [dailyRecords, activeValuationDate]);

  const betaAssumptionsMap = useMemo(() => {
    const map: Record<string, BetaAssumptionRecord> = {};
    for (const rec of betaAssumptions) {
      const tk = tryNormalizedTicker(rec.ticker);
      if (tk && rec.isDeleted !== true) {
        map[tk] = { ...rec, ticker: tk };
      }
    }
    return map;
  }, [betaAssumptions]);

  const universeDiagnostics = useMemo(
    () =>
      deriveStockUniverseDiagnostics(quarterlyRecords, companiesMeta, dailyRecords, betaAssumptionsMap, {
        valuationDate: activeValuationDate,
        sectorDefinitions,
        sectorPeConfirmed,
        sectorPeStatus,
      }),
    [
      quarterlyRecords,
      companiesMeta,
      dailyRecords,
      betaAssumptionsMap,
      activeValuationDate,
      sectorDefinitions,
      sectorPeConfirmed,
      sectorPeStatus,
    ]
  );

  const stocks = universeDiagnostics.stocks;

  const financials = useMemo(
    () => deriveFinancialsFromQuarterlyRecords(quarterlyRecords),
    [quarterlyRecords]
  );

  useEffect(() => {
    const resolved = resolveSelectedTicker(stocks, selectedTicker);
    if (resolved !== selectedTicker) {
      onChangeSelectedTicker(resolved);
    }
  }, [stocks, selectedTicker, onChangeSelectedTicker]);

  const selectedCompany = useMemo(
    () => (selectedTicker ? stocks.find((s) => s.ticker === selectedTicker) || null : null),
    [stocks, selectedTicker]
  );

  const paramsMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of macroParams) {
      map[p.key] = p.value;
    }
    return map;
  }, [macroParams]);

  const macroMetaMap = useMemo(() => {
    const map: Record<
      string,
      Pick<MacroParameter, 'asOfDate' | 'source' | 'enabledInEngine' | 'rfMethodology'>
    > = {};
    for (const p of macroParams) {
      map[p.key] = {
        asOfDate: p.asOfDate,
        source: p.source,
        enabledInEngine: p.enabledInEngine,
        rfMethodology: p.rfMethodology,
      };
    }
    return map;
  }, [macroParams]);

  const selectedBaseTicker = selectedCompany ? tryNormalizedTicker(selectedCompany.ticker) : null;
  const selectedLatestDaily = selectedBaseTicker ? latestDailyMap[selectedBaseTicker] : undefined;
  const selectedStockQuarterly = useMemo(
    () =>
      selectedBaseTicker
        ? quarterlyRecords.filter((q) => tryNormalizedTicker(q.ticker) === selectedBaseTicker)
        : [],
    [quarterlyRecords, selectedBaseTicker]
  );

  const companyOverridesMap = useMemo(() => {
    const map: Record<string, CompanyParameterOverride> = {};
    if (!selectedBaseTicker) return map;
    for (const ov of companyOverrides) {
      if ((tryNormalizedTicker(ov.ticker) ?? ov.ticker) === selectedBaseTicker && ov.isDeleted !== true) {
        map[ov.key] = ov;
      }
    }
    return map;
  }, [companyOverrides, selectedBaseTicker]);

  const selectedStockDividends = useMemo(
    () =>
      selectedBaseTicker
        ? dividendRecords.filter(
            (d) => (tryNormalizedTicker(d.ticker) ?? d.ticker) === selectedBaseTicker && d.isDeleted !== true
          )
        : [],
    [dividendRecords, selectedBaseTicker]
  );

  const selectedStockDividendYearStatuses = useMemo(
    () =>
      selectedBaseTicker
        ? dividendYearStatuses.filter(
            (s) => (tryNormalizedTicker(s.ticker) ?? s.ticker) === selectedBaseTicker && s.isDeleted !== true
          )
        : [],
    [dividendYearStatuses, selectedBaseTicker]
  );

  const metricsTTM = useMemo(
    () =>
      selectedCompany
        ? calculateTTMMetrics(selectedCompany, financials, {
            dividendRecords: selectedStockDividends,
            dividendYearStatuses: selectedStockDividendYearStatuses,
            latestDaily: selectedLatestDaily,
            valuationDate: activeValuationDate,
            cutoffDate: activeValuationDate ?? selectedLatestDaily?.tradeDate ?? selectedCompany.latestTradeDate ?? null,
          })
        : null,
    [
      selectedCompany,
      financials,
      selectedStockDividends,
      selectedStockDividendYearStatuses,
      activeValuationDate,
      selectedLatestDaily?.tradeDate,
    ]
  );

  const selectedBetaRecord = selectedBaseTicker ? (betaAssumptionsMap[selectedBaseTicker] ?? null) : null;
  const effectiveRimRetentionPolicy =
    rimRetentionPolicy ?? selectedCompany?.rimRetentionPolicy ?? 'rim_parameter';

  const valuation = useMemo(
    () =>
      selectedCompany && metricsTTM
        ? runValuationModels(selectedCompany, metricsTTM, undefined, paramsMap, {
            priority: assumptionPriority,
            sectorDefinitions,
            sectorPEMap,
            sectorPeConfirmed,
            sectorPeStatus,
            sectorPeError,
            quarterlyRecords: selectedStockQuarterly,
            latestDaily: selectedLatestDaily,
            betaRecord: selectedBetaRecord,
            betaConfirmed,
            betaError: betaError ? 'تعذر تأكيد مجموعة beta_assumptions من Firestore' : null,
            companyOverridesMap,
            companyOverridesConfirmed,
            macroParamsConfirmed,
            macroMetaMap,
            terminalValueMethod,
            rimRetentionPolicy: effectiveRimRetentionPolicy,
            valuationDate: activeValuationDate,
            disableLegacyCompanyFallback: true,
          })
        : null,
    [
      selectedCompany,
      metricsTTM,
      sectorDefinitions,
      sectorPEMap,
      sectorPeConfirmed,
      sectorPeStatus,
      sectorPeError,
      paramsMap,
      assumptionPriority,
      selectedStockQuarterly,
      selectedLatestDaily,
      selectedBetaRecord,
      betaConfirmed,
      betaError,
      companyOverridesMap,
      companyOverridesConfirmed,
      macroParamsConfirmed,
      macroMetaMap,
      terminalValueMethod,
      effectiveRimRetentionPolicy,
      activeValuationDate,
    ]
  );

  const engineOutputs = valuation?.engineOutputs ?? null;

  const auditWarnings = useMemo(
    () => (selectedCompany ? runDataQualityAudit(selectedCompany, financials) : []),
    [selectedCompany, financials]
  );

  const healthChecks = useMemo(() => {
    if (!selectedCompany || !engineOutputs || !selectedBaseTicker) return [];
    return runStockHealthChecks({
      ticker: selectedCompany.ticker,
      dailyRecord: selectedLatestDaily,
      quarterlyRecords: selectedStockQuarterly,
      engineOutputs,
      terminalGrowth: valuation?.resolvedAssumptions?.terminalGrowth?.value ?? null,
      terminalValueMethod,
    });
  }, [
    selectedCompany,
    selectedBaseTicker,
    selectedLatestDaily,
    selectedStockQuarterly,
    engineOutputs,
    valuation,
    terminalValueMethod,
  ]);

  const currentStory: InvestmentStory | null = useMemo(() => {
    if (!selectedCompany) return null;
    return stories[selectedCompany.id] ?? stories[selectedCompany.ticker] ?? null;
  }, [stories, selectedCompany]);

  const currentDecision: DecisionItem | null = useMemo(() => {
    if (!selectedCompany) return null;
    return decisions[selectedCompany.id] ?? decisions[selectedCompany.ticker] ?? null;
  }, [decisions, selectedCompany]);

  return {
    stocks,
    universeDiagnostics,
    financials,
    selectedCompany,
    selectedBaseTicker,
    selectedLatestDaily,
    selectedStockQuarterly,
    selectedBetaRecord,
    companyOverridesMap,
    paramsMap,
    macroMetaMap,
    sectorDefinitions,
    sectorPEMap,
    sectorPeConfirmed,
    sectorPeStatus,
    sectorPeError,
    betaConfirmed,
    betaError,
    effectiveRimRetentionPolicy,
    metricsTTM,
    valuation,
    engineOutputs,
    auditWarnings,
    healthChecks,
    currentStory,
    currentDecision,
  };
}
