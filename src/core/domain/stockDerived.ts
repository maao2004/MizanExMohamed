/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Company,
  QuarterlyFinancial,
  SectorDefinition,
  SectorMatchCandidate,
  SectorPeLoadStatus,
} from '../../types/financial';
import { BetaAssumptionRecord, DailyTradingRecord, QuarterlyFinancialRecord } from '../../types';
import { financialProjection, normalizedTicker, tryNormalizedTicker } from '../contracts';
import {
  deriveFinancialCurrencyAndUnit,
  normalizeCurrencyCode,
  resolveMarketPriceFromDaily,
} from './valuationAssumptions';
import { deriveSecurityIdentityAndMetadata } from './securityIdentity';

export { tryNormalizedTicker };

const QUARTER_ORDER: Record<string, number> = {
  Q1: 1,
  Q2: 2,
  Q3: 3,
  FY: 4,
};

function isValidQuarter(quarter: unknown): quarter is 'Q1' | 'Q2' | 'Q3' | 'FY' {
  return quarter === 'Q1' || quarter === 'Q2' || quarter === 'Q3' || quarter === 'FY';
}

export function isValidQuarterlyIdentity(rec: Partial<QuarterlyFinancialRecord>): boolean {
  const tk = tryNormalizedTicker(rec.ticker);
  if (!tk) return false;
  if (!Number.isInteger(rec.year) || (rec.year as number) < 1900 || (rec.year as number) > 2200) return false;
  if (!isValidQuarter(rec.quarter)) return false;
  return true;
}

function compareRecordsChronological(a: QuarterlyFinancialRecord, b: QuarterlyFinancialRecord): number {
  if (a.year !== b.year) return a.year - b.year;
  return (QUARTER_ORDER[a.quarter] || 0) - (QUARTER_ORDER[b.quarter] || 0);
}

export interface StockUniverseDiagnostics {
  stocks: Company[];
  excludedNonEquity: Array<{
    ticker: string;
    instrumentType: string;
    nameAr: string;
    reasonAr: string;
  }>;
  metadataConflicts: import('../../types/financial').MetadataConflictItem[];
  unmappedSectors: Array<{ ticker: string; rawSector: string }>;
  ambiguousSectors: Array<{
    ticker: string;
    rawSector: string;
    candidates: SectorMatchCandidate[];
    reasonAr: string;
  }>;
  disabledSectors: Array<{
    ticker: string;
    rawSector: string;
    sectorId: string | null;
    reasonAr: string;
  }>;
  sectorPeConfirmed: boolean;
  sectorPeStatus: SectorPeLoadStatus;
}

/**
 * اشتقاق قائمة الأسهم حصرياً من رموز quarterly_financial_records الصالحة،
 * مع استبعاد السندات والأدوات غير الأسهم العادية وتوثيق مصدر كل حقل وصفي وتعارضات ISIN/القطاع.
 */
