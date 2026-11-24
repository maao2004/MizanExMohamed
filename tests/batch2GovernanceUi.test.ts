import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  computeCalendarSpanDays,
  executeDeleteSectorGovernance,
  executeToggleSectorStatusGovernance,
  executeUpsertSectorGovernance,
  resolveSectorPeFromRegistry,
  resolveUnifiedSector,
  SectorGovernanceConflictError,
  SectorGovernanceNotFoundError,
  validateQuarterlyPeriodInputs,
  validateRecords,
  type CompanyDocEntry,
  type SectorDocEntry,
  type SectorMutationPort,
  type SectorMutationTxContext,
} from '../src/core/contracts';
import { deriveFinancialsFromQuarterlyRecords } from '../src/core/domain/stockDerived';
import { resolveMetricAuditBundle } from '../src/core/domain/metricContracts';
import { AddCompanyModal } from '../src/components/AddCompanyModal';
import { MetricAuditCard } from '../src/components/MetricAuditCard';
import { EditQuarterlyRecordModal } from '../src/modules/data-hub/EditQuarterlyRecordModal';
import { QuarterlyRecordsTable } from '../src/modules/data-hub/QuarterlyRecordsTable';
import { resolveRequestedQuarterlyEditTarget } from '../src/modules/data-hub/DataHubView';
import { SectorGovernanceActionModal } from '../src/modules/admin/SectorGovernanceActionModal';
import type {
  Company,
  QuarterlyFinancialRecord,
  SectorDefinition,
} from '../src/types';

