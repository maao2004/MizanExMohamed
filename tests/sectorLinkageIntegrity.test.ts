import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStockAndQuarterAtomicWrite,
  classifyCompanySectorLinkage,
  companyMatchesSectorDefinition,
  executeDeleteSectorGovernance,
  executeToggleSectorStatusGovernance,
  executeUpsertSectorGovernance,
  matchSectorFromRegistry,
  resolveSectorPeFromRegistry,
  resolveUnifiedSector,
  sanitizeSectorId,
  SectorGovernanceConflictError,
  validateAndCanonicalizeCompanySectorWrite,
  type CompanyDocEntry,
  type SectorDefinition,
  type SectorDocEntry,
  type SectorMutationPort,
  type SectorMutationTxContext,
} from '../src/core/contracts';
import { deriveSecurityIdentityAndMetadata } from '../src/core/domain/securityIdentity';
import { deriveStockUniverseDiagnostics } from '../src/core/domain/stockDerived';
import { analyzeLegacyMigration } from '../src/core/domain/legacyMigrationTool';
import type { Company, DailyTradingRecord, QuarterlyFinancialRecord } from '../src/types';

const STAMP = {
  updatedAt: '2026-05-01T12:00:00.000Z',
  updatedBy: 'admin-integrity-test',
};

function makeIndexedInMemorySectorPort(seed: {
  sectors?: SectorDocEntry[];
  companies?: CompanyDocEntry[];
  onBeforeTx?: (txNumber: number) => void;
}) {
  const sectors = new Map<string, Record<string, any>>();
  const companies = new Map<string, Record<string, any>>();
  const tombstones: string[] = [];
  let txCount = 0;
  let fullCompanyScans = 0;
  let indexedSectorQueries = 0;
  let legacyProjectionQueries = 0;
  let pointCompanyReads = 0;

  for (const s of seed.sectors ?? []) {
    sectors.set(s.id, { ...s.data });
  }
  for (const c of seed.companies ?? []) {
    companies.set(c.id, { ...c.data });
  }

  const snapshotSectors = (): SectorDocEntry[] =>
    Array.from(sectors.entries()).map(([id, data]) => ({ id, data: { ...data } }));
  const snapshotCompanies = (): CompanyDocEntry[] =>
    Array.from(companies.entries()).map(([id, data]) => ({ id, data: { ...data } }));
  const queryBySectorId = (sectorId: string, limit?: number): CompanyDocEntry[] => {
    indexedSectorQueries += 1;
    const matched = Array.from(companies.entries())
      .filter(([, data]) => data.sectorId === sectorId)
      .map(([id, data]) => ({ id, data: { ...data } }));
    return typeof limit === 'number' && limit > 0 ? matched.slice(0, limit) : matched;
  };
  const queryLegacyWithoutSectorId = (): CompanyDocEntry[] => {
    legacyProjectionQueries += 1;
    return Array.from(companies.entries())
      .filter(([, data]) => !sanitizeSectorId(data.sectorId ?? ''))
      .map(([id, data]) => ({
        id,
        data: {
          sectorId: data.sectorId ?? null,
          sector: data.sector ?? null,
          rawSector: data.rawSector ?? null,
          isDeleted: data.isDeleted ?? false,
          ticker: data.ticker ?? null,
        },
      }));
  };

  const port: SectorMutationPort = {
    async listAllSectors() {
      return snapshotSectors();
    },
    async listAllCompanies() {
      fullCompanyScans += 1;
      return snapshotCompanies();
    },
    async queryCompaniesBySectorId(sectorId, limit) {
      return queryBySectorId(sectorId, limit);
    },
    async listLegacyCompaniesWithoutSectorId() {
      return queryLegacyWithoutSectorId();
    },
    async runTransaction<T>(fn: (tx: SectorMutationTxContext) => Promise<T>): Promise<T> {
      txCount += 1;
      seed.onBeforeTx?.(txCount);

      const pendingSectorSets: Array<{ id: string; payload: Record<string, any>; merge: boolean }> = [];
      const pendingSectorDeletes: string[] = [];
      const pendingCompanySets: Array<{ id: string; payload: Record<string, any>; merge: boolean }> = [];
      const pendingTombstones: string[] = [];

      const tx: SectorMutationTxContext = {
        async getAllSectors() {
          return snapshotSectors();
        },
        async getAllCompanies() {
          fullCompanyScans += 1;
          return snapshotCompanies();
        },
        async getSectorDoc(sectorId) {
          const found = sectors.get(sectorId);
          return found ? { ...found } : undefined;
        },
        async getCompanyDoc(companyId) {
          pointCompanyReads += 1;
          const found = companies.get(companyId);
          return found ? { ...found } : undefined;
        },
        async queryCompaniesBySectorId(sectorId, limit) {
          return queryBySectorId(sectorId, limit);
        },
        async listLegacyCompaniesWithoutSectorId() {
          return queryLegacyWithoutSectorId();
        },
        setSectorDoc(sectorId, payload, merge) {
          pendingSectorSets.push({ id: sectorId, payload: { ...payload }, merge });
        },
        deleteSectorDoc(sectorId) {
          pendingSectorDeletes.push(sectorId);
        },
        setCompanyDoc(companyId, payload, merge) {
          pendingCompanySets.push({ id: companyId, payload: { ...payload }, merge });
        },
        writeSectorTombstone(sectorId) {
          pendingTombstones.push(sectorId);
        },
      };

      const result = await fn(tx);
      for (const s of pendingSectorSets) {
        sectors.set(s.id, s.merge ? { ...(sectors.get(s.id) ?? {}), ...s.payload } : s.payload);
      }
      for (const id of pendingSectorDeletes) {
        sectors.delete(id);
      }
      for (const c of pendingCompanySets) {
        companies.set(c.id, c.merge ? { ...(companies.get(c.id) ?? {}), ...c.payload } : c.payload);
      }
      tombstones.push(...pendingTombstones);
      return result;
    },
    async commitBatch() {
      throw new Error('Hardened multi-batch must execute bounded transactions, never blind commitBatch.');
    },
  };

  return {
    port,
    sectors,
    companies,
    tombstones,
    getMetrics: () => ({
      txCount,
      fullCompanyScans,
      indexedSectorQueries,
      legacyProjectionQueries,
      pointCompanyReads,
    }),
  };
}

