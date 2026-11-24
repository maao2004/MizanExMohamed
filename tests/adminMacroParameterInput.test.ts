/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  RECORD_SCHEMA_VERSION,
  buildMacroParameterWritePayload,
  buildParameterUpdatePrecondition,
  computeRecordBusinessHash,
  normalizeMacroParameterFromFirestore,
  planParameterPersistenceWrites,
  resolveCanonicalParameterType,
  validateParameterRecords,
  type ParameterDocumentProvenance,
} from '../src/core/contracts';
import {
  buildNewMacroParameterFromDraft,
  createMacroParamDraftMap,
  formatExactNumberString,
  formatParameterCompactPreview,
  getMacroParameterInputSpec,
  getMissingGlobalParameterDefinitions,
  parseAndValidateMacroParameterDraft,
  prepareMacroParamsForSave,
  resolveValuationAssumptions,
  storedValueToDisplayString,
  storedValueToEditString,
} from '../src/core/domain';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import { AdminDashboard } from '../src/modules/admin/AdminDashboard';
import type {
  AppUser,
  Company,
  CompanyParameterOverride,
  MacroParameter,
  QuarterlyFinancial,
} from '../src/types';

const ADMIN_USER: AppUser = {
  id: 'admin_test_1',
  email: 'admin@mizanex.local',
  displayName: 'مدير اختباري',
  role: 'admin',
  tier: 'enterprise',
  isActive: true,
  createdAt: '2026-01-01',
};

const TEST_PROVENANCE: ParameterDocumentProvenance = {
  importId: 'test_import_1',
  sourceFile: 'admin_ui_test',
  sourceSheet: 'bulk_parameters',
  schemaVersion: RECORD_SCHEMA_VERSION,
  updatedBy: ADMIN_USER.id,
  updatedAt: '2026-11-20T00:00:00.000Z',
  serverUpdatedAt: 'SERVER_TIMESTAMP',
  isDeleted: false,
};

/**
 * Isolated in-memory Firestore document store exercising the EXACT shared production
 * client payload builder (`buildMacroParameterWritePayload`), server write planner
 * (`planParameterPersistenceWrites`, used identically by `bulk_parameters` & `macro_parameter`
 * in `functions/src/index.ts`), `{ merge: true }` write semantics, and reader transform
 * (`normalizeMacroParameterFromFirestore`, used by `mapMacroSnapshot`).
 */
class IsolatedParameterStore {
  public readonly docs = new Map<string, Record<string, any>>();

  public executeBulkSave(params: MacroParameter[]) {
    const rawInputs = params.map((p) => {
      const existing = this.docs.get(`macro_params/${p.key}`);
      const precondition =
        existing && existing.isDeleted !== true
          ? buildParameterUpdatePrecondition(existing)
          : ({ mode: 'create' } as const);
      return buildMacroParameterWritePayload(p, precondition);
    });
    const plan = planParameterPersistenceWrites({
      rawInputs,
      existingDocsByPath: this.docs,
      provenance: { ...TEST_PROVENANCE, sourceSheet: 'bulk_parameters' },
    });
    for (const write of plan.writes) {
      if (write.status === 'skip' || !write.document) continue;
      const prev = this.docs.get(write.docPath) ?? {};
      this.docs.set(write.docPath, { ...prev, ...write.document });
    }
    return plan;
  }

  public executeSingleSave(param: MacroParameter) {
    const existing = this.docs.get(`macro_params/${param.key}`);
    const precondition =
      existing && existing.isDeleted !== true
        ? buildParameterUpdatePrecondition(existing)
        : ({ mode: 'create' } as const);
    const rawInput = buildMacroParameterWritePayload(param, precondition);
    const plan = planParameterPersistenceWrites({
      rawInputs: [rawInput],
      existingDocsByPath: this.docs,
      provenance: { ...TEST_PROVENANCE, sourceSheet: 'macro_parameter' },
      maxBatch: 1,
    });
    for (const write of plan.writes) {
      if (write.status === 'skip' || !write.document) continue;
      const prev = this.docs.get(write.docPath) ?? {};
      this.docs.set(write.docPath, { ...prev, ...write.document });
    }
    return plan;
  }

  public readAllMacroParams(): MacroParameter[] {
    const list: MacroParameter[] = [];
    for (const [docPath, raw] of this.docs.entries()) {
      if (!docPath.startsWith('macro_params/')) continue;
      const docId = docPath.slice('macro_params/'.length);
      list.push(normalizeMacroParameterFromFirestore(docId, raw) as MacroParameter);
    }
    return list;
  }

  public readMacroParam(key: string): MacroParameter | undefined {
    const raw = this.docs.get(`macro_params/${key}`);
    if (!raw) return undefined;
    return normalizeMacroParameterFromFirestore(key, raw) as MacroParameter;
  }
}

const BASE_VALUATION_MACROS: Record<string, number> = {
  TaxRate: 0.225,
  Rf_Egypt_10Y: 0.15,
  ERP_Developed: 0.05,
  CRP_Egypt: 0,
  Beta_Default: 1.0,
  Terminal_Growth: 0.05,
  Exit_Multiple: 6,
  Forecast_Years: 3,
  Cost_of_Debt: 0.16,
  Growth_Y1: 0.1,
  Growth_Y2: 0.08,
  Growth_Y3: 0.06,
  WACC_Mode: 1,
  DDM_Growth: 0.05,
  r_Mode: 1,
  Weight_DCF: 0.25,
  Weight_DDM: 0.15,
  Weight_RIM: 0.3,
  Weight_Relative: 0.2,
  Weight_Graham: 0.1,
  Beta_Raw_Weight: 1,
  Beta_Anchor: 1,
  Country_Risk_Lambda: 1,
  RIM_Retention: 0.5,
  RIM_Terminal_Method: 1,
  Relative_PE_Weight: 50,
  Relative_PB_Weight: 50,
};

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'comi',
    ticker: 'COMI',
    nameAr: 'البنك التجاري الدولي',
    nameEn: 'CIB Egypt',
    sector: 'بنوك',
    sectorId: 'banks',
    sectorClassification: 'financial',
    marketPrice: 60,
    marketPriceSource: 'lastPrice',
    latestTradeDate: '2026-04-01',
    sharesOutstanding: 100_000_000,
    sharesSource: 'quarterly_record',
    sharesPeriod: 'FY 2025',
    beta: 1.0,
    riskFreeRate: 0.15,
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