export function deriveStockUniverseDiagnostics(
  quarterlyRecords: QuarterlyFinancialRecord[],
  companiesMetadata: Company[] = [],
  dailyRecords: Record<string, DailyTradingRecord> | DailyTradingRecord[] = {},
  betaAssumptions: Record<string, BetaAssumptionRecord> = {},
  options?: {
    valuationDate?: string | null;
    sectorDefinitions?: SectorDefinition[] | null;
    sectorPeConfirmed?: boolean;
    sectorPeStatus?: SectorPeLoadStatus;
  }
): StockUniverseDiagnostics {
  const groupedByTicker = new Map<string, QuarterlyFinancialRecord[]>();

  for (const rec of quarterlyRecords) {
    if (!isValidQuarterlyIdentity(rec)) continue;
    const tk = normalizedTicker(rec.ticker);
    const list = groupedByTicker.get(tk) || [];
    list.push({ ...rec, ticker: tk });
    groupedByTicker.set(tk, list);
  }

  const metadataByTicker = new Map<string, Company>();
  for (const c of companiesMetadata) {
    const tk = tryNormalizedTicker(c.ticker || c.id);
    if (!tk) continue;
    const existing = metadataByTicker.get(tk);
    if (!existing) {
      metadataByTicker.set(tk, c);
    } else {
      metadataByTicker.set(tk, {
        ...existing,
        ...c,
        marketPrice: existing.marketPrice ?? c.marketPrice,
      });
    }
  }

  const rawValuationDate = options?.valuationDate ?? null;
  const activeValuationDate =
    rawValuationDate && /^\d{4}-\d{2}-\d{2}$/.test(rawValuationDate) ? rawValuationDate : null;

  const dailyValuesRaw: DailyTradingRecord[] = Array.isArray(dailyRecords)
    ? dailyRecords
    : Object.values(dailyRecords);
  const dailyValues = activeValuationDate
    ? dailyValuesRaw.filter((rec) => !rec.tradeDate || rec.tradeDate <= activeValuationDate)
    : dailyValuesRaw;

  const dailyHistoryByTicker = new Map<string, DailyTradingRecord[]>();
  const dailyByTicker = new Map<string, DailyTradingRecord>();
  const isinToTickers = new Map<string, Set<string>>();

  for (const rec of dailyValues) {
    const tk = tryNormalizedTicker(rec.ticker);
    if (!tk) continue;
    const normRec = { ...rec, ticker: tk };
    const hist = dailyHistoryByTicker.get(tk) || [];
    hist.push(normRec);
    dailyHistoryByTicker.set(tk, hist);

    const prev = dailyByTicker.get(tk);
    if (!prev || rec.tradeDate > prev.tradeDate) {
      dailyByTicker.set(tk, normRec);
    }

    const cleanIsin = typeof rec.isinCode === 'string' ? rec.isinCode.trim().toUpperCase() : '';
    if (cleanIsin && cleanIsin !== '-' && cleanIsin !== 'N/A') {
      const set = isinToTickers.get(cleanIsin) || new Set<string>();
      set.add(tk);
      isinToTickers.set(cleanIsin, set);
    }
  }

  for (const [tk, meta] of metadataByTicker.entries()) {
    const cleanIsin = typeof meta.isinCode === 'string' ? meta.isinCode.trim().toUpperCase() : '';
    if (cleanIsin && cleanIsin !== '-' && cleanIsin !== 'N/A') {
      const set = isinToTickers.get(cleanIsin) || new Set<string>();
      set.add(tk);
      isinToTickers.set(cleanIsin, set);
    }
  }

  const sectorPeConfirmed = options?.sectorPeConfirmed ?? true;
  const sectorPeStatus: SectorPeLoadStatus =
    options?.sectorPeStatus ?? (sectorPeConfirmed ? 'ready' : 'loading');

  const derived: Company[] = [];
  const excludedNonEquity: StockUniverseDiagnostics['excludedNonEquity'] = [];
  const allConflicts: StockUniverseDiagnostics['metadataConflicts'] = [];
  const unmappedSectors: StockUniverseDiagnostics['unmappedSectors'] = [];
  const ambiguousSectors: StockUniverseDiagnostics['ambiguousSectors'] = [];
  const disabledSectors: StockUniverseDiagnostics['disabledSectors'] = [];

  const sortedTickers = Array.from(groupedByTicker.keys()).sort((a, b) => a.localeCompare(b));

  for (const tk of sortedTickers) {
    const records = groupedByTicker.get(tk)!.sort(compareRecordsChronological);
    const latestRecord = records[records.length - 1];
    const meta = metadataByTicker.get(tk);
    const daily = dailyByTicker.get(tk);
    const dailyHistory = dailyHistoryByTicker.get(tk) || (daily ? [daily] : []);
    const betaRec = betaAssumptions[tk];

    const identity = deriveSecurityIdentityAndMetadata({
      ticker: tk,
      quarterlyRecords: records,
      meta,
      dailyHistory,
      isinToTickers,
      sectorDefinitions: options?.sectorDefinitions,
      sectorPeConfirmed,
      sectorPeStatus,
    });

    if (identity.conflicts.length > 0) {
      allConflicts.push(...identity.conflicts);
    }

    if (!identity.isEquityEligible) {
      excludedNonEquity.push({
        ticker: tk,
        instrumentType: identity.instrumentType,
        nameAr: identity.nameAr,
        reasonAr: identity.instrumentExclusionReasonAr || 'تم استبعاد الأداة لكونها غير سهم عادي.',
      });
      continue;
    }

    if (sectorPeConfirmed && sectorPeStatus === 'ready') {
      if (identity.sectorStatus === 'ambiguous') {
        ambiguousSectors.push({
          ticker: tk,
          rawSector: identity.rawSector || identity.sector || '',
          candidates: identity.sectorCandidates ?? [],
          reasonAr: identity.sectorReasonAr || 'تطابق غامض في مجموعة sectorPE يتطلب مراجعة.',
        });
      } else if (identity.sectorStatus === 'disabled_sector') {
        disabledSectors.push({
          ticker: tk,
          rawSector: identity.rawSector || identity.sector || '',
          sectorId: identity.sectorId,
          reasonAr: identity.sectorReasonAr || 'القطاع معطّل في sectorPE ويحتاج إعادة ربط بقطاع نشط.',
        });
      } else if (identity.sectorStatus === 'unmapped' || (identity.rawSector && !identity.sectorId)) {
        unmappedSectors.push({
          ticker: tk,
          rawSector: identity.rawSector || identity.sectorId || '',
        });
      }
    }

    const resolvedPrice = resolveMarketPriceFromDaily(daily);

    const latestQuarterlySharesRecord = [...records]
      .reverse()
      .find((r) => typeof r.shares === 'number' && Number.isFinite(r.shares) && r.shares > 0);
    const latestQuarterlyShares = latestQuarterlySharesRecord?.shares ?? null;

    const dailyListedShares =
      daily && typeof daily.listedShares === 'number' && Number.isFinite(daily.listedShares) && daily.listedShares > 0
        ? daily.listedShares
        : null;

    const metaShares =
      meta?.sharesOutstanding != null && Number.isFinite(meta.sharesOutstanding) && meta.sharesOutstanding > 0
        ? meta.sharesOutstanding
        : null;

    const sharesOutstanding = latestQuarterlyShares ?? metaShares ?? dailyListedShares;
    const sharesSource: Company['sharesSource'] =
      latestQuarterlyShares !== null
        ? 'quarterly_record'
        : metaShares !== null
        ? 'company_metadata'
        : dailyListedShares !== null
        ? 'daily_listed_shares'
        : 'missing';
    const sharesPeriod =
      latestQuarterlySharesRecord
        ? `${latestQuarterlySharesRecord.quarter} ${latestQuarterlySharesRecord.year}`
        : sharesSource === 'daily_listed_shares'
        ? daily?.tradeDate ?? null
        : null;

    const betaVal =
      betaRec && typeof betaRec.beta === 'number' && Number.isFinite(betaRec.beta)
        ? betaRec.beta
        : null;

    const finCurrencyInfo = deriveFinancialCurrencyAndUnit(records);
    const metaCurrencyNorm = meta?.currency ? normalizeCurrencyCode(meta.currency) : 'MISSING';
    const derivedCurrencyLabel =
      finCurrencyInfo.currency === 'UNSUPPORTED'
        ? 'UNSUPPORTED'
        : finCurrencyInfo.currency ?? 'EGP';
    const derivedMarketPriceCurrency: Company['marketPriceCurrency'] = daily
      ? 'EGP'
      : metaCurrencyNorm === 'EGP' || metaCurrencyNorm === 'USD' || metaCurrencyNorm === 'UNSUPPORTED'
      ? metaCurrencyNorm
      : finCurrencyInfo.currency === 'UNSUPPORTED'
      ? 'UNSUPPORTED'
      : finCurrencyInfo.currency ?? 'EGP';

    derived.push({
      id: tk.toLowerCase(),
      ticker: tk,
      nameAr: identity.nameAr,
      nameEn: identity.nameEn,
      shortName: identity.shortName,
      fullName: identity.fullName,
      isinCode: identity.isinCode,
      market: identity.market,
      instrumentType: identity.instrumentType,
      sector: identity.sector,
      rawSector: identity.rawSector,
      sectorId: identity.sectorId,
      sectorSource: identity.sectorSource,
      sectorDate: identity.sectorDate,
      sectorClassification: identity.sectorClassification,
      metadataProvenance: identity.provenance,
      metadataConflicts: identity.conflicts.length > 0 ? identity.conflicts : undefined,
      marketPrice: resolvedPrice.price,
      marketPriceSource: resolvedPrice.source,
      latestTradeDate: resolvedPrice.tradeDate,
      sharesOutstanding,
      sharesSource,
      sharesPeriod,
      beta: betaVal,
      riskFreeRate: null,
      equityRiskPremium: null,
      costOfDebt: null,
      taxRate: null,
      targetDebtRatio: null,
      sustainableGrowthRate: null,
      shortTermGrowthRate: null,
      targetPE: null,
      targetPB: null,
      currency: derivedCurrencyLabel,
      marketPriceCurrency: derivedMarketPriceCurrency,
      rimRetentionPolicy: meta?.rimRetentionPolicy,
      rimRetentionPolicySource: meta?.rimRetentionPolicySource ?? null,
      description: meta?.description || '',
      website: meta?.website,
      updatedAt: latestRecord?.updatedAt || meta?.updatedAt,
    });
  }

  return {
    stocks: derived,
    excludedNonEquity,
    metadataConflicts: allConflicts,
    unmappedSectors,
    ambiguousSectors,
    disabledSectors,
    sectorPeConfirmed,
    sectorPeStatus,
  };
}

