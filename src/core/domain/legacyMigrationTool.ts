/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BetaAssumptionRecord,
  Company,
  CompanyParameterOverride,
  MetadataConflictItem,
  SectorDefinition,
} from '../../types/financial';
import type { DailyTradingRecord, MacroParameter, QuarterlyFinancialRecord } from '../../types';
import {
  auditLegacyReportedEpsRecord,
  buildSectorDefinitionsFromMap,
  classifyInstrumentType,
  cleanMetadataText,
  isMissingMetadataValue,
  LegacyReportedEpsAuditItem,
  normalizeSectorToken,
  resolveUnifiedSector,
  sanitizeSectorId,
  suggestSectorId,
  tryNormalizedTicker,
} from '../contracts';

export interface MigrationCompanyChange {
  ticker: string;
  companyId: string;
  action:
    | 'clear_placeholder_sector'
    | 'enrich_sector_from_daily'
    | 'normalize_sector_id'
    | 'flag_ambiguous_sector'
    | 'flag_disabled_sector'
    | 'flag_unmapped_sector'
    | 'flag_non_equity';
  currentSector: string | null;
  proposedSector: string | null;
  proposedSectorId: string | null;
  proposedClassification: string;
  reasonAr: string;
}

export interface MigrationSectorPeChange {
  currentKey: string;
  multiple: number | null;
  proposedCanonicalKey: string | null;
  proposedSectorId: string | null;
  status:
    | 'already_canonical'
    | 'legacy_value_doc'
    | 'disabled_sector'
    | 'null_multiple'
    | 'duplicate_alias_conflict'
    | 'unmapped_key';
  reasonAr: string;
}

export interface MigrationLegacyParameterItem {
  ticker: string;
  companyId: string;
  legacyField: string;
  legacyValue: number;
  targetCollection: 'company_assumptions' | 'beta_assumptions';
  targetKey: string;
  authoritativeValue: number | null;
  status: 'ready_to_migrate' | 'already_migrated_equal' | 'conflict_different_value';
  reasonAr: string;
}

export interface BetaDefaultAuditItem {
  present: boolean;
  value: number | null;
  status: 'missing_ok' | 'compliant_one' | 'conflict_non_one';
  reasonAr: string;
}

export interface LegacyMigrationReport {
  generatedAt: string;
  dryRunOnly: true;
  companyChanges: MigrationCompanyChange[];
  sectorPeChanges: MigrationSectorPeChange[];
  legacyParameterMigrations: MigrationLegacyParameterItem[];
  betaDefaultAudit: BetaDefaultAuditItem;
  excludedNonEquityTickers: Array<{ ticker: string; instrumentType: string; reasonAr: string }>;
  reportedEpsPeriodAudit: LegacyReportedEpsAuditItem[];
  legacyMillionUnitRecordsCount: number;
  conflicts: MetadataConflictItem[];
  summaryCounts: {
    companiesPlaceholderSector: number;
    companiesEnrichableFromDaily: number;
    companiesUnmappedSector: number;
    companiesAmbiguousSector: number;
    companiesDisabledSector: number;
    sectorPeRichDocsCount: number;
    sectorPeLegacyFormatCount: number;
    sectorPeDisabledCount: number;
    sectorPeNullMultipleCount: number;
    sectorPeUnmappedKeys: number;
    excludedNonEquityCount: number;
    legacyMillionUnitRecordsCount: number;
    legacyParamsReadyToMigrate: number;
    legacyParamsAlreadyMigrated: number;
    legacyParamsConflicts: number;
    betaDefaultConflict: boolean;
    reportedEpsStructuredValidCount: number;
    reportedEpsUnambiguousConvertibleCount: number;
    reportedEpsNeedsReviewCount: number;
  };
}