function makeQuarterFin(overrides: Partial<QuarterlyFinancial> = {}): QuarterlyFinancial {
  return {
    id: 'COMI_2025_FY',
    companyId: 'comi',
    year: 2025,
    quarter: 'FY',
    periodDate: '2025-12-31',
    periodStartDate: '2025-01-01',
    periodEndDate: '2025-12-31',
    revenueYTD: 1_000_000_000,
    grossProfitYTD: 500_000_000,
    operatingProfitYTD: 400_000_000,
    netProfitYTD: 300_000_000,
    netIncomeCommonYTD: 250_000_000,
    netIncomeCommonBasis: 'explicit_common',
    operatingCashFlowYTD: 320_000_000,
    capexYTD: 50_000_000,
    dividendsPaidYTD: 80_000_000,
    totalAssets: 2_000_000_000,
    totalDebt: 200_000_000,
    cashAndEquivalents: 300_000_000,
    totalEquity: 1_200_000_000,
    commonEquity: 1_000_000_000,
    commonEquityBasis: 'explicit_common',
    sharesCount: 100_000_000,
    weightedAvgSharesYTD: 100_000_000,
    weightedAvgSharesBasis: 'ytd_weighted_avg',
    reportedEps: 2.5,
    reportedEpsSource: 'القوائم المدققة 2025',
    reportedEpsPeriod: 'FY 2025',
    isCapitalActionAdjusted: true,
    financialCurrency: 'EGP',
    financialUnit: 'base',
    isAudited: true,
    ...overrides,
  };
}

function renderAdminParamsHtml(macroParams: MacroParameter[]): string {
  return renderToStaticMarkup(
    React.createElement(AdminDashboard, {
      macroParams,
      onSaveMacroParams: async () => {},
      sectorPEMap: {},
      onSaveSectorPE: () => {},
      users: [ADMIN_USER],
      onSaveUsers: () => {},
      currentUser: ADMIN_USER,
      onSwitchUser: () => {},
    })
  );
}

function extractInputValueByAriaLabel(html: string, ariaLabel: string): string | null {
  const escaped = ariaLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRegex = new RegExp(`<input[^>]*aria-label="${escaped}"[^>]*>`, 'i');
  const tagMatch = html.match(tagRegex);
  if (!tagMatch) return null;
  const valMatch = tagMatch[0].match(/value="([^"]*)"/);
  return valMatch ? valMatch[1] : null;
}

