/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildLinkedQuarterlyDocId,
  buildRealEstateDisclosureDocId,
  deriveRealEstateDisclosureCompleteness,
  deriveRealEstateDisclosureStatusBreakdown,
  FINANCIAL_STATEMENT_SCOPE_OPTIONS,
  inspectFinancialStatementScope,
  inspectRealEstateAccountingPolicy,
  inspectRealEstateAssetCategory,
  inspectRealEstateDisclosureId,
  REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS,
  REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS,
  REAL_ESTATE_ASSET_CATEGORY_OPTIONS,
  REAL_ESTATE_DISCLOSURE_FIELD_DICTIONARY,
  REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH,
  REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS,
  sanitizeRealEstateDisclosureId,
  validateAndNormalizeRealEstateDisclosure,
  validateRealEstateDisclosureId,
} from '../src/core/contracts';
import {
  DISCLOSED_FAIR_VALUE_DIFFERENCE_LABEL_AR,
  evaluateRealEstateFairValueGap,
  summarizeRealEstateDisclosures,
} from '../src/core/domain';
import { calculateTTMMetrics, runValuationModels } from '../src/utils/financialCalculations';
import type { Company, QuarterlyFinancial } from '../src/types/financial';

describe('Batch 39 & 40 — Documented Real Estate Disclosures (Foundation & Hardening)', () => {
  it('1) distinguishes missing (null) from explicit zero (0) and rejects non-finite or negative asset values', () => {
    const zeroRec = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 're_zero',
      ticker: 'TMGH.CA',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      aggregationLevel: 'standalone_item',
      carryingValue: 0,
      disclosedFairValue: 0,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: true,
      fairValueSource: 'مثمن مستقل',
      footnoteReference: 'إيضاح رقم 12',
    });

    assert.equal(zeroRec.ticker, 'TMGH');
    assert.equal(zeroRec.linkedQuarterlyDocId, 'TMGH_2025_FY');
    assert.equal(zeroRec.carryingValue, 0);
    assert.equal(zeroRec.disclosedFairValue, 0);
    assert.equal(zeroRec.completenessStatus, 'complete_comparable');

    const zeroEval = evaluateRealEstateFairValueGap(zeroRec);
    assert.equal(zeroEval.structuralValidityStatus, 'valid');
    assert.equal(zeroEval.documentationStatus, 'documented_complete');
    assert.equal(zeroEval.comparabilityStatus, 'comparable');
    assert.equal(zeroEval.comparable, true);
    assert.equal(zeroEval.difference, 0);
    assert.equal(zeroEval.differenceRatioToCarrying, null); // no division by 0
    assert.equal(zeroEval.isCarryingValueExplicitZero, true);
    assert.equal(zeroEval.isFairValueExplicitZero, true);

    // Null carrying value => NOT zero, blocked as missing_carrying_value
    const missingCarrying = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 're_missing_carrying',
      ticker: 'TMGH',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      carryingValue: null,
      disclosedFairValue: 150,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: true,
    });
    assert.equal(missingCarrying.carryingValue, null);
    assert.equal(missingCarrying.completenessStatus, 'partial_missing_carrying_value');
    const missingCarryingEval = evaluateRealEstateFairValueGap(missingCarrying);
    assert.equal(missingCarryingEval.comparable, false);
    assert.equal(missingCarryingEval.difference, null);
    assert.equal(missingCarryingEval.isCarryingValueExplicitZero, false);
    assert.ok(missingCarryingEval.blockingReasons.some((r) => r.code === 'missing_carrying_value'));

    // Reject negative and non-finite numbers strictly
    for (const badVal of [-1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(() =>
        validateAndNormalizeRealEstateDisclosure({
          disclosureId: 're_bad_c',
          ticker: 'TMGH',
          balanceSheetDate: '2025-12-31',
          carryingValue: badVal,
        })
      );
      assert.throws(() =>
        validateAndNormalizeRealEstateDisclosure({
          disclosureId: 're_bad_f',
          ticker: 'TMGH',
          balanceSheetDate: '2025-12-31',
          carryingValue: 100,
          disclosedFairValue: badVal,
        })
      );
    }

    // Raw inspection also blocks negative/non-finite numbers without computing a difference
    const badRawEval = evaluateRealEstateFairValueGap({
      disclosureId: 'raw_bad',
      ticker: 'TMGH',
      balanceSheetDate: '2025-12-31',
      fairValueDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      fairValueAssetScopeMatchesCarrying: true,
      carryingValue: -50,
      disclosedFairValue: Number.POSITIVE_INFINITY,
    });
    assert.equal(badRawEval.structuralValidityStatus, 'invalid');
    assert.equal(badRawEval.comparable, false);
    assert.equal(badRawEval.difference, null);
    assert.ok(badRawEval.blockingReasons.some((r) => r.code === 'invalid_numeric_value'));
  });

  it('2) computes exact difference = 50 when carrying = 100 and disclosed fair value = 150 with explicitly documented matching asset scope', () => {
    const rec = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'ip_total_2025',
      ticker: 'PHDC',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      assetUsageDescription: 'مراكز تجارية مؤجرة للغير',
      accountingPolicy: 'cost_model',
      aggregationLevel: 'total_summary',
      carryingValue: 100,
      disclosedFairValue: 150,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: true,
      fairValueSource: 'خبير تقييم عقاري معتمد',
      fairValueSourceType: 'independent_valuer',
      footnoteReference: 'إيضاح رقم (11) — الاستثمارات العقارية',
      explanatoryNote: 'القيمة بالتكلفة الدفترية والقيمة العادلة من إيضاح القوائم الموحدة.',
    });

    assert.equal(rec.completenessStatus, 'complete_comparable');

    const evaluation = evaluateRealEstateFairValueGap(rec);
    assert.equal(evaluation.structuralValidityStatus, 'valid');
    assert.equal(evaluation.documentationStatus, 'documented_complete');
    assert.equal(evaluation.comparabilityStatus, 'comparable');
    assert.equal(evaluation.completenessStatus, 'complete_comparable');
    assert.equal(evaluation.comparable, true);
    assert.equal(evaluation.difference, 50);
    assert.equal(evaluation.differenceRatioToCarrying, 0.5);
    assert.equal(evaluation.metricNameAr, 'فرق القيمة العادلة المُفصح عنها عن القيمة الدفترية');
    assert.equal(evaluation.metricNameAr, DISCLOSED_FAIR_VALUE_DIFFERENCE_LABEL_AR);
    assert.match(evaluation.accountingNatureDisclaimerAr, /ولا يُعد ربح إعادة تقييم للفترة/);
    assert.match(evaluation.accountingNatureDisclaimerAr, /Adjusted NAV/);
    assert.match(evaluation.accountingNatureDisclaimerAr, /ولا سعر سهم/);
    assert.equal(evaluation.blockingReasons.length, 0);
  });

  it('3) computes exact difference = 0 when carrying = 150 and disclosed fair value = 150 without inferring period profit', () => {
    const rec = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'ip_fv_model',
      ticker: 'ORHD',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      accountingPolicy: 'fair_value_model',
      aggregationLevel: 'standalone_item',
      carryingValue: 150,
      disclosedFairValue: 150,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: true,
      fairValueSource: 'تقييم مثمن مستقل كما أفصحت الشركة',
      fairValueSourceType: 'independent_valuer',
      footnoteReference: 'إيضاح رقم (9)',
    });

    const evaluation = evaluateRealEstateFairValueGap(rec);
    assert.equal(evaluation.comparable, true);
    assert.equal(evaluation.completenessStatus, 'complete_comparable');
    assert.equal(evaluation.difference, 0);
    assert.equal(evaluation.differenceRatioToCarrying, 0);
    assert.match(evaluation.summaryAr, /لا يُستنتج من ذلك ربح إعادة تقييم للفترة/);
    assert.match(evaluation.accountingNatureDisclaimerAr, /ولا يُعد ربح إعادة تقييم للفترة/);
  });

  it('4) returns unavailable difference with clear structured reason when disclosedFairValue is missing (never infers from carryingValue)', () => {
    const rec = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'dev_land_no_fv',
      ticker: 'OCDI',
      fiscalYear: 2025,
      fiscalQuarter: 'Q3',
      balanceSheetDate: '2025-09-30',
      statementScope: 'consolidated',
      assetCategory: 'development_inventory',
      accountingPolicy: 'cost_model',
      aggregationLevel: 'standalone_item',
      carryingValue: 240,
      disclosedFairValue: null,
      fairValueDate: null,
      footnoteReference: 'إيضاح رقم (14) — أراضٍ ومشروعات قيد التطوير',
    });

    assert.equal(rec.disclosedFairValue, null);
    assert.equal(rec.completenessStatus, 'partial_missing_fair_value');

    const evaluation = evaluateRealEstateFairValueGap(rec);
    assert.equal(evaluation.structuralValidityStatus, 'valid');
    assert.equal(evaluation.documentationStatus, 'documented_missing_fair_value');
    assert.equal(evaluation.comparabilityStatus, 'blocked');
    assert.equal(evaluation.comparable, false);
    assert.equal(evaluation.disclosedFairValue, null);
    assert.equal(evaluation.difference, null);
    assert.ok(evaluation.blockingReasons.some((r) => r.code === 'missing_fair_value'));
    assert.match(evaluation.summaryAr, /غير متاح/);
    assert.match(evaluation.summaryAr, /لا تُستنتج القيمة العادلة من القيمة الدفترية/);
  });

  it('5) separates completeness from comparability: date mismatch, scope mismatch, or unverified/mismatched asset scope NEVER yields complete_comparable', () => {
    // 5a) Date mismatch with ALL other metadata complete -> documented_complete + blocked => documented_not_comparable (NEVER complete_comparable)
    const staleDateRec = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'stale_fv_date',
      ticker: 'EMFD',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      aggregationLevel: 'standalone_item',
      carryingValue: 100,
      disclosedFairValue: 150,
      fairValueDate: '2024-12-31',
      fairValueAssetScopeMatchesCarrying: true,
      fairValueSource: 'مثمن عقاري مستقل',
      footnoteReference: 'إيضاح رقم 11',
    });
    assert.equal(staleDateRec.completenessStatus, 'documented_not_comparable');
    assert.notEqual(staleDateRec.completenessStatus, 'complete_comparable');

    const dateEval = evaluateRealEstateFairValueGap(staleDateRec);
    assert.equal(dateEval.structuralValidityStatus, 'valid');
    assert.equal(dateEval.documentationStatus, 'documented_complete');
    assert.equal(dateEval.comparabilityStatus, 'blocked');
    assert.equal(dateEval.completenessStatus, 'documented_not_comparable');
    assert.equal(dateEval.comparable, false);
    assert.equal(dateEval.difference, null);
    assert.equal(dateEval.dateGapDays, 365);
    assert.ok(dateEval.blockingReasons.some((r) => r.code === 'date_mismatch_not_comparable'));

    // Direct call to deriveRealEstateDisclosureCompleteness agrees 100% (zero contradiction)
    assert.equal(
      deriveRealEstateDisclosureCompleteness({
        carryingValue: staleDateRec.carryingValue,
        disclosedFairValue: staleDateRec.disclosedFairValue,
        statementScope: staleDateRec.statementScope,
        fairValueStatementScope: staleDateRec.fairValueStatementScope,
        fairValueAssetScopeMatchesCarrying: staleDateRec.fairValueAssetScopeMatchesCarrying,
        balanceSheetDate: staleDateRec.balanceSheetDate,
        fairValueDate: staleDateRec.fairValueDate,
        accountingPolicy: staleDateRec.accountingPolicy,
        footnoteReference: staleDateRec.footnoteReference,
        fairValueSource: staleDateRec.fairValueSource,
      }),
      'documented_not_comparable'
    );

    // 5b) Undocumented asset scope (fairValueAssetScopeMatchesCarrying === null) -> NEVER treated as true!
    const unverifiedAssetScopeRec = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'unverified_asset_scope',
      ticker: 'EMFD',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      aggregationLevel: 'standalone_item',
      carryingValue: 100,
      disclosedFairValue: 150,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: null,
      fairValueSource: 'مثمن عقاري مستقل',
      footnoteReference: 'إيضاح رقم 11',
    });
    assert.equal(unverifiedAssetScopeRec.fairValueAssetScopeMatchesCarrying, null);
    assert.equal(unverifiedAssetScopeRec.completenessStatus, 'incomplete_missing_metadata');
    assert.notEqual(unverifiedAssetScopeRec.completenessStatus, 'complete_comparable');

    const unverifiedEval = evaluateRealEstateFairValueGap(unverifiedAssetScopeRec);
    assert.equal(unverifiedEval.structuralValidityStatus, 'valid');
    assert.equal(unverifiedEval.documentationStatus, 'documented_missing_metadata');
    assert.ok(unverifiedEval.missingDocumentationFields.includes('fairValueAssetScopeMatchesCarrying'));
    assert.equal(unverifiedEval.comparabilityStatus, 'blocked');
    assert.equal(unverifiedEval.comparable, false);
    assert.equal(unverifiedEval.difference, null);
    assert.ok(unverifiedEval.blockingReasons.some((r) => r.code === 'unverified_asset_scope_match'));

    // 5c) Statement scope mismatch (carrying consolidated vs fair value standalone) -> documented_not_comparable
    const scopeMismatchRec = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'scope_diff',
      ticker: 'EMFD',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      fairValueStatementScope: 'standalone',
      fairValueAssetScopeMatchesCarrying: true,
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      carryingValue: 100,
      disclosedFairValue: 150,
      fairValueDate: '2025-12-31',
      fairValueSource: 'مثمن مستقل',
      footnoteReference: 'إيضاح 11',
    });
    assert.equal(scopeMismatchRec.completenessStatus, 'documented_not_comparable');
    const scopeEval = evaluateRealEstateFairValueGap(scopeMismatchRec);
    assert.equal(scopeEval.comparable, false);
    assert.equal(scopeEval.completenessStatus, 'documented_not_comparable');
    assert.equal(scopeEval.difference, null);
    assert.ok(scopeEval.blockingReasons.some((r) => r.code === 'statement_scope_mismatch'));

    // 5d) Unspecified statement scope -> incomplete_missing_metadata & blocked
    const unspecifiedScopeRec = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'scope_unspec',
      ticker: 'EMFD',
      balanceSheetDate: '2025-12-31',
      statementScope: 'unspecified',
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      carryingValue: 100,
      disclosedFairValue: 150,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: true,
      fairValueSource: 'مثمن مستقل',
      footnoteReference: 'إيضاح 11',
    });
    assert.equal(unspecifiedScopeRec.completenessStatus, 'incomplete_missing_metadata');
    const unspecEval = evaluateRealEstateFairValueGap(unspecifiedScopeRec);
    assert.equal(unspecEval.comparable, false);
    assert.equal(unspecEval.difference, null);
    assert.ok(unspecEval.blockingReasons.some((r) => r.code === 'unspecified_statement_scope'));

    // 5e) Explicit asset pool mismatch (fairValueAssetScopeMatchesCarrying === false) -> documented_not_comparable
    const assetMismatchRec = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'subset_fv',
      ticker: 'EMFD',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      carryingValue: 100,
      disclosedFairValue: 150,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: false,
      fairValueSource: 'مثمن مستقل',
      footnoteReference: 'إيضاح 11',
    });
    assert.equal(assetMismatchRec.completenessStatus, 'documented_not_comparable');
    const assetEval = evaluateRealEstateFairValueGap(assetMismatchRec);
    assert.equal(assetEval.documentationStatus, 'documented_complete');
    assert.equal(assetEval.comparabilityStatus, 'blocked');
    assert.equal(assetEval.completenessStatus, 'documented_not_comparable');
    assert.equal(assetEval.comparable, false);
    assert.equal(assetEval.difference, null);
    assert.ok(assetEval.blockingReasons.some((r) => r.code === 'asset_scope_mismatch'));

    // 5f) Breakdown confirms exact 3-axis alignment
    const breakdown = deriveRealEstateDisclosureStatusBreakdown({
      carryingValue: 100,
      disclosedFairValue: 150,
      statementScope: 'consolidated',
      fairValueAssetScopeMatchesCarrying: true,
      balanceSheetDate: '2025-12-31',
      fairValueDate: '2024-12-31',
      accountingPolicy: 'cost_model',
      footnoteReference: 'إيضاح 11',
      fairValueSource: 'مثمن مستقل',
    });
    assert.equal(breakdown.structuralValidityStatus, 'valid');
    assert.equal(breakdown.documentationStatus, 'documented_complete');
    assert.equal(breakdown.comparabilityStatus, 'blocked');
    assert.equal(breakdown.completenessStatus, 'documented_not_comparable');
  });

  it('6) prevents ID collisions: rejects >80-char IDs without silent truncation and rejects whitespace/ambiguous IDs consistently for disclosureId and parentDisclosureId', () => {
    assert.equal(REAL_ESTATE_DISCLOSURE_ID_MAX_LENGTH, 80);

    // 6a) Two IDs > 80 chars sharing identical first 80 chars MUST BOTH be rejected (never truncated to same docId)
    const sharedPrefix80 = 'A'.repeat(80);
    const overLimitIdA = `${sharedPrefix80}_1`;
    const overLimitIdB = `${sharedPrefix80}_2`;

    assert.equal(inspectRealEstateDisclosureId(overLimitIdA).status, 'invalid');
    assert.equal(inspectRealEstateDisclosureId(overLimitIdA).invalidReason, 'exceeds_max_length');
    assert.equal(inspectRealEstateDisclosureId(overLimitIdB).status, 'invalid');
    assert.equal(inspectRealEstateDisclosureId(overLimitIdB).invalidReason, 'exceeds_max_length');

    assert.throws(() => sanitizeRealEstateDisclosureId(overLimitIdA), /يتجاوز الحد الأقصى|80/);
    assert.throws(() => sanitizeRealEstateDisclosureId(overLimitIdB), /يتجاوز الحد الأقصى|80/);
    assert.throws(() =>
      buildRealEstateDisclosureDocId({
        ticker: 'TMGH',
        fiscalYear: 2025,
        fiscalQuarter: 'FY',
        statementScope: 'consolidated',
        disclosureId: overLimitIdA,
      })
    );
    assert.throws(() =>
      buildRealEstateDisclosureDocId({
        ticker: 'TMGH',
        fiscalYear: 2025,
        fiscalQuarter: 'FY',
        statementScope: 'consolidated',
        disclosureId: overLimitIdB,
      })
    );
    assert.throws(() =>
      validateAndNormalizeRealEstateDisclosure({
        disclosureId: overLimitIdA,
        ticker: 'TMGH',
        balanceSheetDate: '2025-12-31',
      })
    );

    // Exact 80-char boundary IS accepted without truncation
    assert.equal(validateRealEstateDisclosureId(sharedPrefix80), sharedPrefix80);

    // 6b) Potential whitespace collisions ('note 11', 'note  11', ' note_11', 'note_11 ', 'note\t11') are REJECTED (never collapsed to 'note_11')
    for (const spaceyId of ['note 11', 'note  11', ' note_11', 'note_11 ', 'note\t11']) {
      const insp = inspectRealEstateDisclosureId(spaceyId);
      assert.equal(insp.status, 'invalid');
      assert.equal(insp.invalidReason, 'contains_whitespace');
      assert.throws(() => sanitizeRealEstateDisclosureId(spaceyId), /مسافات/);
      assert.throws(() =>
        buildRealEstateDisclosureDocId({
          ticker: 'TMGH',
          fiscalYear: 2025,
          fiscalQuarter: 'FY',
          statementScope: 'consolidated',
          disclosureId: spaceyId,
        })
      );
      // Same identity rule applies strictly to parentDisclosureId
      assert.throws(() =>
        validateAndNormalizeRealEstateDisclosure({
          disclosureId: 'child_1',
          ticker: 'TMGH',
          balanceSheetDate: '2025-12-31',
          aggregationLevel: 'component_detail',
          parentDisclosureId: spaceyId,
        })
      );
    }

    // Over-limit parentDisclosureId is also rejected without silent truncation
    assert.throws(() =>
      validateAndNormalizeRealEstateDisclosure({
        disclosureId: 'child_1',
        ticker: 'TMGH',
        balanceSheetDate: '2025-12-31',
        aggregationLevel: 'component_detail',
        parentDisclosureId: overLimitIdA,
      })
    );

    // Distinct valid IDs stay distinct (no silent folding)
    const docUnderscore = buildRealEstateDisclosureDocId({
      ticker: 'TMGH.CA',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      statementScope: 'consolidated',
      disclosureId: 'note_11',
    });
    const docHyphen = buildRealEstateDisclosureDocId({
      ticker: 'TMGH.CA',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      statementScope: 'consolidated',
      disclosureId: 'note-11',
    });
    const docCase = buildRealEstateDisclosureDocId({
      ticker: 'TMGH.CA',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      statementScope: 'consolidated',
      disclosureId: 'Note_11',
    });
    assert.equal(docUnderscore, 'TMGH_2025_FY_consolidated_note_11');
    assert.equal(docHyphen, 'TMGH_2025_FY_consolidated_note-11');
    assert.equal(docCase, 'TMGH_2025_FY_consolidated_Note_11');
    assert.notEqual(docUnderscore, docHyphen);
    assert.notEqual(docUnderscore, docCase);

    // buildRealEstateDisclosureDocId rejects undated/invalid period instead of silent 'undated' collision
    assert.throws(() =>
      buildRealEstateDisclosureDocId({
        ticker: 'TMGH',
        statementScope: 'consolidated',
        disclosureId: 'note_11',
      })
    );
  });

  it('7) preserves unrecognized classifications as unknown without silent default to investment_property, and rejects them on strict write', () => {
    const inspectedCat = inspectRealEstateAssetCategory('custom_unmapped_real_estate');
    assert.equal(inspectedCat.status, 'unrecognized');
    assert.equal(inspectedCat.code, null);
    assert.equal(inspectedCat.rawValue, 'custom_unmapped_real_estate');

    const inspectedScope = inspectFinancialStatementScope('pro_forma');
    assert.equal(inspectedScope.status, 'unrecognized');
    assert.equal(inspectedScope.code, null);

    const inspectedPolicy = inspectRealEstateAccountingPolicy('ias40_assumed');
    assert.equal(inspectedPolicy.status, 'unrecognized');
    assert.equal(inspectedPolicy.code, null);

    const rawEval = evaluateRealEstateFairValueGap({
      disclosureId: 'legacy_unknown_cat',
      ticker: 'MNHD',
      balanceSheetDate: '2025-12-31',
      fairValueDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'custom_unmapped_real_estate',
      accountingPolicy: 'cost_model',
      fairValueAssetScopeMatchesCarrying: true,
      carryingValue: 100,
      disclosedFairValue: 150,
    });
    assert.equal(rawEval.structuralValidityStatus, 'invalid');
    assert.equal(rawEval.assetCategoryStatus, 'unrecognized');
    assert.equal(rawEval.assetCategory, null);
    assert.equal(rawEval.rawAssetCategory, 'custom_unmapped_real_estate');
    assert.equal(rawEval.completenessStatus, 'unrecognized_classification');
    assert.equal(rawEval.comparable, false);
    assert.equal(rawEval.difference, null);
    assert.ok(rawEval.blockingReasons.some((r) => r.code === 'unrecognized_asset_category'));

    // On strict write validation: unrecognized category is explicitly rejected
    assert.throws(() =>
      validateAndNormalizeRealEstateDisclosure({
        disclosureId: 'bad_cat_write',
        ticker: 'MNHD',
        balanceSheetDate: '2025-12-31',
        assetCategory: 'custom_unmapped_real_estate',
      })
    );

    // Omitted category on write defaults ONLY to explicit 'unspecified', NEVER to 'investment_property'
    const omittedCat = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'omitted_cat',
      ticker: 'MNHD',
      balanceSheetDate: '2025-12-31',
      carryingValue: 80,
    });
    assert.equal(omittedCat.assetCategory, 'unspecified');
    assert.equal(omittedCat.accountingPolicy, 'unspecified');
    assert.equal(omittedCat.statementScope, 'unspecified');
    assert.equal(omittedCat.fairValueAssetScopeMatchesCarrying, null);
  });

  it('8) handles duplicate IDs and strict containment: exact duplicate counted once, conflicting duplicate blocks, absent/conflicting parent never excluded by category alone, and documented parent-child sums without double-counting', () => {
    const total = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'ip_total',
      ticker: 'HELI',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      aggregationLevel: 'total_summary',
      carryingValue: 100,
      disclosedFairValue: 150,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: true,
      fairValueSource: 'مثمن مستقل',
      footnoteReference: 'إيضاح 10',
    });

    const childA = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'ip_mall_a',
      ticker: 'HELI',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      aggregationLevel: 'component_detail',
      parentDisclosureId: 'ip_total',
      carryingValue: 60,
      disclosedFairValue: 90,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: true,
      fairValueSource: 'مثمن مستقل',
      footnoteReference: 'إيضاح 10-أ',
    });

    const childB = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'ip_office_b',
      ticker: 'HELI',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      aggregationLevel: 'component_detail',
      parentDisclosureId: 'ip_total',
      carryingValue: 40,
      disclosedFairValue: 60,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: true,
      fairValueSource: 'مثمن مستقل',
      footnoteReference: 'إيضاح 10-ب',
    });

    // 8a) Documented total + its verified compatible children => 100 / 150 / 50 without double-counting
    const validSummary = summarizeRealEstateDisclosures([total, childA, childB]);
    assert.equal(validSummary.aggregateComparable, true);
    assert.deepEqual(validSummary.includedDisclosureIds, ['ip_total']);
    assert.equal(validSummary.excludedDuplicates.length, 2);
    assert.ok(validSummary.excludedDuplicates.every((e) => e.reasonCode === 'child_of_present_total'));
    assert.equal(validSummary.items.length, 3);
    assert.equal(validSummary.totalCarryingValue, 100);
    assert.equal(validSummary.totalDisclosedFairValue, 150);
    assert.equal(validSummary.totalFairValueMinusCarryingValue, 50);
    assert.ok(validSummary.reconciliationNotesAr.some((n) => n.includes('مطابقة تامة')));

    // 8b) Exact duplicate of the same record does NOT double balances
    const exactDupSummary = summarizeRealEstateDisclosures([total, { ...total }]);
    assert.equal(exactDupSummary.aggregateComparable, true);
    assert.equal(exactDupSummary.items.length, 2); // both received records remain visible
    assert.deepEqual(exactDupSummary.includedDisclosureIds, ['ip_total']);
    assert.equal(exactDupSummary.excludedDuplicates.length, 1);
    assert.equal(exactDupSummary.excludedDuplicates[0]?.reasonCode, 'exact_duplicate_disclosure_id');
    assert.equal(exactDupSummary.totalCarryingValue, 100);
    assert.equal(exactDupSummary.totalDisclosedFairValue, 150);
    assert.equal(exactDupSummary.totalFairValueMinusCarryingValue, 50);

    // 8c) Duplicate ID with conflicting values => explicit structured conflict, never silently picks one, blocks approved totals, keeps all visible
    const conflictingCopy = { ...total, carryingValue: 120, disclosedFairValue: 180 };
    const conflictDupSummary = summarizeRealEstateDisclosures([total, conflictingCopy]);
    assert.equal(conflictDupSummary.aggregateComparable, false);
    assert.equal(conflictDupSummary.totalCarryingValue, null);
    assert.equal(conflictDupSummary.totalDisclosedFairValue, null);
    assert.equal(conflictDupSummary.totalFairValueMinusCarryingValue, null);
    assert.equal(conflictDupSummary.items.length, 2);
    assert.ok(
      conflictDupSummary.blockingReasons.some((r) => r.code === 'conflicting_duplicate_disclosure_id')
    );

    // 8d) component_detail referencing a DIFFERENT / ABSENT parent is NEVER excluded by category alone
    const differentParentChild = validateAndNormalizeRealEstateDisclosure({
      ...childA,
      disclosureId: 'ip_detail_other_parent',
      parentDisclosureId: 'ip_total_other_pool',
    });
    const missingParentSummary = summarizeRealEstateDisclosures([total, differentParentChild]);
    assert.equal(missingParentSummary.aggregateComparable, false);
    assert.equal(missingParentSummary.totalCarryingValue, null);
    assert.equal(missingParentSummary.totalDisclosedFairValue, null);
    assert.equal(missingParentSummary.totalFairValueMinusCarryingValue, null);
    assert.equal(missingParentSummary.items.length, 2);
    assert.equal(
      missingParentSummary.excludedDuplicates.some((e) => e.disclosureId === 'ip_detail_other_parent'),
      false
    );
    assert.ok(
      missingParentSummary.blockingReasons.some((r) => r.code === 'missing_parent_disclosure')
    );

    // 8e) component_detail with NO parentDisclosureId is NEVER excluded by category alone
    const orphanChild = validateAndNormalizeRealEstateDisclosure({
      ...childA,
      disclosureId: 'ip_orphan_detail',
      parentDisclosureId: null,
    });
    const orphanSummary = summarizeRealEstateDisclosures([total, orphanChild]);
    assert.equal(orphanSummary.aggregateComparable, false);
    assert.equal(orphanSummary.totalCarryingValue, null);
    assert.equal(orphanSummary.totalDisclosedFairValue, null);
    assert.equal(orphanSummary.totalFairValueMinusCarryingValue, null);
    assert.equal(orphanSummary.items.length, 2);
    assert.equal(
      orphanSummary.excludedDuplicates.some((e) => e.disclosureId === 'ip_orphan_detail'),
      false
    );
    assert.ok(
      orphanSummary.blockingReasons.some((r) => r.code === 'unresolved_component_parent')
    );

    // 8f) component_detail pointing to a parent that is NOT a total_summary (or incompatible period/scope) => conflicting_parent_disclosure, NOT excluded
    const standaloneParent = validateAndNormalizeRealEstateDisclosure({
      ...total,
      disclosureId: 'not_a_total',
      aggregationLevel: 'standalone_item',
    });
    const childPointingToStandalone = validateAndNormalizeRealEstateDisclosure({
      ...childA,
      disclosureId: 'child_bad_parent_type',
      parentDisclosureId: 'not_a_total',
    });
    const badParentTypeSummary = summarizeRealEstateDisclosures([
      standaloneParent,
      childPointingToStandalone,
    ]);
    assert.equal(badParentTypeSummary.aggregateComparable, false);
    assert.equal(badParentTypeSummary.totalCarryingValue, null);
    assert.equal(badParentTypeSummary.items.length, 2);
    assert.equal(badParentTypeSummary.excludedDuplicates.length, 0);
    assert.ok(
      badParentTypeSummary.blockingReasons.some((r) => r.code === 'conflicting_parent_disclosure')
    );

    // 8g) Unspecified aggregation level alongside total_summary => blocked for ambiguous overlap, all records visible
    const unspecAgg = validateAndNormalizeRealEstateDisclosure({
      ...childB,
      disclosureId: 'ip_ambiguous',
      aggregationLevel: 'unspecified',
      parentDisclosureId: null,
    });
    const ambiguousSummary = summarizeRealEstateDisclosures([total, unspecAgg]);
    assert.equal(ambiguousSummary.aggregateComparable, false);
    assert.equal(ambiguousSummary.totalCarryingValue, null);
    assert.equal(ambiguousSummary.totalFairValueMinusCarryingValue, null);
    assert.equal(ambiguousSummary.items.length, 2);
    assert.ok(ambiguousSummary.blockingReasons.some((r) => r.code === 'ambiguous_aggregation_overlap'));

    // 8h) Mixing consolidated + standalone in one summary => blocked
    const standaloneRec = validateAndNormalizeRealEstateDisclosure({
      ...total,
      disclosureId: 'ip_standalone',
      statementScope: 'standalone',
    });
    const mixedScopeSummary = summarizeRealEstateDisclosures([total, standaloneRec]);
    assert.equal(mixedScopeSummary.aggregateComparable, false);
    assert.equal(mixedScopeSummary.totalCarryingValue, null);
    assert.equal(mixedScopeSummary.totalFairValueMinusCarryingValue, null);
    assert.equal(mixedScopeSummary.items.length, 2);
    assert.ok(mixedScopeSummary.blockingReasons.some((r) => r.code === 'mixed_statement_scopes_in_summary'));
  });

  it('9) exposes complete dropdown registries, field dictionary, deterministic docId helpers, zero Firestore writes, and leaves existing valuation outputs untouched', () => {
    assert.equal(FINANCIAL_STATEMENT_SCOPE_OPTIONS.length, 3);
    assert.ok(REAL_ESTATE_ASSET_CATEGORY_OPTIONS.length >= 6);
    assert.equal(REAL_ESTATE_ACCOUNTING_POLICY_OPTIONS.length, 3);
    assert.equal(REAL_ESTATE_AGGREGATION_LEVEL_OPTIONS.length, 4);
    assert.ok(REAL_ESTATE_DISCLOSURE_FIELD_DICTIONARY.length >= 20);
    assert.equal(buildLinkedQuarterlyDocId('TMGH.CA', 2025, 'FY'), 'TMGH_2025_FY');
    assert.equal(
      buildRealEstateDisclosureDocId({
        ticker: 'TMGH.CA',
        fiscalYear: 2025,
        fiscalQuarter: 'FY',
        statementScope: 'consolidated',
        disclosureId: 'note_11',
      }),
      'TMGH_2025_FY_consolidated_note_11'
    );

    // Verify zero Firestore/Firebase imports in the contract & domain modules
    const contractSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/core/contracts/realEstateDisclosures.ts'),
      'utf8'
    );
    const domainSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/core/domain/realEstateDisclosureAnalysis.ts'),
      'utf8'
    );
    assert.doesNotMatch(contractSrc, /firebase\/firestore|FirestoreService|FirestoreWriters/);
    assert.doesNotMatch(domainSrc, /firebase\/firestore|FirestoreService|FirestoreWriters/);

    // Verify existing valuation engine results remain completely untouched
    const company: Company = {
      id: 'co-re-check',
      ticker: 'TMGH',
      name: 'Real Estate Check Co.',
      sector: 'Real Estate',
      currency: 'EGP',
      financialCurrency: 'EGP',
      marketPrice: 20,
      sharesOutstanding: 100_000_000,
      beta: 1.0,
      wacc: 0.2,
      terminalGrowthRate: 0.05,
      expectedEarningsGrowth: 0.1,
      dividendGrowthRate: 0.05,
    };
    const q: QuarterlyFinancial = {
      id: 'TMGH_2025_Q4',
      companyId: company.id,
      year: 2025,
      quarter: 4,
      date: '2025-12-31',
      revenueYTD: 1_000_000_000,
      grossProfitYTD: 400_000_000,
      operatingProfitYTD: 300_000_000,
      netProfitYTD: 250_000_000,
      netIncomeCommonYTD: 250_000_000,
      netIncomeCommonBasis: 'attested_common_ni',
      operatingCashFlowYTD: 260_000_000,
      capexYTD: 50_000_000,
      dividendsPaidYTD: 0,
      totalAssets: 2_000_000_000,
      totalLiabilities: 800_000_000,
      totalEquity: 1_200_000_000,
      commonEquity: 1_200_000_000,
      commonEquityBasis: 'attested_common_equity',
      totalDebt: 200_000_000,
      cashAndEquivalents: 150_000_000,
      sharesOutstanding: 100_000_000,
      financialCurrency: 'EGP',
      financialUnit: 'base',
    };

    const metricsBefore = calculateTTMMetrics(company, [q], { valuationDate: '2026-04-28' });
    const valBefore = runValuationModels(
      company,
      metricsBefore,
      undefined,
      {
        r_Mode: 3,
        Rf_Egypt_10Y: 0.2,
        ERP_Developed: 0.06,
        Beta_Raw_Weight: 0.67,
        Beta_Anchor: 1.0,
        Relative_PE_Weight: 0.6,
        Relative_PB_Weight: 0.4,
        Sector_PB_Benchmark: 2.0,
        Weight_DCF: 25,
        Weight_DDM: 25,
        Weight_RIM: 25,
        Weight_Relative: 15,
        Weight_Graham: 10,
      },
      {
        sectorPEMap: { 'Real Estate': 10 },
        sectorPeConfirmed: true,
        betaConfirmed: true,
        companyOverridesConfirmed: true,
        macroParamsConfirmed: true,
        valuationDate: '2026-04-28',
        disableLegacyCompanyFallback: true,
      }
    );

    const disclosure = validateAndNormalizeRealEstateDisclosure({
      disclosureId: 'ip_1',
      ticker: 'TMGH',
      fiscalYear: 2025,
      fiscalQuarter: 'FY',
      balanceSheetDate: '2025-12-31',
      statementScope: 'consolidated',
      assetCategory: 'investment_property',
      accountingPolicy: 'cost_model',
      aggregationLevel: 'standalone_item',
      carryingValue: 100,
      disclosedFairValue: 150,
      fairValueDate: '2025-12-31',
      fairValueAssetScopeMatchesCarrying: true,
      fairValueSource: 'مثمن مستقل',
      footnoteReference: 'إيضاح 11',
    });
    const gap = evaluateRealEstateFairValueGap(disclosure);
    assert.equal(gap.difference, 50);

    const metricsAfter = calculateTTMMetrics(company, [q], { valuationDate: '2026-04-28' });
    const valAfter = runValuationModels(
      company,
      metricsAfter,
      undefined,
      {
        r_Mode: 3,
        Rf_Egypt_10Y: 0.2,
        ERP_Developed: 0.06,
        Beta_Raw_Weight: 0.67,
        Beta_Anchor: 1.0,
        Relative_PE_Weight: 0.6,
        Relative_PB_Weight: 0.4,
        Sector_PB_Benchmark: 2.0,
        Weight_DCF: 25,
        Weight_DDM: 25,
        Weight_RIM: 25,
        Weight_Relative: 15,
        Weight_Graham: 10,
      },
      {
        sectorPEMap: { 'Real Estate': 10 },
        sectorPeConfirmed: true,
        betaConfirmed: true,
        companyOverridesConfirmed: true,
        macroParamsConfirmed: true,
        valuationDate: '2026-04-28',
        disableLegacyCompanyFallback: true,
      }
    );

    assert.equal(metricsAfter.netIncomeCommonTTM, metricsBefore.netIncomeCommonTTM);
    assert.equal(metricsAfter.epsTTM, metricsBefore.epsTTM);
    assert.equal(metricsAfter.bookValuePerShare, metricsBefore.bookValuePerShare);
    assert.equal(valAfter.compositeFairValue, valBefore.compositeFairValue);
    assert.equal(valAfter.relativeFairValue, valBefore.relativeFairValue);
    assert.equal(valAfter.grahamFairValue, valBefore.grahamFairValue);
  });

  it('10) rejects over-limit documentation text fields without silent truncation across all 4 fields including Arabic and multiline text', () => {
    const textFieldSpecs = [
      {
        field: 'assetUsageDescription' as const,
        maxLength: REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.assetUsageDescription,
        expectedMax: 240,
      },
      {
        field: 'fairValueSource' as const,
        maxLength: REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.fairValueSource,
        expectedMax: 240,
      },
      {
        field: 'footnoteReference' as const,
        maxLength: REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.footnoteReference,
        expectedMax: 160,
      },
      {
        field: 'explanatoryNote' as const,
        maxLength: REAL_ESTATE_DISCLOSURE_TEXT_MAX_LENGTHS.explanatoryNote,
        expectedMax: 800,
      },
    ];

    // Helper generating an exact-length multiline Arabic string
    const buildMultilineArabic = (targetLength: number): string => {
      const prefix = 'بند موثق من الإيضاح:\nالسطر الثاني — ';
      assert.ok(targetLength > prefix.length);
      return `${prefix}${'ع'.repeat(targetLength - prefix.length)}`;
    };

    for (const spec of textFieldSpecs) {
      assert.equal(spec.maxLength, spec.expectedMax);

      // Field dictionary reuses the exact centralized limit
      const dictEntry = REAL_ESTATE_DISCLOSURE_FIELD_DICTIONARY.find((d) => d.field === spec.field);
      assert.ok(dictEntry, `Missing dictionary entry for ${spec.field}`);
      assert.ok(dictEntry.dataType.includes(`<=${spec.maxLength}`));
      assert.match(dictEntry.governanceNotesAr, /دون قص صامت/);

      // Exact limit with multiline Arabic text is accepted completely intact
      const exactText = buildMultilineArabic(spec.maxLength);
      assert.equal(exactText.length, spec.maxLength);

      const accepted = validateAndNormalizeRealEstateDisclosure({
        disclosureId: `text_ok_${spec.field}`,
        ticker: 'TMGH',
        balanceSheetDate: '2025-12-31',
        [spec.field]: exactText,
      });
      assert.equal(accepted[spec.field], exactText);
      assert.equal(accepted[spec.field]?.length, spec.maxLength);

      // Limit + 1 is explicitly rejected with an Arabic error citing field, limit, and entered length
      const overByOne = `${exactText}أ`;
      assert.equal(overByOne.length, spec.maxLength + 1);
      assert.throws(
        () =>
          validateAndNormalizeRealEstateDisclosure({
            disclosureId: `text_over_${spec.field}`,
            ticker: 'TMGH',
            balanceSheetDate: '2025-12-31',
            [spec.field]: overByOne,
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes(spec.field), `Expected field name in error: ${err.message}`);
          assert.ok(
            err.message.includes(String(spec.maxLength)),
            `Expected max length in error: ${err.message}`
          );
          assert.ok(
            err.message.includes(String(overByOne.length)),
            `Expected actual length in error: ${err.message}`
          );
          assert.match(err.message, /لا يُقص/);
          return true;
        }
      );

      // Missing / null / blank text stays null, distinct from entered text
      const missingRec = validateAndNormalizeRealEstateDisclosure({
        disclosureId: `text_null_${spec.field}`,
        ticker: 'TMGH',
        balanceSheetDate: '2025-12-31',
        [spec.field]: '   ',
      });
      assert.equal(missingRec[spec.field], null);
    }

    // Confirm zero silent .slice() calls remain on those 4 fields in realEstateDisclosures.ts
    const contractSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/core/contracts/realEstateDisclosures.ts'),
      'utf8'
    );
    assert.doesNotMatch(
      contractSrc,
      /(assetUsageDescription|fairValueSource|footnoteReference|explanatoryNote)[^\n]*\.slice\(/
    );
  });
});