const LEGACY_COMPANY_PARAM_MAPPINGS: Array<{
  field:
    | 'beta'
    | 'riskFreeRate'
    | 'equityRiskPremium'
    | 'costOfDebt'
    | 'taxRate'
    | 'sustainableGrowthRate'
    | 'targetPE'
    | 'targetPB';
  targetCollection: 'beta_assumptions' | 'company_assumptions';
  targetKey: string;
}> = [
  { field: 'beta', targetCollection: 'beta_assumptions', targetKey: 'Beta' },
  { field: 'riskFreeRate', targetCollection: 'company_assumptions', targetKey: 'Rf_Egypt_10Y' },
  { field: 'equityRiskPremium', targetCollection: 'company_assumptions', targetKey: 'ERP_Developed' },
  { field: 'costOfDebt', targetCollection: 'company_assumptions', targetKey: 'Cost_of_Debt' },
  { field: 'taxRate', targetCollection: 'company_assumptions', targetKey: 'TaxRate' },
  { field: 'sustainableGrowthRate', targetCollection: 'company_assumptions', targetKey: 'Terminal_Growth' },
  { field: 'targetPE', targetCollection: 'company_assumptions', targetKey: 'Target_PE' },
  { field: 'targetPB', targetCollection: 'company_assumptions', targetKey: 'Target_PB' },
];

/**
 * أداة معاينة ترحيل البيانات القديمة (Dry-Run Only):
 * تفحص السجلات الحالية محلياً وتصدر تقريراً بالتعديلات المقترحة بالاعتماد الحصري على مجموعة sectorPE دون أي كتابة إلى Firestore.
 */
