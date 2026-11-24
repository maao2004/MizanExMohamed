/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  ALL_PARAMETERS_EXCEL_HEADERS,
  ALL_PARAMETERS_INSTRUCTIONS_SHEET_NAME,
  ALL_PARAMETERS_SHEET_NAME,
  buildParameterUpdatePrecondition,
  buildParameterWritePayloadFromImport,
  computeRecordBusinessHash,
  getParameterDefinition,
  normalizeCompanyOverrideFromFirestore,
  normalizeMacroParameterFromFirestore,
  planParameterPersistenceWrites,
  type ParameterDocumentProvenance,
} from '../src/core/contracts';
import {
  buildAllParametersTemplateWorkbook,
  buildImportPreview,
  parseAllParametersExcelFile,
  type ParsedParameterImportRow,
} from '../src/core/imports';
import { buildAllParametersExportWorkbook } from '../src/utils/excelExport';
import {
  getMacroParameterInputSpec,
  storedValueToEditString,
} from '../src/core/domain/macroParameterInput';
import type { CompanyParameterOverride, MacroParameter } from '../src/types';

const TEST_PROVENANCE: ParameterDocumentProvenance = {
  importId: 'imp_excel_contract_test',
  sourceFile: 'All_Parameters.xlsx',
  sourceSheet: ALL_PARAMETERS_SHEET_NAME,
  schemaVersion: 3,
  updatedBy: 'admin_test_uid',
  updatedAt: '2026-11-20T00:00:00.000Z',
  serverUpdatedAt: { _seconds: 1795132800 },
  isDeleted: false,
};

function workbookToExcelFile(wb: XLSX.WorkBook, name = 'All_Parameters.xlsx'): File {
  const arr = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return {
    name,
    arrayBuffer: async () => arr,
  } as unknown as File;
}

function rowsToExcelFile(
  rows: Array<Record<string, unknown>>,
  options?: { headers?: string[]; sheetName?: string; fileName?: string }
): File {
  const wb = XLSX.utils.book_new();
  const ws = options?.headers
    ? XLSX.utils.json_to_sheet(rows, { header: options.headers })
    : XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, options?.sheetName || ALL_PARAMETERS_SHEET_NAME);
  return workbookToExcelFile(wb, options?.fileName || 'All_Parameters.xlsx');
}

function buildExistingPreviewMap(store: Map<string, Record<string, any>>): Map<string, Record<string, any>> {
  const map = new Map<string, Record<string, any>>();
  for (const [docPath, doc] of store.entries()) {
    if (docPath.startsWith('macro_params/')) {
      const key = docPath.slice('macro_params/'.length);
      map.set(key, {
        ...doc,
        key,
        scope: 'global',
        ticker: null,
        description: doc.descriptionAr ?? doc.description ?? '',
      });
    } else if (docPath.startsWith('company_assumptions/')) {
      const parts = docPath.split('/');
      const ticker = parts[1];
      const key = parts[3];
      map.set(`${ticker}__${key}`, {
        ...doc,
        key,
        scope: 'company',
        ticker,
        description: doc.description ?? '',
      });
    }
  }
  return map;
}

function commitImportRowsThroughProductionPlanner(
  rows: ParsedParameterImportRow[],
  store: Map<string, Record<string, any>>
) {
  const payloads = rows.map((p) => {
    const docPath =
      p.scope === 'company' && p.ticker
        ? `company_assumptions/${p.ticker}/parameters/${p.key}`
        : `macro_params/${p.key}`;
    const existing = store.get(docPath);
    const precondition =
      existing && existing.isDeleted !== true
        ? buildParameterUpdatePrecondition(existing)
        : ({ mode: 'create' } as const);
    return buildParameterWritePayloadFromImport({
      key: p.key,
      nameAr: p.nameAr,
      value: p.value,
      valueType: p.valueType,
      isPercentage: p.isPercentage,
      description: p.description,
      scope: p.scope,
      ticker: p.ticker,
      unit: p.unit,
      currency: p.currency,
      forecastHorizonYears: p.forecastHorizonYears,
      rfMethodology: p.rfMethodology,
      asOfDate: p.asOfDate,
      source: p.source,
      sourceRow: p.sourceRow,
      precondition,
    });
  });
  const plan = planParameterPersistenceWrites({
    rawInputs: payloads,
    existingDocsByPath: store,
    provenance: TEST_PROVENANCE,
  });
  for (const w of plan.writes) {
    if (w.status !== 'skip' && w.document) {
      const prev = store.get(w.docPath) ?? {};
      store.set(w.docPath, { ...prev, ...w.document });
    }
  }
  return plan;
}

