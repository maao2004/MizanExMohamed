/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import * as XLSX from 'xlsx';

import {
  getParameterDefinition,
  getValuationLabField,
  RELATIVE_WEIGHT_REGISTRY_KEYS,
} from '../src/core/contracts';
import { createEmptySyncState, FirestoreSessionManager } from '../src/core/domain/firestoreSessionManager';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { ValuationView } from '../src/components/ValuationView';
import { buildCompanyValuationWorkbook } from '../src/utils/excelExport';
import type {
  Company,
  CompanyParameterOverride,
  MacroParameter,
  QuarterlyFinancial,
} from '../src/types';

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'C_TEST',
    ticker: 'TEST',
    nameAr: 'شركة اختبار التقييم النسبي',
    nameEn: 'Relative Valuation Test Co',
    sector: 'الصناعة',
    rawSector: 'الصناعة',
    sectorId: 'industrial',
    sectorClassification: 'non_financial',
    marketPrice: 40,
    marketPriceCurrency: 'EGP',
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
    ...overrides,
  };
}

function makeQuarterly(): QuarterlyFinancial {
  return {
    id: 'TEST_2025_FY',
    companyId: 'C_TEST',
    year: 2025,
    quarter: 'FY',
    periodDate: '2025-12-31',
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 450_000_000,
    operatingProfitYTD: 300_000_000,
    netProfitYTD: 250_000_000,
    netIncomeCommonYTD: 250_000_000,
    netIncomeCommonBasis: 'attested_common_ni',
    operatingCashFlowYTD: 280_000_000,
    capexYTD: 50_000_000,
    dividendsPaidYTD: 0,
    totalAssets: 2_000_000_000,
    totalLiabilities: 750_000_000,
    totalEquity: 1_250_000_000,
    commonEquity: 1_250_000_000,
    commonEquityBasis: 'attested_common_equity',
    totalDebt: 200_000_000,
    cashAndEquivalents: 150_000_000,
    sharesOutstanding: 100_000_000,
    financialCurrency: 'EGP',
    financialUnit: 'base',
  };
}

// EPS_TTM = 250M / 100M = 2.50 EGP -> Target_PE = 10 => peImplied = 25.00
// BVPS = 1,250M / 100M = 12.50 EGP -> Target_PB = 4  => pbImplied = 50.00
const BASE_MACROS: Record<string, number> = {
  Rf_Egypt_10Y: 0.24,
  ERP_Developed: 0.05,
  CRP_Egypt: 0.06,
  Country_Risk_Lambda: 1,
  r_Mode: 1,
  WACC_Mode: 1,
  Beta_Raw_Weight: 0.67,
  Beta_Anchor: 1,
  Weight_DCF: 25,
  Weight_DDM: 15,
  Weight_RIM: 20,
  Weight_Relative: 30,
  Weight_Graham: 10,
};

function makeTargetOverrides(opts: { pe?: number | null; pb?: number | null } = {}): Record<string, CompanyParameterOverride> {
  const out: Record<string, CompanyParameterOverride> = {};
  if (opts.pe !== null) {
    out.Target_PE = {
      ticker: 'TEST',
      key: 'Target_PE',
      value: opts.pe ?? 10,
      scope: 'company',
      source: 'دراسة قطاعية 2026',
      asOfDate: '2026-03-01',
    };
  }
  if (opts.pb !== null) {
    out.Target_PB = {
      ticker: 'TEST',
      key: 'Target_PB',
      value: opts.pb ?? 4,
      scope: 'company',
      source: 'مذكرة القيمة الدفترية',
      asOfDate: '2026-03-01',
    };
  }
  return out;
}