export function analyzeLegacyMigration(params: {
  companies: Company[];
  sectorPEMap: Record<string, number>;
  sectorDefinitions?: SectorDefinition[];
  quarterlyRecords: QuarterlyFinancialRecord[];
  dailyRecords: DailyTradingRecord[] | Record<string, DailyTradingRecord>;
  conflicts?: MetadataConflictItem[];
  companyOverrides?: CompanyParameterOverride[];
  betaAssumptions?: BetaAssumptionRecord[];
  macroParams?: MacroParameter[];
}): LegacyMigrationReport {
  const effectiveSectorDefs: SectorDefinition[] = Array.isArray(params.sectorDefinitions)
    ? params.sectorDefinitions
    : buildSectorDefinitionsFromMap(params.sectorPEMap);

  const dailyList: DailyTradingRecord[] = Array.isArray(params.dailyRecords)
    ? params.dailyRecords
    : Object.values(params.dailyRecords);

  const latestDailySectorByTicker = new Map<string, { sector: string; tradeDate: string }>();
  for (const d of [...dailyList].sort((a, b) => (b.tradeDate || '').localeCompare(a.tradeDate || ''))) {
    const tk = tryNormalizedTicker(d.ticker);
    if (!tk) continue;
    if (!latestDailySectorByTicker.has(tk)) {
      const cleanSec = cleanMetadataText(d.sector);
      if (cleanSec) {
        latestDailySectorByTicker.set(tk, { sector: cleanSec, tradeDate: d.tradeDate });
      }
    }
  }

  const overridesIndex = new Map<string, number>();
  for (const ov of params.companyOverrides ?? []) {
    if (ov.isDeleted === true) continue;
    const tk = tryNormalizedTicker(ov.ticker);
    if (!tk || typeof ov.value !== 'number' || !Number.isFinite(ov.value)) continue;
    overridesIndex.set(`${tk}::${ov.key}`, ov.value);
  }

  const betaIndex = new Map<string, number>();
  for (const b of params.betaAssumptions ?? []) {
    if (b.isDeleted === true) continue;
    const tk = tryNormalizedTicker(b.ticker);
    if (!tk || typeof b.beta !== 'number' || !Number.isFinite(b.beta)) continue;
    betaIndex.set(tk, b.beta);
  }

  const companyChanges: MigrationCompanyChange[] = [];
  const legacyParameterMigrations: MigrationLegacyParameterItem[] = [];
  const excludedNonEquityTickers: LegacyMigrationReport['excludedNonEquityTickers'] = [];
  let companiesPlaceholderSector = 0;
  let companiesEnrichableFromDaily = 0;
  let companiesUnmappedSector = 0;
  let companiesAmbiguousSector = 0;
  let companiesDisabledSector = 0;
  let legacyParamsReadyToMigrate = 0;
  let legacyParamsAlreadyMigrated = 0;
  let legacyParamsConflicts = 0;

  for (const c of params.companies) {
    const tk = tryNormalizedTicker(c.ticker || c.id);
    if (!tk) continue;
    const rawSector = typeof c.sector === 'string' ? c.sector.trim() : '';
    const isPlaceholder = isMissingMetadataValue(rawSector);
    const dailyFallback = latestDailySectorByTicker.get(tk);

    const inst = classifyInstrumentType({
      ticker: tk,
      shortName: c.shortName,
      fullName: c.fullName ?? c.nameAr,
      sector: dailyFallback?.sector ?? rawSector,
      market: c.market,
      isinCode: c.isinCode,
    });
    if (inst.instrumentType === 'bond' || inst.instrumentType === 'other') {
      excludedNonEquityTickers.push({
        ticker: tk,
        instrumentType: inst.instrumentType,
        reasonAr: inst.reasonAr || 'ورقة غير سهم عادي.',
      });
      companyChanges.push({
        ticker: tk,
        companyId: c.id,
        action: 'flag_non_equity',
        currentSector: rawSector || null,
        proposedSector: dailyFallback?.sector ?? null,
        proposedSectorId: null,
        proposedClassification: 'unknown',
        reasonAr: inst.reasonAr || 'وسم الأداة كغير سهم عادي لاستبعادها من التقييم.',
      });
    }

    const explicitSectorId = sanitizeSectorId(c.sectorId ?? '');

    if (explicitSectorId) {
      // Explicit sectorId is strictly authoritative: never fall back to daily or rawSector text.
      const resolved = resolveUnifiedSector(rawSector || c.rawSector || null, null, {
        sectorId: explicitSectorId,
        sectorDefinitions: effectiveSectorDefs,
      });
      if (resolved.source === 'disabled_sector') {
        companiesDisabledSector += 1;
        companyChanges.push({
          ticker: tk,
          companyId: c.id,
          action: 'flag_disabled_sector',
          currentSector: rawSector || explicitSectorId,
          proposedSector: null,
          proposedSectorId: resolved.sectorId,
          proposedClassification: 'unknown',
          reasonAr:
            resolved.reasonAr ||
            `قطاع الشركة (${explicitSectorId}) معطّل في sectorPE ويحتاج إعادة ربط بقطاع نشط.`,
        });
      } else if (resolved.source === 'unmapped') {
        companiesUnmappedSector += 1;
        companyChanges.push({
          ticker: tk,
          companyId: c.id,
          action: 'flag_unmapped_sector',
          currentSector: rawSector || explicitSectorId,
          proposedSector: null,
          proposedSectorId: null,
          proposedClassification: 'unknown',
          reasonAr:
            resolved.reasonAr ||
            `معرف القطاع الصريح "${explicitSectorId}" غير موجود أو محذوف في sectorPE؛ يلزم مراجعة إدارية دون ربط تلقائي عبر النص.`,
        });
      } else if (
        resolved.sectorId &&
        ((resolved.canonicalNameAr && c.sector !== resolved.canonicalNameAr) ||
          c.sectorClassification !== resolved.classification)
      ) {
        companyChanges.push({
          ticker: tk,
          companyId: c.id,
          action: 'normalize_sector_id',
          currentSector: rawSector || null,
          proposedSector: resolved.canonicalNameAr ?? rawSector,
          proposedSectorId: resolved.sectorId,
          proposedClassification: resolved.classification,
          reasonAr: `توحيد اسم وتصنيف الشركة مع تعريف sectorPE الرسمي للمعرف (${resolved.sectorId} / ${resolved.classification}).`,
        });
      }
    } else if (isPlaceholder && dailyFallback) {
      const resolved = resolveUnifiedSector(dailyFallback.sector, c.sectorClassification ?? null, {
        sectorId: null,
        sectorDefinitions: effectiveSectorDefs,
      });
      companiesPlaceholderSector += 1;
      companiesEnrichableFromDaily += 1;
      companyChanges.push({
        ticker: tk,
        companyId: c.id,
        action: 'enrich_sector_from_daily',
        currentSector: rawSector || null,
        proposedSector: resolved.canonicalNameAr ?? dailyFallback.sector,
        proposedSectorId: resolved.sectorId,
        proposedClassification: resolved.classification,
        reasonAr: resolved.sectorId
          ? `استبدال القيمة الافتراضية "${rawSector || 'فارغ'}" بقطاع التداول اليومي الموثق "${dailyFallback.sector}" وربطه بـ ${resolved.sectorId} في sectorPE.`
          : `استبدال القيمة الافتراضية "${rawSector || 'فارغ'}" بقطاع التداول اليومي "${dailyFallback.sector}" (يتطلب تعريفه في sectorPE).`,
      });
    } else if (isPlaceholder && rawSector !== '') {
      companiesPlaceholderSector += 1;
      companyChanges.push({
        ticker: tk,
        companyId: c.id,
        action: 'clear_placeholder_sector',
        currentSector: rawSector,
        proposedSector: null,
        proposedSectorId: null,
        proposedClassification: c.sectorClassification ?? 'unknown',
        reasonAr: `تنظيف النص الافتراضي "${rawSector}" وإرجاعه إلى قيمة فارغة غير مضللة.`,
      });
    } else if (!isPlaceholder) {
      const resolved = resolveUnifiedSector(rawSector, c.sectorClassification ?? null, {
        sectorId: null,
        sectorDefinitions: effectiveSectorDefs,
      });
      if (resolved.source === 'ambiguous') {
        companiesAmbiguousSector += 1;
        companyChanges.push({
          ticker: tk,
          companyId: c.id,
          action: 'flag_ambiguous_sector',
          currentSector: rawSector,
          proposedSector: null,
          proposedSectorId: null,
          proposedClassification: 'unknown',
          reasonAr:
            resolved.reasonAr ||
            `تطابق غامض لقطاع "${rawSector}" مع عدة قطاعات في sectorPE.`,
        });
      } else if (resolved.source === 'disabled_sector') {
        companiesDisabledSector += 1;
        companyChanges.push({
          ticker: tk,
          companyId: c.id,
          action: 'flag_disabled_sector',
          currentSector: rawSector,
          proposedSector: null,
          proposedSectorId: resolved.sectorId,
          proposedClassification: 'unknown',
          reasonAr:
            resolved.reasonAr ||
            `قطاع الشركة "${rawSector}" معطّل في sectorPE ويحتاج إعادة ربط بقطاع نشط.`,
        });
      } else if (resolved.source === 'unmapped') {
        companiesUnmappedSector += 1;
        companyChanges.push({
          ticker: tk,
          companyId: c.id,
          action: 'flag_unmapped_sector',
          currentSector: rawSector || c.sectorId || null,
          proposedSector: null,
          proposedSectorId: null,
          proposedClassification: 'unknown',
          reasonAr:
            resolved.reasonAr ||
            `القطاع "${rawSector || c.sectorId}" غير مسجل في sectorPE؛ أنشئ القطاع إدارياً أو اربط الشركة بقطاع نشط.`,
        });
      } else if (
        resolved.sectorId &&
        (c.sectorId !== resolved.sectorId ||
          (resolved.canonicalNameAr && c.sector !== resolved.canonicalNameAr) ||
          c.sectorClassification !== resolved.classification)
      ) {
        companyChanges.push({
          ticker: tk,
          companyId: c.id,
          action: 'normalize_sector_id',
          currentSector: rawSector,
          proposedSector: resolved.canonicalNameAr ?? rawSector,
          proposedSectorId: resolved.sectorId,
          proposedClassification: resolved.classification,
          reasonAr: `توحيد قطاع الشركة "${rawSector}" مع تعريف sectorPE الرسمي (${resolved.sectorId} / ${resolved.classification}).`,
        });
      }
    }

    for (const mapping of LEGACY_COMPANY_PARAM_MAPPINGS) {
      const legacyVal = c[mapping.field];
      if (typeof legacyVal !== 'number' || !Number.isFinite(legacyVal)) continue;

      const authVal =
        mapping.targetCollection === 'beta_assumptions'
          ? betaIndex.get(tk) ?? null
          : overridesIndex.get(`${tk}::${mapping.targetKey}`) ?? null;

      let status: MigrationLegacyParameterItem['status'];
      let reasonAr: string;
      if (authVal === null) {
        status = 'ready_to_migrate';
        legacyParamsReadyToMigrate += 1;
        reasonAr = `حقل قديم companies.${mapping.field} (${legacyVal}) جاهز للترحيل إلى ${mapping.targetCollection}/${tk}${
          mapping.targetCollection === 'company_assumptions' ? `/parameters/${mapping.targetKey}` : ''
        } وتصفير الحقل القديم.`;
      } else if (Math.abs(authVal - legacyVal) <= 1e-9) {
        status = 'already_migrated_equal';
        legacyParamsAlreadyMigrated += 1;
        reasonAr = `القيمة القديمة (${legacyVal}) مطابقة للسجل المعتمد في ${mapping.targetCollection}؛ يمكن مسح الحقل القديم بأمان.`;
      } else {
        status = 'conflict_different_value';
        legacyParamsConflicts += 1;
        reasonAr = `تعارض قيم: الحقل القديم companies.${mapping.field}=${legacyVal} يختلف عن السجل المعتمد (${authVal}) في ${mapping.targetCollection}؛ السجل المعتمد هو الفعّال ويلزم مراجعة تنظيف الحقل القديم.`;
      }

      legacyParameterMigrations.push({
        ticker: tk,
        companyId: c.id,
        legacyField: mapping.field,
        legacyValue: legacyVal,
        targetCollection: mapping.targetCollection,
        targetKey: mapping.targetKey,
        authoritativeValue: authVal,
        status,
        reasonAr,
      });
    }
  }

  const betaDefaultParam = (params.macroParams ?? []).find((p) => p.key === 'Beta_Default');
  const betaDefaultAudit: BetaDefaultAuditItem = !betaDefaultParam
    ? {
        present: false,
        value: null,
        status: 'missing_ok',
        reasonAr: 'لا يوجد تعارض في Beta_Default داخل macro_params؛ المنصة تطبق 1.00 عند تأكيد غياب سجل السهم.',
      }
    : Math.abs(betaDefaultParam.value - 1) <= 1e-9
    ? {
        present: true,
        value: betaDefaultParam.value,
        status: 'compliant_one',
        reasonAr: 'المعامل Beta_Default في macro_params مطابق للسياسة المعتمدة (1.00).',
      }
    : {
        present: true,
        value: betaDefaultParam.value,
        status: 'conflict_non_one',
        reasonAr: `تعارض سياسة: Beta_Default في macro_params محفوظ بقيمة (${betaDefaultParam.value}) وتخالف القيمة المعتمدة (1.00)؛ يُرجى تصحيحه إلى 1 أو حذفه من الإدارة.`,
      };

  const sectorPeChanges: MigrationSectorPeChange[] = [];
  let sectorPeRichDocsCount = 0;
  let sectorPeLegacyFormatCount = 0;
  let sectorPeDisabledCount = 0;
  let sectorPeNullMultipleCount = 0;
  let sectorPeUnmappedKeys = 0;

  // Detect duplicate normalized tokens / alias collisions across active sectorPE docs
  const tokenOwners = new Map<string, string[]>();
  for (const def of effectiveSectorDefs) {
    if (def.isDeleted === true || def.status === 'disabled') continue;
    const tokens = [def.sectorId, def.nameAr, ...def.aliases]
      .map((t) => normalizeSectorToken(t))
      .filter(Boolean);
    for (const tok of new Set(tokens)) {
      const owners = tokenOwners.get(tok) || [];
      owners.push(def.sectorId);
      tokenOwners.set(tok, owners);
    }
  }

  for (const def of effectiveSectorDefs) {
    if (def.isDeleted === true) continue;
    const tokens = [def.sectorId, def.nameAr, ...def.aliases]
      .map((t) => normalizeSectorToken(t))
      .filter(Boolean);
    const collidingOwners = Array.from(
      new Set(
        tokens.flatMap((tok) => {
          const owners = tokenOwners.get(tok) || [];
          return owners.length > 1 ? owners : [];
        })
      )
    );

    if (collidingOwners.length > 1) {
      sectorPeChanges.push({
        currentKey: def.legacyDocId ?? def.sectorId,
        multiple: def.multiple,
        proposedCanonicalKey: def.nameAr,
        proposedSectorId: def.sectorId,
        status: 'duplicate_alias_conflict',
        reasonAr: `ازدواجية أو تشابه مرادفات بين "${def.nameAr}" (${def.sectorId}) وقطاعات أخرى (${collidingOwners.filter((id) => id !== def.sectorId).join('، ')}) في sectorPE.`,
      });
    } else if (def.status === 'disabled') {
      sectorPeDisabledCount += 1;
      sectorPeChanges.push({
        currentKey: def.legacyDocId ?? def.sectorId,
        multiple: def.multiple,
        proposedCanonicalKey: def.nameAr,
        proposedSectorId: def.sectorId,
        status: 'disabled_sector',
        reasonAr: `القطاع "${def.nameAr}" (${def.sectorId}) معطّل (disabled) ولا يدخل في قوائم الاختيار النشطة.`,
      });
    } else if (def.isLegacyFormat) {
      sectorPeLegacyFormatCount += 1;
      const suggestedId = suggestSectorId(def.nameAr || def.sectorId) || def.sectorId;
      sectorPeChanges.push({
        currentKey: def.legacyDocId ?? def.sectorId,
        multiple: def.multiple,
        proposedCanonicalKey: def.nameAr,
        proposedSectorId: suggestedId,
        status: 'legacy_value_doc',
        reasonAr: `مستند sectorPE بصيغة قديمة ({ value: ${def.multiple ?? 'null'} }) ينقصه classification/status/aliases؛ يُقترح ترقيته إلى تعريف غني وتحديد التصنيف (مالي/غير مالي).`,
      });
    } else if (def.multiple === null) {
      sectorPeNullMultipleCount += 1;
      sectorPeRichDocsCount += 1;
      sectorPeChanges.push({
        currentKey: def.sectorId,
        multiple: null,
        proposedCanonicalKey: def.nameAr,
        proposedSectorId: def.sectorId,
        status: 'null_multiple',
        reasonAr: `القطاع "${def.nameAr}" (${def.sectorId}) معرف بنجاح ولكن مضاعف الربحية null؛ التقييم النسبي بـ Target_PE ينتظر إدخال مضاعف القطاع أو تخصيص الشركة.`,
      });
    } else {
      sectorPeRichDocsCount += 1;
      sectorPeChanges.push({
        currentKey: def.sectorId,
        multiple: def.multiple,
        proposedCanonicalKey: def.nameAr,
        proposedSectorId: def.sectorId,
        status: 'already_canonical',
        reasonAr: `تعريف قطاع رسمي مكتمل (${def.sectorId} / ${def.classification} / ${def.multiple}x).`,
      });
    }
  }

  for (const item of companyChanges) {
    if (item.action === 'flag_unmapped_sector') {
      sectorPeUnmappedKeys += 1;
    }
  }

  const legacyMillionUnitRecordsCount = params.quarterlyRecords.filter(
    (q) => q.financialUnit === 'EGP_millions' || q.financialUnit === 'USD_millions'
  ).length;

  const reportedEpsPeriodAudit: LegacyReportedEpsAuditItem[] = [];
  let reportedEpsStructuredValidCount = 0;
  let reportedEpsUnambiguousConvertibleCount = 0;
  let reportedEpsNeedsReviewCount = 0;
  for (const q of params.quarterlyRecords) {
    const audited = auditLegacyReportedEpsRecord(q);
    if (audited.status === 'no_reported_eps') continue;
    reportedEpsPeriodAudit.push(audited);
    if (audited.status === 'structured_valid') reportedEpsStructuredValidCount += 1;
    else if (audited.status === 'unambiguous_convertible') reportedEpsUnambiguousConvertibleCount += 1;
    else if (audited.status === 'needs_review') reportedEpsNeedsReviewCount += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    dryRunOnly: true,
    companyChanges,
    sectorPeChanges,
    legacyParameterMigrations,
    betaDefaultAudit,
    excludedNonEquityTickers,
    reportedEpsPeriodAudit,
    legacyMillionUnitRecordsCount,
    conflicts: params.conflicts ?? [],
    summaryCounts: {
      companiesPlaceholderSector,
      companiesEnrichableFromDaily,
      companiesUnmappedSector,
      companiesAmbiguousSector,
      companiesDisabledSector,
      sectorPeRichDocsCount,
      sectorPeLegacyFormatCount,
      sectorPeDisabledCount,
      sectorPeNullMultipleCount,
      sectorPeUnmappedKeys,
      excludedNonEquityCount: excludedNonEquityTickers.length,
      legacyMillionUnitRecordsCount,
      legacyParamsReadyToMigrate,
      legacyParamsAlreadyMigrated,
      legacyParamsConflicts,
      betaDefaultConflict: betaDefaultAudit.status === 'conflict_non_one',
      reportedEpsStructuredValidCount,
      reportedEpsUnambiguousConvertibleCount,
      reportedEpsNeedsReviewCount,
    },
  };
}