function readAllFromStore(store: Map<string, Record<string, any>>): {
  macroParams: MacroParameter[];
  companyOverrides: CompanyParameterOverride[];
} {
  const macroParams: MacroParameter[] = [];
  const companyOverrides: CompanyParameterOverride[] = [];
  for (const [docPath, doc] of store.entries()) {
    if (doc.isDeleted === true) continue;
    if (docPath.startsWith('macro_params/')) {
      const key = docPath.slice('macro_params/'.length);
      macroParams.push(normalizeMacroParameterFromFirestore(key, doc) as MacroParameter);
    } else if (docPath.startsWith('company_assumptions/')) {
      const parts = docPath.split('/');
      const ticker = parts[1];
      const key = parts[3];
      companyOverrides.push(
        normalizeCompanyOverrideFromFirestore(key, ticker, doc) as CompanyParameterOverride
      );
    }
  }
  return { macroParams, companyOverrides };
}

describe('All_Parameters.xlsx Import/Export Contract & Precision Parity', () => {
  it('1) Template workbook uses the exact 14 central columns, documents UI vs Excel rules, and parses back cleanly', async () => {
    const templateWb = await buildAllParametersTemplateWorkbook();
    assert.ok(templateWb.SheetNames.includes(ALL_PARAMETERS_SHEET_NAME));
    assert.ok(templateWb.SheetNames.includes(ALL_PARAMETERS_INSTRUCTIONS_SHEET_NAME));

    const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(
      templateWb.Sheets[ALL_PARAMETERS_SHEET_NAME],
      { header: 1 }
    );
    assert.deepEqual(sheetRows[0], [...ALL_PARAMETERS_EXCEL_HEADERS]);

    const instructionText = JSON.stringify(
      XLSX.utils.sheet_to_json(templateWb.Sheets[ALL_PARAMETERS_INSTRUCTIONS_SHEET_NAME], { header: 1 })
    );
    assert.match(instructionText, /ValueType/);
    assert.match(instructionText, /IsPercentage/);
    assert.match(instructionText, /لوحة المدير/);
    assert.match(instructionText, /التحويل المزدوج/);

    const parsed = await parseAllParametersExcelFile(
      workbookToExcelFile(templateWb, 'All_Parameters_Template.xlsx')
    );
    assert.equal(parsed.rejected.length, 0);
    assert.ok(parsed.records.length >= 28);

    for (const rec of parsed.records) {
      const def = getParameterDefinition(rec.key);
      assert.ok(def, `Template row ${rec.key} must exist in registry`);
      assert.equal(rec.valueType, def.valueType);
      assert.equal(rec.isPercentage, def.valueType === 'pct' || def.isPercentage === true);
      assert.equal(rec.parameterTypeSource, 'registry');
    }
  });

  it('2) Custom percentage 15% (stored 0.15): Excel import -> save -> read -> export -> re-import preserves type & value without double scaling', async () => {
    const store = new Map<string, Record<string, any>>();

    // Import one custom global pct via "15%" string and one custom company pct via 0.075 decimal
    const initialFile = rowsToExcelFile([
      {
        Key: 'Custom_Illiquidity_Discount',
        NameAr: 'خصم سيولة مخصص',
        Value: '15%',
        ValueType: 'pct',
        IsPercentage: true,
        Description: 'خصم سيولة مرجعي',
        Scope: 'global',
        Ticker: '',
        Unit: 'decimal',
        AsOfDate: '2026-11-01',
        Source: 'لجنة الاستثمار',
      },
      {
        Key: 'Custom_Company_Haircut',
        NameAr: 'خصم شركة مخصص',
        Value: 0.075,
        ValueType: 'pct',
        IsPercentage: true,
        Description: 'هامش تحفظ خاص بالسهم',
        Scope: 'company',
        Ticker: 'SWDY',
        Unit: 'decimal',
        AsOfDate: '2026-11-02',
        Source: 'فريق التحليل',
      },
    ]);

    const parsed1 = await parseAllParametersExcelFile(initialFile);
    assert.equal(parsed1.rejected.length, 0);
    assert.equal(parsed1.records.length, 2);

    const preview1 = buildImportPreview({
      sourceType: 'parameters',
      fileName: initialFile.name,
      sheetName: parsed1.sheetName,
      totalRows: parsed1.totalRows,
      parsedRecords: parsed1.records,
      rejected: parsed1.rejected,
      warnings: parsed1.warnings,
      existingDocsMap: buildExistingPreviewMap(store),
    });
    assert.equal(preview1.inserts.length, 2);
    assert.equal(preview1.updates.length, 0);
    assert.equal(preview1.rejected.length, 0);

    const plan1 = commitImportRowsThroughProductionPlanner(
      preview1.inserts.map((i) => i.record),
      store
    );
    assert.equal(plan1.insertedCount, 2);
    // Preview hash MUST match server persistence hash identically
    for (let i = 0; i < preview1.inserts.length; i++) {
      assert.equal(plan1.writes[i].contentHash, preview1.inserts[i].contentHash);
    }

    const { macroParams, companyOverrides } = readAllFromStore(store);
    assert.equal(macroParams.length, 1);
    assert.equal(macroParams[0].key, 'Custom_Illiquidity_Discount');
    assert.equal(macroParams[0].nameAr, 'خصم سيولة مخصص');
    assert.equal(macroParams[0].value, 0.15);
    assert.equal(macroParams[0].valueType, 'pct');
    assert.equal(macroParams[0].isPercentage, true);
    assert.equal(macroParams[0].parameterTypeSource, 'explicit');
    assert.equal(macroParams[0].enabledInEngine, false);

    // Admin UI spec displays 0.15 as 15%
    const uiSpec = getMacroParameterInputSpec(macroParams[0].key, macroParams[0]);
    assert.equal(uiSpec.isPercentDecimal, true);
    assert.equal(storedValueToEditString(macroParams[0].key, macroParams[0].value, macroParams[0]), '15');

    assert.equal(companyOverrides.length, 1);
    assert.equal(companyOverrides[0].ticker, 'SWDY');
    assert.equal(companyOverrides[0].value, 0.075);
    assert.equal(companyOverrides[0].valueType, 'pct');
    assert.equal(companyOverrides[0].isPercentage, true);
    assert.equal(companyOverrides[0].nameAr, 'خصم شركة مخصص');

    // Export saved records to real Excel workbook
    const exportedWb = await buildAllParametersExportWorkbook({
      macroParams,
      companyOverrides,
    });
    const exportedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      exportedWb.Sheets[ALL_PARAMETERS_SHEET_NAME]
    );
    const exportedGlobal = exportedRows.find((r) => r.Key === 'Custom_Illiquidity_Discount')!;
    assert.equal(exportedGlobal.Value, 0.15, 'Export must write stored decimal 0.15, never 15');
    assert.equal(exportedGlobal.ValueType, 'pct');
    assert.equal(exportedGlobal.IsPercentage, true);
    assert.equal(exportedGlobal.NameAr, 'خصم سيولة مخصص');
    assert.equal(exportedGlobal.Unit, 'decimal');
    assert.equal(exportedGlobal.Source, 'لجنة الاستثمار');
    assert.equal(exportedGlobal.AsOfDate, '2026-11-01');
    assert.equal(exportedGlobal.Scope, 'global');

    // Re-import the exact exported Excel file: must be 100% unchanged (no type loss, no value scaling)
    const reimportFile = workbookToExcelFile(exportedWb, 'All_Parameters_Export.xlsx');
    const parsed2 = await parseAllParametersExcelFile(reimportFile);
    assert.equal(parsed2.rejected.length, 0);
    assert.equal(parsed2.records.length, 2);

    const preview2 = buildImportPreview({
      sourceType: 'parameters',
      fileName: reimportFile.name,
      sheetName: parsed2.sheetName,
      totalRows: parsed2.totalRows,
      parsedRecords: parsed2.records,
      rejected: parsed2.rejected,
      warnings: parsed2.warnings,
      existingDocsMap: buildExistingPreviewMap(store),
    });
    assert.equal(preview2.rejected.length, 0);
    assert.equal(preview2.inserts.length, 0);
    assert.equal(preview2.updates.length, 0);
    assert.equal(preview2.unchanged.length, 2);

    // Ambiguous plain 15 without % on a custom percentage row is rejected to prevent double-scaling
    const ambiguousFile = rowsToExcelFile([
      {
        Key: 'Custom_Illiquidity_Discount',
        Value: 15,
        ValueType: 'pct',
        IsPercentage: true,
        Scope: 'global',
      },
    ]);
    const parsedAmbiguous = await parseAllParametersExcelFile(ambiguousFile);
    assert.equal(parsedAmbiguous.records.length, 0);
    assert.equal(parsedAmbiguous.rejected.length, 1);
    assert.match(parsedAmbiguous.rejected[0].reasonAr, /قيمة ملتبسة لنسبة مئوية/);
  });

  it('3) Normal numeric custom parameter with value 0.15 (even with Unit=decimal) stays numeric and rejects % sign', async () => {
    const store = new Map<string, Record<string, any>>();
    const excelFile = rowsToExcelFile([
      {
        Key: 'Custom_Liquidity_Ratio',
        NameAr: 'معامل سيولة عددي',
        Value: 0.15,
        ValueType: 'number',
        IsPercentage: false,
        Description: 'معامل عددي ليس نسبة مئوية',
        Scope: 'global',
        Unit: 'decimal',
        AsOfDate: '2026-11-05',
        Source: 'بحث داخلي',
      },
      {
        Key: 'Custom_Bad_Percent_On_Number',
        Value: '15%',
        ValueType: 'number',
        IsPercentage: false,
        Scope: 'global',
      },
      {
        Key: 'Custom_Non_Integer',
        Value: 3.5,
        ValueType: 'integer',
        IsPercentage: false,
        Scope: 'global',
      },
    ]);

    const parsed = await parseAllParametersExcelFile(excelFile);
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.rejected.length, 2);
    assert.match(parsed.rejected[0].reasonAr, /تحتوي على علامة %/);
    assert.match(parsed.rejected[1].reasonAr, /عدداً صحيحاً/);

    commitImportRowsThroughProductionPlanner(parsed.records, store);
    const { macroParams } = readAllFromStore(store);
    assert.equal(macroParams.length, 1);
    assert.equal(macroParams[0].value, 0.15);
    assert.equal(macroParams[0].valueType, 'number');
    assert.equal(macroParams[0].isPercentage, false);
    assert.equal(macroParams[0].parameterTypeSource, 'explicit');
    assert.equal(macroParams[0].enabledInEngine, false);

    // Export and re-import preserves numeric type (never reclassified as percentage)
    const exportedWb = await buildAllParametersExportWorkbook({ macroParams });
    const reparsed = await parseAllParametersExcelFile(workbookToExcelFile(exportedWb));
    assert.equal(reparsed.rejected.length, 0);
    assert.equal(reparsed.records[0].value, 0.15);
    assert.equal(reparsed.records[0].valueType, 'number');
    assert.equal(reparsed.records[0].isPercentage, false);
  });

  it('4) ValueType and IsPercentage columns are genuinely read (together and individually)', async () => {
    const store = new Map<string, Record<string, any>>();
    const excelFile = rowsToExcelFile([
      { Key: 'Custom_Both_Pct', Value: 0.12, ValueType: 'pct', IsPercentage: 'TRUE', Scope: 'global' },
      { Key: 'Custom_Only_ValueType_Pct', Value: 0.18, ValueType: 'pct', IsPercentage: '', Scope: 'global' },
      { Key: 'Custom_Only_IsPct_True', Value: 0.21, ValueType: '', IsPercentage: true, Scope: 'global' },
      { Key: 'Custom_Only_IsPct_False', Value: 0.15, ValueType: '', IsPercentage: 'FALSE', Scope: 'global' },
      { Key: 'Custom_Multiple_Type', Value: 6.5, ValueType: 'multiple', IsPercentage: '', Scope: 'global' },
    ]);

    const parsed = await parseAllParametersExcelFile(excelFile);
    assert.equal(parsed.rejected.length, 0);
    assert.equal(parsed.records.length, 5);

    commitImportRowsThroughProductionPlanner(parsed.records, store);
    const { macroParams } = readAllFromStore(store);
    const byKey = new Map(macroParams.map((p) => [p.key, p]));

    assert.equal(byKey.get('Custom_Both_Pct')?.valueType, 'pct');
    assert.equal(byKey.get('Custom_Both_Pct')?.isPercentage, true);
    assert.equal(byKey.get('Custom_Only_ValueType_Pct')?.valueType, 'pct');
    assert.equal(byKey.get('Custom_Only_ValueType_Pct')?.isPercentage, true);
    assert.equal(byKey.get('Custom_Only_IsPct_True')?.valueType, 'pct');
    assert.equal(byKey.get('Custom_Only_IsPct_True')?.isPercentage, true);
    assert.equal(byKey.get('Custom_Only_IsPct_False')?.valueType, 'number');
    assert.equal(byKey.get('Custom_Only_IsPct_False')?.isPercentage, false);
    assert.equal(byKey.get('Custom_Multiple_Type')?.valueType, 'multiple');
    assert.equal(byKey.get('Custom_Multiple_Type')?.isPercentage, false);

    for (const p of macroParams) {
      assert.equal(p.enabledInEngine, false, `Custom parameter ${p.key} must not auto-enable in engine`);
    }
  });

  it('5) Missing or conflicting type on custom rows is rejected clearly without wiping existing stored type (parser, preview, and server planner)', async () => {
    const store = new Map<string, Record<string, any>>();

    // Seed an existing custom percentage parameter via production path
    const seedFile = rowsToExcelFile([
      {
        Key: 'Custom_Protected_Pct',
        NameAr: 'نسبة محمية',
        Value: 0.15,
        ValueType: 'pct',
        IsPercentage: true,
        Unit: 'decimal',
        Scope: 'global',
        Source: 'إدخال أولي',
      },
    ]);
    const seeded = await parseAllParametersExcelFile(seedFile);
    commitImportRowsThroughProductionPlanner(seeded.records, store);

    // Attempt to re-import without ValueType/IsPercentage, plus conflicting/invalid rows
    const badFile = rowsToExcelFile([
      {
        Key: 'Custom_Protected_Pct',
        Value: 0.15,
        Unit: 'decimal',
        ValueType: '',
        IsPercentage: '',
        Scope: 'global',
      },
      {
        Key: 'Custom_Conflict_A',
        Value: 0.15,
        ValueType: 'pct',
        IsPercentage: false,
        Scope: 'global',
      },
      {
        Key: 'Custom_Conflict_B',
        Value: 0.15,
        ValueType: 'number',
        IsPercentage: true,
        Scope: 'global',
      },
      {
        Key: 'Custom_Invalid_Type',
        Value: 0.15,
        ValueType: 'percentage',
        IsPercentage: '',
        Scope: 'global',
      },
      {
        Key: 'Custom_Invalid_Bool',
        Value: 0.15,
        ValueType: '',
        IsPercentage: 'maybe',
        Scope: 'global',
      },
    ]);

    const parsedBad = await parseAllParametersExcelFile(badFile);
    assert.equal(parsedBad.records.length, 0);
    assert.equal(parsedBad.rejected.length, 5);
    assert.equal(parsedBad.rejected[0].rowNumber, 2);
    assert.match(parsedBad.rejected[0].reasonAr, /Custom_Protected_Pct/);
    assert.match(parsedBad.rejected[0].reasonAr, /ValueType/);
    assert.match(parsedBad.rejected[0].reasonAr, /IsPercentage/);
    assert.match(parsedBad.rejected[1].reasonAr, /تعارض/);
    assert.match(parsedBad.rejected[2].reasonAr, /تعارض/);
    assert.match(parsedBad.rejected[3].reasonAr, /غير مدعوم/);
    assert.match(parsedBad.rejected[4].reasonAr, /IsPercentage غير صالح/);

    const badPreview = buildImportPreview({
      sourceType: 'parameters',
      fileName: badFile.name,
      sheetName: parsedBad.sheetName,
      totalRows: parsedBad.totalRows,
      parsedRecords: parsedBad.records,
      rejected: parsedBad.rejected,
      warnings: parsedBad.warnings,
      existingDocsMap: buildExistingPreviewMap(store),
    });
    assert.equal(badPreview.inserts.length, 0);
    assert.equal(badPreview.updates.length, 0);
    assert.equal(badPreview.rejected.length, 5);

    // Defense-in-depth #1: preview rejects even a manually injected untyped custom record
    const previewBypass = buildImportPreview({
      sourceType: 'parameters',
      fileName: 'manual.xlsx',
      sheetName: ALL_PARAMETERS_SHEET_NAME,
      totalRows: 1,
      parsedRecords: [
        {
          key: 'Custom_Protected_Pct',
          value: 0.15,
          description: '',
          scope: 'global',
          ticker: null,
          unit: 'decimal',
          asOfDate: '',
          source: 'test',
          sourceRow: 2,
        },
      ],
      rejected: [],
      warnings: [],
      existingDocsMap: buildExistingPreviewMap(store),
    });
    assert.equal(previewBypass.updates.length, 0);
    assert.equal(previewBypass.rejected.length, 1);
    assert.match(previewBypass.rejected[0].reasonAr, /ولن يُسمح بمحوه بصمت/);

    // Defense-in-depth #2: production server planner rejects an untyped update against an existing typed custom doc
    assert.throws(
      () =>
        planParameterPersistenceWrites({
          rawInputs: [
            {
              key: 'Custom_Protected_Pct',
              value: 0.2,
              description: 'attempt wipe',
              scope: 'global',
              ticker: null,
              unit: 'decimal',
              asOfDate: '',
              source: 'direct_call',
              precondition: buildParameterUpdatePrecondition(
                store.get('macro_params/Custom_Protected_Pct')!
              ),
            },
          ],
          existingDocsByPath: store,
          provenance: TEST_PROVENANCE,
        }),
      /بدون تعريف نوع صريح/
    );

    // Existing stored custom percentage remains completely untouched
    const after = readAllFromStore(store).macroParams[0];
    assert.equal(after.value, 0.15);
    assert.equal(after.valueType, 'pct');
    assert.equal(after.isPercentage, true);
    assert.equal(after.parameterTypeSource, 'explicit');

    // Legacy untyped custom doc remains inspectable and exports blank type columns without inventing a type
    const legacyDoc = normalizeMacroParameterFromFirestore('Legacy_Old_Param', {
      key: 'Legacy_Old_Param',
      value: 0.15,
      unit: 'decimal',
      source: 'legacy',
    }) as MacroParameter;
    assert.equal(legacyDoc.parameterTypeSource, 'unspecified');
    assert.equal(legacyDoc.valueType, null);
    assert.equal(legacyDoc.isPercentage, null);
    const legacyWb = await buildAllParametersExportWorkbook({ macroParams: [legacyDoc] });
    const legacySheetRow = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      legacyWb.Sheets[ALL_PARAMETERS_SHEET_NAME],
      { defval: '' }
    )[0];
    assert.equal(legacySheetRow.ValueType, '');
    assert.equal(legacySheetRow.IsPercentage, '');
  });

  it('6) Central registry remains authoritative for known parameters even if Excel omits or mismatches type columns', async () => {
    const store = new Map<string, Record<string, any>>();
    const excelFile = rowsToExcelFile([
      {
        Key: 'RIM_Retention',
        Value: 0.4,
        ValueType: 'number',
        IsPercentage: false,
        Scope: 'global',
        Unit: 'decimal',
        Source: 'مراجعة',
      },
      {
        Key: 'Beta_Raw_Weight',
        Value: 0.67,
        ValueType: 'pct',
        IsPercentage: true,
        Scope: 'global',
        Unit: 'ratio',
        Source: 'مراجعة',
      },
      {
        Key: 'TaxRate',
        Value: 0.225,
        ValueType: '',
        IsPercentage: '',
        Scope: 'global',
        Source: 'مراجعة',
      },
    ]);

    const parsed = await parseAllParametersExcelFile(excelFile);
    assert.equal(parsed.rejected.length, 0);
    assert.equal(parsed.records.length, 3);
    assert.ok(
      parsed.warnings.some((w) => w.includes('RIM_Retention') && w.includes('السجل المركزي')),
      'Expected warning noting registry override for RIM_Retention'
    );
    assert.ok(
      parsed.warnings.some((w) => w.includes('Beta_Raw_Weight') && w.includes('السجل المركزي')),
      'Expected warning noting registry override for Beta_Raw_Weight'
    );

    commitImportRowsThroughProductionPlanner(parsed.records, store);
    const { macroParams } = readAllFromStore(store);
    const byKey = new Map(macroParams.map((p) => [p.key, p]));

    assert.equal(byKey.get('RIM_Retention')?.valueType, 'pct');
    assert.equal(byKey.get('RIM_Retention')?.isPercentage, true);
    assert.equal(byKey.get('RIM_Retention')?.parameterTypeSource, 'registry');
    assert.equal(byKey.get('RIM_Retention')?.enabledInEngine, true);

    assert.equal(byKey.get('Beta_Raw_Weight')?.valueType, 'number');
    assert.equal(byKey.get('Beta_Raw_Weight')?.isPercentage, false);
    assert.equal(byKey.get('Beta_Raw_Weight')?.parameterTypeSource, 'registry');
    assert.equal(byKey.get('Beta_Raw_Weight')?.enabledInEngine, true);

    assert.equal(byKey.get('TaxRate')?.valueType, 'pct');
    assert.equal(byKey.get('TaxRate')?.isPercentage, true);
    assert.equal(byKey.get('TaxRate')?.parameterTypeSource, 'registry');
  });

  it('7) Changing ONLY the type of a custom parameter (same value 0.15) appears in preview, business hash, and server persistence', async () => {
    const store = new Map<string, Record<string, any>>();

    const v1File = rowsToExcelFile([
      {
        Key: 'Custom_Switchable',
        NameAr: 'معامل قابل للتصنيف',
        Value: 0.15,
        ValueType: 'number',
        IsPercentage: false,
        Description: 'اختبار تغيير النوع فقط',
        Scope: 'global',
        Unit: 'decimal',
        AsOfDate: '2026-11-10',
        Source: 'لجنة',
      },
    ]);
    const parsedV1 = await parseAllParametersExcelFile(v1File);
    assert.equal(parsedV1.rejected.length, 0);
    const planV1 = commitImportRowsThroughProductionPlanner(parsedV1.records, store);
    const hashV1 = planV1.writes[0].contentHash;

    // Change ONLY ValueType & IsPercentage while keeping Value=0.15 and all other columns identical
    const v2File = rowsToExcelFile([
      {
        Key: 'Custom_Switchable',
        NameAr: 'معامل قابل للتصنيف',
        Value: 0.15,
        ValueType: 'pct',
        IsPercentage: true,
        Description: 'اختبار تغيير النوع فقط',
        Scope: 'global',
        Unit: 'decimal',
        AsOfDate: '2026-11-10',
        Source: 'لجنة',
      },
    ]);
    const parsedV2 = await parseAllParametersExcelFile(v2File);
    assert.equal(parsedV2.rejected.length, 0);

    const previewV2 = buildImportPreview({
      sourceType: 'parameters',
      fileName: v2File.name,
      sheetName: parsedV2.sheetName,
      totalRows: parsedV2.totalRows,
      parsedRecords: parsedV2.records,
      rejected: parsedV2.rejected,
      warnings: parsedV2.warnings,
      existingDocsMap: buildExistingPreviewMap(store),
    });
    assert.equal(previewV2.updates.length, 1);
    assert.equal(previewV2.unchanged.length, 0);
    assert.notEqual(previewV2.updates[0].contentHash, hashV1);
    assert.ok(previewV2.updates[0].changedFields?.includes('valueType'));
    assert.ok(previewV2.updates[0].changedFields?.includes('isPercentage'));

    const planV2 = commitImportRowsThroughProductionPlanner(
      previewV2.updates.map((u) => u.record),
      store
    );
    assert.equal(planV2.updatedCount, 1);
    assert.equal(planV2.skippedUnchangedCount, 0);
    assert.equal(planV2.writes[0].contentHash, previewV2.updates[0].contentHash);

    const saved = readAllFromStore(store).macroParams[0];
    assert.equal(saved.value, 0.15);
    assert.equal(saved.valueType, 'pct');
    assert.equal(saved.isPercentage, true);
    assert.equal(saved.parameterTypeSource, 'explicit');

    // Verify business hash directly differs between number and pct for identical numeric value
    assert.notEqual(
      computeRecordBusinessHash('parameter', { ...saved, valueType: 'number', isPercentage: false }),
      computeRecordBusinessHash('parameter', { ...saved, valueType: 'pct', isPercentage: true })
    );
  });

  it('8) Zero vs blank, tiny non-zero (1e-12), high-precision values, exact % shift, and underflow guard round-trip without silent rounding', async () => {
    const store = new Map<string, Record<string, any>>();
    const excelFile = rowsToExcelFile([
      { Key: 'Custom_Zero_Pct', Value: 0, ValueType: 'pct', IsPercentage: true, Scope: 'global' },
      { Key: 'Custom_Zero_Num', Value: 0, ValueType: 'number', IsPercentage: false, Scope: 'global' },
      { Key: 'Custom_Blank_Val', Value: '', ValueType: 'number', IsPercentage: false, Scope: 'global' },
      { Key: 'Custom_Blank_Token', Value: 'BLANK', ValueType: 'pct', IsPercentage: true, Scope: 'global' },
      {
        Key: 'Custom_Tiny_NonZero',
        Value: 0.000000000001,
        ValueType: 'number',
        IsPercentage: false,
        Scope: 'global',
      },
      {
        Key: 'Custom_High_Precision_Pct',
        Value: 0.1234567890123456,
        ValueType: 'pct',
        IsPercentage: true,
        Scope: 'global',
      },
      {
        Key: 'Custom_Large_Precise',
        Value: 123456789012.345,
        ValueType: 'number',
        IsPercentage: false,
        Scope: 'global',
      },
      {
        Key: 'Custom_Exact_Pct_Text',
        Value: '19.9%',
        ValueType: 'pct',
        IsPercentage: true,
        Scope: 'global',
      },
      {
        Key: 'Custom_Underflow_Pct',
        Value: '1e-323%',
        ValueType: 'pct',
        IsPercentage: true,
        Scope: 'global',
      },
    ]);

    const parsed = await parseAllParametersExcelFile(excelFile);
    assert.equal(parsed.records.length, 6);
    assert.equal(parsed.rejected.length, 3);
    assert.ok(parsed.rejected.some((r) => r.reasonAr.includes('Custom_Blank_Val')));
    assert.ok(parsed.rejected.some((r) => r.reasonAr.includes('Custom_Blank_Token')));
    assert.ok(parsed.rejected.some((r) => r.reasonAr.includes('Custom_Underflow_Pct')));

    commitImportRowsThroughProductionPlanner(parsed.records, store);
    const { macroParams } = readAllFromStore(store);
    const byKey = new Map(macroParams.map((p) => [p.key, p]));

    assert.equal(Object.is(byKey.get('Custom_Zero_Pct')?.value, 0), true);
    assert.equal(Object.is(byKey.get('Custom_Zero_Num')?.value, 0), true);
    assert.equal(byKey.get('Custom_Tiny_NonZero')?.value, 0.000000000001);
    assert.notEqual(byKey.get('Custom_Tiny_NonZero')?.value, 0);
    assert.equal(byKey.get('Custom_High_Precision_Pct')?.value, 0.1234567890123456);
    assert.equal(byKey.get('Custom_Large_Precise')?.value, 123456789012.345);
    assert.equal(byKey.get('Custom_Exact_Pct_Text')?.value, 0.199);

    // Export -> real Excel binary -> re-import -> preview must show 6 unchanged, 0 updates, exact values
    const exportedWb = await buildAllParametersExportWorkbook({ macroParams });
    const reimportFile = workbookToExcelFile(exportedWb, 'All_Parameters_Precision_Export.xlsx');
    const reparsed = await parseAllParametersExcelFile(reimportFile);
    assert.equal(reparsed.rejected.length, 0);
    assert.equal(reparsed.records.length, 6);

    const preview = buildImportPreview({
      sourceType: 'parameters',
      fileName: reimportFile.name,
      sheetName: reparsed.sheetName,
      totalRows: reparsed.totalRows,
      parsedRecords: reparsed.records,
      rejected: reparsed.rejected,
      warnings: reparsed.warnings,
      existingDocsMap: buildExistingPreviewMap(store),
    });
    assert.equal(preview.rejected.length, 0);
    assert.equal(preview.inserts.length, 0);
    assert.equal(preview.updates.length, 0);
    assert.equal(preview.unchanged.length, 6);

    const reparsedByKey = new Map(reparsed.records.map((r) => [r.key, r]));
    assert.equal(reparsedByKey.get('Custom_Tiny_NonZero')?.value, 0.000000000001);
    assert.equal(reparsedByKey.get('Custom_High_Precision_Pct')?.value, 0.1234567890123456);
    assert.equal(reparsedByKey.get('Custom_Large_Precise')?.value, 123456789012.345);
    assert.equal(reparsedByKey.get('Custom_Exact_Pct_Text')?.value, 0.199);
  });
});
