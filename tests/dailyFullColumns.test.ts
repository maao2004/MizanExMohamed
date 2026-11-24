import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  computeRecordBusinessHash,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  MAX_BATCH_PAYLOAD_BYTES,
  splitItemsIntoByteSafeChunks,
  validateDailySchemaPayload,
  validateRecords,
} from '../src/core/contracts';
import { buildImportPreview, parseDailyTradingExcelDetailed } from '../src/core/imports';
import { FirestoreSessionManager } from '../src/core/domain/firestoreSessionManager';
import { buildDailyTradingWorkbook, resolveDailyExportColumns } from '../src/utils/excelExport';
import { computeComprehensiveValuation } from '../src/core/math/valuation';

function makeXlsxFileFromWorkbook(wb: XLSX.WorkBook, fileName: string): File {
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([bytes], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('Part 2: Dynamic Full-Column Daily Trading Import, Chunking, Validation, Sync & Export', () => {
  it('1) Extracts ALL 75 columns (>61), duplicate/blank headers, cells past last header, leading zeros, 0 vs blank, booleans & formula flags', async () => {
    const ws: XLSX.WorkSheet = {};

    const headers: Array<[number, string | null]> = [
      [0, 'الرمز'],
      [1, 'الإسم المختصر'],
      [2, 'أخر'],
      [3, 'التغير%'],
      [4, 'إقفال اليوم'],
      [5, 'رأس مال السوق بالألأف'],
      [6, 'الأسهم المدرجة'],
      [7, 'الكود الدولي'],
      [8, 'مضاعف ربحية السهم'],
      [9, 'مضاعف القيمة الدفترية'],
    ];

    for (let c = 10; c <= 73; c++) {
      if (c === 42 || c === 65) {
        headers.push([c, 'عمود مكرر']);
      } else if (c === 50) {
        headers.push([c, null]); // عنوان فارغ وسط الجدول
      } else {
        headers.push([c, `مؤشر إضافي ${c}`]);
      }
    }
    // Note: column index 74 (col 75) intentionally has NO header at row 0!

    for (const [c, h] of headers) {
      if (h !== null) {
        ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: h };
      }
    }

    // Row 1 (COMI)
    ws[XLSX.utils.encode_cell({ r: 1, c: 0 })] = { t: 's', v: 'COMI' };
    ws[XLSX.utils.encode_cell({ r: 1, c: 1 })] = { t: 's', v: 'التجاري الدولي' };
    ws[XLSX.utils.encode_cell({ r: 1, c: 2 })] = { t: 'n', v: 85.5, w: '85.50' };
    ws[XLSX.utils.encode_cell({ r: 1, c: 3 })] = { t: 'n', v: 0, w: '0.00' }; // 0 صريح غير مفقود
    ws[XLSX.utils.encode_cell({ r: 1, c: 4 })] = { t: 'n', v: 85.5, w: '85.50' };
    ws[XLSX.utils.encode_cell({ r: 1, c: 5 })] = { t: 'n', v: 260000000 }; // رأس مال السوق بالألأف خام
    ws[XLSX.utils.encode_cell({ r: 1, c: 6 })] = { t: 'n', v: 3040000000 };
    ws[XLSX.utils.encode_cell({ r: 1, c: 7 })] = { t: 's', v: '00123', w: '00123' }; // كود بأصفار بادئة
    ws[XLSX.utils.encode_cell({ r: 1, c: 8 })] = { t: 'n', v: 7.4 };
    ws[XLSX.utils.encode_cell({ r: 1, c: 9 })] = { t: 'n', v: 2.15 };

    // Extra columns up to 74
    ws[XLSX.utils.encode_cell({ r: 1, c: 42 })] = { t: 'n', v: 111 }; // عمود مكرر أول
    ws[XLSX.utils.encode_cell({ r: 1, c: 50 })] = { t: 'b', v: true }; // خلية منطقية في عمود بلا عنوان
    // col 55 left intentionally blank (missing -> not stored as 0)
    ws[XLSX.utils.encode_cell({ r: 1, c: 64 })] = { t: 'n', v: 171, f: 'C2*2' }; // صيغة بقيمة مخبأة
    ws[XLSX.utils.encode_cell({ r: 1, c: 65 })] = { t: 'n', v: 222 }; // عمود مكرر ثاني
    ws[XLSX.utils.encode_cell({ r: 1, c: 68 })] = { t: 's', v: '', f: 'C2*3' }; // صيغة بلا قيمة مخبأة
    ws[XLSX.utils.encode_cell({ r: 1, c: 74 })] = { t: 's', v: 'بعد آخر عنوان' }; // عمود 75 بعد آخر عنوان!

    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 1, c: 74 } });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const file = makeXlsxFileFromWorkbook(wb, '2026-11-8.xlsx');

    const parsed = await parseDailyTradingExcelDetailed(file);
    assert.equal(parsed.rejected.length, 0);
    assert.equal(parsed.tradeDate, '2026-11-08');
    assert.equal(parsed.records.length, 1);
    assert.ok(parsed.dailySchema);
    assert.equal(parsed.dailySchema.totalColumns, 75);
    assert.equal(parsed.dailySchema.columns.length, 75);
    assert.equal(parsed.dailySchema.columns[74].colId, 'col_74');
    assert.equal(parsed.dailySchema.columns[74].headerName, null);

    // Duplicate headers get distinct positional IDs & duplicate flag
    assert.equal(parsed.dailySchema.columns[42].colId, 'col_42');
    assert.equal(parsed.dailySchema.columns[65].colId, 'col_65');
    assert.equal(parsed.dailySchema.columns[65].isDuplicateHeader, true);

    const rec = parsed.records[0];
    assert.equal(rec.ticker, 'COMI');
    assert.equal(rec.changePct, 0);
    assert.equal(rec.marketCapThousands, 260000000);
    assert.equal(rec.peRatio, 7.4);
    assert.equal(rec.pbRatio, 2.15);
    assert.equal(rec.isinCode, '00123');
    assert.equal(rec.rawCells?.col_3?.v, 0);
    assert.equal(rec.rawCells?.col_7?.v, '00123');
    assert.equal(rec.rawCells?.col_7?.t, 's');
    assert.equal(rec.rawCells?.col_42?.v, 111);
    assert.equal(rec.rawCells?.col_50?.v, true);
    assert.equal(rec.rawCells?.col_50?.t, 'b');
    assert.equal(rec.rawCells?.col_55, undefined); // Blank not fabricated as 0
    assert.equal(rec.rawCells?.col_64?.v, 171);
    assert.equal(rec.rawCells?.col_64?.f, 'C2*2');
    assert.equal(rec.rawCells?.col_65?.v, 222);
    assert.equal(rec.rawCells?.col_68?.f, 'C2*3');
    assert.equal(rec.rawCells?.col_68?.v, null);
    assert.equal(rec.rawCells?.col_68?.formulaMissingCachedResult, true);
    assert.equal(rec.rawCells?.col_74?.v, 'بعد آخر عنوان');
    assert.equal(rec.rawRowHeadersMissingCount, 2);
    assert.equal(rec.formulaMissingCachedCount, 1);
    assert.ok(parsed.warnings.some((w) => w.includes('صيغ')));

    // Validate through shared contracts & Cloud Functions schema validation
    const validatedSchema = validateDailySchemaPayload(parsed.dailySchema);
    assert.equal(validatedSchema.totalColumns, 75);
    const validatedRecords = validateRecords([rec], false);
    assert.equal(validatedRecords.length, 1);
    assert.equal(validatedRecords[0].pbRatio, 2.15);
    assert.equal(validatedRecords[0].rawCells.col_74.v, 'بعد آخر عنوان');

    // Excel export preserves ALL 75 columns + leading zero + 0
    const exportCols = resolveDailyExportColumns([rec], { [parsed.dailySchema.schemaId]: parsed.dailySchema });
    assert.equal(exportCols.length, 75);
    assert.equal(exportCols[42].headerName, 'عمود مكرر');
    assert.equal(exportCols[65].headerName, 'عمود مكرر');
    const outWb = await buildDailyTradingWorkbook([rec], { [parsed.dailySchema.schemaId]: parsed.dailySchema });
    const outSheet = outWb.Sheets['Daily_Trading'];
    const aoa = XLSX.utils.sheet_to_json(outSheet, { header: 1, defval: null }) as any[][];
    assert.equal(aoa[0].length, 76); // 75 schema cols + TradeDate
    assert.equal(aoa[1][3], 0);
    assert.equal(aoa[1][7], '00123');
    assert.equal(aoa[1][74], 'بعد آخر عنوان');
  });

  it('2) Detects changes in extra column #68 in business hash / preview and preserves unchanged skip', () => {
    const baseRec = {
      ticker: 'COMI',
      shortName: 'COMI',
      tradeDate: '2026-11-08',
      lastPrice: 85.5,
      changePct: 0,
      tradesCount: 100,
      openPrice: 85,
      closePrice: 85.5,
      turnoverValue: 1000,
      netLiquidity: 100,
      volume: 500,
      avgVolume5D: null,
      avgVolume30D: null,
      avgVolume90D: null,
      lowPrice: 84,
      highPrice: 86,
      sector: 'Banks',
      totalBids: null,
      bidsCount: null,
      offersCount: null,
      totalOffers: null,
      avgVolume: null,
      high52W: null,
      low52W: null,
      prevClose: 85.5,
      marketCapThousands: 260000000,
      vwap: 85.2,
      peRatio: 7.4,
      pbRatio: 2.15,
      listedShares: 3040000000,
      isinCode: '00123',
      inflowOrders: null,
      inflowVolume: null,
      inflowLiquidity: null,
      askTrades: null,
      askTradesVolume: null,
      outflowLiquidity: null,
      fullName: 'CIB',
      market: 'Main',
      volChange5DPct: null,
      volChange30DPct: null,
      volChange90DPct: null,
      schemaId: 'daily_2026-11-08_s1',
      rawCells: {
        col_0: { v: 'COMI', t: 's' as const },
        col_67: { v: 12.5, t: 'n' as const, w: '12.5' },
      },
      updatedAt: '2026-11-08T10:00:00Z',
    };

    const existingHash = computeRecordBusinessHash('daily', baseRec);
    const modifiedRec = {
      ...baseRec,
      rawCells: {
        ...baseRec.rawCells,
        col_67: { v: 99.9, t: 'n' as const, w: '99.9' },
      },
    };

    const existingMap = new Map<string, Record<string, any>>([
      ['COMI_2026-11-08', { ...baseRec, contentHash: existingHash }],
    ]);

    const samePreview = buildImportPreview({
      sourceType: 'daily',
      fileName: '2026-11-08.xlsx',
      sheetName: 'Sheet1',
      tradeDate: '2026-11-08',
      totalRows: 1,
      parsedRecords: [baseRec],
      rejected: [],
      warnings: [],
      existingDocsMap: existingMap,
    });
    assert.equal(samePreview.unchanged.length, 1);
    assert.equal(samePreview.updates.length, 0);

    const changedPreview = buildImportPreview({
      sourceType: 'daily',
      fileName: '2026-11-08.xlsx',
      sheetName: 'Sheet1',
      tradeDate: '2026-11-08',
      totalRows: 1,
      parsedRecords: [modifiedRec],
      rejected: [],
      warnings: [],
      existingDocsMap: existingMap,
    });
    assert.equal(changedPreview.updates.length, 1);
    assert.ok(changedPreview.updates[0].changedFields?.includes('rawCells'));
  });

  it('3) Enforces 1 MiB document size rejection without dropping columns & splits batches by byte budget', () => {
    const hugeString = 'X'.repeat(FIRESTORE_MAX_DOCUMENT_BYTES + 20_000);
    assert.throws(
      () =>
        validateRecords(
          [
            {
              ticker: 'COMI',
              tradeDate: '2026-11-08',
              rawCells: { col_99: { v: hugeString, t: 's' } },
            },
          ],
          false
        ),
      /يتجاوز حد مستند Firestore/
    );

    const heavyItems = Array.from({ length: 12 }, (_, idx) => ({
      id: idx,
      payload: 'A'.repeat(400_000),
    }));
    const chunks = splitItemsIntoByteSafeChunks(heavyItems, {
      maxItemsPerChunk: 50,
      maxPayloadBytes: MAX_BATCH_PAYLOAD_BYTES,
      estimateItemBytes: (item) => Buffer.byteLength(JSON.stringify(item), 'utf8'),
    });
    assert.ok(chunks.length >= 2);
    assert.equal(chunks.reduce((sum, c) => sum + c.length, 0), 12);
  });

  it('4) Syncs dailySchemas across snapshot, incremental delta, and tombstones in FirestoreSessionManager', () => {
    const mgr = new FirestoreSessionManager();
    const token = mgr.beginSession('user_test_1');
    mgr.applyManualSyncResult(token, {
      quarterly: [],
      companies: [],
      daily: [],
      stories: {},
      decisions: {},
      trades: [],
      macro: [],
      dailySchemas: {
        s1: {
          schemaId: 's1',
          tradeDate: '2026-11-08',
          totalColumns: 65,
          columns: [
            {
              colId: 'col_0',
              index: 0,
              colLetter: 'A',
              headerName: 'الرمز',
              normalizedHeader: 'الرمز',
              mappedField: 'ticker',
            },
          ],
          updatedAt: '2026-11-08T12:00:00Z',
        },
      },
    });
    assert.equal(mgr.getState().dailySchemas.s1.totalColumns, 65);

    mgr.applyManualSyncResult(token, {
      isIncrementalDelta: true,
      quarterly: [],
      companies: [],
      daily: [],
      stories: {},
      decisions: {},
      trades: [],
      macro: [],
      dailySchemas: {
        s2: {
          schemaId: 's2',
          tradeDate: '2026-11-09',
          totalColumns: 70,
          columns: [
            {
              colId: 'col_0',
              index: 0,
              colLetter: 'A',
              headerName: 'الرمز',
              normalizedHeader: 'الرمز',
              mappedField: 'ticker',
            },
          ],
          updatedAt: '2026-11-09T12:00:00Z',
        },
      },
      tombstones: [
        {
          id: 't1',
          collection: 'daily_trading_schemas',
          docId: 's1',
          deletedAt: '2026-11-09T13:00:00Z',
          expiresAtMs: Date.now() + 86400_000,
        },
      ],
    });
    assert.equal(mgr.getState().dailySchemas.s1, undefined);
    assert.equal(mgr.getState().dailySchemas.s2.totalColumns, 70);
  });

  it('5) Keeps daily peRatio/pbRatio strictly transparent without mutating configured model weights', () => {
    const res = computeComprehensiveValuation(
      {
        ticker: 'COMI',
        marketPrice: 85.5,
        sharesOutstanding: 3_040_000_000,
        betaRaw: 1.0,
        betaStatus: 'actual',
        netIncomeTTM: 30_000_000_000,
        ocfTTM: 35_000_000_000,
        capexTTM: 2_000_000_000,
        fcfTTM: 33_000_000_000,
        fcffTTM: 30_000_000_000,
        ebitdaTTM: 40_000_000_000,
        totalEquity: 120_000_000_000,
        totalDebt: 0,
        cash: 10_000_000_000,
        dpsRegular: 2.5,
        sector: 'البنوك',
        sectorClassification: 'financial',
        companyTargetPE: 7.5,
        companyTargetPB: 2.0,
      },
      {
        TaxRate: 0.225,
        Rf_Egypt_10Y: 0.25,
        ERP_Developed: 0.0421,
        CRP_Egypt: 0.076,
        Beta_Default: 1.0,
        Terminal_Growth: 0.05,
        Exit_Multiple: 6,
        Forecast_Years: 5,
        Cost_of_Debt: 0.15,
        Growth_Y1: 0.15,
        Growth_Y2: 0.12,
        Growth_Y3: 0.1,
        Growth_Y4: 0.08,
        Growth_Y5: 0.06,
        WACC_Mode: 1,
        DDM_Growth: 0.08,
        r_Mode: 1,
        Weight_DCF: 0.5,
        Weight_DDM: 0.2,
        Weight_Relative: 0.1,
        Weight_Graham: 0.1,
        Weight_RIM: 0.1,
        Beta_Raw_Weight: 1,
        Beta_Anchor: 1,
        Country_Risk_Lambda: 1,
        RIM_Retention: 0.6,
        Relative_PE_Weight: 0.5,
        Relative_PB_Weight: 0.5,
      }
    );
    // Relative weights remain exactly 50%/50% as configured, not auto-derived from daily pbRatio/peRatio
    assert.ok(Math.abs(res.configuredWeights.relative - 10) < 1e-9);
    assert.ok(res.relativeValue !== null);
  });
});