export function deriveStocksFromQuarterlyRecords(
  quarterlyRecords: QuarterlyFinancialRecord[],
  companiesMetadata: Company[] = [],
  dailyRecords: Record<string, DailyTradingRecord> | DailyTradingRecord[] = {},
  betaAssumptions: Record<string, BetaAssumptionRecord> = {},
  options?: {
    valuationDate?: string | null;
    sectorDefinitions?: SectorDefinition[] | null;
    sectorPeConfirmed?: boolean;
    sectorPeStatus?: SectorPeLoadStatus;
  }
): Company[] {
  return deriveStockUniverseDiagnostics(
    quarterlyRecords,
    companiesMetadata,
    dailyRecords,
    betaAssumptions,
    options
  ).stocks;
}

/**
 * اشتقاق القوائم المالية بصيغة QuarterlyFinancial حصرياً من quarterly_financial_records
 * باستخدام financialProjection الموحّد.
 */
export function deriveFinancialsFromQuarterlyRecords(
  quarterlyRecords: QuarterlyFinancialRecord[]
): QuarterlyFinancial[] {
  const projected: QuarterlyFinancial[] = [];
  const dedup = new Map<string, QuarterlyFinancial>();

  for (const rec of quarterlyRecords) {
    if (!isValidQuarterlyIdentity(rec)) continue;
    const item = financialProjection(rec) as QuarterlyFinancial;
    dedup.set(item.id, item);
  }

  for (const item of dedup.values()) {
    projected.push(item);
  }

  return projected.sort((a, b) => {
    if (a.companyId !== b.companyId) return a.companyId.localeCompare(b.companyId);
    if (a.year !== b.year) return a.year - b.year;
    return (QUARTER_ORDER[a.quarter] || 0) - (QUARTER_ORDER[b.quarter] || 0);
  });
}