describe('Admin Macro Parameter Display, Persistence Contract & Numerical Precision', () => {
  it('derives display/input specs strictly from central parameterRegistry (static, dynamic, and uncataloged) without magnitude guessing', () => {
    const rimSpec = getMacroParameterInputSpec('RIM_Retention');
    assert.equal(rimSpec.isCataloged, true);
    assert.equal(rimSpec.typeSource, 'registry');
    assert.equal(rimSpec.isPercentDecimal, true);
    assert.equal(rimSpec.scale, 100);
    assert.equal(rimSpec.inputSuffix, '%');
    assert.equal(rimSpec.minStored, 0);
    assert.equal(rimSpec.maxStored, 1);
    assert.equal(rimSpec.minDisplay, 0);
    assert.equal(rimSpec.maxDisplay, 100);
    assert.match(rimSpec.storageHintAr, /كسر عشري/);

    // Dynamic registry parameter (future/extended horizon key not in static list)
    const dynamicGrowthSpec = getMacroParameterInputSpec('Growth_Y7');
    assert.equal(dynamicGrowthSpec.isCataloged, true);
    assert.equal(dynamicGrowthSpec.isPercentDecimal, true);
    assert.equal(dynamicGrowthSpec.scale, 100);
    assert.equal(storedValueToDisplayString('Growth_Y7', 0.125), '12.5');

    // Non-percentage parameters whose stored value is < 1 MUST NOT be scaled to %
    const betaRawWeightSpec = getMacroParameterInputSpec('Beta_Raw_Weight');
    assert.equal(betaRawWeightSpec.isPercentDecimal, false);
    assert.equal(betaRawWeightSpec.scale, 1);
    assert.equal(betaRawWeightSpec.inputSuffix, null);
    assert.equal(storedValueToDisplayString('Beta_Raw_Weight', 0.67), '0.67');

    // Multiple, integer years, mode, and non-pct ratio parameters
    assert.equal(getMacroParameterInputSpec('Exit_Multiple').scale, 1);
    assert.equal(getMacroParameterInputSpec('Exit_Multiple').inputSuffix, 'x');
    assert.equal(getMacroParameterInputSpec('Forecast_Years').scale, 1);
    assert.equal(getMacroParameterInputSpec('Forecast_Years').inputSuffix, 'سنة');
    assert.equal(getMacroParameterInputSpec('WACC_Mode').scale, 1);
    assert.equal(getMacroParameterInputSpec('WACC_Mode').inputSuffix, null);
    assert.equal(getMacroParameterInputSpec('Relative_PE_Weight').scale, 1);

    // Uncataloged custom parameter with unit='decimal' and value < 1 MUST NOT be assumed percentage
    const customDecimalUntyped = getMacroParameterInputSpec('Custom_Factor_Alpha', {
      unit: 'decimal',
    });
    assert.equal(customDecimalUntyped.isCataloged, false);
    assert.equal(customDecimalUntyped.typeSource, 'unspecified');
    assert.equal(customDecimalUntyped.isPercentDecimal, false);
    assert.equal(storedValueToDisplayString('Custom_Factor_Alpha', 0.35, { unit: 'decimal' }), '0.35');
  });

  it('preserves custom percentage parameter type end-to-end across bulk & single persistence, Firestore storage, readback, and UI (15 -> 0.15 -> 15%)', () => {
    const store = new IsolatedParameterStore();

    // 1. Add custom percentage parameter via modal contract: user enters "15"
    const built = buildNewMacroParameterFromDraft({
      key: 'Custom_Risk_Buffer',
      nameAr: 'هامش أمان مخصص',
      descriptionAr: 'نسبة احتياطي توثيقية غير مفعلة في المحرك.',
      draftValue: '15',
      customValueType: 'pct',
    });
    assert.equal(built.ok, true);
    if (!built.ok) throw new Error('Expected custom percentage build to succeed');
    assert.equal(built.param.value, 0.15);
    assert.equal(built.param.valueType, 'pct');
    assert.equal(built.param.isPercentage, true);
    assert.equal(built.param.parameterTypeSource, 'explicit');
    assert.equal(built.param.enabledInEngine, false);

    // 2. Persist through the EXACT production bulk_parameters path
    const bulkPlan = store.executeBulkSave([built.param]);
    assert.equal(bulkPlan.insertedCount, 1);
    assert.equal(bulkPlan.skippedUnchangedCount, 0);

    // Verify raw Firestore document written by server planner
    const rawDoc = store.docs.get('macro_params/Custom_Risk_Buffer');
    assert.ok(rawDoc);
    assert.equal(rawDoc.value, 0.15);
    assert.equal(rawDoc.valueType, 'pct');
    assert.equal(rawDoc.isPercentage, true);
    assert.equal(rawDoc.parameterTypeSource, 'explicit');
    assert.equal(rawDoc.unit, 'decimal');
    assert.equal(rawDoc.nameAr, 'هامش أمان مخصص');
    assert.equal(rawDoc.enabledInEngine, false); // Custom parameter is NEVER auto-enabled in engine

    // 3. Re-read from Firestore via production `normalizeMacroParameterFromFirestore` and render in AdminDashboard
    const reloaded = store.readAllMacroParams();
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0].value, 0.15);
    assert.equal(reloaded[0].valueType, 'pct');
    assert.equal(reloaded[0].isPercentage, true);
    assert.equal(reloaded[0].enabledInEngine, false);

    const drafts = createMacroParamDraftMap(reloaded);
    assert.equal(drafts.Custom_Risk_Buffer, '15');

    const html = renderAdminParamsHtml(reloaded);
    assert.equal(extractInputValueByAriaLabel(html, 'قيمة Custom_Risk_Buffer'), '15');
    assert.match(html, /للتوثيق فقط/);
    assert.doesNotMatch(html, /مفعّل حسابياً/);

    // 4. Verify single save (`macro_parameter`) produces IDENTICAL hash & skips when unchanged
    const singlePlan = store.executeSingleSave(reloaded[0]);
    assert.equal(singlePlan.skippedUnchangedCount, 1);
    assert.equal(singlePlan.updatedCount, 0);
    assert.equal(singlePlan.writes[0].contentHash, rawDoc.contentHash);
  });

  it('keeps custom numeric parameter (0.15, even with unit=decimal) numeric and marks legacy untyped custom docs explicitly as unspecified', () => {
    const store = new IsolatedParameterStore();

    // Case A: Explicit numeric custom parameter with value 0.15 and unit='decimal'
    const numericParam: MacroParameter = {
      key: 'Custom_Decimal_Ratio',
      nameAr: 'معامل عددي عشري',
      descriptionAr: 'معامل عددي قيمته 0.15 وليس نسبة مئوية.',
      value: 0.15,
      category: 'macro_inflation',
      valueType: 'number',
      isPercentage: false,
      parameterTypeSource: 'explicit',
      unit: 'decimal',
      enabledInEngine: false,
    };

    const plan = store.executeBulkSave([numericParam]);
    assert.equal(plan.insertedCount, 1);

    const rawDoc = store.docs.get('macro_params/Custom_Decimal_Ratio');
    assert.ok(rawDoc);
    assert.equal(rawDoc.value, 0.15);
    assert.equal(rawDoc.valueType, 'number');
    assert.equal(rawDoc.isPercentage, false);
    assert.equal(rawDoc.unit, 'decimal');

    const reloadedNumeric = store.readMacroParam('Custom_Decimal_Ratio')!;
    assert.equal(storedValueToEditString(reloadedNumeric.key, reloadedNumeric.value, reloadedNumeric), '0.15');
    const htmlNum = renderAdminParamsHtml([reloadedNumeric]);
    assert.equal(extractInputValueByAriaLabel(htmlNum, 'قيمة Custom_Decimal_Ratio'), '0.15');

    // Case B: Legacy untyped custom Firestore record with unit='decimal' (no valueType, no isPercentage)
    store.docs.set('macro_params/Legacy_Custom_Coeff', {
      key: 'Legacy_Custom_Coeff',
      nameAr: 'معامل قديم غير مصنف',
      descriptionAr: 'سجل قديم بدون حقل نوع.',
      value: 0.15,
      unit: 'decimal',
      scope: 'global',
      ticker: null,
      asOfDate: '2025-12-31',
      source: 'استيراد قديم',
    });

    const reloadedLegacy = store.readMacroParam('Legacy_Custom_Coeff')!;
    assert.equal(reloadedLegacy.parameterTypeSource, 'unspecified');
    assert.equal(reloadedLegacy.valueType, null);
    assert.equal(reloadedLegacy.isPercentage, null);
    assert.equal(reloadedLegacy.enabledInEngine, false);
    assert.equal(storedValueToEditString(reloadedLegacy.key, reloadedLegacy.value, reloadedLegacy), '0.15');

    const htmlLegacy = renderAdminParamsHtml([reloadedLegacy]);
    assert.equal(extractInputValueByAriaLabel(htmlLegacy, 'قيمة Legacy_Custom_Coeff'), '0.15');
    assert.match(htmlLegacy, /نوع غير محدد \(سجل قديم\)/);

    // Re-saving untouched legacy unspecified parameter preserves `unspecified` instead of fabricating a type
    const prepared = prepareMacroParamsForSave([reloadedLegacy], createMacroParamDraftMap([reloadedLegacy]));
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw new Error('Expected legacy save prep to succeed');
    assert.equal(prepared.params[0].value, 0.15);
    assert.equal(prepared.params[0].valueType, null);
    assert.equal(prepared.params[0].isPercentage, null);
    assert.equal(prepared.params[0].parameterTypeSource, 'unspecified');
  });

  it('detects type-only metadata edits in business hash even when numeric value stays identical, and rejects conflicting type payloads on server', () => {
    const store = new IsolatedParameterStore();

    // 1. Insert custom numeric parameter with value 0.15 and unit='decimal'
    const asNumber: MacroParameter = {
      key: 'Custom_Margin_Factor',
      nameAr: 'معامل هامش مخصص',
      descriptionAr: 'اختبار تعديل النوع فقط.',
      value: 0.15,
      category: 'macro_inflation',
      valueType: 'number',
      isPercentage: false,
      parameterTypeSource: 'explicit',
      unit: 'decimal',
      asOfDate: '2026-04-01',
      source: 'لوحة الإدارة',
      enabledInEngine: false,
    };

    const insertPlan = store.executeBulkSave([asNumber]);
    assert.equal(insertPlan.insertedCount, 1);
    const hashBefore = store.docs.get('macro_params/Custom_Margin_Factor')!.contentHash;

    // Re-saving identical payload skips cleanly
    const noopPlan = store.executeBulkSave([asNumber]);
    assert.equal(noopPlan.skippedUnchangedCount, 1);
    assert.equal(noopPlan.updatedCount, 0);

    // 2. Change ONLY type metadata from number/false -> pct/true while keeping value=0.15 & unit='decimal'
    const asPct: MacroParameter = {
      ...asNumber,
      valueType: 'pct',
      isPercentage: true,
    };

    const typeOnlyHash = computeRecordBusinessHash('parameter', buildMacroParameterWritePayload(asPct));
    assert.notEqual(typeOnlyHash, hashBefore);

    const updatePlan = store.executeBulkSave([asPct]);
    assert.equal(updatePlan.updatedCount, 1);
    assert.equal(updatePlan.skippedUnchangedCount, 0);

    const updatedDoc = store.docs.get('macro_params/Custom_Margin_Factor')!;
    assert.equal(updatedDoc.value, 0.15);
    assert.equal(updatedDoc.valueType, 'pct');
    assert.equal(updatedDoc.isPercentage, true);
    assert.equal(updatedDoc.contentHash, typeOnlyHash);

    // Re-reading now displays 15 (%)
    const reloaded = store.readMacroParam('Custom_Margin_Factor')!;
    assert.equal(storedValueToEditString(reloaded.key, reloaded.value, reloaded), '15');

    // 3. Server contract rejects contradictory or invalid type metadata on custom parameters
    assert.throws(
      () =>
        validateParameterRecords([
          {
            key: 'Custom_Bad_Conflict',
            value: 0.15,
            scope: 'global',
            ticker: null,
            unit: 'decimal',
            valueType: 'number',
            isPercentage: true,
          },
        ]),
      /تعارض في تعريف نوع المعامل/
    );
    assert.throws(
      () =>
        validateParameterRecords([
          {
            key: 'Custom_Bad_Type',
            value: 1,
            scope: 'global',
            ticker: null,
            unit: 'number',
            valueType: 'invalid_type',
          },
        ]),
      /غير مدعوم/
    );
    assert.throws(
      () =>
        validateParameterRecords([
          {
            key: 'Custom_Bad_Bool',
            value: 1,
            scope: 'global',
            ticker: null,
            unit: 'number',
            isPercentage: 'true' as unknown as boolean,
          },
        ]),
      /قيمة منطقية/
    );
  });

  it('enforces central parameterRegistry authority for known parameters regardless of stale/wrong client or Firestore type metadata', () => {
    const store = new IsolatedParameterStore();

    // Even if incoming payload tries to label RIM_Retention as number/false or Beta_Raw_Weight as pct/true,
    // central registry ALWAYS wins on validation, persistence, and readback.
    const validated = validateParameterRecords([
      {
        key: 'RIM_Retention',
        value: 0.5,
        scope: 'global',
        ticker: null,
        unit: 'decimal',
        valueType: 'number',
        isPercentage: false,
        precondition: { mode: 'create' },
      },
      {
        key: 'Beta_Raw_Weight',
        value: 0.67,
        scope: 'global',
        ticker: null,
        unit: 'ratio',
        valueType: 'pct',
        isPercentage: true,
        precondition: { mode: 'create' },
      },
    ]);

    assert.equal(validated[0].valueType, 'pct');
    assert.equal(validated[0].isPercentage, true);
    assert.equal(validated[1].valueType, 'number');
    assert.equal(validated[1].isPercentage, false);

    // Corrupted legacy Firestore docs for known parameters are also self-healed on read via registry authority
    store.docs.set('macro_params/RIM_Retention', {
      key: 'RIM_Retention',
      value: 0.5,
      valueType: 'number',
      isPercentage: false,
      unit: 'number',
    });
    store.docs.set('macro_params/Beta_Raw_Weight', {
      key: 'Beta_Raw_Weight',
      value: 0.67,
      valueType: 'pct',
      isPercentage: true,
      unit: 'decimal',
    });

    const rimRead = store.readMacroParam('RIM_Retention')!;
    const betaRead = store.readMacroParam('Beta_Raw_Weight')!;
    assert.equal(rimRead.parameterTypeSource, 'registry');
    assert.equal(rimRead.valueType, 'pct');
    assert.equal(rimRead.isPercentage, true);
    assert.equal(storedValueToEditString(rimRead.key, rimRead.value, rimRead), '50');

    assert.equal(betaRead.parameterTypeSource, 'registry');
    assert.equal(betaRead.valueType, 'number');
    assert.equal(betaRead.isPercentage, false);
    assert.equal(storedValueToEditString(betaRead.key, betaRead.value, betaRead), '0.67');

    assert.equal(resolveCanonicalParameterType('RIM_Retention', { isPercentage: false }).isPercentDecimal, true);
    assert.equal(resolveCanonicalParameterType('Beta_Raw_Weight', { isPercentage: true }).isPercentDecimal, false);
  });

  it('protects numerical precision: tiny non-zero values never become 0, high-precision values are never truncated, and scientific notation round-trips cleanly', () => {
    const store = new IsolatedParameterStore();

    // 1. Tiny non-zero value 0.000000000001 (1e-12) MUST NEVER format as "0" or save as 0
    const tinyValue = 0.000000000001;
    const tinyNumeric: MacroParameter = {
      key: 'Custom_Tiny_Epsilon',
      nameAr: 'معامل دقة صغير جداً',
      descriptionAr: 'قيمة صغيرة غير صفرية.',
      value: tinyValue,
      category: 'macro_inflation',
      valueType: 'number',
      isPercentage: false,
      parameterTypeSource: 'explicit',
      unit: 'number',
      enabledInEngine: false,
    };

    const tinyEdit = storedValueToEditString(tinyNumeric.key, tinyNumeric.value, tinyNumeric);
    assert.equal(tinyEdit, '0.000000000001');
    assert.notEqual(tinyEdit, '0');

    const tinyPrepared = prepareMacroParamsForSave([tinyNumeric], { Custom_Tiny_Epsilon: tinyEdit });
    assert.equal(tinyPrepared.ok, true);
    if (!tinyPrepared.ok) throw new Error('Expected tiny numeric save to succeed');
    assert.equal(tinyPrepared.params[0].value, tinyValue);

    store.executeBulkSave(tinyPrepared.params);
    const tinyReloaded = store.readMacroParam('Custom_Tiny_Epsilon')!;
    assert.equal(tinyReloaded.value, tinyValue);
    assert.equal(storedValueToEditString(tinyReloaded.key, tinyReloaded.value, tinyReloaded), '0.000000000001');

    // Tiny non-zero percentage (1e-12 stored -> 0.0000000001% display -> 1e-12 saved)
    const tinyPctDisplay = storedValueToEditString('TaxRate', tinyValue);
    assert.equal(tinyPctDisplay, '0.0000000001');
    const tinyPctParsed = parseAndValidateMacroParameterDraft('TaxRate', tinyPctDisplay);
    assert.equal(tinyPctParsed.ok, true);
    if (tinyPctParsed.ok) {
      assert.equal(tinyPctParsed.storedValue, tinyValue);
    }

    // 2. High-precision values (>12 significant digits) MUST NOT be rounded to 12 digits
    const highPrecDecimal = 0.1234567890123456; // 16 significant digits
    const highPrecLarge = 123456789012.345; // 15 significant digits

    const highPrecNumeric: MacroParameter = {
      key: 'Custom_High_Precision',
      nameAr: 'قيمة عالية الدقة',
      descriptionAr: 'اختبار الحفاظ على الدقة الكاملة.',
      value: highPrecLarge,
      category: 'macro_inflation',
      valueType: 'number',
      isPercentage: false,
      parameterTypeSource: 'explicit',
      unit: 'number',
      enabledInEngine: false,
    };
    const highPrecEdit = storedValueToEditString(highPrecNumeric.key, highPrecNumeric.value, highPrecNumeric);
    assert.equal(highPrecEdit, '123456789012.345');
    const highPrecSave = prepareMacroParamsForSave([highPrecNumeric], { Custom_High_Precision: highPrecEdit });
    assert.equal(highPrecSave.ok, true);
    if (highPrecSave.ok) {
      assert.equal(highPrecSave.params[0].value, highPrecLarge);
    }

    // High-precision percentage round-trip (bit-exact)
    const highPrecPctEdit = storedValueToEditString('TaxRate', highPrecDecimal);
    assert.equal(highPrecPctEdit, '12.34567890123456');
    const highPrecPctParsed = parseAndValidateMacroParameterDraft('TaxRate', highPrecPctEdit);
    assert.equal(highPrecPctParsed.ok, true);
    if (highPrecPctParsed.ok) {
      assert.equal(highPrecPctParsed.storedValue, highPrecDecimal);
    }

    // 3. Scientific notation output (ultra-tiny 1e-30, huge 1e25) is ALWAYS readable back by the input parser
    const ultraTinyStr = formatExactNumberString(1e-30);
    assert.equal(ultraTinyStr, '1e-30');
    const parsedUltraTiny = parseAndValidateMacroParameterDraft('Custom_Ultra_Tiny', ultraTinyStr, {
      fallbackParam: { valueType: 'number', isPercentage: false },
    });
    assert.equal(parsedUltraTiny.ok, true);
    if (parsedUltraTiny.ok) {
      assert.equal(parsedUltraTiny.storedValue, 1e-30);
    }

    const hugeStr = formatExactNumberString(1e25);
    assert.equal(hugeStr, '1e+25');
    const parsedHuge = parseAndValidateMacroParameterDraft('Custom_Huge', hugeStr, {
      fallbackParam: { valueType: 'number', isPercentage: false },
    });
    assert.equal(parsedHuge.ok, true);
    if (parsedHuge.ok) {
      assert.equal(parsedHuge.storedValue, 1e25);
    }

    // 4. Compact visual preview is strictly separated from edit/save strings and never turns tiny non-zero into 0
    assert.equal(formatParameterCompactPreview('TaxRate', 0.123456789, undefined, 4), '12.3457%');
    assert.equal(formatParameterCompactPreview('Custom_Tiny_Epsilon', tinyValue, tinyNumeric, 4), '0.000000000001');

    // 5. Non-zero input that would underflow IEEE-754 to 0 on % -> decimal conversion is rejected instead of saved as 0
    const underflowCheck = parseAndValidateMacroParameterDraft('TaxRate', '1e-323');
    assert.equal(underflowCheck.ok, false);
    if (!underflowCheck.ok) {
      assert.equal(underflowCheck.code, 'invalid_number');
    }
  });

  it('executes isolated RIM_Retention full production lifecycle: 0.5 -> display 50% -> edit 40 -> server persist 0.4 -> reload 40% -> valuation & company override', () => {
    const store = new IsolatedParameterStore();

    const initialParams: MacroParameter[] = [
      {
        key: 'RIM_Retention',
        nameAr: 'نسبة احتجاز الأرباح لنموذج RIM',
        descriptionAr: 'نسبة الاحتجاز لاحتساب نمو القيمة الدفترية في نموذج الأرباح المتبقية.',
        value: 0.5,
        category: 'growth',
        valueType: 'pct',
        isPercentage: true,
        unit: 'decimal',
        asOfDate: '2026-04-01',
        source: 'اختبار معزول',
      },
      {
        key: 'TaxRate',
        nameAr: 'معدل ضريبة الشركات',
        descriptionAr: 'معدل الضريبة الفعلي.',
        value: 0.225,
        category: 'tax_rf',
        valueType: 'pct',
        isPercentage: true,
        unit: 'decimal',
        asOfDate: '2026-04-01',
        source: 'اختبار معزول',
      },
    ];

    // Seed initial state through production persistence
    store.executeBulkSave(initialParams);
    const loadedInitial = store.readAllMacroParams();

    // 1. Load 0.5 -> AdminDashboard displays "50" (NOT "0.5") with % suffix and clear decimal storage hint
    const initialDrafts = createMacroParamDraftMap(loadedInitial);
    assert.equal(initialDrafts.RIM_Retention, '50');
    assert.equal(initialDrafts.TaxRate, '22.5');

    const initialHtml = renderAdminParamsHtml(loadedInitial);
    assert.equal(extractInputValueByAriaLabel(initialHtml, 'قيمة RIM_Retention'), '50');
    assert.equal(extractInputValueByAriaLabel(initialHtml, 'قيمة TaxRate'), '22.5');
    assert.match(initialHtml, /أدخل النسبة بالمئة؛ تُحفظ حسابياً ككسر عشري/);
    assert.match(initialHtml, /النطاق المسموح: من 0% إلى 100%/);

    // 2. Edit RIM_Retention draft to "40" -> prepare & persist via production server planner -> saved value is 0.4
    const editedDrafts = { ...initialDrafts, RIM_Retention: '40' };
    const prepared = prepareMacroParamsForSave(loadedInitial, editedDrafts);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw new Error('Expected prepared save payload to succeed');

    const updatePlan = store.executeBulkSave(prepared.params);
    assert.equal(updatePlan.updatedCount, 1); // Only RIM_Retention changed
    assert.equal(updatePlan.skippedUnchangedCount, 1); // TaxRate unchanged -> skipped!

    const storedRimDoc = store.docs.get('macro_params/RIM_Retention')!;
    assert.equal(storedRimDoc.value, 0.4);
    assert.equal(storedRimDoc.valueType, 'pct');
    assert.equal(storedRimDoc.isPercentage, true);
    assert.equal(storedRimDoc.parameterTypeSource, 'registry');

    // 3. Re-read saved 0.4 back into UI -> displays "40" (NO double conversion to 4000 or 0.4)
    const reloadedParams = store.readAllMacroParams();
    const reloadedDrafts = createMacroParamDraftMap(reloadedParams);
    assert.equal(reloadedDrafts.RIM_Retention, '40');
    const reloadedHtml = renderAdminParamsHtml(reloadedParams);
    assert.equal(extractInputValueByAriaLabel(reloadedHtml, 'قيمة RIM_Retention'), '40');

    // 4. Verify saved decimal 0.4 flows into resolveValuationAssumptions and RIM valuation engine
    const company = makeCompany();
    const financials = [makeQuarterFin()];
    const ttm = calculateTTMMetrics(company, financials);
    const savedRimVal = reloadedParams.find((p) => p.key === 'RIM_Retention')!.value;
    const globalMacrosAfterSave: Record<string, number> = {
      ...BASE_VALUATION_MACROS,
      RIM_Retention: savedRimVal, // 0.4
    };

    const resolvedGlobal = resolveValuationAssumptions({
      company,
      paramsMap: globalMacrosAfterSave,
      companyOverridesMap: {},
      priority: 'company_first',
    });
    assert.equal(resolvedGlobal.map.rimRetention.value, 0.4);
    assert.equal(resolvedGlobal.map.rimRetention.source, 'global');

    const valuationGlobal = runValuationModels(
      company,
      ttm,
      undefined,
      globalMacrosAfterSave,
      {
        priority: 'company_first',
        sectorPEMap: { banks: 8 },
        companyOverridesMap: {},
      }
    );
    assert.equal(valuationGlobal.rimAudit?.eligible, true);
    assert.equal(valuationGlobal.rimAudit?.retentionUsed, 0.4);

    // 5. Verify company override (`company_assumptions/{ticker}/parameters/RIM_Retention`) works with priority rules
    const companyOverridesMap: Record<string, CompanyParameterOverride> = {
      RIM_Retention: {
        id: 'COMI_RIM_Retention',
        ticker: 'COMI',
        key: 'RIM_Retention',
        value: 0.25,
        unit: 'decimal',
        asOfDate: '2026-04-02',
        source: 'سياسة توزيع الشركة',
      },
    };

    const resolvedCompanyFirst = resolveValuationAssumptions({
      company,
      paramsMap: globalMacrosAfterSave,
      companyOverridesMap,
      priority: 'company_first',
    });
    assert.equal(resolvedCompanyFirst.map.rimRetention.value, 0.25);
    assert.equal(resolvedCompanyFirst.map.rimRetention.source, 'company');

    const valuationCompanyFirst = runValuationModels(
      company,
      ttm,
      undefined,
      globalMacrosAfterSave,
      {
        priority: 'company_first',
        sectorPEMap: { banks: 8 },
        companyOverridesMap,
      }
    );
    assert.equal(valuationCompanyFirst.rimAudit?.eligible, true);
    assert.equal(valuationCompanyFirst.rimAudit?.retentionUsed, 0.25);

    const valuationGlobalFirst = runValuationModels(
      company,
      ttm,
      undefined,
      globalMacrosAfterSave,
      {
        priority: 'global_first',
        sectorPEMap: { banks: 8 },
        companyOverridesMap,
      }
    );
    assert.equal(valuationGlobalFirst.rimAudit?.eligible, true);
    assert.equal(valuationGlobalFirst.rimAudit?.retentionUsed, 0.4);
  });

  it('distinguishes valid 0 from empty input, supports 100% when allowed, and preserves decimal fractions cleanly', () => {
    // Valid zero
    const rimZero = parseAndValidateMacroParameterDraft('RIM_Retention', '0');
    assert.equal(rimZero.ok, true);
    if (rimZero.ok) {
      assert.equal(rimZero.storedValue, 0);
      assert.equal(rimZero.normalizedDraft, '0');
    }
    assert.equal(storedValueToDisplayString('RIM_Retention', 0), '0');

    // Negative zero normalized cleanly to 0
    const negZero = parseAndValidateMacroParameterDraft('RIM_Retention', '-0');
    assert.equal(negZero.ok, true);
    if (negZero.ok) {
      assert.equal(Object.is(negZero.storedValue, -0), false);
      assert.equal(negZero.storedValue, 0);
    }

    // 100% allowed when registry max === 1 (RIM_Retention, TaxRate)
    const rimFull = parseAndValidateMacroParameterDraft('RIM_Retention', '100');
    assert.equal(rimFull.ok, true);
    if (rimFull.ok) {
      assert.equal(rimFull.storedValue, 1);
      assert.equal(storedValueToDisplayString('RIM_Retention', rimFull.storedValue), '100');
    }

    const taxFull = parseAndValidateMacroParameterDraft('TaxRate', '100');
    assert.equal(taxFull.ok, true);
    if (taxFull.ok) assert.equal(taxFull.storedValue, 1);

    // 100% rejected when registry max < 1 (Terminal_Growth max = 0.99 -> 99%)
    const terminal99 = parseAndValidateMacroParameterDraft('Terminal_Growth', '99');
    assert.equal(terminal99.ok, true);
    if (terminal99.ok) assert.equal(terminal99.storedValue, 0.99);

    const terminal100 = parseAndValidateMacroParameterDraft('Terminal_Growth', '100');
    assert.equal(terminal100.ok, false);
    if (!terminal100.ok) {
      assert.equal(terminal100.code, 'above_max');
      assert.match(terminal100.errorAr, /99%/);
    }

    // Decimal fractions without binary floating-point noise (exact base-10 shift)
    const fractions: Array<[string, number]> = [
      ['22.5', 0.225],
      ['14', 0.14],
      ['29', 0.29],
      ['4.21', 0.0421],
      ['0.22', 0.0022],
      ['19.99', 0.1999],
    ];
    for (const [displayStr, expectedDecimal] of fractions) {
      const parsed = parseAndValidateMacroParameterDraft('TaxRate', displayStr);
      assert.equal(parsed.ok, true, `Expected ${displayStr}% to parse`);
      if (parsed.ok) {
        assert.equal(parsed.storedValue, expectedDecimal);
        assert.equal(storedValueToDisplayString('TaxRate', parsed.storedValue), displayStr);
      }
    }
  });

  it('rejects empty and unparseable inputs without turning them into 0 or implicitly deleting parameters', () => {
    const params: MacroParameter[] = [
      {
        key: 'RIM_Retention',
        nameAr: 'نسبة احتجاز الأرباح لنموذج RIM',
        descriptionAr: 'نسبة الاحتجاز',
        value: 0.5,
        category: 'growth',
        valueType: 'pct',
        isPercentage: true,
        unit: 'decimal',
      },
      {
        key: 'Exit_Multiple',
        nameAr: 'مضاعف الخروج',
        descriptionAr: 'مضاعف القيمة النهائية',
        value: 5.5,
        category: 'multiples',
        valueType: 'multiple',
        isPercentage: false,
        unit: 'multiple',
      },
    ];

    // Empty and whitespace drafts MUST fail with code 'empty' and block save
    for (const emptyDraft of ['', '   ']) {
      const check = parseAndValidateMacroParameterDraft('RIM_Retention', emptyDraft);
      assert.equal(check.ok, false);
      if (!check.ok) {
        assert.equal(check.code, 'empty');
        assert.match(check.errorAr, /RIM_Retention/);
      }

      const saveAttempt = prepareMacroParamsForSave(params, {
        RIM_Retention: emptyDraft,
        Exit_Multiple: '5.5',
      });
      assert.equal(saveAttempt.ok, false);
      if (!saveAttempt.ok) {
        assert.equal(saveAttempt.errorCount, 1);
        assert.ok(saveAttempt.fieldErrors.RIM_Retention);
        assert.equal(params.length, 2);
        assert.equal(params[0].value, 0.5);
      }
    }

    // Invalid / unparseable strings MUST fail with code 'invalid_number' and never coerce to 0
    for (const bad of ['abc', '50%', '12..3', 'NaN', 'Infinity', '--5', '50abc', '1e']) {
      const check = parseAndValidateMacroParameterDraft('RIM_Retention', bad);
      assert.equal(check.ok, false, `Expected "${bad}" to be rejected`);
      if (!check.ok) {
        assert.equal(check.code, 'invalid_number');
      }
    }
  });

  it('enforces registry bounds, integer/mode rules, and global scope restrictions', () => {
    const negativeRim = parseAndValidateMacroParameterDraft('RIM_Retention', '-1');
    assert.equal(negativeRim.ok, false);
    if (!negativeRim.ok) {
      assert.equal(negativeRim.code, 'below_min');
      assert.match(negativeRim.errorAr, /0%/);
    }

    const overRim = parseAndValidateMacroParameterDraft('RIM_Retention', '101');
    assert.equal(overRim.ok, false);
    if (!overRim.ok) {
      assert.equal(overRim.code, 'above_max');
      assert.match(overRim.errorAr, /100%/);
    }

    const fractionalYears = parseAndValidateMacroParameterDraft('Forecast_Years', '2.5');
    assert.equal(fractionalYears.ok, false);
    if (!fractionalYears.ok) assert.equal(fractionalYears.code, 'not_integer');

    const tooManyYears = parseAndValidateMacroParameterDraft('Forecast_Years', '21');
    assert.equal(tooManyYears.ok, false);
    if (!tooManyYears.ok) assert.equal(tooManyYears.code, 'above_max');

    const badMode = parseAndValidateMacroParameterDraft('WACC_Mode', '4');
    assert.equal(badMode.ok, false);
    if (!badMode.ok) {
      assert.equal(badMode.code, 'invalid_mode');
      assert.match(badMode.errorAr, /1، 2، 3/);
    }

    const companyOnlyCheck = parseAndValidateMacroParameterDraft('Projected_Terminal_EBITDA', '1000000');
    assert.equal(companyOnlyCheck.ok, false);
    if (!companyOnlyCheck.ok) assert.equal(companyOnlyCheck.code, 'invalid_scope');

    const missingGlobalKeys = getMissingGlobalParameterDefinitions([]).map((d) => d.key);
    assert.equal(missingGlobalKeys.includes('Projected_Terminal_EBITDA'), false);
    assert.equal(missingGlobalKeys.includes('Target_PE'), false);
    assert.equal(missingGlobalKeys.includes('RIM_Retention'), true);
  });

  it('keeps non-percentage numeric parameters unscaled in both UI display and save payload', () => {
    const nonPctParams: MacroParameter[] = [
      {
        key: 'Exit_Multiple',
        nameAr: 'مضاعف الخروج EV/EBITDA',
        descriptionAr: 'مضاعف الخروج النهائي',
        value: 5.5,
        category: 'multiples',
        valueType: 'multiple',
        isPercentage: false,
        unit: 'multiple',
      },
      {
        key: 'Forecast_Years',
        nameAr: 'عدد سنوات التوقع',
        descriptionAr: 'أفق التوقع',
        value: 5,
        category: 'growth',
        valueType: 'integer',
        isPercentage: false,
        unit: 'years',
      },
      {
        key: 'Beta_Raw_Weight',
        nameAr: 'وزن بيتا الخام في تعديل بلوم',
        descriptionAr: 'نسبة عددية بين 0 و 1',
        value: 0.67,
        category: 'beta',
        valueType: 'number',
        isPercentage: false,
        unit: 'ratio',
      },
      {
        key: 'WACC_Mode',
        nameAr: 'نمط حساب WACC',
        descriptionAr: 'رمز النمط',
        value: 1,
        category: 'wacc_modes',
        valueType: 'mode',
        isPercentage: false,
        unit: 'code',
      },
      {
        key: 'Relative_PE_Weight',
        nameAr: 'وزن مضاعف الربحية P/E',
        descriptionAr: 'وزن عددي',
        value: 50,
        category: 'weights',
        valueType: 'number',
        isPercentage: false,
        unit: 'ratio',
      },
    ];

    const drafts = createMacroParamDraftMap(nonPctParams);
    assert.equal(drafts.Exit_Multiple, '5.5');
    assert.equal(drafts.Forecast_Years, '5');
    assert.equal(drafts.Beta_Raw_Weight, '0.67');
    assert.equal(drafts.WACC_Mode, '1');
    assert.equal(drafts.Relative_PE_Weight, '50');

    const html = renderAdminParamsHtml(nonPctParams);
    assert.equal(extractInputValueByAriaLabel(html, 'قيمة Exit_Multiple'), '5.5');
    assert.equal(extractInputValueByAriaLabel(html, 'قيمة Forecast_Years'), '5');
    assert.equal(extractInputValueByAriaLabel(html, 'قيمة Beta_Raw_Weight'), '0.67');
    assert.equal(extractInputValueByAriaLabel(html, 'قيمة WACC_Mode'), '1');
    assert.equal(extractInputValueByAriaLabel(html, 'قيمة Relative_PE_Weight'), '50');

    const prepared = prepareMacroParamsForSave(nonPctParams, {
      Exit_Multiple: '6.25',
      Forecast_Years: '7',
      Beta_Raw_Weight: '0.75',
      WACC_Mode: '2',
      Relative_PE_Weight: '60',
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw new Error('Expected non-pct save to succeed');

    const byKey = new Map(prepared.params.map((p) => [p.key, p.value]));
    assert.equal(byKey.get('Exit_Multiple'), 6.25);
    assert.equal(byKey.get('Forecast_Years'), 7);
    assert.equal(byKey.get('Beta_Raw_Weight'), 0.75);
    assert.equal(byKey.get('WACC_Mode'), 2);
    assert.equal(byKey.get('Relative_PE_Weight'), 60);
  });

  it('applies the same centralized conversion, type contract, and validation when adding new parameters in the modal', () => {
    const addRim = buildNewMacroParameterFromDraft({
      key: 'RIM_Retention',
      nameAr: 'نسبة احتجاز الأرباح لنموذج RIM',
      draftValue: '35.5',
    });
    assert.equal(addRim.ok, true);
    if (addRim.ok) {
      assert.equal(addRim.param.value, 0.355);
      assert.equal(addRim.param.valueType, 'pct');
      assert.equal(addRim.param.isPercentage, true);
      assert.equal(addRim.param.parameterTypeSource, 'registry');
      assert.equal(addRim.param.unit, 'decimal');
      assert.equal(addRim.normalizedDraft, '35.5');
    }

    const addMultiple = buildNewMacroParameterFromDraft({
      key: 'Exit_Multiple',
      nameAr: 'مضاعف الخروج',
      draftValue: '7.25',
    });
    assert.equal(addMultiple.ok, true);
    if (addMultiple.ok) {
      assert.equal(addMultiple.param.value, 7.25);
      assert.equal(addMultiple.param.valueType, 'multiple');
      assert.equal(addMultiple.param.isPercentage, false);
      assert.equal(addMultiple.param.unit, 'multiple');
    }

    const addCompanyOnly = buildNewMacroParameterFromDraft({
      key: 'Target_PE',
      nameAr: 'مضاعف مستهدف',
      draftValue: '10',
    });
    assert.equal(addCompanyOnly.ok, false);
    if (!addCompanyOnly.ok) assert.equal(addCompanyOnly.code, 'invalid_scope');

    const addEmpty = buildNewMacroParameterFromDraft({
      key: 'TaxRate',
      nameAr: 'الضريبة',
      draftValue: '',
    });
    assert.equal(addEmpty.ok, false);
    if (!addEmpty.ok) assert.equal(addEmpty.code, 'empty');

    const addCustomPct = buildNewMacroParameterFromDraft({
      key: 'Future_Buffer_Rate',
      nameAr: 'نسبة احتياطي مستقبلية',
      draftValue: '12.5',
      customValueType: 'pct',
    });
    assert.equal(addCustomPct.ok, true);
    if (addCustomPct.ok) {
      assert.equal(addCustomPct.param.value, 0.125);
      assert.equal(addCustomPct.param.valueType, 'pct');
      assert.equal(addCustomPct.param.isPercentage, true);
      assert.equal(addCustomPct.param.parameterTypeSource, 'explicit');
      assert.equal(addCustomPct.param.enabledInEngine, false);
      assert.equal(addCustomPct.param.unit, 'decimal');
    }

    const addCustomNum = buildNewMacroParameterFromDraft({
      key: 'Future_Scale_Factor',
      nameAr: 'معامل قياس مستقبلي',
      draftValue: '0.4',
      customValueType: 'number',
    });
    assert.equal(addCustomNum.ok, true);
    if (addCustomNum.ok) {
      assert.equal(addCustomNum.param.value, 0.4);
      assert.equal(addCustomNum.param.valueType, 'number');
      assert.equal(addCustomNum.param.isPercentage, false);
      assert.equal(addCustomNum.param.parameterTypeSource, 'explicit');
      assert.equal(addCustomNum.param.enabledInEngine, false);
      assert.equal(addCustomNum.param.unit, 'number');
    }
  });
});
