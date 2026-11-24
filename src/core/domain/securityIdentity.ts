/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Company,
  InstrumentType,
  MetadataConflictItem,
  MetadataFieldProvenance,
  SectorClassification,
  SectorDefinition,
  SectorMatchCandidate,
  SectorPeLoadStatus,
} from '../../types/financial';
import type { DailyTradingRecord, QuarterlyFinancialRecord } from '../../types';
import {
  classifyInstrumentType,
  cleanMetadataText,
  normalizeSectorToken,
  resolveUnifiedSector,
  sanitizeSectorId,
  type UnifiedSectorResolution,
} from '../contracts';

export interface ResolvedCompanySecurityMetadata {
  ticker: string;
  nameAr: string;
  nameEn: string;
  shortName: string | null;
  fullName: string | null;
  isinCode: string | null;
  market: string | null;
  instrumentType: InstrumentType;
  instrumentExclusionReasonAr: string | null;
  isEquityEligible: boolean;
  sector: string;
  rawSector: string | null;
  sectorId: string | null;
  sectorSource: string;
  sectorDate: string | null;
  sectorClassification: SectorClassification;
  sectorClassificationSource: string;
  sectorStatus: UnifiedSectorResolution['source'];
  sectorCandidates?: SectorMatchCandidate[];
  sectorReasonAr?: string | null;
  provenance: Record<string, MetadataFieldProvenance>;
  conflicts: MetadataConflictItem[];
}

function resolveDailyMetadataField(
  sortedNewestFirst: DailyTradingRecord[],
  getter: (r: DailyTradingRecord) => unknown
): { value: string | null; asOfDate: string | null; allDistinct: Array<{ value: string; asOfDate: string }> } {
  let latestValid: { value: string; asOfDate: string } | null = null;
  const distinctMap = new Map<string, string>();
  for (const d of sortedNewestFirst) {
    const clean = cleanMetadataText(getter(d));
    if (!clean) continue;
    if (!latestValid) {
      latestValid = { value: clean, asOfDate: d.tradeDate };
    }
    const key = clean.toLowerCase();
    if (!distinctMap.has(key)) {
      distinctMap.set(key, d.tradeDate);
    }
  }
  const allDistinct = Array.from(distinctMap.entries()).map(([lowerKey, asOfDate]) => {
    const matched = sortedNewestFirst.find((d) => {
      const c = cleanMetadataText(getter(d));
      return c && c.toLowerCase() === lowerKey;
    });
    return { value: cleanMetadataText(getter(matched!)) || lowerKey, asOfDate };
  });
  return {
    value: latestValid?.value ?? null,
    asOfDate: latestValid?.asOfDate ?? null,
    allDistinct,
  };
}

/**
 * اشتقاق الهوية والبيانات الوصفية للسهم على مستوى كل حقل بشكل مستقل:
 * - مسح جلسات التداول من الأحدث للأقدم لكل حقل على حدة (فراغ اليوم لا يمسح قطاع الأمس الصالح).
 * - تجاهل الرموز الناقصة والافتراضية مثل "غير مصنف" / "-" / "عام" حتى لا تحجب قطاعاً موثقاً.
 * - استخدام مجموعة sectorPE الرسمية كمصدر وحيد لتعريف وتصنيف القطاعات دون قوائم ثابتة في الكود.
 * - عدم دمج شركتين بالاعتماد على تشابه الاسم العربي وحده.
 */