export function formatLegacyMigrationDryRunReport(report: LegacyMigrationReport): string {
  const s = report.summaryCounts;
  const lines: string[] = [
    '============================================================',
    'MizanEX — تقرير معاينة ترحيل وتدقيق البيانات (Dry-Run Only)',
    `تاريخ التقرير: ${report.generatedAt}`,
    'تنبيه: هذا الفحص للقراءة فقط ولا يجري أي كتابة أو حذف على Firestore.',
    '============================================================',
    `1. مجموعة sectorPE الرسمية:`,
    `   - قطاعات غنية مكتملة: ${s.sectorPeRichDocsCount}`,
    `   - مستندات صيغة قديمة ({ value } فقط): ${s.sectorPeLegacyFormatCount}`,
    `   - قطاعات معطلة (disabled): ${s.sectorPeDisabledCount}`,
    `   - قطاعات بدون مضاعف (multiple=null): ${s.sectorPeNullMultipleCount}`,
    `2. ربط قطاعات الشركات بـ sectorPE:`,
    `   - شركات بقطاع قابل للاستكمال من التداول اليومي: ${s.companiesEnrichableFromDaily}`,
    `   - شركات بقطاع غير معرف في sectorPE: ${s.companiesUnmappedSector}`,
    `   - شركات بتطابق قطاع غامض: ${s.companiesAmbiguousSector}`,
    `   - شركات مرتبطة بقطاع معطل: ${s.companiesDisabledSector}`,
    `3. حقول معاملات قديمة على مستندات companies:`,
    `   - جاهزة للترحيل: ${s.legacyParamsReadyToMigrate} | مطابقة: ${s.legacyParamsAlreadyMigrated} | متضاربة: ${s.legacyParamsConflicts}`,
    `   - تعارض Beta_Default != 1: ${s.betaDefaultConflict ? 'نعم' : 'لا'}`,
    `4. أدوات غير أسهم عادية مستبعدة: ${s.excludedNonEquityCount}`,
    `5. سجلات فصلية بوحدة الملايين القديمة: ${s.legacyMillionUnitRecordsCount}`,
    `6. مراجعة فترات ReportedEPS القديمة (Dry-Run بدون تعديل):`,
    `   - معرّفة بنيوياً وصالحة: ${s.reportedEpsStructuredValidCount}`,
    `   - قابلة للتحويل غير الغامض مع تواريخ موثقة: ${s.reportedEpsUnambiguousConvertibleCount}`,
    `   - غامضة أو ناقصة التواريخ وتحتاج مراجعة يدوية: ${s.reportedEpsNeedsReviewCount}`,
  ];

  if (report.sectorPeChanges.length > 0) {
    lines.push('', '--- تفاصيل فحص sectorPE ---');
    for (const item of report.sectorPeChanges) {
      lines.push(`• [${item.status}] ${item.currentKey} (${item.multiple ?? 'null'}) -> ${item.reasonAr}`);
    }
  }

  if (report.companyChanges.length > 0) {
    lines.push('', '--- تفاصيل تغييرات الشركات المقترحة ---');
    for (const c of report.companyChanges) {
      lines.push(`• [${c.action}] ${c.ticker}: ${c.reasonAr}`);
    }
  }

  if (report.legacyParameterMigrations.length > 0) {
    lines.push('', '--- تفاصيل المعاملات القديمة على companies ---');
    for (const p of report.legacyParameterMigrations) {
      lines.push(`• [${p.status}] ${p.ticker}.${p.legacyField} -> ${p.reasonAr}`);
    }
  }

  const epsActionable = report.reportedEpsPeriodAudit.filter((item) => item.status !== 'structured_valid');
  if (epsActionable.length > 0) {
    lines.push('', '--- تفاصيل مراجعة فترات ReportedEPS القديمة (تحتاج مراجعة أو تحويل موثق) ---');
    for (const item of epsActionable) {
      lines.push(
        `• [${item.status}] ${item.ticker} ${item.yearQuarter} (ReportedEPS=${item.reportedEps ?? 'BLANK'} | legacy="${item.legacyReportedEpsPeriod ?? 'BLANK'}") -> ${item.reasonAr}${
          item.remediationAr ? ` | الإجراء: ${item.remediationAr}` : ''
        }`
      );
    }
  }

  return lines.join('\n');
}