function makeSampleQuarter(ticker = 'COMI'): QuarterlyFinancialRecord {
  return {
    ticker,
    stockName: 'شركة اختبارية',
    yearQuarter: '2025FY',
    year: 2025,
    quarter: 'FY',
    shares: 100_000_000,
    intangibleAssets: null,
    totalAssets: 5_000_000_000,
    equity: 2_000_000_000,
    totalDebtWithoutTX: 500_000_000,
    totalLiabilities: 3_000_000_000,
    revenueYTD: 3_000_000_000,
    grossProfitYTD: 1_000_000_000,
    ebitYTD: 700_000_000,
    pbtYTD: 600_000_000,
    netIncomeYTD: 450_000_000,
    ocfYTD: 500_000_000,
    netInvestingCfYTD: -100_000_000,
    dividendsPaidYTD: 100_000_000,
    cash: 300_000_000,
    interestExpenseYTD: 50_000_000,
    financeCostsYTD: 50_000_000,
    interestIncomeYTD: 10_000_000,
    taxExpenseYTD: 150_000_000,
    interestPaidYTD: 45_000_000,
    capexYTD: 120_000_000,
    dateInsertData: '2026-03-01',
    updatedAt: '2026-03-01T10:00:00.000Z',
  };
}

function makeSampleDaily(ticker: string, sector: string): DailyTradingRecord {
  return {
    ticker,
    shortName: ticker,
    tradeDate: '2026-04-20',
    lastPrice: 50,
    changePct: 0,
    tradesCount: 100,
    openPrice: 49,
    closePrice: 50,
    turnoverValue: 500_000,
    netLiquidity: null,
    volume: 10_000,
    avgVolume5D: null,
    avgVolume30D: null,
    avgVolume90D: null,
    lowPrice: 49,
    highPrice: 51,
    sector,
    totalBids: null,
    bidsCount: null,
    offersCount: null,
    totalOffers: null,
    avgVolume: null,
    high52W: null,
    low52W: null,
    prevClose: 49,
    marketCapThousands: null,
    vwap: null,
    peRatio: null,
    listedShares: 100_000_000,
    isinCode: 'EGS3C251C013',
    inflowOrders: null,
    inflowVolume: null,
    inflowLiquidity: null,
    askTrades: null,
    askTradesVolume: null,
    outflowLiquidity: null,
    fullName: `شركة ${ticker}`,
    market: 'EGX',
    volChange5DPct: null,
    volChange30DPct: null,
    volChange90DPct: null,
    updatedAt: '2026-04-20T15:00:00.000Z',
  };
}