describe('Batch 34: Relative Valuation Weights Clarity, Provenance, Remediation & Parity', () => {
  it('1) Central definitions clarify blending meaning and keep original DB keys without aliases', () => {
    assert.deepEqual([...RELATIVE_WEIGHT_REGISTRY_KEYS], ['Relative_PE_Weight', 'Relative_PB_Weight']);
    const peDef = getParameterDefinition('Relative_PE_Weight');
    const pbDef = getParameterDefinition('Relative_PB_Weight');
    assert.ok(peDef && pbDef);
    assert.equal(peDef.valueType, 'number');
    assert.equal(pbDef.valueType, 'number');
    assert.deepEqual(peDef.allowedScopes, ['global', 'company']);
    assert.deepEqual(pbDef.allowedScopes, ['global', 'company']);
    assert.match(peDef.nameAr, /وزن دمج قيمة P\/E/);
    assert.match(pbDef.nameAr, /وزن دمج قيمة P\/B/);
    assert.match(peDef.descriptionAr, /ليس مضاعف الربحية نفسه/);
    assert.match(pbDef.descriptionAr, /ليس مضاعف القيمة الدفترية نفسه/);
    assert.equal(getParameterDefinition('Rel_PE_W'), null);
    assert.equal(getParameterDefinition('Rel_PB_W'), null);

    const peField = getValuationLabField('Relative_PE_Weight');
    const pbField = getValuationLabField('Relative_PB_Weight');
    assert.ok(peField && pbField);
    assert.equal(peField.scale, 1);
    assert.equal(pbField.scale, 1);
    assert.equal(peField.authoritativeSource, 'company_assumptions_or_macro_params');
    assert.equal(pbField.authoritativeSource, 'company_assumptions_or_macro_params');
  });

  it('2) Company override without global values works and preserves documentary source & date without fabrication', () => {
    const company = makeCompany();
    const q = makeQuarterly();
    const metrics = calculateTTMMetrics(company, [q]);
    const overrides: Record<string, CompanyParameterOverride> = {
      ...makeTargetOverrides(),
      Relative_PE_Weight: {
        ticker: 'TEST',
        key: 'Relative_PE_Weight',
        value: 60,
        scope: 'company',
        source: 'لجنة الاستثمار — شركة TEST',
        asOfDate: '2026-04-10',
      },
      // Intentionally undocumented documentary source & date on PB weight:
      Relative_PB_Weight: {
        ticker: 'TEST',
        key: 'Relative_PB_Weight',
        value: 40,
        scope: 'company',
      },
    };

    const val = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      priority: 'company_first',
      companyOverridesMap: overrides,
      companyOverridesConfirmed: true,
      macroParamsConfirmed: true,
      disableLegacyCompanyFallback: true,
    });

    // (25 * 60 + 50 * 40) / 100 = 35
    assert.equal(val.relativeFairValue, 35);
    const audit = val.relativeAudit!;
    assert.equal(audit.status, 'blended_both');
    assert.equal(audit.blendingApplied, true);
    assert.equal(audit.weightsSum, 100);

    assert.equal(audit.peWeight.rawValue, 60);
    assert.equal(audit.peWeight.normalizedSharePct, 60);
    assert.equal(audit.peWeight.scope, 'company');
    assert.equal(audit.peWeight.documentarySource, 'لجنة الاستثمار — شركة TEST');
    assert.equal(audit.peWeight.asOfDate, '2026-04-10');
    assert.equal(audit.peWeight.globalValue, null);

    // Undocumented company override must NOT fabricate source or date
    assert.equal(audit.pbWeight.rawValue, 40);
    assert.equal(audit.pbWeight.normalizedSharePct, 40);
    assert.equal(audit.pbWeight.scope, 'company');
    assert.equal(audit.pbWeight.documentarySource, null);
    assert.equal(audit.pbWeight.asOfDate, null);
  });

  it('3) Global values without company override work with full scope/documentary metadata', () => {
    const company = makeCompany();
    const q = makeQuarterly();
    const metrics = calculateTTMMetrics(company, [q]);
    const params = {
      ...BASE_MACROS,
      Relative_PE_Weight: 0.7,
      Relative_PB_Weight: 0.3,
    };
    const macroMetaMap = {
      Relative_PE_Weight: { source: 'سياسة التقييم الكلية', asOfDate: '2026-01-15' },
      Relative_PB_Weight: { source: 'سياسة التقييم الكلية', asOfDate: '2026-01-15' },
    };

    const val = runValuationModels(company, metrics, undefined, params, {
      priority: 'company_first',
      companyOverridesMap: makeTargetOverrides(),
      macroMetaMap,
      companyOverridesConfirmed: true,
      macroParamsConfirmed: true,
      disableLegacyCompanyFallback: true,
    });

    // (25 * 0.7 + 50 * 0.3) / 1 = 32.5
    assert.ok(val.relativeFairValue !== null && Math.abs(val.relativeFairValue - 32.5) < 1e-9);
    const audit = val.relativeAudit!;
    assert.equal(audit.peWeight.scope, 'global');
    assert.equal(audit.peWeight.rawValue, 0.7);
    assert.ok(Math.abs((audit.peWeight.normalizedSharePct ?? 0) - 70) < 1e-9);
    assert.equal(audit.peWeight.documentarySource, 'سياسة التقييم الكلية');
    assert.equal(audit.peWeight.asOfDate, '2026-01-15');
    assert.equal(audit.peWeight.companyValue, null);
    assert.equal(audit.pbWeight.scope, 'global');
  });

  it('4) Both scopes present: company_first vs global_first switches winning scope, source, date, and keeps both scopes visible', () => {
    const company = makeCompany();
    const q = makeQuarterly();
    const metrics = calculateTTMMetrics(company, [q]);
    const overrides: Record<string, CompanyParameterOverride> = {
      ...makeTargetOverrides(),
      Relative_PE_Weight: {
        ticker: 'TEST',
        key: 'Relative_PE_Weight',
        value: 80,
        scope: 'company',
        source: 'مذكرة تخصيص الشركة',
        asOfDate: '2026-04-01',
      },
      Relative_PB_Weight: {
        ticker: 'TEST',
        key: 'Relative_PB_Weight',
        value: 20,
        scope: 'company',
        source: 'مذكرة تخصيص الشركة',
        asOfDate: '2026-04-01',
      },
    };
    const params = {
      ...BASE_MACROS,
      Relative_PE_Weight: 20,
      Relative_PB_Weight: 80,
    };
    const macroMetaMap = {
      Relative_PE_Weight: { source: 'مرجع المنصة العام', asOfDate: '2026-02-01' },
      Relative_PB_Weight: { source: 'مرجع المنصة العام', asOfDate: '2026-02-01' },
    };

    const companyFirst = runValuationModels(company, metrics, undefined, params, {
      priority: 'company_first',
      companyOverridesMap: overrides,
      macroMetaMap,
      disableLegacyCompanyFallback: true,
    });
    // (25 * 80 + 50 * 20) / 100 = 30
    assert.equal(companyFirst.relativeFairValue, 30);
    assert.equal(companyFirst.relativeAudit?.priority, 'company_first');
    assert.equal(companyFirst.relativeAudit?.peWeight.scope, 'company');
    assert.equal(companyFirst.relativeAudit?.peWeight.rawValue, 80);
    assert.equal(companyFirst.relativeAudit?.peWeight.normalizedSharePct, 80);
    assert.equal(companyFirst.relativeAudit?.peWeight.documentarySource, 'مذكرة تخصيص الشركة');
    assert.equal(companyFirst.relativeAudit?.peWeight.asOfDate, '2026-04-01');
    assert.equal(companyFirst.relativeAudit?.peWeight.companyValue, 80);
    assert.equal(companyFirst.relativeAudit?.peWeight.globalValue, 20);
    assert.equal(companyFirst.relativeAudit?.peWeight.globalDocumentarySource, 'مرجع المنصة العام');
    assert.equal(companyFirst.relativeAudit?.peWeight.globalAsOfDate, '2026-02-01');
    assert.equal(companyFirst.relativeAudit?.peWeight.isOverriddenByPriority, false);

    const globalFirst = runValuationModels(company, metrics, undefined, params, {
      priority: 'global_first',
      companyOverridesMap: overrides,
      macroMetaMap,
      disableLegacyCompanyFallback: true,
    });
    // (25 * 20 + 50 * 80) / 100 = 45
    assert.equal(globalFirst.relativeFairValue, 45);
    assert.equal(globalFirst.relativeAudit?.priority, 'global_first');
    assert.equal(globalFirst.relativeAudit?.peWeight.scope, 'global');
    assert.equal(globalFirst.relativeAudit?.peWeight.rawValue, 20);
    assert.equal(globalFirst.relativeAudit?.peWeight.normalizedSharePct, 20);
    assert.equal(globalFirst.relativeAudit?.peWeight.documentarySource, 'مرجع المنصة العام');
    assert.equal(globalFirst.relativeAudit?.peWeight.asOfDate, '2026-02-01');
    assert.equal(globalFirst.relativeAudit?.peWeight.companyValue, 80);
    assert.equal(globalFirst.relativeAudit?.peWeight.companyDocumentarySource, 'مذكرة تخصيص الشركة');
    assert.equal(globalFirst.relativeAudit?.peWeight.globalValue, 20);
    assert.equal(globalFirst.relativeAudit?.peWeight.isOverriddenByPriority, true);
    assert.match(globalFirst.relativeAudit?.peWeight.priorityExplanationAr ?? '', /global_first/);
  });

  it('5) Missing weight, single zero weight (1/0 valid), negative weight, and zero sum (0/0 blocked) produce accurate diagnostics naming both scopes', () => {
    const company = makeCompany();
    const q = makeQuarterly();
    const metrics = calculateTTMMetrics(company, [q]);

    // 5a) Missing PB weight only
    const missingPb = runValuationModels(
      company,
      metrics,
      undefined,
      { ...BASE_MACROS, Relative_PE_Weight: 60 },
      {
        companyOverridesMap: makeTargetOverrides(),
        companyOverridesConfirmed: true,
        macroParamsConfirmed: true,
        disableLegacyCompanyFallback: true,
      }
    );
    assert.equal(missingPb.relativeFairValue, null);
    assert.equal(missingPb.relativeAudit?.status, 'blocked_weights');
    assert.equal(missingPb.relativeAudit?.blendingApplied, false);
    assert.equal(missingPb.relativeAudit?.peWeight.normalizedSharePct, null);
    assert.equal(missingPb.relativeAudit?.pbWeight.normalizedSharePct, null);
    assert.match(missingPb.relativeAudit?.blockingReasonAr ?? '', /Relative_PB_Weight/);
    assert.match(missingPb.relativeAudit?.blockingReasonAr ?? '', /company_assumptions/);
    assert.match(missingPb.relativeAudit?.blockingReasonAr ?? '', /macro_params/);
    assert.ok(!(missingPb.relativeAudit?.blockingReasonAr ?? '').includes('في المتغيرات الكلية.'));

    // 5b) Single zero weight (1 and 0) => valid! 100% P/E, 0% P/B
    const singleZero = runValuationModels(
      company,
      metrics,
      undefined,
      { ...BASE_MACROS, Relative_PE_Weight: 1, Relative_PB_Weight: 0 },
      {
        companyOverridesMap: makeTargetOverrides(),
        disableLegacyCompanyFallback: true,
      }
    );
    assert.equal(singleZero.relativeFairValue, 25);
    assert.equal(singleZero.relativeAudit?.status, 'blended_both');
    assert.equal(singleZero.relativeAudit?.blendingApplied, true);
    assert.equal(singleZero.relativeAudit?.peWeight.rawValue, 1);
    assert.equal(singleZero.relativeAudit?.pbWeight.rawValue, 0);
    assert.equal(singleZero.relativeAudit?.peWeight.normalizedSharePct, 100);
    assert.equal(singleZero.relativeAudit?.pbWeight.normalizedSharePct, 0);

    // 5c) Zero sum (0 and 0) => blocked
    const zeroSum = runValuationModels(
      company,
      metrics,
      undefined,
      { ...BASE_MACROS, Relative_PE_Weight: 0, Relative_PB_Weight: 0 },
      {
        companyOverridesMap: makeTargetOverrides(),
        disableLegacyCompanyFallback: true,
      }
    );
    assert.equal(zeroSum.relativeFairValue, null);
    assert.equal(zeroSum.relativeAudit?.status, 'blocked_weights');
    assert.equal(zeroSum.relativeAudit?.peWeight.normalizedSharePct, null);
    assert.equal(zeroSum.relativeAudit?.pbWeight.normalizedSharePct, null);
    assert.match(zeroSum.relativeAudit?.blockingReasonAr ?? '', /مجموع وزني الدمج يساوي صفراً/);
    assert.match(zeroSum.relativeAudit?.remediationAr ?? '', /company_assumptions/);
    assert.match(zeroSum.relativeAudit?.remediationAr ?? '', /macro_params/);

    // 5d) Negative weight => blocked and names invalid weight
    const negativeW = runValuationModels(
      company,
      metrics,
      undefined,
      { ...BASE_MACROS, Relative_PE_Weight: -10, Relative_PB_Weight: 50 },
      {
        companyOverridesMap: makeTargetOverrides(),
        disableLegacyCompanyFallback: true,
      }
    );
    assert.equal(negativeW.relativeFairValue, null);
    assert.equal(negativeW.relativeAudit?.status, 'blocked_weights');
    assert.equal(negativeW.relativeAudit?.peWeight.validity, 'negative');
    assert.match(negativeW.relativeAudit?.blockingReasonAr ?? '', /Relative_PE_Weight/);
  });

  it('6) Numeric equivalence: 60/40 and 0.6/0.4 produce identical fair value and normalized shares while preserving distinct raw values', () => {
    const company = makeCompany();
    const q = makeQuarterly();
    const metrics = calculateTTMMetrics(company, [q]);

    const val6040 = runValuationModels(
      company,
      metrics,
      undefined,
      { ...BASE_MACROS, Relative_PE_Weight: 60, Relative_PB_Weight: 40 },
      { companyOverridesMap: makeTargetOverrides(), disableLegacyCompanyFallback: true }
    );
    const val0604 = runValuationModels(
      company,
      metrics,
      undefined,
      { ...BASE_MACROS, Relative_PE_Weight: 0.6, Relative_PB_Weight: 0.4 },
      { companyOverridesMap: makeTargetOverrides(), disableLegacyCompanyFallback: true }
    );

    assert.ok(val6040.relativeFairValue !== null && val0604.relativeFairValue !== null);
    assert.ok(Math.abs(val6040.relativeFairValue - val0604.relativeFairValue) < 1e-12);
    assert.equal(val6040.relativeAudit?.peWeight.rawValue, 60);
    assert.equal(val6040.relativeAudit?.pbWeight.rawValue, 40);
    assert.equal(val0604.relativeAudit?.peWeight.rawValue, 0.6);
    assert.equal(val0604.relativeAudit?.pbWeight.rawValue, 0.4);
    assert.ok(Math.abs((val6040.relativeAudit?.peWeight.normalizedSharePct ?? 0) - 60) < 1e-9);
    assert.ok(Math.abs((val0604.relativeAudit?.peWeight.normalizedSharePct ?? 0) - 60) < 1e-9);
    assert.ok(Math.abs((val6040.relativeAudit?.pbWeight.normalizedSharePct ?? 0) - 40) < 1e-9);
    assert.ok(Math.abs((val0604.relativeAudit?.pbWeight.normalizedSharePct ?? 0) - 40) < 1e-9);
  });

  it('7) Single branch available (only P/E or only P/B) adopts it directly without demanding weights or displaying fake blending shares', () => {
    const company = makeCompany();
    const q = makeQuarterly();
    const metrics = calculateTTMMetrics(company, [q]);

    const onlyPe = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      companyOverridesMap: makeTargetOverrides({ pe: 10, pb: null }),
      disableLegacyCompanyFallback: true,
    });
    assert.equal(onlyPe.relativeFairValue, 25);
    assert.equal(onlyPe.relativeAudit?.status, 'single_pe_only');
    assert.equal(onlyPe.relativeAudit?.blendingApplied, false);
    assert.equal(onlyPe.relativeAudit?.blendingRequired, false);
    assert.equal(onlyPe.relativeAudit?.blockingReasonAr, null);
    assert.equal(onlyPe.relativeAudit?.peWeight.normalizedSharePct, null);
    assert.equal(onlyPe.relativeAudit?.pbWeight.normalizedSharePct, null);

    const onlyPb = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      companyOverridesMap: makeTargetOverrides({ pe: null, pb: 4 }),
      disableLegacyCompanyFallback: true,
    });
    assert.equal(onlyPb.relativeFairValue, 50);
    assert.equal(onlyPb.relativeAudit?.status, 'single_pb_only');
    assert.equal(onlyPb.relativeAudit?.blendingApplied, false);
    assert.equal(onlyPb.relativeAudit?.blendingRequired, false);
    assert.equal(onlyPb.relativeAudit?.blockingReasonAr, null);
    assert.equal(onlyPb.relativeAudit?.peWeight.normalizedSharePct, null);
    assert.equal(onlyPb.relativeAudit?.pbWeight.normalizedSharePct, null);
  });

  it('8) Incomplete loading state never falsely claims weights are missing, and FirestoreSessionManager tracks macroParamsConfirmed', () => {
    const emptyState = createEmptySyncState();
    assert.equal(emptyState.companyOverridesConfirmed, false);
    assert.equal(emptyState.macroParamsConfirmed, false);

    const mgr = new FirestoreSessionManager();
    const tok = mgr.beginSession('u1');
    const res = mgr.applyNonQuarterlySnapshot(
      tok,
      'macroParams',
      [{ key: 'Relative_PE_Weight', value: 60, asOfDate: '2026-03-01', source: 'تقرير' } as MacroParameter],
      { fromCache: false, hasPendingWrites: false }
    );
    assert.equal(res.accepted, true);
    assert.equal(res.state.macroParamsConfirmed, true);
    assert.equal(res.state.companyOverridesConfirmed, false);

    const company = makeCompany();
    const q = makeQuarterly();
    const metrics = calculateTTMMetrics(company, [q]);
    const unconfirmed = runValuationModels(company, metrics, undefined, BASE_MACROS, {
      companyOverridesMap: makeTargetOverrides(),
      companyOverridesConfirmed: false,
      macroParamsConfirmed: false,
      disableLegacyCompanyFallback: true,
    });

    assert.equal(unconfirmed.relativeFairValue, null);
    assert.equal(unconfirmed.relativeAudit?.status, 'loading_unconfirmed');
    assert.equal(unconfirmed.relativeAudit?.peWeight.scope, 'loading_unconfirmed');
    assert.equal(unconfirmed.relativeAudit?.pbWeight.scope, 'loading_unconfirmed');
    assert.deepEqual(unconfirmed.relativeAudit?.loadingUnconfirmedScopes, [
      'company_assumptions',
      'macro_params',
    ]);
    assert.match(unconfirmed.relativeAudit?.blockingReasonAr ?? '', /لم يكتمل تأكيد تحميل/);
  });

  it('9) Full parity across Engine, UI (ValuationView SSR & interactive sensitivity draft), and Excel Export with zero Firestore writes', async () => {
    const company = makeCompany();
    const q = makeQuarterly();
    const metrics = calculateTTMMetrics(company, [q]);
    const overrides: Record<string, CompanyParameterOverride> = {
      ...makeTargetOverrides(),
      Relative_PE_Weight: {
        ticker: 'TEST',
        key: 'Relative_PE_Weight',
        value: 60,
        scope: 'company',
        source: 'دراسة خاصة بالشركة',
        asOfDate: '2026-04-05',
      },
      Relative_PB_Weight: {
        ticker: 'TEST',
        key: 'Relative_PB_Weight',
        value: 40,
        scope: 'company',
        source: 'دراسة خاصة بالشركة',
        asOfDate: '2026-04-05',
      },
    };
    const params = {
      ...BASE_MACROS,
      Relative_PE_Weight: 30,
      Relative_PB_Weight: 70,
    };
    const macroMetaMap = {
      Relative_PE_Weight: { source: 'مرجع كلي عام', asOfDate: '2026-01-10' },
      Relative_PB_Weight: { source: 'مرجع كلي عام', asOfDate: '2026-01-10' },
    };

    const val = runValuationModels(company, metrics, undefined, params, {
      priority: 'global_first',
      companyOverridesMap: overrides,
      macroMetaMap,
      companyOverridesConfirmed: true,
      macroParamsConfirmed: true,
      quarterlyRecords: [],
      disableLegacyCompanyFallback: true,
    });

    let writeCalls = 0;
    const html = renderToStaticMarkup(
      React.createElement(ValuationView, {
        company,
        metrics: {
          ...metrics,
          costOfEquity: val.engineOutputs?.costOfEquity ?? null,
          wacc: val.engineOutputs?.wacc ?? null,
        },
        valuation: val,
        assumptionPriority: 'global_first',
        onChangePriority: () => undefined,
        onUpdateCompanyParams: () => undefined,
        companyOverridesMap: overrides,
        companyOverridesConfirmed: true,
        paramsMap: params,
        macroParamsConfirmed: true,
        macroMetaMap,
        isAdmin: true,
        canEditFinancials: true,
        onSaveCompanyOverride: async () => {
          writeCalls += 1;
          return { docPath: 'company_assumptions/TEST/parameters/Relative_PE_Weight', verifiedAt: '2026-04-05' };
        },
        onSaveGlobalMacroParam: async () => {
          writeCalls += 1;
          return { docPath: 'macro_params/Relative_PE_Weight', verifiedAt: '2026-04-05' };
        },
        initialModelTab: 'relative',
      })
    );

    assert.equal(writeCalls, 0);
    // Abbreviations must be completely gone
    assert.ok(!html.includes('Rel_PE_W'), 'UI must not render Rel_PE_W abbreviation');
    assert.ok(!html.includes('Rel_PB_W'), 'UI must not render Rel_PB_W abbreviation');
    // Clear Arabic labels + secondary technical keys
    assert.match(html, /وزن دمج قيمة P\/E/);
    assert.match(html, /وزن دمج قيمة P\/B/);
    assert.match(html, /Relative_PE_Weight/);
    assert.match(html, /Relative_PB_Weight/);
    // Scope vs documentary source vs effective date + both scopes' values + normalized shares (30% / 70%)
    assert.match(html, /الافتراض العام أولاً \(global_first\)/);
    assert.match(html, /مرجع كلي عام/);
    assert.match(html, /2026-01-10/);
    assert.match(html, /دراسة خاصة بالشركة/);
    assert.match(html, /2026-04-05/);
    assert.match(html, /30\.0%/);
    assert.match(html, /70\.0%/);
    // Reuses unified ValuationParameterCard controls
    assert.match(html, /param-card-Relative_PE_Weight/);
    assert.match(html, /param-card-Relative_PB_Weight/);

    // Excel export parity (existing sheets only — no duplicate Relative sheet)
    const wb = await buildCompanyValuationWorkbook(company, [q], metrics, val, []);
    assert.ok(!wb.SheetNames.includes('Relative_Weights_Duplicate'));
    const summaryRows = XLSX.utils.sheet_to_json(wb.Sheets['ملخص التقييم'], { header: 1 }) as unknown[][];
    const peSummaryRow = summaryRows.find((r) => String(r[0] ?? '').includes('Relative_PE_Weight'));
    const pbSummaryRow = summaryRows.find((r) => String(r[0] ?? '').includes('Relative_PB_Weight'));
    assert.ok(peSummaryRow && pbSummaryRow);
    assert.equal(peSummaryRow[1], '30');
    assert.equal(peSummaryRow[2], '30.0%');
    assert.match(String(peSummaryRow[3]), /المتغيرات الكلية \(macro_params\)/);
    assert.match(String(peSummaryRow[3]), /مرجع كلي عام/);
    assert.match(String(peSummaryRow[3]), /2026-01-10/);
    assert.match(String(peSummaryRow[3]), /تخصيص الشركة: 60/);
    assert.equal(pbSummaryRow[1], '70');
    assert.equal(pbSummaryRow[2], '70.0%');

    const assumptionsRows = XLSX.utils.sheet_to_json(wb.Sheets['الافتراضات_والمصادر'], { header: 1 }) as unknown[][];
    const peAssumpRow = assumptionsRows.find((r) => r[0] === 'relativePeWeight');
    assert.ok(peAssumpRow);
    assert.equal(peAssumpRow[1], 'Relative_PE_Weight');
    assert.equal(peAssumpRow[3], 30);
    assert.equal(peAssumpRow[4], 'عام محفوظ');
    assert.match(String(peAssumpRow[5]), /Global First/);
    assert.equal(peAssumpRow[6], 60);
    assert.equal(peAssumpRow[7], 30);
    assert.equal(peAssumpRow[8], 'نعم');
    assert.equal(peAssumpRow[9], '2026-01-10');
    assert.equal(peAssumpRow[10], 'مرجع كلي عام');

    // Interactive sensitivity draft test via happy-dom: changing sensitivity draft updates calculation in-memory with ZERO Firestore writes and NO fabricated asOfDate
    const win = new Window({ url: 'http://localhost/' });
    const prevGlobals: Record<string, unknown> = {
      window: (globalThis as Record<string, unknown>).window,
      document: (globalThis as Record<string, unknown>).document,
      HTMLElement: (globalThis as Record<string, unknown>).HTMLElement,
      HTMLInputElement: (globalThis as Record<string, unknown>).HTMLInputElement,
      HTMLButtonElement: (globalThis as Record<string, unknown>).HTMLButtonElement,
      Element: (globalThis as Record<string, unknown>).Element,
      Node: (globalThis as Record<string, unknown>).Node,
      Event: (globalThis as Record<string, unknown>).Event,
      InputEvent: (globalThis as Record<string, unknown>).InputEvent,
      IS_REACT_ACT_ENVIRONMENT: (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT,
    };
    const prevNav = globalThis.navigator;
    (globalThis as unknown as Record<string, unknown>).window = win;
    (globalThis as unknown as Record<string, unknown>).document = win.document;
    (globalThis as unknown as Record<string, unknown>).HTMLElement = win.HTMLElement;
    (globalThis as unknown as Record<string, unknown>).HTMLInputElement = win.HTMLInputElement;
    (globalThis as unknown as Record<string, unknown>).HTMLButtonElement = win.HTMLButtonElement;
    (globalThis as unknown as Record<string, unknown>).Element = win.Element;
    (globalThis as unknown as Record<string, unknown>).Node = win.Node;
    (globalThis as unknown as Record<string, unknown>).Event = win.Event;
    (globalThis as unknown as Record<string, unknown>).InputEvent = win.InputEvent;
    Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

    const { createRoot } = await import('react-dom/client');
    const container = win.document.createElement('div');
    win.document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          React.createElement(ValuationView, {
            company,
            metrics: {
              ...metrics,
              costOfEquity: val.engineOutputs?.costOfEquity ?? null,
              wacc: val.engineOutputs?.wacc ?? null,
            },
            valuation: val,
            assumptionPriority: 'global_first',
            onChangePriority: () => undefined,
            onUpdateCompanyParams: () => undefined,
            companyOverridesMap: overrides,
            companyOverridesConfirmed: true,
            paramsMap: params,
            macroParamsConfirmed: true,
            macroMetaMap,
            isAdmin: true,
            canEditFinancials: true,
            onSaveCompanyOverride: async () => {
              writeCalls += 1;
              return { docPath: 'company_assumptions/TEST/parameters/Relative_PE_Weight', verifiedAt: '2026-04-05' };
            },
            onSaveGlobalMacroParam: async () => {
              writeCalls += 1;
              return { docPath: 'macro_params/Relative_PE_Weight', verifiedAt: '2026-04-05' };
            },
            initialModelTab: 'relative',
          })
        );
      });

      const peCard = container.querySelector('[data-testid="param-card-Relative_PE_Weight"]');
      assert.ok(peCard);
      const input = peCard.querySelector('input[type="number"]') as HTMLInputElement | null;
      assert.ok(input);

      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, '70');
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
        input.dispatchEvent(new win.Event('change', { bubbles: true }));
      });

      const buttons = Array.from(peCard.querySelectorAll('button'));
      const trialBtn = buttons.find((b) => (b.textContent ?? '').includes('تجربة مؤقتة'));
      assert.ok(trialBtn, 'Sensitivity trial button must exist on Relative_PE_Weight card');

      await act(async () => {
        trialBtn.click();
      });

      // With draft Relative_PE_Weight = 70 and Relative_PB_Weight = 70 => 50.0% / 50.0%, fair value = 37.50, ZERO writes!
      assert.equal(writeCalls, 0);
      const peSummaryDom = container.querySelector('[data-testid="relative-weight-summary-Relative_PE_Weight"]');
      assert.ok(peSummaryDom);
      assert.match(peSummaryDom.textContent ?? '', /50\.0%/);
      assert.match(peSummaryDom.textContent ?? '', /غير محدد/); // No fabricated date on temporary sensitivity draft
    } finally {
      await act(async () => {
        root.unmount();
      });
      await win.close();
      for (const [k, v] of Object.entries(prevGlobals)) {
        (globalThis as Record<string, unknown>)[k] = v;
      }
      Object.defineProperty(globalThis, 'navigator', { value: prevNav, configurable: true });
    }
  });
});