function createInMemorySectorPort(seed: {
  sectors?: SectorDocEntry[];
  companies?: CompanyDocEntry[];
  onBeforeAtomicRead?: () => void;
}) {
  const sectors = new Map<string, Record<string, any>>();
  const companies = new Map<string, Record<string, any>>();
  const tombstones: string[] = [];
  let atomicTxCalls = 0;
  let batchCalls = 0;

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

  const port: SectorMutationPort = {
    async listAllSectors() {
      return snapshotSectors();
    },
    async listAllCompanies() {
      return snapshotCompanies();
    },
    async runTransaction<T>(fn: (tx: SectorMutationTxContext) => Promise<T>): Promise<T> {
      atomicTxCalls += 1;
      seed.onBeforeAtomicRead?.();

      const pendingSectorSets: Array<{ id: string; payload: Record<string, any>; merge: boolean }> = [];
      const pendingSectorDeletes: string[] = [];
      const pendingCompanySets: Array<{ id: string; payload: Record<string, any>; merge: boolean }> = [];
      const pendingTombstones: string[] = [];

      const tx: SectorMutationTxContext = {
        async getAllSectors() {
          return snapshotSectors();
        },
        async getAllCompanies() {
          return snapshotCompanies();
        },
        async getSectorDoc(sectorId: string) {
          const found = sectors.get(sectorId);
          return found ? { ...found } : undefined;
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
      // Commit atomically only after fn succeeds
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
    async commitBatch(fn) {
      batchCalls += 1;
      const pendingSectorSets: Array<{ id: string; payload: Record<string, any>; merge: boolean }> = [];
      const pendingSectorDeletes: string[] = [];
      const pendingCompanySets: Array<{ id: string; payload: Record<string, any>; merge: boolean }> = [];
      const pendingTombstones: string[] = [];

      fn({
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
      });

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
    },
  };

  return {
    port,
    sectors,
    companies,
    tombstones,
    getCounts: () => ({ atomicTxCalls, batchCalls }),
  };
}

const STAMP = {
  updatedAt: '2026-01-15T10:00:00.000Z',
  updatedBy: 'admin-1',
};

const SAMPLE_SECTORS: SectorDefinition[] = [
  {
    sectorId: 'banks',
    nameAr: 'البنوك',
    classification: 'financial',
    multiple: 6.5,
    status: 'active',
    aliases: ['بنوك'],
  },
  {
    sectorId: 'industrial_no_pe',
    nameAr: 'الصناعات الهندسية',
    classification: 'non_financial',
    multiple: null,
    status: 'active',
    aliases: [],
  },
  {
    sectorId: 'legacy_disabled',
    nameAr: 'قطاع قديم معطل',
    classification: 'non_financial',
    multiple: 11,
    status: 'disabled',
    aliases: [],
  },
];

describe('Batch 2 — Official sectorPE registry states & null multiple', () => {
  it('distinguishes active, disabled, unmapped, null-multiple, and load-failure states without static fallback', () => {
    // Active with null multiple: classifies cleanly without requiring multiple
    const nullPeUnified = resolveUnifiedSector('الصناعات الهندسية', null, {
      sectorId: 'industrial_no_pe',
      sectorDefinitions: SAMPLE_SECTORS,
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
    });
    assert.equal(nullPeUnified.classification, 'non_financial');
    assert.equal(nullPeUnified.source, 'sector_registry');
    assert.equal(nullPeUnified.sectorId, 'industrial_no_pe');

    const nullPeRes = resolveSectorPeFromRegistry({
      rawSector: 'الصناعات الهندسية',
      resolvedSectorId: 'industrial_no_pe',
      sectorDefinitions: SAMPLE_SECTORS,
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
    });
    assert.equal(nullPeRes.multiple, null);
    assert.equal(nullPeRes.unavailableError, undefined);

    // Disabled sector preserves audit link and flags disabled_sector
    const disabledUnified = resolveUnifiedSector('قطاع قديم معطل', null, {
      sectorId: 'legacy_disabled',
      sectorDefinitions: SAMPLE_SECTORS,
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
    });
    assert.equal(disabledUnified.source, 'disabled_sector');
    assert.equal(disabledUnified.sectorId, 'legacy_disabled');

    // Unmapped sector when registry is confirmed
    const unmapped = resolveUnifiedSector('قطاع غير موجود', null, {
      sectorDefinitions: SAMPLE_SECTORS,
      sectorPeConfirmed: true,
      sectorPeStatus: 'ready',
    });
    assert.equal(unmapped.source, 'unmapped');
    assert.equal(unmapped.classification, 'unknown');

    // Load failure / permission_denied must NOT be confused with empty/unmapped
    const loadErr = resolveUnifiedSector('البنوك', null, {
      sectorId: 'banks',
      sectorDefinitions: [],
      sectorPeConfirmed: false,
      sectorPeStatus: 'permission_denied',
    });
    assert.equal(loadErr.source, 'registry_unavailable');
    assert.equal(loadErr.sectorPeStatus, 'permission_denied');
    assert.equal(loadErr.classification, 'unknown');

    const peLoadErr = resolveSectorPeFromRegistry({
      rawSector: 'البنوك',
      resolvedSectorId: 'banks',
      sectorDefinitions: [],
      sectorPeConfirmed: false,
      sectorPeStatus: 'permission_denied',
    });
    assert.equal(peLoadErr.multiple, null);
    assert.equal(peLoadErr.unavailableError, true);
  });

  it('AddCompanyModal lists ONLY active sectorPE options (including multiple:null), hides disabled, and distinguishes load error vs empty', () => {
    const htmlLoaded = renderToStaticMarkup(
      React.createElement(AddCompanyModal, {
        isOpen: true,
        onClose: () => {},
        onSaveStockAndQuarter: async () => {},
        sectorDefinitions: SAMPLE_SECTORS,
        sectorPeConfirmed: true,
        sectorPeStatus: 'ready',
      })
    );
    assert.match(htmlLoaded, /البنوك/);
    assert.match(htmlLoaded, /الصناعات الهندسية/);
    assert.match(htmlLoaded, /بدون مضاعف/);
    assert.doesNotMatch(htmlLoaded, /قطاع قديم معطل/);
    // New accounting & period fields rendered without DPS_Current
    assert.match(htmlLoaded, /PeriodStartDate/);
    assert.match(htmlLoaded, /PeriodEndDate/);
    assert.match(htmlLoaded, /PeriodDays/);
    assert.match(htmlLoaded, /WeightedAvgShares_Basis/);
    assert.match(htmlLoaded, /NetIncomeCommon_Basis/);
    assert.match(htmlLoaded, /EquityCommon_Basis/);
    assert.doesNotMatch(htmlLoaded, /DPS_Current/i);

    // Load failure state shows explicit error notice and disables sector dropdown
    const htmlError = renderToStaticMarkup(
      React.createElement(AddCompanyModal, {
        isOpen: true,
        onClose: () => {},
        onSaveStockAndQuarter: async () => {},
        sectorDefinitions: [],
        sectorPeConfirmed: false,
        sectorPeStatus: 'permission_denied',
        sectorPeError: 'permission-denied',
      })
    );
    assert.match(htmlError, /لا توجد صلاحية قراءة sectorPE/);
    assert.match(htmlError, /سجل القطاعات غير مؤكد حالياً/);
  });
});

describe('Batch 2 — Authoritative sector governance (disable, delete, concurrency, resumable multi-batch)', () => {
  it('allows creating a sector with multiple: null', async () => {
    const { port, sectors } = createInMemorySectorPort({});
    const res = await executeUpsertSectorGovernance(port, {
      rawPayload: {
        sectorId: 'logistics',
        nameAr: 'الخدمات اللوجستية',
        classification: 'non_financial',
        multiple: null,
        status: 'active',
      },
      stamp: STAMP,
    });
    assert.equal(res.report.sectorId, 'logistics');
    assert.equal(res.report.completed, true);
    assert.equal(res.report.atomic, true);
    assert.equal(sectors.get('logistics')?.multiple, null);
    assert.equal(sectors.get('logistics')?.classification, 'non_financial');
  });

  it('disabling a linked sector without reassignment preserves links; disabling with replacement reassigns atomically', async () => {
    const seedSectors: SectorDocEntry[] = [
      {
        id: 'old_sec',
        data: {
          sectorId: 'old_sec',
          nameAr: 'قطاع قديم',
          classification: 'non_financial',
          multiple: 9,
          status: 'active',
          aliases: [],
        },
      },
      {
        id: 'new_sec',
        data: {
          sectorId: 'new_sec',
          nameAr: 'قطاع بديل نشط',
          classification: 'financial',
          multiple: null,
          status: 'active',
          aliases: [],
        },
      },
    ];
    const seedCompanies: CompanyDocEntry[] = [
      {
        id: 'comi',
        data: {
          ticker: 'COMI',
          sectorId: 'old_sec',
          sector: 'قطاع قديم',
          sectorClassification: 'non_financial',
        },
      },
    ];

    // 1. Disable WITHOUT reassignment -> preserves company link for auditability
    const env1 = createInMemorySectorPort({ sectors: seedSectors, companies: seedCompanies });
    const res1 = await executeToggleSectorStatusGovernance(env1.port, {
      rawPayload: { sectorId: 'old_sec', status: 'disabled' },
      stamp: STAMP,
    });
    assert.equal(res1.report.completed, true);
    assert.equal(res1.report.atomic, true);
    assert.equal(res1.report.reassignedCount, 0);
    assert.equal(env1.sectors.get('old_sec')?.status, 'disabled');
    assert.equal(env1.companies.get('comi')?.sectorId, 'old_sec');

    // 2. Disable WITH explicit active replacement -> reassigns atomically
    const env2 = createInMemorySectorPort({ sectors: seedSectors, companies: seedCompanies });
    const res2 = await executeToggleSectorStatusGovernance(env2.port, {
      rawPayload: { sectorId: 'old_sec', status: 'disabled', reassignToSectorId: 'new_sec' },
      stamp: STAMP,
    });
    assert.equal(res2.report.completed, true);
    assert.equal(res2.report.atomic, true);
    assert.equal(res2.report.reassignedCount, 1);
    assert.equal(env2.sectors.get('old_sec')?.status, 'disabled');
    assert.equal(env2.companies.get('comi')?.sectorId, 'new_sec');
    assert.equal(env2.companies.get('comi')?.sectorClassification, 'financial');
  });

  it('refuses deleting a linked sector without explicit active replacement, and handles concurrent link changes inside transaction', async () => {
    const seedSectors: SectorDocEntry[] = [
      {
        id: 'sec_a',
        data: {
          sectorId: 'sec_a',
          nameAr: 'قطاع أ',
          classification: 'non_financial',
          multiple: 10,
          status: 'active',
          aliases: [],
        },
      },
      {
        id: 'sec_b',
        data: {
          sectorId: 'sec_b',
          nameAr: 'قطاع ب',
          classification: 'non_financial',
          multiple: 12,
          status: 'active',
          aliases: [],
        },
      },
      {
        id: 'sec_disabled',
        data: {
          sectorId: 'sec_disabled',
          nameAr: 'قطاع معطل',
          classification: 'non_financial',
          multiple: 8,
          status: 'disabled',
          aliases: [],
        },
      },
    ];

    // 1. Linked company exists -> refuse delete without reassignment
    const env1 = createInMemorySectorPort({
      sectors: seedSectors,
      companies: [{ id: 'tmgh', data: { ticker: 'TMGH', sectorId: 'sec_a', sector: 'قطاع أ' } }],
    });
    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(env1.port, {
          rawPayload: { sectorId: 'sec_a' },
          stamp: STAMP,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );
    assert.ok(env1.sectors.has('sec_a'));
    assert.equal(env1.companies.get('tmgh')?.sectorId, 'sec_a');

    // 2. Reject disabled replacement target
    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(env1.port, {
          rawPayload: { sectorId: 'sec_a', reassignToSectorId: 'sec_disabled' },
          stamp: STAMP,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );

    // 3. Concurrent link added right before atomic transaction starts (stale pre-check saw 0)
    let injected = false;
    const envConcurrent = createInMemorySectorPort({
      sectors: seedSectors,
      companies: [],
      onBeforeAtomicRead: () => {
        if (!injected) {
          injected = true;
          envConcurrent.companies.set('efid', {
            ticker: 'EFID',
            sectorId: 'sec_a',
            sector: 'قطاع أ',
          });
        }
      },
    });
    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(envConcurrent.port, {
          rawPayload: { sectorId: 'sec_a' },
          stamp: STAMP,
        }),
      (err: unknown) => err instanceof SectorGovernanceConflictError
    );
    assert.ok(envConcurrent.sectors.has('sec_a'), 'Sector must NOT be deleted after concurrent link');

    // 4. Delete with explicit active replacement reassigns company and deletes ONLY the sector doc
    const resDel = await executeDeleteSectorGovernance(env1.port, {
      rawPayload: { sectorId: 'sec_a', reassignToSectorId: 'sec_b' },
      stamp: STAMP,
    });
    assert.equal(resDel.report.completed, true);
    assert.equal(resDel.report.atomic, true);
    assert.equal(resDel.report.reassignedCount, 1);
    assert.equal(env1.sectors.has('sec_a'), false);
    assert.equal(env1.companies.get('tmgh')?.sectorId, 'sec_b');
    assert.equal(env1.companies.size, 1, 'Company document must NEVER be deleted');
    assert.equal(env1.tombstones.length, 1);

    // 5. Missing sector throws NotFound
    await assert.rejects(
      () =>
        executeDeleteSectorGovernance(env1.port, {
          rawPayload: { sectorId: 'does_not_exist' },
          stamp: STAMP,
        }),
      (err: unknown) => err instanceof SectorGovernanceNotFoundError
    );
  });

  it('honestly reports resumable non-atomic multi-batch execution when linked companies exceed atomic limit and never deletes sector early', async () => {
    const seedSectors: SectorDocEntry[] = [
      {
        id: 'big_sec',
        data: {
          sectorId: 'big_sec',
          nameAr: 'قطاع ضخم',
          classification: 'non_financial',
          multiple: 10,
          status: 'active',
          aliases: [],
        },
      },
      {
        id: 'target_sec',
        data: {
          sectorId: 'target_sec',
          nameAr: 'قطاع بديل',
          classification: 'non_financial',
          multiple: 11,
          status: 'active',
          aliases: [],
        },
      },
    ];
    const seedCompanies: CompanyDocEntry[] = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => ({
      id,
      data: {
        ticker: id.toUpperCase(),
        sectorId: 'big_sec',
        sector: 'قطاع ضخم',
      },
    }));

    const env = createInMemorySectorPort({ sectors: seedSectors, companies: seedCompanies });

    // Batch 1 (limit 2 of 5)
    const r1 = (
      await executeDeleteSectorGovernance(env.port, {
        rawPayload: { sectorId: 'big_sec', reassignToSectorId: 'target_sec', batchLimit: 2 },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;
    assert.equal(r1.atomic, false);
    assert.equal(r1.completed, false);
    assert.equal(r1.reassignedCount, 2);
    assert.equal(r1.remainingLinkedCount, 3);
    assert.ok(r1.resumeAfterCompanyId);
    assert.ok(r1.warningAr);
    assert.ok(env.sectors.has('big_sec'), 'Sector must remain until all linked companies are reassigned');

    // Batch 2 (limit 2 of remaining 3)
    const r2 = (
      await executeDeleteSectorGovernance(env.port, {
        rawPayload: {
          sectorId: 'big_sec',
          reassignToSectorId: 'target_sec',
          batchLimit: 2,
          resumeAfterCompanyId: r1.resumeAfterCompanyId,
        },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;
    assert.equal(r2.atomic, false);
    assert.equal(r2.completed, false);
    assert.equal(r2.reassignedCount, 2);
    assert.equal(r2.remainingLinkedCount, 1);
    assert.ok(env.sectors.has('big_sec'), 'Sector must still exist with 1 company remaining');

    // Batch 3 (final 1 company -> atomic deletion after confirming 0 remaining)
    const r3 = (
      await executeDeleteSectorGovernance(env.port, {
        rawPayload: {
          sectorId: 'big_sec',
          reassignToSectorId: 'target_sec',
          batchLimit: 2,
          resumeAfterCompanyId: r2.resumeAfterCompanyId,
        },
        stamp: STAMP,
        maxAtomicCompanies: 2,
      })
    ).report;
    assert.equal(r3.completed, true);
    assert.equal(r3.remainingLinkedCount, 0);
    assert.equal(env.sectors.has('big_sec'), false, 'Sector deleted only after final zero-link check');
    assert.equal(env.companies.size, 5, 'No company record deleted');
    for (const c of env.companies.values()) {
      assert.equal(c.sectorId, 'target_sec');
    }
  });

  it('SectorGovernanceActionModal never auto-selects replacement and renders partial-batch resume prompt', () => {
    const linked: Company[] = [
      {
        id: 'comi',
        ticker: 'COMI',
        nameAr: 'التجاري الدولي',
        sectorId: 'banks',
        sector: 'البنوك',
      } as Company,
    ];
    const htmlDelete = renderToStaticMarkup(
      React.createElement(SectorGovernanceActionModal, {
        mode: 'delete',
        sector: SAMPLE_SECTORS[0],
        linkedCompanies: linked,
        activeReplacementSectors: [SAMPLE_SECTORS[1]],
        reassignToSectorId: '',
        onChangeReassignToSectorId: () => {},
        busy: false,
        errorText: null,
        pendingReport: {
          operation: 'delete_sector',
          sectorId: 'banks',
          atomic: false,
          completed: false,
          linkedCompaniesCount: 5,
          reassignedCount: 2,
          updatedCompaniesCount: 2,
          remainingLinkedCount: 3,
          reassignedToSectorId: 'industrial_no_pe',
          resumeAfterCompanyId: 'c2',
          warningAr: 'التنفيذ متعدد الدفعات غير ذري بالكامل.',
          messageAr: 'تم نقل دفعة وتبقى 3 شركات.',
        },
        onCancel: () => {},
        onConfirm: () => {},
      })
    );
    assert.match(htmlDelete, /يجب اختيار قطاع بديل نشط صراحةً/);
    assert.match(htmlDelete, /التنفيذ متعدد الدفعات غير ذري بالكامل/);
    assert.match(htmlDelete, /استئناف|استكمال/);
  });

  it('enforces server-side admin-only role checks on sector mutations and denies direct client writes in firestore.rules', () => {
    const fnSrc = fs.readFileSync(path.join(process.cwd(), 'functions/src/index.ts'), 'utf8');
    assert.match(
      fnSrc,
      /operationType === 'upsert_sector'[\s\S]{0,160}if \(!admin\) throw new HttpsError\('permission-denied'/
    );
    assert.match(
      fnSrc,
      /operationType === 'toggle_sector_status'[\s\S]{0,160}if \(!admin\) throw new HttpsError\('permission-denied'/
    );
    assert.match(
      fnSrc,
      /operationType === 'delete_sector'[\s\S]{0,160}if \(!admin\) throw new HttpsError\('permission-denied'/
    );

    const rulesSrc = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');
    assert.match(rulesSrc, /match \/sectorPE\/\{sectorId\}[\s\S]{0,200}allow write:\s*if false/);
    assert.match(
      rulesSrc,
      /match \/quarterly_financial_records\/\{recordId\}[\s\S]{0,200}allow write:\s*if false/
    );
  });
});

describe('Batch 2 — Quarterly accounting & period validation (non-calendar FY, leap years, no Jan-1 fabrication)', () => {
  it('validates non-calendar fiscal years and leap years accurately and rejects invalid/conflicting period inputs', () => {
    // Non-calendar FY: 2024-07-01 to 2025-06-30 = 365 days
    const nonCal = validateQuarterlyPeriodInputs({
      periodStartDate: '2024-07-01',
      periodEndDate: '2025-06-30',
      periodDays: null,
    });
    assert.equal(nonCal.periodDays, 365);
    assert.equal(computeCalendarSpanDays('2024-07-01', '2025-06-30'), 365);

    // Non-calendar FY spanning leap Feb 29, 2024: 2023-07-01 to 2024-06-30 = 366 days
    const nonCalLeap = validateQuarterlyPeriodInputs({
      periodStartDate: '2023-07-01',
      periodEndDate: '2024-06-30',
    });
    assert.equal(nonCalLeap.periodDays, 366);

    // Valid leap-year date 2024-02-29
    const leapOk = validateQuarterlyPeriodInputs({
      periodStartDate: '2024-01-01',
      periodEndDate: '2024-02-29',
    });
    assert.equal(leapOk.periodDays, 60);

    // Invalid non-leap date 2025-02-29 -> rejected
    assert.throws(
      () =>
        validateQuarterlyPeriodInputs({
          periodStartDate: '2025-01-01',
          periodEndDate: '2025-02-29',
        }),
      /غير صالح تقويمياً/
    );

    // Reversed dates -> rejected
    assert.throws(
      () =>
        validateQuarterlyPeriodInputs({
          periodStartDate: '2025-06-30',
          periodEndDate: '2024-07-01',
        }),
      /يجب أن يسبق أو يساوي/
    );

    // Single date only (must NEVER fabricate Jan 1) -> rejected
    assert.throws(
      () =>
        validateQuarterlyPeriodInputs({
          periodStartDate: null,
          periodEndDate: '2025-03-31',
        }),
      /يلزم إدخال تاريخي بداية ونهاية الفترة المالية معاً/
    );

    // Conflicting periodDays -> rejected
    assert.throws(
      () =>
        validateQuarterlyPeriodInputs({
          periodStartDate: '2024-07-01',
          periodEndDate: '2025-06-30',
          periodDays: 360,
        }),
      /تعارض في طول الفترة/
    );
  });

  it('round-trips all new quarterly accounting & period fields through validateRecords, projection, and resolveMetricAuditBundle', () => {
    const rawRec: QuarterlyFinancialRecord = {
      ticker: 'EFID',
      stockName: 'إيديتا للصناعات الغذائية',
      yearQuarter: '2025FY',
      year: 2025,
      quarter: 'FY',
      shares: 700_000_000,
      intangibleAssets: null,
      totalAssets: 12_000_000_000,
      equity: 5_000_000_000,
      totalDebtWithoutTX: 1_200_000_000,
      totalLiabilities: 7_000_000_000,
      revenueYTD: 15_000_000_000,
      grossProfitYTD: 5_000_000_000,
      ebitYTD: 2_200_000_000,
      pbtYTD: 1_950_000_000,
      netIncomeYTD: 1_500_000_000,
      ocfYTD: 1_800_000_000,
      netInvestingCfYTD: -600_000_000,
      dividendsPaidYTD: 300_000_000,
      cash: 1_100_000_000,
      interestExpenseYTD: 250_000_000,
      financeCostsYTD: 260_000_000,
      interestIncomeYTD: 40_000_000,
      taxExpenseYTD: 450_000_000,
      interestPaidYTD: 240_000_000,
      capexYTD: 550_000_000,
      dateInsertData: '2026-01-15',
      updatedAt: '2026-01-15T10:00:00.000Z',
      netIncomeCommonYTD: 1_400_000_000,
      netIncomeCommonBasis: 'explicit_common',
      netIncomeCommonNote: 'نصيب مساهمي الشركة الأم بعد خصم الأقلية',
      equityCommon: 4_800_000_000,
      equityCommonBasis: 'explicit_common',
      equityCommonNote: 'حقوق مساهمي الشركة الأم فقط',
      weightedAvgSharesYTD: 695_000_000,
      weightedAvgSharesBasis: 'ytd_weighted_avg',
      periodStartDate: '2024-07-01',
      periodEndDate: '2025-06-30',
      periodDays: null,
      reportedEps: 2.01,
      reportedEpsPeriodType: 'fy',
      reportedEpsFiscalYear: 2025,
      reportedEpsPeriodStart: '2024-07-01',
      reportedEpsPeriodEnd: '2025-06-30',
      reportedEpsPeriod: 'FY 2025',
      reportedEpsSource: 'قوائم مدققة',
      isCapitalActionAdjusted: true,
      financialCurrency: 'EGP',
    };

    const validated = validateRecords([rawRec], true) as QuarterlyFinancialRecord[];
    assert.equal(validated.length, 1);
    const saved = validated[0];
    assert.equal(saved.netIncomeCommonYTD, 1_400_000_000);
    assert.equal(saved.netIncomeCommonBasis, 'explicit_common');
    assert.equal(saved.equityCommon, 4_800_000_000);
    assert.equal(saved.equityCommonBasis, 'explicit_common');
    assert.equal(saved.weightedAvgSharesYTD, 695_000_000);
    assert.equal(saved.weightedAvgSharesBasis, 'ytd_weighted_avg');
    assert.equal(saved.periodStartDate, '2024-07-01');
    assert.equal(saved.periodEndDate, '2025-06-30');
    assert.equal(saved.periodDays, 365);

    const projected = deriveFinancialsFromQuarterlyRecords(validated);
    const audit = resolveMetricAuditBundle({
      company: { id: 'efid', ticker: 'EFID', nameAr: 'إيديتا' } as Company,
      financials: projected,
      netIncomeTTM: 1_500_000_000,
      finCurrencyAllowed: true,
      currencySuffix: 'ج.م',
    });
    assert.equal(audit.missingCommonFields.length, 0);
    assert.equal(audit.missingAccountingEpsFields?.length ?? 0, 0);
    assert.ok(audit.accountingEpsLatest.value !== null);
    assert.ok(
      Math.abs(audit.accountingEpsLatest.value! - 1_400_000_000 / 695_000_000) < 1e-6
    );
  });
});

describe('Batch 2 — MetricAuditCard edit-target routing, DataHubView safeguards & EditQuarterlyRecordModal state isolation', () => {
  const makeBaseRecord = (
    overrides: Partial<QuarterlyFinancialRecord>
  ): QuarterlyFinancialRecord => ({
    ticker: 'COMI',
    stockName: 'التجاري الدولي',
    yearQuarter: '2025Q3',
    year: 2025,
    quarter: 'Q3',
    shares: 3_070_850_000,
    intangibleAssets: null,
    totalAssets: 900_000_000_000,
    equity: 150_000_000_000,
    totalDebtWithoutTX: null,
    totalLiabilities: 750_000_000_000,
    revenueYTD: 80_000_000_000,
    grossProfitYTD: null,
    ebitYTD: null,
    pbtYTD: 55_000_000_000,
    netIncomeYTD: 40_000_000_000,
    ocfYTD: null,
    netInvestingCfYTD: null,
    dividendsPaidYTD: null,
    cash: null,
    interestExpenseYTD: null,
    financeCostsYTD: null,
    interestIncomeYTD: null,
    taxExpenseYTD: 15_000_000_000,
    interestPaidYTD: null,
    capexYTD: null,
    dateInsertData: '2026-01-10',
    updatedAt: '2026-01-10T10:00:00.000Z',
    ...overrides,
  });

  const recA = makeBaseRecord({});
  const recB = makeBaseRecord({
    ticker: 'TMGH',
    stockName: 'طلعت مصطفى',
    yearQuarter: '2025FY',
    year: 2025,
    quarter: 'FY',
    shares: 2_063_562_286,
    netIncomeYTD: 12_000_000_000,
    equity: 80_000_000_000,
    periodStartDate: '2025-01-01',
    periodEndDate: '2025-12-31',
    periodDays: 365,
    weightedAvgSharesBasis: 'ytd_weighted_avg',
  });

  it('MetricAuditCard renders missing common & accounting EPS items with edit-target buttons', () => {
    const projected = deriveFinancialsFromQuarterlyRecords([recA]);
    const audit = resolveMetricAuditBundle({
      company: { id: 'comi', ticker: 'COMI', nameAr: 'التجاري الدولي' } as Company,
      financials: projected,
      netIncomeTTM: 40_000_000_000,
      finCurrencyAllowed: true,
      currencySuffix: 'ج.م',
    });
    assert.ok(audit.missingCommonFields.length > 0);
    assert.ok((audit.missingAccountingEpsFields?.length ?? 0) > 0);

    const html = renderToStaticMarkup(
      React.createElement(MetricAuditCard, {
        metricAudit: audit,
        finCurrencyLabel: 'ج.م',
        ticker: 'COMI',
        onRequestEditTarget: () => {},
      })
    );
    assert.match(html, /استكمال الحقول المحاسبية والفترية الناقصة/);
    assert.match(html, /تعديل الحقل في السجل/);
    assert.match(html, /edit-missing-2025-Q3-weightedAvgSharesYTD/);
  });

  it('resolveRequestedQuarterlyEditTarget enforces exact match, permission checks, and never fabricates missing records', () => {
    // 1. Authorized exact match
    const okRes = resolveRequestedQuarterlyEditTarget({
      target: { ticker: 'COMI.CA', year: 2025, quarter: 'Q3', field: 'weightedAvgSharesBasis' },
      quarterlyRecords: [recA, recB],
      userRole: 'admin',
    });
    assert.equal(okRes.status, 'open');
    if (okRes.status === 'open') {
      assert.equal(okRes.record.ticker, 'COMI');
      assert.equal(okRes.record.year, 2025);
      assert.equal(okRes.record.quarter, 'Q3');
      assert.equal(okRes.focusField, 'weightedAvgSharesBasis');
    }

    // 2. Missing period -> returns not_found (never fabricates or substitutes recB)
    const missingRes = resolveRequestedQuarterlyEditTarget({
      target: { ticker: 'COMI', year: 2024, quarter: 'Q3', field: 'periodStartDate' },
      quarterlyRecords: [recA, recB],
      userRole: 'data_entry',
    });
    assert.equal(missingRes.status, 'not_found');
    if (missingRes.status === 'not_found') {
      assert.match(missingRes.messageAr, /لم يُنشأ سجل بديل ولم يُبدَّل السهم المختار/);
    }

    // 3. Unauthorized subscriber role -> blocked cleanly
    const unauthRes = resolveRequestedQuarterlyEditTarget({
      target: { ticker: 'COMI', year: 2025, quarter: 'Q3', field: 'equityCommon' },
      quarterlyRecords: [recA],
      userRole: 'subscriber',
    });
    assert.equal(unauthRes.status, 'unauthorized');
    if (unauthRes.status === 'unauthorized') {
      assert.match(unauthRes.messageAr, /لا تملك صلاحية تعديل/);
    }
  });

  it('EditQuarterlyRecordModal exposes all new period/accounting data-field targets, highlights focusField, and isolates state per record', () => {
    const htmlA = renderToStaticMarkup(
      React.createElement(EditQuarterlyRecordModal, {
        isOpen: true,
        record: recA,
        focusField: 'periodStartDate',
        onClose: () => {},
        onSave: () => {},
      })
    );
    assert.match(htmlA, /COMI \(Q3 2025\)/);
    assert.match(htmlA, /data-field="periodStartDate"/);
    assert.match(htmlA, /data-field="periodEndDate"/);
    assert.match(htmlA, /data-field="periodDays"/);
    assert.match(htmlA, /data-field="weightedAvgSharesBasis"/);
    assert.match(htmlA, /data-field="intangibleAssets"/);
    assert.match(htmlA, /data-field="financeCostsYTD"/);
    assert.match(htmlA, /data-field="interestIncomeYTD"/);
    assert.match(htmlA, /data-field="interestPaidYTD"/);
    assert.match(htmlA, /ring-2 ring-amber-400/);
    assert.doesNotMatch(htmlA, /DPS_Current/i);

    const htmlB = renderToStaticMarkup(
      React.createElement(EditQuarterlyRecordModal, {
        isOpen: true,
        record: recB,
        focusField: 'weightedAvgSharesBasis',
        onClose: () => {},
        onSave: () => {},
      })
    );
    assert.match(htmlB, /TMGH \(FY 2025\)/);
    assert.match(htmlB, /2025-01-01/);
    assert.match(htmlB, /2025-12-31/);
    assert.doesNotMatch(htmlB, /COMI \(Q3 2025\)/);
  });

  it('QuarterlyRecordsTable renders unified table including weightedAvgSharesBasis and period boundary columns', () => {
    const html = renderToStaticMarkup(
      React.createElement(QuarterlyRecordsTable, {
        selectedTicker: 'TMGH',
        records: [recB],
        userRole: 'admin',
        onRequestEdit: () => {},
        onRequestDelete: () => {},
      })
    );
    assert.match(html, /WeightedAvgShares_Basis/);
    assert.match(html, /PeriodStartDate/);
    assert.match(html, /PeriodEndDate/);
    assert.match(html, /PeriodDays/);
    assert.match(html, /2025-01-01/);
    assert.match(html, /2025-12-31/);
    assert.match(html, /365/);
  });
});