describe('Sector Linkage Integrity — Authoritative SSOT Resolution (Scenarios 1–4)', () => {
  const sectorDefs: SectorDefinition[] = [
    {
      sectorId: 'old_cement',
      nameAr: 'أسمنت قديم',
      aliases: ['مواد بناء قديمة'],
      classification: 'non_financial',
      multiple: 8.5,
      status: 'active',
    },
    {
      sectorId: 'new_industrial',
      nameAr: 'صناعات حديثة',
      aliases: ['صناعة'],
      classification: 'non_financial',
      multiple: 12.0,
      status: 'active',
    },
    {
      sectorId: 'banks',
      nameAr: 'البنوك',
      aliases: ['بنوك'],
      classification: 'financial',
      multiple: 6.5,
      status: 'active',
    },
    {
      sectorId: 'ambig_a',
      nameAr: 'خدمات مالية أ',
      aliases: ['تمويل مشترك'],
      classification: 'financial',
      multiple: 9.0,
      status: 'active',
    },
    {
      sectorId: 'ambig_b',
      nameAr: 'خدمات مالية ب',
      aliases: ['تمويل مشترك'],
      classification: 'financial',
      multiple: 10.0,
      status: 'active',
    },
  ];

  it('Scenario 1 & 2: Explicit sectorId is strictly authoritative — never counted in old sector or double-linked via rawSector / daily text, and broken sectorId never falls back to text', () => {
    const reassignedCompany: Company = {
      id: 'arcc',
      ticker: 'ARCC',
      nameAr: 'العربية للأسمنت',
      nameEn: 'Arabian Cement',
      sectorId: 'new_industrial',
      sector: 'صناعات حديثة',
      rawSector: 'أسمنت قديم', // Old rawSector preserved for audit
      sectorClassification: 'non_financial',
      sectorSource: 'sector_registry_reassign',
      sectorDate: '2026-04-10',
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

    // Must match ONLY new_industrial, NEVER old_cement
    assert.equal(
      companyMatchesSectorDefinition(reassignedCompany, 'old_cement', sectorDefs[0], sectorDefs),
      false,
      'Company with explicit sectorId=new_industrial must NOT match old_cement via old rawSector'
    );
    assert.equal(
      companyMatchesSectorDefinition(reassignedCompany, 'new_industrial', sectorDefs[1], sectorDefs),
      true
    );

    const matchedSectorIds = sectorDefs
      .filter((def) => companyMatchesSectorDefinition(reassignedCompany, def.sectorId, def, sectorDefs))
      .map((d) => d.sectorId);
    assert.deepEqual(matchedSectorIds, ['new_industrial'], 'Company with explicit sectorId must link to EXACTLY one sector');

    // Sector P/E lookup must NOT trigger a false conflict due to old rawSector
    const peRes = resolveSectorPeFromRegistry({
      sectorDefinitions: sectorDefs,
      resolvedSectorId: 'new_industrial',
      rawSector: 'أسمنت قديم',
    });
    assert.equal(peRes.conflictDetected, false);
    assert.equal(peRes.matchedSectorId, 'new_industrial');
    assert.equal(peRes.multiple, 12.0);

    // Security identity preserves explicit sectorId even with newer daily trading text pointing to old_cement,
    // while keeping rawSector preserved and surfacing an explicit audit conflict
    const identity = deriveSecurityIdentityAndMetadata({
      ticker: 'ARCC',
      meta: reassignedCompany,
      quarterlyRecords: [makeSampleQuarter('ARCC')],
      dailyHistory: [makeSampleDaily('ARCC', 'أسمنت قديم')],
      sectorDefinitions: sectorDefs,
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
    });
    assert.equal(identity.sectorId, 'new_industrial');
    assert.equal(identity.sector, 'صناعات حديثة');
    assert.equal(identity.rawSector, 'أسمنت قديم', 'rawSector must remain preserved for audit');
    assert.ok(
      identity.conflicts.some((c) => c.field === 'sector'),
      'Discrepancy between authoritative sectorId and daily trading sector text must be surfaced for audit'
    );

    // Broken / deleted explicit sectorId must NEVER silently fall back to rawSector text
    const brokenCompany: Company = {
      ...reassignedCompany,
      id: 'brkn',
      ticker: 'BRKN',
      sectorId: 'deleted_sector_999',
      sector: 'أسمنت قديم',
      rawSector: 'أسمنت قديم',
    };
    const brokenMatch = matchSectorFromRegistry({
      sectorId: brokenCompany.sectorId,
      rawSector: brokenCompany.rawSector,
      sectorDefinitions: sectorDefs,
    });
    assert.equal(brokenMatch.status, 'unmapped');
    assert.equal(brokenMatch.sector, null);

    const brokenClass = classifyCompanySectorLinkage(brokenCompany, sectorDefs);
    assert.equal(brokenClass.kind, 'explicit_broken_ref');
    assert.equal(brokenClass.matchedSectorId, null);

    const brokenUnified = resolveUnifiedSector(brokenCompany.rawSector, null, {
      sectorId: brokenCompany.sectorId,
      sectorDefinitions: sectorDefs,
    });
    assert.equal(brokenUnified.source, 'unmapped');
    assert.equal(brokenUnified.classification, 'unknown');
    assert.equal(
      companyMatchesSectorDefinition(brokenCompany, 'old_cement', sectorDefs[0], sectorDefs),
      false
    );

    const migReport = analyzeLegacyMigration({
      companies: [brokenCompany],
      sectorDefinitions: sectorDefs,
      sectorPEMap: {},
      quarterlyRecords: [],
      dailyRecords: [makeSampleDaily('BRKN', 'أسمنت قديم')],
      conflicts: [],
    });
    assert.equal(migReport.summaryCounts.companiesUnmappedSector, 1);
    assert.equal(migReport.companyChanges[0].action, 'flag_unmapped_sector');
  });

  it('Scenario 3: Reassignment followed by re-running does NOT move the company again even when rawSector retains old sector name', async () => {
    const env = makeIndexedInMemorySectorPort({
      sectors: [
        { id: 'old_cement', data: sectorDefs[0] },
        { id: 'new_industrial', data: sectorDefs[1] },
      ],
      companies: [
        {
          id: 'arcc',
          data: {
            ticker: 'ARCC',
            sectorId: 'old_cement',
            sector: 'أسمنت قديم',
            rawSector: 'أسمنت قديم',
            sectorClassification: 'non_financial',
          },
        },
      ],
    });

    // Run 1: Disable old_cement and reassign to new_industrial
    const r1 = (
      await executeToggleSectorStatusGovernance(env.port, {
        rawPayload: {
          sectorId: 'old_cement',
          status: 'disabled',
          reassignToSectorId: 'new_industrial',
        },
        stamp: STAMP,
      })
    ).report;
    assert.equal(r1.completed, true);
    assert.equal(r1.reassignedCount, 1);
    assert.equal(env.companies.get('arcc')?.sectorId, 'new_industrial');
    assert.equal(env.companies.get('arcc')?.rawSector, 'أسمنت قديم', 'rawSector preserved untouched');

    // Run 2: Delete old_cement WITHOUT reassignToSectorId -> MUST succeed with 0 linked companies (NOT re-include arcc!)
    const r2 = (
      await executeDeleteSectorGovernance(env.port, {
        rawPayload: { sectorId: 'old_cement' },
        stamp: STAMP,
      })
    ).report;
    assert.equal(r2.completed, true);
    assert.equal(r2.linkedCompaniesCount, 0);
    assert.equal(r2.reassignedCount, 0);
    assert.equal(env.sectors.has('old_cement'), false);
    assert.equal(env.companies.get('arcc')?.sectorId, 'new_industrial');
  });

  it('Scenario 4: Legacy record without sectorId matches ONLY unambiguous text; ambiguous text is NEVER linked or reassigned', async () => {
    const unambiguousLegacy = {
      ticker: 'LEG1',
      sectorId: null,
      sector: 'مواد بناء قديمة',
      rawSector: 'مواد بناء قديمة',
    };
    const ambiguousLegacy = {
      ticker: 'LEG2',
      sectorId: null,
      sector: 'تمويل مشترك', // Alias shared by ambig_a and ambig_b
      rawSector: 'تمويل مشترك',
    };

    const clsUnambig = classifyCompanySectorLinkage(unambiguousLegacy, sectorDefs);
    assert.equal(clsUnambig.kind, 'legacy_text_unambiguous');
    assert.equal(clsUnambig.matchedSectorId, 'old_cement');
    assert.equal(
      companyMatchesSectorDefinition(unambiguousLegacy, 'old_cement', sectorDefs[0], sectorDefs),
      true
    );

    const clsAmbig = classifyCompanySectorLinkage(ambiguousLegacy, sectorDefs);
    assert.equal(clsAmbig.kind, 'legacy_text_ambiguous');
    assert.equal(clsAmbig.matchedSectorId, null);
    assert.deepEqual(clsAmbig.ambiguousSectorIds.sort(), ['ambig_a', 'ambig_b']);
    assert.equal(
      companyMatchesSectorDefinition(ambiguousLegacy, 'ambig_a', sectorDefs[3], sectorDefs),
      false
    );
    assert.equal(
      companyMatchesSectorDefinition(ambiguousLegacy, 'ambig_b', sectorDefs[4], sectorDefs),
      false
    );

    // Server governance deleting ambig_a must NOT silently claim or reassign the ambiguous legacy company
    const env = makeIndexedInMemorySectorPort({
      sectors: sectorDefs.map((d) => ({ id: d.sectorId, data: d })),
      companies: [
        { id: 'leg1', data: unambiguousLegacy },
        { id: 'leg2', data: ambiguousLegacy },
      ],
    });
    const delAmbig = (
      await executeDeleteSectorGovernance(env.port, {
        rawPayload: { sectorId: 'ambig_a', reassignToSectorId: 'banks' },
        stamp: STAMP,
      })
    ).report;
    assert.equal(delAmbig.linkedCompaniesCount, 0);
    assert.equal(delAmbig.reassignedCount, 0);
    assert.equal(env.companies.get('leg2')?.sectorId, null, 'Ambiguous legacy company must NOT be silently reassigned');
  });
});

describe('Sector Linkage Integrity — Server Referential Integrity Across All Write Paths (Scenarios 5–7)', () => {
  const sectorStore = new Map<string, Record<string, any>>([
    [
      'banks',
      {
        sectorId: 'banks',
        nameAr: 'البنوك',
        aliases: ['بنوك'],
        classification: 'financial',
        multiple: 6.5,
        status: 'active',
        isDeleted: false,
      },
    ],
    [
      'industrial_null_pe',
      {
        sectorId: 'industrial_null_pe',
        nameAr: 'الصناعات الهندسية',
        aliases: [],
        classification: 'non_financial',
        multiple: null,
        status: 'active',
        isDeleted: false,
      },
    ],
    [
      'disabled_sec',
      {
        sectorId: 'disabled_sec',
        nameAr: 'قطاع معطل',
        aliases: [],
        classification: 'non_financial',
        multiple: 10,
        status: 'disabled',
        isDeleted: false,
      },
    ],
    [
      'deleted_flag_sec',
      {
        sectorId: 'deleted_flag_sec',
        nameAr: 'قطاع محذوف منطقياً',
        aliases: [],
        classification: 'non_financial',
        multiple: 10,
        status: 'active',
        isDeleted: true,
      },
    ],
    [
      'deleting_sec',
      {
        sectorId: 'deleting_sec',
        nameAr: 'قطاع قيد الحذف',
        aliases: [],
        classification: 'non_financial',
        multiple: 10,
        status: 'active',
        pendingDelete: true,
        pendingDeleteOperationId: 'op_del_1',
        pendingDeleteTargetSectorId: 'industrial_null_pe',
        isDeleted: false,
      },
    ],
  ]);

  const getSectorDoc = async (sectorId: string) => sectorStore.get(sectorId);

  it('Scenario 5: Rejects new assignments to missing, deleted, disabled, or pendingDelete sectors; rejects classification spoofing; allows active sector with multiple: null', async () => {
    // Missing sector
    await assert.rejects(
      () =>
        validateAndCanonicalizeCompanySectorWrite({
          existingCompanyData: undefined,
          incomingPatch: { sectorId: 'non_existent' },
          getSectorDoc,
          isCreate: true,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // Logically deleted sector
    await assert.rejects(
      () =>
        validateAndCanonicalizeCompanySectorWrite({
          existingCompanyData: undefined,
          incomingPatch: { sectorId: 'deleted_flag_sec' },
          getSectorDoc,
          isCreate: true,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // Disabled sector
    await assert.rejects(
      () =>
        validateAndCanonicalizeCompanySectorWrite({
          existingCompanyData: undefined,
          incomingPatch: { sectorId: 'disabled_sec' },
          getSectorDoc,
          isCreate: true,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // Sector currently pendingDelete
    await assert.rejects(
      () =>
        validateAndCanonicalizeCompanySectorWrite({
          existingCompanyData: undefined,
          incomingPatch: { sectorId: 'deleting_sec' },
          getSectorDoc,
          isCreate: true,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // Spoofing bank classification to non_financial to bypass FCFF/WACC ineligibility MUST be rejected
    await assert.rejects(
      () =>
        validateAndCanonicalizeCompanySectorWrite({
          existingCompanyData: undefined,
          incomingPatch: {
            sectorId: 'banks',
            sector: 'قطاع مزيف',
            sectorClassification: 'non_financial',
          },
          getSectorDoc,
          isCreate: true,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // Active sector with multiple: null IS valid and derives canonical nameAr & classification from sectorPE
    const ok = await validateAndCanonicalizeCompanySectorWrite({
      existingCompanyData: undefined,
      incomingPatch: {
        sectorId: 'industrial_null_pe',
        sector: 'اسم عشوائي من العميل', // Must be replaced by authoritative sectorPE nameAr
      },
      getSectorDoc,
      isCreate: true,
    });
    assert.equal(ok.canonicalPatch.sectorId, 'industrial_null_pe');
    assert.equal(ok.canonicalPatch.sector, 'الصناعات الهندسية');
    assert.equal(ok.canonicalPatch.sectorClassification, 'non_financial');

    // Same guard enforced inside applyStockAndQuarterAtomicWrite (atomic quarter + company metadata write)
    const docs = new Map<string, Record<string, any>>();
    for (const [k, v] of sectorStore.entries()) docs.set(`sectorPE/${k}`, v);
    const txTarget = {
      async getDoc(col: string, docId: string) {
        return docs.get(`${col}/${docId}`);
      },
      setDoc(col: string, docId: string, data: Record<string, any>, merge: boolean) {
        const key = `${col}/${docId}`;
        docs.set(key, merge ? { ...(docs.get(key) ?? {}), ...data } : data);
      },
    };
    await assert.rejects(
      () =>
        applyStockAndQuarterAtomicWrite(txTarget, {
          record: makeSampleQuarter('NEWCO'),
          companyMetadata: { id: 'newco', ticker: 'NEWCO', sectorId: 'disabled_sec' },
          stamp: STAMP,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );
    assert.equal(docs.has('companies/newco'), false);
    assert.equal(docs.has('quarterly_financial_records/NEWCO_2025_FY'), false);
  });

  it('Scenario 6: Independent financial/metadata edits on a company already linked to a disabled sector ARE allowed without changing its sector', async () => {
    const existingCompany = {
      id: 'oldco',
      ticker: 'OLDCO',
      nameAr: 'شركة قديمة',
      sectorId: 'disabled_sec',
      sector: 'قطاع معطل',
      rawSector: 'قطاع معطل',
      sectorClassification: 'non_financial',
      description: 'وصف قديم',
    };

    // Independent metadata patch (notes/description/policy)
    const resMeta = await validateAndCanonicalizeCompanySectorWrite({
      existingCompanyData: existingCompany,
      incomingPatch: {
        description: 'وصف مالي محدث',
        rimRetentionPolicy: 'historical_retention',
      },
      getSectorDoc,
      isCreate: false,
    });
    assert.equal(resMeta.preservedExistingDisabledSector, true);
    assert.equal(resMeta.canonicalPatch.sectorId, 'disabled_sec');
    assert.equal(resMeta.canonicalPatch.description, 'وصف مالي محدث');

    // Independent quarterly record + company metadata save via applyStockAndQuarterAtomicWrite
    const docs = new Map<string, Record<string, any>>();
    for (const [k, v] of sectorStore.entries()) docs.set(`sectorPE/${k}`, v);
    docs.set('companies/oldco', { ...existingCompany });
    const txTarget = {
      async getDoc(col: string, docId: string) {
        return docs.get(`${col}/${docId}`);
      },
      setDoc(col: string, docId: string, data: Record<string, any>, merge: boolean) {
        const key = `${col}/${docId}`;
        docs.set(key, merge ? { ...(docs.get(key) ?? {}), ...data } : data);
      },
    };

    await applyStockAndQuarterAtomicWrite(txTarget, {
      record: makeSampleQuarter('OLDCO'),
      companyMetadata: { id: 'oldco', ticker: 'OLDCO', description: 'تحديث مع قوائم 2025' },
      stamp: STAMP,
    });
    assert.equal(docs.get('companies/oldco')?.sectorId, 'disabled_sec');
    assert.equal(docs.get('companies/oldco')?.description, 'تحديث مع قوائم 2025');
    assert.ok(docs.has('quarterly_financial_records/OLDCO_2025_FY'));

    // Disabled diagnostic remains visible on the derived sector resolution
    const disabledDiag = resolveUnifiedSector(existingCompany.rawSector, existingCompany.sectorClassification as any, {
      sectorId: existingCompany.sectorId,
      sectorDefinitions: [
        {
          sectorId: 'disabled_sec',
          nameAr: 'قطاع معطل',
          aliases: [],
          classification: 'non_financial',
          multiple: 10,
          status: 'disabled',
        },
      ],
    });
    assert.equal(disabledDiag.source, 'disabled_sector');
    assert.equal(disabledDiag.sectorId, 'disabled_sec');
  });

  it('Scenario 7: Concurrent company assignment vs sector deletion/disabling resolves into a valid state or clean rejection under both orderings and multi-batch pendingDelete lock', async () => {
    const baseSector: SectorDocEntry = {
      id: 'sec_race',
      data: {
        sectorId: 'sec_race',
        nameAr: 'قطاع سباق',
        aliases: [],
        classification: 'non_financial',
        multiple: 11,
        status: 'active',
      },
    };
    const altSector: SectorDocEntry = {
      id: 'sec_safe',
      data: {
        sectorId: 'sec_safe',
        nameAr: 'قطاع آمن',
        aliases: [],
        classification: 'non_financial',
        multiple: 9,
        status: 'active',
      },
    };

    // Ordering A: Sector disable commits first -> concurrent company assignment MUST reject
    const envA = makeIndexedInMemorySectorPort({ sectors: [baseSector] });
    await executeToggleSectorStatusGovernance(envA.port, {
      rawPayload: { sectorId: 'sec_race', status: 'disabled' },
      stamp: STAMP,
    });
    await assert.rejects(
      () =>
        validateAndCanonicalizeCompanySectorWrite({
          existingCompanyData: undefined,
          incomingPatch: { sectorId: 'sec_race' },
          getSectorDoc: async (id) => envA.sectors.get(id),
          isCreate: true,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // Ordering B: Company assignment commits right before delete transaction reads -> delete WITHOUT replacement MUST reject
    let raced = false;
    const envB = makeIndexedInMemorySectorPort({
      sectors: [baseSector],
      companies: [],
      onBeforeTx: () => {
        if (!raced) {
          raced = true;
          envB.companies.set('race_co', {
            ticker: 'RACE',
            sectorId: 'sec_race',
            sector: 'قطاع سباق',
            sectorClassification: 'non_financial',
          });
        }
      },
    });
    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(envB.port, {
          rawPayload: { sectorId: 'sec_race' },
          stamp: STAMP,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );
    assert.ok(envB.sectors.has('sec_race'), 'Sector must remain intact when concurrent company link won');

    // Ordering C: Multi-batch deletion locks sector as pendingDelete on batch 1 -> concurrent assignment during batch 1..N MUST reject
    const envC = makeIndexedInMemorySectorPort({
      sectors: [baseSector, altSector],
      companies: [
        { id: 'c1', data: { ticker: 'C1', sectorId: 'sec_race', sector: 'قطاع سباق' } },
        { id: 'c2', data: { ticker: 'C2', sectorId: 'sec_race', sector: 'قطاع سباق' } },
        { id: 'c3', data: { ticker: 'C3', sectorId: 'sec_race', sector: 'قطاع سباق' } },
      ],
    });
    const b1 = (
      await executeDeleteSectorGovernance(envC.port, {
        rawPayload: { sectorId: 'sec_race', reassignToSectorId: 'sec_safe', batchLimit: 1 },
        stamp: STAMP,
        maxAtomicCompanies: 1,
      })
    ).report;
    assert.equal(b1.completed, false);
    assert.equal(envC.sectors.get('sec_race')?.pendingDelete, true);

    await assert.rejects(
      () =>
        validateAndCanonicalizeCompanySectorWrite({
          existingCompanyData: undefined,
          incomingPatch: { sectorId: 'sec_race' },
          getSectorDoc: async (id) => envC.sectors.get(id),
          isCreate: true,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );
  });
});

describe('Sector Linkage Integrity — Hardened Multi-Batch Reassignment & Deletion (Scenarios 8–10)', () => {
  const mkSectors = (): SectorDocEntry[] => [
    {
      id: 'sec_src',
      data: {
        sectorId: 'sec_src',
        nameAr: 'قطاع مصدر',
        aliases: [],
        classification: 'non_financial',
        multiple: 10,
        status: 'active',
      },
    },
    {
      id: 'sec_dst',
      data: {
        sectorId: 'sec_dst',
        nameAr: 'قطاع بديل',
        aliases: [],
        classification: 'non_financial',
        multiple: 12,
        status: 'active',
      },
    },
    {
      id: 'sec_third',
      data: {
        sectorId: 'sec_third',
        nameAr: 'قطاع ثالث',
        aliases: [],
        classification: 'financial',
        multiple: 7,
        status: 'active',
      },
    },
  ];

  it('Scenario 8: Detects company linkage change and replacement sector status change between preview and write without blindly overwriting', async () => {
    // 8a) Company c2 moves to sec_third between preview and chunk transaction -> NOT overwritten, conflict reported, completed=false
    let movedBetweenPreviewAndTx = false;
    const envCompanyMoved = makeIndexedInMemorySectorPort({
      sectors: mkSectors(),
      companies: [
        { id: 'c1', data: { ticker: 'C1', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
        { id: 'c2', data: { ticker: 'C2', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
        { id: 'c3', data: { ticker: 'C3', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
      ],
      onBeforeTx: (txNum) => {
        if (txNum === 1 && !movedBetweenPreviewAndTx) {
          movedBetweenPreviewAndTx = true;
          envCompanyMoved.companies.set('c2', {
            ticker: 'C2',
            sectorId: 'sec_third',
            sector: 'قطاع ثالث',
            sectorClassification: 'financial',
          });
        }
      },
    });

    const repA = (
      await executeDeleteSectorGovernance(envCompanyMoved.port, {
        rawPayload: { sectorId: 'sec_src', reassignToSectorId: 'sec_dst', batchLimit: 2 },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;

    assert.equal(repA.completed, false);
    assert.equal(repA.atomic, false);
    assert.equal(repA.reassignedCount, 1, 'Only c1 should be reassigned');
    assert.equal(repA.conflictedCount, 1, 'c2 change between preview and write must be counted as conflict');
    assert.equal(repA.conflictsAr.length, 1);
    assert.equal(
      envCompanyMoved.companies.get('c2')?.sectorId,
      'sec_third',
      'c2 must NOT be blindly overwritten back to sec_dst'
    );
    assert.equal(envCompanyMoved.sectors.has('sec_src'), true);

    // Indexed queries used; zero full-collection company scans!
    const metrics = envCompanyMoved.getMetrics();
    assert.equal(metrics.fullCompanyScans, 0, 'Must use indexed sectorId queries + point reads instead of full collection scans');
    assert.ok(metrics.indexedSectorQueries > 0);
    assert.ok(metrics.pointCompanyReads > 0);

    // 8b) Replacement sector gets disabled between preview and chunk transaction -> MUST reject without overwriting any company
    let disabledBeforeTx = false;
    const envTargetDisabled = makeIndexedInMemorySectorPort({
      sectors: mkSectors(),
      companies: [
        { id: 'c1', data: { ticker: 'C1', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
        { id: 'c2', data: { ticker: 'C2', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
        { id: 'c3', data: { ticker: 'C3', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
      ],
      onBeforeTx: () => {
        if (!disabledBeforeTx) {
          disabledBeforeTx = true;
          envTargetDisabled.sectors.set('sec_dst', {
            ...envTargetDisabled.sectors.get('sec_dst')!,
            status: 'disabled',
          });
        }
      },
    });

    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(envTargetDisabled.port, {
          rawPayload: { sectorId: 'sec_src', reassignToSectorId: 'sec_dst', batchLimit: 2 },
          stamp: STAMP,
          maxAtomicCompanies: 2,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );
    assert.equal(envTargetDisabled.companies.get('c1')?.sectorId, 'sec_src', 'No company overwritten when target disabled');
    assert.equal(envTargetDisabled.companies.get('c2')?.sectorId, 'sec_src');
  });

  it('Scenario 9: Company linked BEHIND the resume cursor is caught before completion/deletion, and mismatched mutationId/target is rejected', async () => {
    const env = makeIndexedInMemorySectorPort({
      sectors: mkSectors(),
      companies: [
        { id: 'b1', data: { ticker: 'B1', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
        { id: 'b2', data: { ticker: 'B2', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
        { id: 'b3', data: { ticker: 'B3', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
      ],
    });

    // Batch 1 moves b1, b2 -> cursor = 'b2'
    const r1 = (
      await executeDeleteSectorGovernance(env.port, {
        rawPayload: { sectorId: 'sec_src', reassignToSectorId: 'sec_dst', batchLimit: 2 },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;
    assert.equal(r1.completed, false);
    assert.equal(r1.resumeAfterCompanyId, 'b2');
    assert.ok(r1.mutationId);

    // Reject resume with wrong mutationId
    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(env.port, {
          rawPayload: {
            sectorId: 'sec_src',
            reassignToSectorId: 'sec_dst',
            mutationId: 'wrong_mutation_id',
            resumeAfterCompanyId: r1.resumeAfterCompanyId,
            batchLimit: 2,
          },
          stamp: STAMP,
          maxAtomicCompanies: 2,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // Reject resume with mismatched replacement target
    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(env.port, {
          rawPayload: {
            sectorId: 'sec_src',
            reassignToSectorId: 'sec_third',
            mutationId: r1.mutationId,
            resumeAfterCompanyId: r1.resumeAfterCompanyId,
            batchLimit: 2,
          },
          stamp: STAMP,
          maxAtomicCompanies: 2,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // Inject company 'a0' BEHIND cursor 'b2' before batch 2
    env.companies.set('a0', {
      ticker: 'A0',
      sectorId: 'sec_src',
      sector: 'قطاع مصدر',
    });

    // Batch 2 processes 'b3' (after cursor 'b2'), MUST catch 'a0' behind cursor and NOT delete sector!
    const r2 = (
      await executeDeleteSectorGovernance(env.port, {
        rawPayload: {
          sectorId: 'sec_src',
          reassignToSectorId: 'sec_dst',
          mutationId: r1.mutationId,
          resumeAfterCompanyId: r1.resumeAfterCompanyId,
          batchLimit: 2,
        },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;
    assert.equal(r2.completed, false, 'MUST NOT declare completion when company exists behind resume cursor');
    assert.equal(r2.remainingLinkedCount, 1);
    assert.equal(r2.resumeAfterCompanyId, null, 'Cursor must reset to sweep behind-cursor company');
    assert.equal(env.sectors.has('sec_src'), true, 'Sector must NOT be deleted while a0 remains linked');

    // Batch 3 sweeps 'a0' and completes deletion atomically
    const r3 = (
      await executeDeleteSectorGovernance(env.port, {
        rawPayload: {
          sectorId: 'sec_src',
          reassignToSectorId: 'sec_dst',
          mutationId: r1.mutationId,
          resumeAfterCompanyId: r2.resumeAfterCompanyId,
          batchLimit: 2,
        },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;
    assert.equal(r3.completed, true);
    assert.equal(r3.remainingLinkedCount, 0);
    assert.equal(env.sectors.has('sec_src'), false);
    assert.equal(env.companies.get('a0')?.sectorId, 'sec_dst');
  });

  it('Scenario 10: Completion is NEVER declared while conflicts or final-check remaining links exist (delete & disable)', async () => {
    // 10a) Conflict on the LAST batch (even when live remaining == 0) MUST return completed=false so conflicts are surfaced before deletion
    let movedLast = false;
    const envFinalConflict = makeIndexedInMemorySectorPort({
      sectors: mkSectors(),
      companies: [
        { id: 'c1', data: { ticker: 'C1', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
        { id: 'c2', data: { ticker: 'C2', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
      ],
      onBeforeTx: (txNum) => {
        if (txNum === 2 && !movedLast) {
          movedLast = true;
          // Move c2 to sec_third right before batch 2 runs
          envFinalConflict.companies.set('c2', {
            ticker: 'C2',
            sectorId: 'sec_third',
            sector: 'قطاع ثالث',
          });
        }
      },
    });

    const r1 = (
      await executeDeleteSectorGovernance(envFinalConflict.port, {
        rawPayload: { sectorId: 'sec_src', reassignToSectorId: 'sec_dst', batchLimit: 1 },
        stamp: STAMP,
        maxAtomicCompanies: 1,
      })
    ).report;
    assert.equal(r1.completed, false);

    // Batch 2 encounters conflict on c2 -> MUST NOT declare completed=true or delete sec_src on this conflicted call
    const r2 = (
      await executeDeleteSectorGovernance(envFinalConflict.port, {
        rawPayload: {
          sectorId: 'sec_src',
          reassignToSectorId: 'sec_dst',
          mutationId: r1.mutationId,
          resumeAfterCompanyId: r1.resumeAfterCompanyId,
          batchLimit: 1,
        },
        stamp: STAMP,
        maxAtomicCompanies: 1,
      })
    ).report;
    assert.equal(r2.completed, false, 'Must NOT report completed=true when conflictedCount > 0');
    assert.equal(r2.conflictedCount, 1);
    assert.equal(r2.remainingLinkedCount, 0);
    assert.equal(envFinalConflict.sectors.has('sec_src'), true, 'Must wait for clean confirmation before deleting');

    // Batch 3 clean confirmation (0 remaining, 0 conflicts) completes deletion
    const r3 = (
      await executeDeleteSectorGovernance(envFinalConflict.port, {
        rawPayload: {
          sectorId: 'sec_src',
          reassignToSectorId: 'sec_dst',
          mutationId: r1.mutationId,
          resumeAfterCompanyId: r2.resumeAfterCompanyId,
          batchLimit: 1,
        },
        stamp: STAMP,
        maxAtomicCompanies: 1,
      })
    ).report;
    assert.equal(r3.completed, true);
    assert.equal(r3.conflictedCount, 0);
    assert.equal(envFinalConflict.sectors.has('sec_src'), false);

    // 10b) Same guarantee for multi-batch toggle_sector_status (behind-cursor link prevents early disable)
    const envToggle = makeIndexedInMemorySectorPort({
      sectors: mkSectors(),
      companies: [
        { id: 'm1', data: { ticker: 'M1', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
        { id: 'm2', data: { ticker: 'M2', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
      ],
    });
    const t1 = (
      await executeToggleSectorStatusGovernance(envToggle.port, {
        rawPayload: {
          sectorId: 'sec_src',
          status: 'disabled',
          reassignToSectorId: 'sec_dst',
          batchLimit: 1,
        },
        stamp: STAMP,
        maxAtomicCompanies: 1,
      })
    ).report;
    assert.equal(t1.completed, false);
    assert.equal(envToggle.sectors.get('sec_src')?.status, 'active');

    // Inject company behind cursor 'm1'
    envToggle.companies.set('a_late', {
      ticker: 'ALATE',
      sectorId: 'sec_src',
      sector: 'قطاع مصدر',
    });

    const t2 = (
      await executeToggleSectorStatusGovernance(envToggle.port, {
        rawPayload: {
          sectorId: 'sec_src',
          status: 'disabled',
          reassignToSectorId: 'sec_dst',
          mutationId: t1.mutationId,
          resumeAfterCompanyId: t1.resumeAfterCompanyId,
          batchLimit: 1,
        },
        stamp: STAMP,
        maxAtomicCompanies: 1,
      })
    ).report;
    assert.equal(t2.completed, false);
    assert.equal(t2.remainingLinkedCount, 1);
    assert.equal(envToggle.sectors.get('sec_src')?.status, 'active', 'Must NOT disable while a_late remains linked');

    const t3 = (
      await executeToggleSectorStatusGovernance(envToggle.port, {
        rawPayload: {
          sectorId: 'sec_src',
          status: 'disabled',
          reassignToSectorId: 'sec_dst',
          mutationId: t1.mutationId,
          resumeAfterCompanyId: t2.resumeAfterCompanyId,
          batchLimit: 1,
        },
        stamp: STAMP,
        maxAtomicCompanies: 1,
      })
    ).report;
    assert.equal(t3.completed, true);
    assert.equal(t3.remainingLinkedCount, 0);
    assert.equal(envToggle.sectors.get('sec_src')?.status, 'disabled');
    assert.equal(envToggle.companies.get('a_late')?.sectorId, 'sec_dst');

    // 10c) Multi-batch upsert_sector propagation also catches conflicts and avoids overwriting moved companies
    let movedUpsert = false;
    const envUpsert = makeIndexedInMemorySectorPort({
      sectors: mkSectors(),
      companies: [
        { id: 'u1', data: { ticker: 'U1', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
        { id: 'u2', data: { ticker: 'U2', sectorId: 'sec_src', sector: 'قطاع مصدر' } },
      ],
      onBeforeTx: (txNum) => {
        if (txNum === 1 && !movedUpsert) {
          movedUpsert = true;
          envUpsert.companies.set('u1', {
            ticker: 'U1',
            sectorId: 'sec_third',
            sector: 'قطاع ثالث',
          });
        }
      },
    });
    const u1 = (
      await executeUpsertSectorGovernance(envUpsert.port, {
        rawPayload: {
          sectorId: 'sec_src',
          nameAr: 'قطاع مصدر محدث',
          classification: 'non_financial',
          multiple: 10,
          status: 'active',
          batchLimit: 1,
        },
        stamp: STAMP,
        maxAtomicCompanies: 1,
      })
    ).report;
    assert.equal(u1.completed, false);
    assert.equal(u1.conflictedCount, 1);
    assert.equal(envUpsert.companies.get('u1')?.sectorId, 'sec_third', 'Moved company u1 must NOT be overwritten');
  });
});

describe('Sector Linkage Integrity — Empty Confirmed sectorPE Registry vs Unconfirmed/Loading/Error Registry', () => {
  const companyWithExplicitSector: Company = {
    id: 'comi',
    ticker: 'COMI',
    nameAr: 'البنك التجاري الدولي',
    nameEn: 'CIB',
    sectorId: 'banks',
    sector: 'البنوك',
    rawSector: 'البنوك',
    sectorClassification: 'financial',
    sectorSource: 'sector_registry',
    sectorDate: '2026-04-10',
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

  const legacyTextOnlyCompany = {
    id: 'legco',
    ticker: 'LEGCO',
    sectorId: null,
    sector: 'البنوك',
    rawSector: 'البنوك',
  };

  const staleBanksDef: SectorDefinition = {
    sectorId: 'banks',
    nameAr: 'البنوك',
    aliases: ['بنوك'],
    classification: 'financial',
    multiple: 6.5,
    status: 'active',
  };

  it('classifies stored sectorId against a CONFIRMED EMPTY sectorPE ([]) as explicit_broken_ref / unmapped with zero text fallback', () => {
    // 1) classifyCompanySectorLinkage MUST return explicit_broken_ref when allSectorDefs is confirmed []
    const cls = classifyCompanySectorLinkage(companyWithExplicitSector, [], {
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
    });
    assert.equal(cls.kind, 'explicit_broken_ref');
    assert.equal(cls.matchedSectorId, null);
    assert.equal(cls.explicitSectorId, 'banks');

    // Even when options are omitted, passing an explicit empty array `[]` means confirmed empty registry
    const clsDefault = classifyCompanySectorLinkage(companyWithExplicitSector, []);
    assert.equal(clsDefault.kind, 'explicit_broken_ref');
    assert.equal(clsDefault.matchedSectorId, null);

    // 2) companyMatchesSectorDefinition MUST return false against confirmed empty registry [] (explicit AND legacy)
    assert.equal(
      companyMatchesSectorDefinition(companyWithExplicitSector, 'banks', staleBanksDef, []),
      false
    );
    assert.equal(
      companyMatchesSectorDefinition(legacyTextOnlyCompany, 'banks', staleBanksDef, []),
      false
    );

    // 3) matchSectorFromRegistry with [] MUST return unmapped (zero text fallback)
    const match = matchSectorFromRegistry({
      sectorId: 'banks',
      rawSector: 'البنوك',
      sectorDefinitions: [],
    });
    assert.equal(match.status, 'unmapped');
    assert.equal(match.sector, null);

    // 4) resolveUnifiedSector with confirmed empty [] MUST return unmapped (even if stale sectorPEMap is supplied!)
    const unified = resolveUnifiedSector('البنوك', 'financial', {
      sectorId: 'banks',
      sectorDefinitions: [],
      sectorPEMap: { البنوك: 6.5 },
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
    });
    assert.equal(unified.source, 'unmapped');
    assert.equal(unified.classification, 'unknown');
    assert.equal(unified.sectorPeConfirmed, true);

    // 5) resolveSectorPeFromRegistry with confirmed empty [] MUST NOT fall back to stale sectorPEMap
    const peLookup = resolveSectorPeFromRegistry({
      sectorDefinitions: [],
      sectorPEMap: { البنوك: 6.5 },
      resolvedSectorId: 'banks',
      rawSector: 'البنوك',
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
    });
    assert.equal(peLookup.multiple, null);
    assert.equal(peLookup.matchedSectorId, null);
    assert.equal(peLookup.unavailableError, undefined);
    assert.match(peLookup.reasonAr, /فارغة/);

    // 6) deriveSecurityIdentityAndMetadata & deriveStockUniverseDiagnostics flag broken ref under confirmed empty []
    const identity = deriveSecurityIdentityAndMetadata({
      ticker: 'COMI',
      meta: companyWithExplicitSector,
      quarterlyRecords: [makeSampleQuarter('COMI')],
      dailyHistory: [makeSampleDaily('COMI', 'البنوك')],
      sectorDefinitions: [],
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
    });
    assert.equal(identity.sectorStatus, 'unmapped');
    assert.equal(identity.sectorClassification, 'unknown');

    const universe = deriveStockUniverseDiagnostics(
      [makeSampleQuarter('COMI')],
      [companyWithExplicitSector],
      [makeSampleDaily('COMI', 'البنوك')],
      {},
      {
        sectorDefinitions: [],
        sectorPeConfirmed: true,
        sectorPeStatus: 'ready',
      }
    );
    assert.equal(universe.unmappedSectors.length, 1);
    assert.equal(universe.unmappedSectors[0].ticker, 'COMI');

    // 7) analyzeLegacyMigration with explicit empty sectorDefinitions: [] flags broken explicit sectorId
    const migration = analyzeLegacyMigration({
      companies: [companyWithExplicitSector],
      sectorDefinitions: [],
      sectorPEMap: { البنوك: 6.5 },
      quarterlyRecords: [],
      dailyRecords: [makeSampleDaily('COMI', 'البنوك')],
    });
    assert.equal(migration.summaryCounts.companiesUnmappedSector, 1);
    assert.equal(migration.companyChanges[0]?.action, 'flag_unmapped_sector');
  });

  it('distinguishes OMITTED / LOADING / ERROR / PERMISSION_DENIED sectorPE from an empty registry — NEVER falsely reporting broken refs', () => {
    // Omitted (undefined / null) registry -> explicit_unconfirmed_registry (NOT explicit_broken_ref!)
    const clsOmitted = classifyCompanySectorLinkage(companyWithExplicitSector, undefined);
    assert.equal(clsOmitted.kind, 'explicit_unconfirmed_registry');
    assert.equal(clsOmitted.explicitSectorId, 'banks');

    const clsNull = classifyCompanySectorLinkage(companyWithExplicitSector, null);
    assert.equal(clsNull.kind, 'explicit_unconfirmed_registry');

    // Loading / error / permission_denied even with empty array [] -> explicit_unconfirmed_registry
    for (const status of ['loading', 'error', 'permission_denied'] as const) {
      const clsUnconfirmed = classifyCompanySectorLinkage(companyWithExplicitSector, [], {
        sectorPeConfirmed: false,
        sectorPeStatus: status,
      });
      assert.equal(
        clsUnconfirmed.kind,
        'explicit_unconfirmed_registry',
        `status=${status} must NOT falsely report explicit_broken_ref`
      );

      // resolveUnifiedSector MUST return registry_unavailable (even if caller forgot sectorPeConfirmed: false when status='loading')
      const unified = resolveUnifiedSector('البنوك', 'financial', {
        sectorId: 'banks',
        sectorDefinitions: [],
        sectorPeConfirmed: status === 'loading' ? true : false,
        sectorPeStatus: status,
      });
      assert.equal(unified.source, 'registry_unavailable');
      assert.equal(unified.sectorPeConfirmed, false);

      // resolveSectorPeFromRegistry MUST mark unavailableError: true
      const pe = resolveSectorPeFromRegistry({
        sectorDefinitions: [],
        resolvedSectorId: 'banks',
        rawSector: 'البنوك',
        sectorPeConfirmed: false,
        sectorPeStatus: status,
      });
      assert.equal(pe.multiple, null);
      assert.equal(pe.unavailableError, true);

      // deriveStockUniverseDiagnostics MUST NOT pollute unmappedSectors while loading/errored
      const universe = deriveStockUniverseDiagnostics(
        [makeSampleQuarter('COMI')],
        [companyWithExplicitSector],
        [makeSampleDaily('COMI', 'البنوك')],
        {},
        {
          sectorDefinitions: [],
          sectorPeConfirmed: false,
          sectorPeStatus: status,
        }
      );
      assert.equal(
        universe.unmappedSectors.length,
        0,
        `status=${status} must NOT falsely add companies to unmappedSectors`
      );
    }
  });
});