export function deriveSecurityIdentityAndMetadata(params: {
  ticker: string;
  quarterlyRecords: QuarterlyFinancialRecord[];
  meta?: Company;
  dailyHistory: DailyTradingRecord[];
  isinToTickers?: Map<string, Set<string>>;
  sectorDefinitions?: SectorDefinition[] | null;
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
}): ResolvedCompanySecurityMetadata {
  const { ticker, quarterlyRecords, meta, dailyHistory, isinToTickers } = params;
  const conflicts: MetadataConflictItem[] = [];

  const sortedDailyNewest = [...dailyHistory].sort((a, b) =>
    (b.tradeDate || '').localeCompare(a.tradeDate || '')
  );
  const latestDaily = sortedDailyNewest[0] ?? null;

  const dailyShortName = resolveDailyMetadataField(sortedDailyNewest, (d) => d.shortName);
  const dailyFullName = resolveDailyMetadataField(sortedDailyNewest, (d) => d.fullName);
  const dailySector = resolveDailyMetadataField(sortedDailyNewest, (d) => d.sector);
  const dailyIsin = resolveDailyMetadataField(sortedDailyNewest, (d) => d.isinCode);
  const dailyMarket = resolveDailyMetadataField(sortedDailyNewest, (d) => d.market);

  // رصد اختلاف الكود الدولي ISIN لنفس الرمز أو اشتراك رموز مختلفة في نفس ISIN
  if (dailyIsin.allDistinct.length > 1) {
    conflicts.push({
      ticker,
      field: 'isinCode',
      values: dailyIsin.allDistinct.map((v) => ({
        value: v.value,
        source: 'daily_trading_records',
        asOfDate: v.asOfDate,
      })),
      reasonAr: `تضارب في الكود الدولي ISIN للسهم ${ticker} عبر جلسات التداول اليومي (${dailyIsin.allDistinct.map((x) => x.value).join(' مقابل ')}).`,
    });
  }

  const metaIsin = cleanMetadataText(meta?.isinCode);
  const activeIsin = metaIsin ?? dailyIsin.value ?? null;
  if (metaIsin && dailyIsin.value && metaIsin.toUpperCase() !== dailyIsin.value.toUpperCase()) {
    conflicts.push({
      ticker,
      field: 'isinCode',
      values: [
        { value: metaIsin, source: 'companies', asOfDate: meta?.updatedAt?.slice(0, 10) ?? null },
        { value: dailyIsin.value, source: 'daily_trading_records', asOfDate: dailyIsin.asOfDate },
      ],
      reasonAr: `تضارب الكود الدولي ISIN بين بطاقة الشركة (${metaIsin}) والتداول اليومي (${dailyIsin.value}).`,
    });
  }

  if (activeIsin && isinToTickers) {
    const linked = isinToTickers.get(activeIsin.toUpperCase());
    if (linked && linked.size > 1) {
      const others = Array.from(linked).filter((t) => t !== ticker);
      conflicts.push({
        ticker,
        field: 'isinCode',
        values: Array.from(linked).map((tk) => ({
          value: `${activeIsin} (${tk})`,
          source: 'cross_ticker_isin',
          asOfDate: latestDaily?.tradeDate ?? null,
        })),
        reasonAr: `يشترك الكود الدولي ${activeIsin} مع رموز أخرى (${others.join('، ')})؛ تم إبقاء السجلات منفصلة للمراجعة وعدم الدمج التلقائي.`,
      });
    }
  }

  // الاسم العربي والإنجليزي بدون أي دمج تلقائي بالاسم
  const qName = [...quarterlyRecords]
    .reverse()
    .map((r) => cleanMetadataText(r.stockName))
    .find((name) => name !== null && name.toUpperCase() !== ticker);
  const metaNameAr =
    cleanMetadataText(meta?.nameAr) && cleanMetadataText(meta?.nameAr)!.toUpperCase() !== ticker
      ? cleanMetadataText(meta?.nameAr)
      : null;
  const metaNameEn =
    cleanMetadataText(meta?.nameEn) && cleanMetadataText(meta?.nameEn)!.toUpperCase() !== ticker
      ? cleanMetadataText(meta?.nameEn)
      : null;

  const shortName = cleanMetadataText(meta?.shortName) ?? dailyShortName.value ?? null;
  const fullName = cleanMetadataText(meta?.fullName) ?? dailyFullName.value ?? null;
  const market = cleanMetadataText(meta?.market) ?? dailyMarket.value ?? null;

  const displayNameAr = qName || metaNameAr || fullName || shortName || ticker;
  const displayNameEn = metaNameEn || displayNameAr;

  // القطاع: المعرف الصريح sectorId في بطاقة الشركة مرجعي وحاسم ولا يُستبدل بنص التداول اليومي،
  // مع الإبقاء على rawSector وتوثيق أي تعارض مع التداول اليومي بشفافية للتدقيق.
  const cleanMetaSector = cleanMetadataText(meta?.sector);
  const cleanMetaRawSector = cleanMetadataText(meta?.rawSector);
  const explicitMetaSectorId = sanitizeSectorId(meta?.sectorId ?? '');
  const metaSectorDate = meta?.sectorDate || meta?.updatedAt?.slice(0, 10) || null;
  const isMetaSectorOverride = meta?.sectorSource === 'admin_override';

  let chosenRawSector: string | null = null;
  let chosenSectorSource = 'missing';
  let chosenSectorDate: string | null = null;

  if (explicitMetaSectorId) {
    // Explicit sectorId is authoritative (whether admin_override, sector_registry_reassign, or sector_registry_sync)
    chosenRawSector = cleanMetaRawSector ?? cleanMetaSector ?? dailySector.value ?? null;
    chosenSectorSource = meta?.sectorSource || 'sector_registry';
    chosenSectorDate = metaSectorDate;
  } else if (cleanMetaSector && isMetaSectorOverride) {
    chosenRawSector = cleanMetaRawSector ?? cleanMetaSector;
    chosenSectorSource = 'admin_override';
    chosenSectorDate = metaSectorDate;
  } else if (dailySector.value && (!cleanMetaSector || !metaSectorDate || (dailySector.asOfDate ?? '') >= metaSectorDate)) {
    chosenRawSector = dailySector.value;
    chosenSectorSource = 'daily_trading';
    chosenSectorDate = dailySector.asOfDate;
    if (cleanMetaSector && cleanMetaSector.toLowerCase() !== dailySector.value.toLowerCase()) {
      conflicts.push({
        ticker,
        field: 'sector',
        values: [
          { value: cleanMetaSector, source: 'companies', asOfDate: metaSectorDate },
          { value: dailySector.value, source: 'daily_trading_records', asOfDate: dailySector.asOfDate },
        ],
        reasonAr: `تعارض القطاع بين بطاقة الشركة (${cleanMetaSector}) وأحدث جلسة تداول (${dailySector.value})؛ تم تغليب التداول اليومي الأحدث لعدم وجود sectorId صريح.`,
      });
    }
  } else if (cleanMetaSector) {
    chosenRawSector = cleanMetaSector;
    chosenSectorSource = meta?.sectorSource || 'company_metadata';
    chosenSectorDate = metaSectorDate;
    if (dailySector.value && dailySector.value.toLowerCase() !== cleanMetaSector.toLowerCase()) {
      conflicts.push({
        ticker,
        field: 'sector',
        values: [
          { value: cleanMetaSector, source: 'companies', asOfDate: metaSectorDate },
          { value: dailySector.value, source: 'daily_trading_records', asOfDate: dailySector.value ? dailySector.asOfDate : null },
        ],
        reasonAr: `تعارض القطاع بين التخصيص الأحدث في الشركة (${cleanMetaSector}) وسجل التداول (${dailySector.value}).`,
      });
    }
  }

  const explicitClass =
    !explicitMetaSectorId &&
    (meta?.sectorClassification === 'financial' || meta?.sectorClassification === 'non_financial')
      ? meta.sectorClassification
      : null;

  const unifiedSector = resolveUnifiedSector(chosenRawSector, explicitClass, {
    sectorId: explicitMetaSectorId,
    sectorDefinitions: params.sectorDefinitions,
    sectorPeConfirmed: params.sectorPeConfirmed,
    sectorPeStatus: params.sectorPeStatus,
  });

  if (explicitMetaSectorId && dailySector.value) {
    const authoritativeLabel = unifiedSector.canonicalNameAr ?? cleanMetaSector ?? explicitMetaSectorId;
    const normAuth = normalizeSectorToken(authoritativeLabel);
    const normDaily = normalizeSectorToken(dailySector.value);
    const matchedDef = (params.sectorDefinitions ?? []).find(
      (d) => d.isDeleted !== true && d.sectorId === explicitMetaSectorId
    );
    const matchesAuthoritativeAlias =
      matchedDef?.aliases.some((a) => normalizeSectorToken(a) === normDaily) ?? false;
    if (normAuth && normDaily && normAuth !== normDaily && !matchesAuthoritativeAlias) {
      conflicts.push({
        ticker,
        field: 'sector',
        values: [
          {
            value: `${authoritativeLabel} (${explicitMetaSectorId})`,
            source: 'companies',
            asOfDate: metaSectorDate,
          },
          {
            value: dailySector.value,
            source: 'daily_trading_records',
            asOfDate: dailySector.asOfDate,
          },
        ],
        reasonAr: `الارتباط المعتمد للشركة عبر sectorId هو "${authoritativeLabel}" (${explicitMetaSectorId}) بينما يعرض التداول اليومي "${dailySector.value}"؛ تم الإبقاء على المعرف الصريح وتوثيق النص الخام للتدقيق.`,
      });
    }
  }

  const sectorClassificationSource =
    unifiedSector.source === 'explicit_override'
      ? 'admin_override'
      : unifiedSector.source === 'sector_registry'
      ? 'sector_registry'
      : unifiedSector.source === 'registry_unavailable'
      ? 'registry_unavailable'
      : 'unresolved';

  // تصنيف الورقة المالية (استبعاد السندات والأدوات غير الأسهم العادية)
  const latestQ = quarterlyRecords[quarterlyRecords.length - 1];
  const instRes = meta?.instrumentType && meta.instrumentType !== 'unknown'
    ? {
        instrumentType: meta.instrumentType,
        reasonAr:
          meta.instrumentType === 'bond'
            ? 'الورقة مصنفة صراحة كسند/أداة دين ومستبعدة من أسهم التقييم.'
            : meta.instrumentType === 'other'
            ? 'الورقة مصنفة صراحة كأداة غير سهم عادي ومستبعدة من أسهم التقييم.'
            : null,
      }
    : classifyInstrumentType({
        ticker,
        shortName,
        fullName,
        sector: chosenRawSector,
        market,
        isinCode: activeIsin,
        extendedFields: latestQ?.extendedFields ?? null,
      });

  const provenance: Record<string, MetadataFieldProvenance> = {
    shortName: {
      value: shortName,
      source: cleanMetadataText(meta?.shortName) ? 'admin_override' : dailyShortName.value ? 'daily_trading' : 'missing',
      asOfDate: cleanMetadataText(meta?.shortName) ? metaSectorDate : dailyShortName.asOfDate,
    },
    fullName: {
      value: fullName,
      source: cleanMetadataText(meta?.fullName) ? 'admin_override' : dailyFullName.value ? 'daily_trading' : 'missing',
      asOfDate: cleanMetadataText(meta?.fullName) ? metaSectorDate : dailyFullName.asOfDate,
    },
    sector: {
      value: unifiedSector.canonicalNameAr ?? chosenRawSector,
      source:
        chosenSectorSource === 'admin_override'
          ? 'admin_override'
          : chosenSectorSource === 'daily_trading'
          ? 'daily_trading'
          : unifiedSector.source === 'sector_registry' || chosenRawSector
          ? 'sector_registry'
          : 'missing',
      asOfDate: chosenSectorDate,
    },
    isinCode: {
      value: activeIsin,
      source: metaIsin ? 'admin_override' : dailyIsin.value ? 'daily_trading' : 'missing',
      asOfDate: metaIsin ? metaSectorDate : dailyIsin.asOfDate,
    },
    market: {
      value: market,
      source: cleanMetadataText(meta?.market) ? 'admin_override' : dailyMarket.value ? 'daily_trading' : 'missing',
      asOfDate: cleanMetadataText(meta?.market) ? metaSectorDate : dailyMarket.asOfDate,
    },
  };

  return {
    ticker,
    nameAr: displayNameAr,
    nameEn: displayNameEn,
    shortName,
    fullName,
    isinCode: activeIsin,
    market,
    instrumentType: instRes.instrumentType,
    instrumentExclusionReasonAr: instRes.reasonAr,
    isEquityEligible: instRes.instrumentType !== 'bond' && instRes.instrumentType !== 'other',
    sector: unifiedSector.canonicalNameAr ?? chosenRawSector ?? '',
    rawSector: chosenRawSector,
    sectorId: unifiedSector.sectorId,
    sectorSource: chosenSectorSource,
    sectorDate: chosenSectorDate,
    sectorClassification: unifiedSector.classification,
    sectorClassificationSource,
    sectorStatus: unifiedSector.source,
    ...(unifiedSector.candidates?.length ? { sectorCandidates: unifiedSector.candidates } : {}),
    sectorReasonAr: unifiedSector.reasonAr ?? null,
    provenance,
    conflicts,
  };
}