/**
 * تحديد السهم المختار بشكل حتمي بعد أي إضافة أو حذف:
 * يبقى السهم الحالي إذا ظل موجوداً، وإلا يُختار أول سهم متاح بترتيب ثابت، أو null عند فراغ القائمة.
 */
export function resolveSelectedTicker(
  stocks: Company[],
  currentSelectedTicker: string | null
): string | null {
  if (stocks.length === 0) return null;
  if (currentSelectedTicker) {
    const normalized = tryNormalizedTicker(currentSelectedTicker);
    if (normalized && stocks.some((s) => s.ticker === normalized)) {
      return normalized;
    }
  }
  return stocks[0].ticker;
}

export type AppDataStateKind =
  | 'loading'
  | 'unauthenticated'
  | 'offline'
  | 'permission_denied'
  | 'error'
  | 'empty'
  | 'ready';

export interface ConnectionErrorState {
  type: 'permission_denied' | 'offline' | 'error';
  message: string;
}

/**
 * التمييز الصارم بين حالات التحميل، عدم المصادقة، عدم الاتصال، نقص الصلاحيات، خطأ الاتصال، والفراغ المؤكد من الخادم.
 */
export function classifyAppDataState(params: {
  authLoading: boolean;
  isAuthenticated: boolean;
  connectionError: ConnectionErrorState | null;
  quarterlyConfirmed: boolean;
  stocksCount: number;
}): AppDataStateKind {
  if (params.authLoading) return 'loading';
  if (!params.isAuthenticated) return 'unauthenticated';
  if (params.connectionError) return params.connectionError.type;
  if (!params.quarterlyConfirmed) return 'loading';
  if (params.stocksCount === 0) return 'empty';
  return 'ready';
}
