/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BetaAssumptionRecord,
  CompanyParameterOverride,
  DailyCellType,
  DailyRawCellValue,
  DailyTradingColumnSchema,
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  DividendApprovalStatus,
  DividendDistributionSemantics,
  DividendRecord,
  DividendRecordType,
  ImportRejectedRow,
  MacroParameter,
  NetIncomeCommonBasis,
  CommonEquityBasis,
  QuarterlyFinancialRecord,
  RfMethodologyClassification,
  WeightedAvgSharesBasis,
} from '../../types';
import {
  ALL_PARAMETERS_EXCEL_HEADER_ALIASES,
  ALL_PARAMETERS_SHEET_NAME,
  buildDividendDocId,
  computeCalendarSpanDays,
  computeCanonicalHash,
  estimateJsonUtf8Bytes,
  FIRESTORE_MAX_DOCUMENT_BYTES,
  getParameterDefinition,
  isValidCalendarDate,
  normalizedTicker,
  normalizeRfMethodology,
  normalizeStrictCurrency,
  ParameterTypeSource,
  ParameterValueType,
  parseCleanBoolean,
  parseCleanNumber,
  parseCleanText,
  parseOptionalParameterValueType,
  parseStrictPercentage,
  resolveCanonicalParameterType,
  resolveImportedReportedEpsPeriod,
  validateAndNormalizeWeightedAvgSharesBasis,
} from '../contracts';
import { loadXlsx } from './xlsxLoader';

export interface ParsedSourceResult<T> {
  sheetName: string;
  totalRows: number;
  tradeDate?: string | null;
  dailySchema?: DailyTradingSchemaRecord | null;
  records: T[];
  rejected: ImportRejectedRow[];
  warnings: string[];
  requiresSemanticsConfirmation?: boolean;
  defaultSemanticsUsed?: DividendDistributionSemantics;
  requiresApprovalConfirmation?: boolean;
  rowsMissingApprovalCount?: number;
}

export interface ParsedParameterImportRow {
  key: string;
  nameAr: string;
  value: number;
  valueType: ParameterValueType | null;
  isPercentage: boolean | null;
  parameterTypeSource: ParameterTypeSource;
  description: string;
  scope: 'global' | 'company';
  ticker: string | null;
  unit: string;
  asOfDate: string;
  source: string;
  rfMethodology?: RfMethodologyClassification;
  currency?: 'EGP' | 'USD' | null;
  forecastHorizonYears?: number | null;
  sourceRow: number;
  toMacroParameter: () => MacroParameter;
  toCompanyOverride: () => CompanyParameterOverride;
}

export function extractDateFromDailyFileName(fileName: string): string | null {
  const match = fileName.match(/(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/);
  if (!match) return null;
  const year = match[1];
  const month = match[2].padStart(2, '0');
  const day = match[3].padStart(2, '0');
  const date = `${year}-${month}-${day}`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
    ? date
    : null;
}

async function parseExcelDateValue(
  raw: unknown,
  XLSX: typeof import('xlsx')
): Promise<string | null> {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 1 && raw < 2958466) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const iso = `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      return isValidCalendarDate(iso) ? iso : null;
    }
  }
  const text = parseCleanText(raw);
  if (!text) return null;
  if (isValidCalendarDate(text)) return text;
  const slashMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (slashMatch) {
    const candidate = `${slashMatch[1]}-${slashMatch[2].padStart(2, '0')}-${slashMatch[3].padStart(2, '0')}`;
    return isValidCalendarDate(candidate) ? candidate : null;
  }
  return null;
}

function normalizeDailyHeaderText(raw: string): string {
  return raw
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const DAILY_HEADER_FIELD_ALIASES: Record<string, keyof DailyTradingRecord> = (() => {
  const entries: Array<[string[], keyof DailyTradingRecord]> = [
    [['الرمز', 'ticker', 'symbol', 'كود السهم'], 'ticker'],
    [['الإسم المختصر', 'الاسم المختصر', 'short name', 'shortname'], 'shortName'],
    [['أخر', 'آخر', 'اخر', 'last price', 'last', 'lastprice'], 'lastPrice'],
    [['التغير%', 'التغير %', 'change%', 'change %', 'changepct'], 'changePct'],
    [['الصفقات', 'trades', 'trades count', 'tradescount'], 'tradesCount'],
    [['فتح', 'سعر الفتح', 'open', 'open price', 'openprice'], 'openPrice'],
    [['إقفال اليوم', 'اقفال اليوم', 'الاغلاق', 'الإغلاق', 'close', 'close price', 'closeprice'], 'closePrice'],
    [['قيمة التداول', 'turnover', 'turnover value', 'turnovervalue'], 'turnoverValue'],
    [['صافي السيولة', 'net liquidity', 'netliquidity'], 'netLiquidity'],
    [['حجم التداول', 'volume'], 'volume'],
    [['متوسط الحجم 5 أيام', 'avg volume 5d', 'avgvolume5d'], 'avgVolume5D'],
    [['متوسط حجم التداول خلال 30 يوم', 'avg volume 30d', 'avgvolume30d'], 'avgVolume30D'],
    [['متوسط حجم التداول خلال 90 يوم', 'avg volume 90d', 'avgvolume90d'], 'avgVolume90D'],
    [['الأدنى', 'الادنى', 'low', 'low price', 'lowprice'], 'lowPrice'],
    [['أعلى', 'اعلى', 'high', 'high price', 'highprice'], 'highPrice'],
    [['القطاع', 'sector'], 'sector'],
    [['اجمالي الطلبات', 'إجمالي الطلبات', 'total bids', 'totalbids'], 'totalBids'],
    [['عدد الطلبات', 'bids count', 'bidscount'], 'bidsCount'],
    [['عدد العروض', 'offers count', 'offerscount'], 'offersCount'],
    [['اجمالي العروض', 'إجمالي العروض', 'total offers', 'totaloffers'], 'totalOffers'],
    [['متوسط حجم التدول', 'متوسط حجم التداول', 'avg volume', 'avgvolume'], 'avgVolume'],
    [['الأعلى خلال 52 أسبوع', 'الاعلى خلال 52 اسبوع', '52w high', 'high52w'], 'high52W'],
    [['الأدنى خلال 52 أسبوع', 'الادنى خلال 52 اسبوع', '52w low', 'low52w'], 'low52W'],
    [['إقفال سابق', 'اقفال سابق', 'prev close', 'prevclose'], 'prevClose'],
    [['رأس مال السوق بالألأف', 'رأس مال السوق بالآلاف', 'راس مال السوق بالالاف', 'راس مال السوق بالألاف', 'market cap thousands', 'marketcapthousands'], 'marketCapThousands'],
    [['متوسط السعر المرجح', 'vwap'], 'vwap'],
    [['مضاعف ربحية السهم', 'مكرر الربحية', 'p/e', 'pe', 'pe ratio', 'peratio'], 'peRatio'],
    [['مضاعف القيمة الدفترية', 'مكرر القيمة الدفترية', 'p/b', 'pb', 'p/bv', 'pb ratio', 'pbratio'], 'pbRatio'],
    [['الأسهم المدرجة', 'الاسهم المدرجة', 'listed shares', 'listedshares'], 'listedShares'],
    [['الكود الدولي', 'isin', 'isin code', 'isincode'], 'isinCode'],
    [['أوامر السيولة الداخلة', 'اوامر السيولة الداخلة', 'inflow orders', 'infloworders'], 'inflowOrders'],
    [['حجم السيولة الداخلة', 'inflow volume', 'inflowvolume'], 'inflowVolume'],
    [['السيولة الداخلة', 'inflow liquidity', 'inflowliquidity'], 'inflowLiquidity'],
    [['صفقات العرض', 'ask trades', 'asktrades'], 'askTrades'],
    [['حجم صفقات العرض', 'ask trades volume', 'asktradesvolume'], 'askTradesVolume'],
    [['السيولة الخارجة', 'outflow liquidity', 'outflowliquidity'], 'outflowLiquidity'],
    [['الاسم', 'الاسم الكامل', 'full name', 'fullname', 'name'], 'fullName'],
    [['السوق', 'market'], 'market'],
    [['% التغير في حجم التداول لـ 5 أيام', '% التغير في حجم التداول ل 5 ايام', 'vol change 5d %', 'volchange5dpct'], 'volChange5DPct'],
    [['تغير الحجم 30 يوم %', 'vol change 30d %', 'volchange30dpct'], 'volChange30DPct'],
    [['تغير الحجم 90 يوم %', 'vol change 90d %', 'volchange90dpct'], 'volChange90DPct'],
  ];
  const map: Record<string, keyof DailyTradingRecord> = {};
  for (const [aliases, field] of entries) {
    for (const alias of aliases) {
      map[normalizeDailyHeaderText(alias)] = field;
    }
  }
  return map;
})();

const VALID_SHEETJS_TYPES = new Set<DailyCellType>(['s', 'n', 'b', 'd', 'e', 'z']);

function isCellPopulated(cell: any): boolean {
  if (!cell) return false;
  if (typeof cell.f === 'string' && cell.f.trim().length > 0) return true;
  if (cell.v !== undefined && cell.v !== null) {
    if (typeof cell.v === 'string') return cell.v.trim() !== '';
    return true;
  }
  if (typeof cell.w === 'string' && cell.w.trim() !== '') return true;
  return false;
}

function getHeaderCellText(cell: any): string | null {
  if (!cell) return null;
  if (typeof cell.w === 'string' && cell.w.trim() !== '') return cell.w.trim();
  if (cell.v !== undefined && cell.v !== null) {
    const str = String(cell.v).trim();
    return str === '' ? null : str;
  }
  return null;
}

function serializeRawCellObject(cell: any): {
  rawCell: DailyRawCellValue;
  formulaMissingCachedResult: boolean;
} | null {
  if (!isCellPopulated(cell)) return null;
  const rawType = typeof cell.t === 'string' && VALID_SHEETJS_TYPES.has(cell.t as DailyCellType)
    ? (cell.t as DailyCellType)
    : typeof cell.v === 'number'
    ? 'n'
    : typeof cell.v === 'boolean'
    ? 'b'
    : cell.v instanceof Date
    ? 'd'
    : 's';

  const hasFormula = typeof cell.f === 'string' && cell.f.trim().length > 0;
  const missingCached =
    hasFormula &&
    (cell.v === undefined ||
      cell.v === null ||
      (typeof cell.v === 'string' && cell.v.trim() === ''));

  let v: string | number | boolean | null = null;
  if (!missingCached && cell.v !== undefined && cell.v !== null) {
    if (cell.v instanceof Date) {
      v = Number.isFinite(cell.v.getTime()) ? cell.v.toISOString() : null;
    } else if (typeof cell.v === 'number') {
      v = Number.isFinite(cell.v) ? (Object.is(cell.v, -0) ? 0 : cell.v) : null;
    } else if (typeof cell.v === 'boolean') {
      v = cell.v;
    } else {
      v = String(cell.v);
    }
  }

  const rawCell: DailyRawCellValue = {
    v,
    t: rawType,
    ...(typeof cell.w === 'string' ? { w: cell.w } : {}),
    ...(hasFormula ? { f: String(cell.f) } : {}),
    ...(missingCached ? { formulaMissingCachedResult: true } : {}),
  };

  return { rawCell, formulaMissingCachedResult: missingCached };
}

function extractTextFromCell(cell: any): string | null {
  if (!cell) return null;
  if (cell.t === 'n' && typeof cell.w === 'string' && cell.w.trim() !== '') {
    return parseCleanText(cell.w);
  }
  if (cell.t === 's' && cell.v !== undefined && cell.v !== null) {
    return parseCleanText(cell.v);
  }
  return parseCleanText(cell.v ?? cell.w);
}

function extractNumberFromCell(cell: any, contextLabel: string): number | null {
  if (!cell) return null;
  const hasFormula = typeof cell.f === 'string' && cell.f.trim().length > 0;
  if (
    hasFormula &&
    (cell.v === undefined ||
      cell.v === null ||
      (typeof cell.v === 'string' && cell.v.trim() === ''))
  ) {
    return null;
  }
  if (cell.t === 'b') {
    throw new Error(`قيمة منطقية غير متوقعة في حقل رقمي (${contextLabel}).`);
  }
  if (cell.t === 'e') {
    const errText = parseCleanText(cell.w ?? cell.v);
    if (!errText) return null;
    throw new Error(`خطأ صيغة Excel (${errText}) في (${contextLabel}).`);
  }
  if (typeof cell.v === 'number') {
    return parseCleanNumber(cell.v, contextLabel);
  }
  return parseCleanNumber(cell.v ?? cell.w, contextLabel);
}

/**
 * 1) التداول اليومي (DailyTrading: YYYY-M-D.xlsx)
 * قراءة ديناميكية على مستوى الخلايا (Cell-Level) لجميع الأعمدة دون سقف 40 عموداً.
 */
export async function parseDailyTradingExcelDetailed(
  file: File
): Promise<ParsedSourceResult<DailyTradingRecord & { sourceRow?: number }>> {
  const extractedDate = extractDateFromDailyFileName(file.name);
  if (!extractedDate) {
    throw new Error('اسم الملف يجب أن يحتوي تاريخ تداول صالحاً مثل 2026-11-08.xlsx.');
  }

  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    return {
      sheetName: firstSheetName || 'Sheet1',
      totalRows: 0,
      tradeDate: extractedDate,
      dailySchema: null,
      records: [],
      rejected: [],
      warnings: [],
    };
  }

  const refRange = sheet['!ref']
    ? XLSX.utils.decode_range(sheet['!ref'])
    : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  let maxRow = refRange.e.r;
  let lastPopulatedCol = -1;

  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const pos = XLSX.utils.decode_cell(key);
    if (pos.r > maxRow) maxRow = pos.r;
    if (pos.c > lastPopulatedCol && isCellPopulated((sheet as Record<string, any>)[key])) {
      lastPopulatedCol = pos.c;
    }
  }

  if (lastPopulatedCol < 0 || maxRow < 1) {
    return {
      sheetName: firstSheetName,
      totalRows: 0,
      tradeDate: extractedDate,
      dailySchema: null,
      records: [],
      rejected: [],
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const seenNormalizedHeaders = new Set<string>();
  const usedMappedFields = new Set<keyof DailyTradingRecord>();
  const duplicateHeaderNames = new Set<string>();
  const blankHeaderIndices: number[] = [];

  const columns: DailyTradingColumnSchema[] = [];
  const mappedFieldColIndex = new Map<keyof DailyTradingRecord, number>();

  for (let c = 0; c <= lastPopulatedCol; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const headerCell = (sheet as Record<string, any>)[addr];
    const headerName = getHeaderCellText(headerCell);
    const normalizedHeader = headerName ? normalizeDailyHeaderText(headerName) : null;
    const colLetter = XLSX.utils.encode_col(c);

    let isDuplicateHeader = false;
    if (normalizedHeader) {
      if (seenNormalizedHeaders.has(normalizedHeader)) {
        isDuplicateHeader = true;
        duplicateHeaderNames.add(headerName!);
      } else {
        seenNormalizedHeaders.add(normalizedHeader);
      }
    } else {
      blankHeaderIndices.push(c + 1);
    }

    const candidateField = normalizedHeader ? DAILY_HEADER_FIELD_ALIASES[normalizedHeader] ?? null : null;
    let mappedField: string | null = null;
    if (candidateField && !usedMappedFields.has(candidateField)) {
      usedMappedFields.add(candidateField);
      mappedField = candidateField;
      mappedFieldColIndex.set(candidateField, c);
    }

    columns.push({
      colId: `col_${c}`,
      index: c,
      colLetter,
      headerName,
      normalizedHeader,
      mappedField,
      ...(isDuplicateHeader ? { isDuplicateHeader: true } : {}),
    });
  }

  if (duplicateHeaderNames.size > 0) {
    warnings.push(
      `تحتوي الورقة عناوين أعمدة مكررة (${[...duplicateHeaderNames].join('، ')})؛ تم حفظ كل عمود بمعرّفه الموضعي المستقل دون طمس أي بيانات.`
    );
  }
  if (blankHeaderIndices.length > 0) {
    warnings.push(
      `تم اكتشاف ${blankHeaderIndices.length} عموداً بعناوين فارغة أو ممتدة بعد آخر عنوان (الأعمدة: ${blankHeaderIndices.slice(0, 8).join('، ')}${blankHeaderIndices.length > 8 ? '…' : ''}) وتم استيراد خلاياها بالكامل.`
    );
  }

  const now = new Date().toISOString();
  const schemaHash = computeCanonicalHash(
    columns.map((c) => ({ colId: c.colId, headerName: c.headerName, mappedField: c.mappedField }))
  )
    .replace(/^mzh1_/, '')
    .slice(0, 12);
  const schemaId = `ds_${extractedDate}_${schemaHash}`;
  const dailySchema: DailyTradingSchemaRecord = {
    schemaId,
    tradeDate: extractedDate,
    sourceFile: file.name,
    sourceSheet: firstSheetName,
    totalColumns: columns.length,
    columns,
    updatedAt: now,
  };

  const records: (DailyTradingRecord & { sourceRow?: number })[] = [];
  const rejected: ImportRejectedRow[] = [];
  const seenKeys = new Set<string>();
  let totalRows = 0;

  const getMappedCell = (r: number, field: keyof DailyTradingRecord) => {
    const colIdx = mappedFieldColIndex.get(field);
    if (colIdx === undefined) return undefined;
    const addr = XLSX.utils.encode_cell({ r, c: colIdx });
    return (sheet as Record<string, any>)[addr];
  };

  for (let r = 1; r <= maxRow; r++) {
    let rowHasContent = false;
    for (let c = 0; c <= lastPopulatedCol; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (isCellPopulated((sheet as Record<string, any>)[addr])) {
        rowHasContent = true;
        break;
      }
    }
    if (!rowHasContent) continue;

    totalRows += 1;
    const rowNumber = r + 1;

    const tickerRaw = extractTextFromCell(getMappedCell(r, 'ticker'));
    if (!tickerRaw) {
      rejected.push({ rowNumber, column: 'الرمز', reasonAr: 'رمز السهم فارغ.' });
      continue;
    }

    let ticker: string;
    try {
      ticker = normalizedTicker(tickerRaw);
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'الرمز',
        ticker: tickerRaw,
        reasonAr: err instanceof Error ? err.message : 'رمز السهم غير صالح.',
      });
      continue;
    }

    const dedupKey = `${ticker}_${extractedDate}`;
    if (seenKeys.has(dedupKey)) {
      rejected.push({
        rowNumber,
        column: 'الرمز',
        ticker,
        reasonAr: `تعارض أو تكرار لرمز السهم ${ticker} لنفس يوم التداول (${extractedDate}).`,
      });
      continue;
    }

    const rawCells: Record<string, DailyRawCellValue> = {};
    let rawRowHeadersMissingCount = 0;
    let formulaMissingCachedCount = 0;

    for (let c = 0; c <= lastPopulatedCol; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = (sheet as Record<string, any>)[addr];
      const serialized = serializeRawCellObject(cell);
      if (!serialized) continue;
      const col = columns[c];
      rawCells[col.colId] = serialized.rawCell;
      if (col.headerName === null) {
        rawRowHeadersMissingCount += 1;
      }
      if (serialized.formulaMissingCachedResult) {
        formulaMissingCachedCount += 1;
        warnings.push(
          `صف ${rowNumber} (${ticker}) · عمود ${col.colLetter} (${col.headerName || 'بدون عنوان'}): صيغة (${serialized.rawCell.f}) دون قيمة مخبأة؛ تم حفظ الصيغة مع اعتبار القيمة غير متاحة.`
        );
      }
    }

    let failedCol = 'البيانات الرقمية';
    try {
      const numField = (field: keyof DailyTradingRecord, label: string) => {
        failedCol = label;
        return extractNumberFromCell(getMappedCell(r, field), `صف ${rowNumber} - ${label}`);
      };

      const record: DailyTradingRecord & { sourceRow?: number } = {
        ticker,
        shortName: extractTextFromCell(getMappedCell(r, 'shortName')),
        tradeDate: extractedDate,
        lastPrice: numField('lastPrice', 'أخر'),
        changePct: numField('changePct', 'التغير%'),
        tradesCount: numField('tradesCount', 'الصفقات'),
        openPrice: numField('openPrice', 'فتح'),
        closePrice: numField('closePrice', 'إقفال اليوم'),
        turnoverValue: numField('turnoverValue', 'قيمة التداول'),
        netLiquidity: numField('netLiquidity', 'صافي السيولة'),
        volume: numField('volume', 'حجم التداول'),
        avgVolume5D: numField('avgVolume5D', 'متوسط الحجم 5 أيام'),
        avgVolume30D: numField('avgVolume30D', 'متوسط حجم التداول خلال 30 يوم'),
        avgVolume90D: numField('avgVolume90D', 'متوسط حجم التداول خلال 90 يوم'),
        lowPrice: numField('lowPrice', 'الأدنى'),
        highPrice: numField('highPrice', 'أعلى'),
        sector: extractTextFromCell(getMappedCell(r, 'sector')),
        totalBids: numField('totalBids', 'اجمالي الطلبات'),
        bidsCount: numField('bidsCount', 'عدد الطلبات'),
        offersCount: numField('offersCount', 'عدد العروض'),
        totalOffers: numField('totalOffers', 'اجمالي العروض'),
        avgVolume: numField('avgVolume', 'متوسط حجم التدول'),
        high52W: numField('high52W', 'الأعلى خلال 52 أسبوع'),
        low52W: numField('low52W', 'الأدنى خلال 52 أسبوع'),
        prevClose: numField('prevClose', 'إقفال سابق'),
        marketCapThousands: numField('marketCapThousands', 'رأس مال السوق بالألأف'),
        vwap: numField('vwap', 'متوسط السعر المرجح'),
        peRatio: numField('peRatio', 'مضاعف ربحية السهم'),
        pbRatio: numField('pbRatio', 'مضاعف القيمة الدفترية'),
        listedShares: numField('listedShares', 'الأسهم المدرجة'),
        isinCode: extractTextFromCell(getMappedCell(r, 'isinCode')),
        inflowOrders: numField('inflowOrders', 'أوامر السيولة الداخلة'),
        inflowVolume: numField('inflowVolume', 'حجم السيولة الداخلة'),
        inflowLiquidity: numField('inflowLiquidity', 'السيولة الداخلة'),
        askTrades: numField('askTrades', 'صفقات العرض'),
        askTradesVolume: numField('askTradesVolume', 'حجم صفقات العرض'),
        outflowLiquidity: numField('outflowLiquidity', 'السيولة الخارجة'),
        fullName: extractTextFromCell(getMappedCell(r, 'fullName')),
        market: extractTextFromCell(getMappedCell(r, 'market')),
        volChange5DPct: numField('volChange5DPct', '% التغير في حجم التداول لـ 5 أيام'),
        volChange30DPct: numField('volChange30DPct', 'تغير الحجم 30 يوم %'),
        volChange90DPct: numField('volChange90DPct', 'تغير الحجم 90 يوم %'),
        schemaId,
        rawCells,
        rawRowHeadersMissingCount,
        formulaMissingCachedCount,
        updatedAt: now,
        sourceRow: rowNumber,
      };

      const docBytes = estimateJsonUtf8Bytes(record);
      if (docBytes > FIRESTORE_MAX_DOCUMENT_BYTES) {
        rejected.push({
          rowNumber,
          column: 'حجم المستند',
          ticker,
          reasonAr: `حجم الصف (${docBytes.toLocaleString('en-US')} بايت) يتجاوز حد مستند Firestore (${FIRESTORE_MAX_DOCUMENT_BYTES.toLocaleString('en-US')} بايت) ولن تُقتطع الأعمدة.`,
        });
        continue;
      }

      seenKeys.add(dedupKey);
      records.push(record);
    } catch (err) {
      rejected.push({
        rowNumber,
        column: failedCol,
        ticker,
        reasonAr: err instanceof Error ? err.message : 'قيمة غير صالحة.',
      });
    }
  }

  return {
    sheetName: firstSheetName,
    totalRows,
    tradeDate: extractedDate,
    dailySchema,
    records,
    rejected,
    warnings,
  };
}

function buildHeaderLookup(
  headerRow: unknown[]
): (row: unknown[], ...candidates: string[]) => unknown {
  const indexMap = new Map<string, number>();
  headerRow.forEach((h, idx) => {
    const clean = String(h || '').trim();
    if (!clean) return;
    if (!indexMap.has(clean)) indexMap.set(clean, idx);
    const lower = clean.toLowerCase();
    if (!indexMap.has(lower)) indexMap.set(lower, idx);
  });

  return (row: unknown[], ...candidates: string[]): unknown => {
    if (!row) return undefined;
    for (const c of candidates) {
      const clean = c.trim();
      const idx = indexMap.get(clean) ?? indexMap.get(clean.toLowerCase());
      if (idx !== undefined) {
        return row[idx];
      }
    }
    return undefined;
  };
}

function isCompletelyEmptyRow(row: unknown[] | undefined | null): boolean {
  if (!row || row.length === 0) return true;
  return row.every((v) => v === undefined || v === null || String(v).trim() === '');
}

/**
 * 2) القوائم المالية الربع سنوية (QuarterlyFinancialsData.xlsx)
 */
export async function parseQuarterlyFinancialsExcelDetailed(
  file: File
): Promise<ParsedSourceResult<QuarterlyFinancialRecord & { sourceRow?: number }>> {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const targetSheetName =
    workbook.SheetNames.find((s) => s.trim().toLowerCase() === 'quarterlyfinancials') ||
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[targetSheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (rows.length < 2) {
    return { sheetName: targetSheetName, totalRows: 0, records: [], rejected: [], warnings: [] };
  }

  const headerRow = rows[0].map((h) => String(h || '').trim());
  const getCol = buildHeaderLookup(headerRow);

  const standardKnownColumnsLower = new Set([
    'da_ytd', 'deltaoperatingnwc_ytd', 'valuationtaxrate', 'valuationsource', 'financialunit',
    'financialcurrency', 'netincomecommon_ytd', 'netincomecommon_basis', 'netincomecommon_note',
    'weightedavgshares_ytd', 'weightedavgshares_basis', 'periodstartdate', 'periodenddate', 'perioddays',
    'equitycommon', 'commonequity', 'equitycommon_basis', 'commonequity_basis', 'equitycommon_note', 'commonequity_note',
    'reportedeps', 'reportedeps_source', 'reportedeps_period',
    'reportedeps_periodtype', 'reportedeps_fiscalyear', 'reportedeps_fiscalquarter',
    'reportedeps_periodstart', 'reportedeps_periodend',
    'iscapitalactionadjusted',
    'الرمز', 'ticker', 'stockname', 'اسم السهم', 'yearquarter', 'الفترة', 'shares', 'intangibleassets', 'totalassets',
    'equity', 'totaldebtwithouttx', 'totalliabilities', 'revenueytd', 'grossprofitytd',
    'ebit_ytd', 'pbt_ytd', 'netincomeytd', 'ocf_ytd', 'netinvestingcf_ytd',
    'dividendspaidytd', 'cash', 'dps_current', 'dpscurrent', 'interestexpense_ytd', 'financecosts_ytd',
    'interestincome_ytd', 'taxexpense_ytd', 'interestpaid_ytd', 'capex_ytd', 'dateinsertdata',
  ]);

  const hasLegacyDpsHeader = headerRow.some((h) => {
    const low = h.toLowerCase();
    return low === 'dps_current' || low === 'dpscurrent';
  });

  const records: (QuarterlyFinancialRecord & { sourceRow?: number })[] = [];
  const rejected: ImportRejectedRow[] = [];
  const warnings: string[] = [];
  if (hasLegacyDpsHeader) {
    warnings.push(
      'تم رصد عمود DPS_Current القديم في ملف القوائم الربع سنوية وتم تجاهله بالكامل (ولم يُحفظ في الحقول الممتدة)؛ التوزيعات النقدية تُستورد حصرياً عبر مصدر DPS_Actual.'
    );
  }
  const seenKeys = new Set<string>();
  const now = new Date().toISOString();
  let totalRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (isCompletelyEmptyRow(r)) continue;
    totalRows += 1;
    const rowNumber = i + 1;

    const tickerRaw = parseCleanText(getCol(r, 'الرمز', 'Ticker'));
    const yearQuarterRaw = parseCleanText(getCol(r, 'YearQuarter', 'الفترة'));
    if (!tickerRaw) {
      rejected.push({ rowNumber, column: 'الرمز', reasonAr: 'رمز السهم فارغ.' });
      continue;
    }

    let ticker: string;
    try {
      ticker = normalizedTicker(tickerRaw);
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'الرمز',
        ticker: tickerRaw,
        reasonAr: err instanceof Error ? err.message : 'رمز السهم غير صالح.',
      });
      continue;
    }

    if (!yearQuarterRaw) {
      rejected.push({ rowNumber, column: 'YearQuarter', ticker, reasonAr: 'الفترة YearQuarter مفقودة.' });
      continue;
    }

    const yqMatch = yearQuarterRaw.match(/^(\d{4})[-_/\s]*(Q[1-4]|FY)$/i);
    if (!yqMatch) {
      rejected.push({
        rowNumber,
        column: 'YearQuarter',
        ticker,
        reasonAr: `صيغة الفترة غير صالحة (${yearQuarterRaw})؛ المتوقع مثل 2025Q1 أو 2025FY.`,
      });
      continue;
    }

    const year = parseInt(yqMatch[1], 10);
    const qToken = yqMatch[2].toUpperCase();
    const quarter: 'Q1' | 'Q2' | 'Q3' | 'FY' =
      qToken === 'Q1' || qToken === 'Q2' || qToken === 'Q3' ? qToken : 'FY';

    const dedupKey = `${ticker}_${year}_${quarter}`;
    if (seenKeys.has(dedupKey)) {
      rejected.push({
        rowNumber,
        column: 'YearQuarter',
        ticker,
        reasonAr: `تعارض أو تكرار داخل الملف للسهم ${ticker} في الفترة ${year}${quarter}.`,
      });
      continue;
    }

    let currentCol = 'Shares';
    try {
      const numCol = (colName: string) => {
        currentCol = colName;
        return parseCleanNumber(getCol(r, colName), `صف ${rowNumber} - ${colName}`);
      };

      const shares = numCol('Shares');
      if (shares === null || shares <= 0) {
        rejected.push({
          rowNumber,
          column: 'Shares',
          ticker,
          reasonAr: 'عدد الأسهم (Shares) مطلوب ويجب أن يكون أكبر من صفر.',
        });
        continue;
      }

      currentCol = 'ValuationTaxRate';
      const rawTaxCell = getCol(r, 'ValuationTaxRate');
      const taxParsed = parseStrictPercentage(rawTaxCell, {
        contextLabel: `صف ${rowNumber} - ValuationTaxRate`,
        rejectAmbiguousNumeric: true,
        min: 0,
        max: 1,
      });

      currentCol = 'DA_YTD';
      const daYtd = numCol('DA_YTD');
      if (daYtd !== null && daYtd < 0) {
        rejected.push({
          rowNumber,
          column: 'DA_YTD',
          ticker,
          reasonAr: 'قيمة DA_YTD يجب أن تكون موجبة أو صفر.',
        });
        continue;
      }

      currentCol = 'FinancialUnit';
      const unitRaw = parseCleanText(getCol(r, 'FinancialUnit'));

      currentCol = 'FinancialCurrency';
      const currencyRaw = parseCleanText(getCol(r, 'FinancialCurrency'));
      const parsedCurrency = normalizeStrictCurrency(currencyRaw);
      if (parsedCurrency.status === 'unsupported') {
        rejected.push({
          rowNumber,
          column: 'FinancialCurrency',
          ticker,
          reasonAr: `عملة القوائم غير مدعومة (${currencyRaw})؛ العملات المدعومة هي EGP أو USD فقط.`,
        });
        continue;
      }
      const unitUpper = unitRaw ? unitRaw.toUpperCase() : '';
      const derivedCurrencyFromUnit: 'EGP' | 'USD' | null =
        unitUpper.startsWith('USD') ? 'USD' : unitUpper.startsWith('EGP') ? 'EGP' : null;
      if (
        parsedCurrency.status === 'valid' &&
        parsedCurrency.code &&
        derivedCurrencyFromUnit &&
        parsedCurrency.code !== derivedCurrencyFromUnit
      ) {
        rejected.push({
          rowNumber,
          column: 'FinancialCurrency',
          ticker,
          reasonAr: `تعارض بين FinancialCurrency (${parsedCurrency.code}) وFinancialUnit (${unitRaw}).`,
        });
        continue;
      }
      const financialCurrency =
        parsedCurrency.status === 'valid' && parsedCurrency.code
          ? parsedCurrency.code
          : derivedCurrencyFromUnit;

      currentCol = 'WeightedAvgShares_YTD';
      const weightedAvgSharesYTD = numCol('WeightedAvgShares_YTD');
      if (weightedAvgSharesYTD !== null && weightedAvgSharesYTD <= 0) {
        rejected.push({
          rowNumber,
          column: 'WeightedAvgShares_YTD',
          ticker,
          reasonAr: 'المتوسط المرجح للأسهم WeightedAvgShares_YTD يجب أن يكون أكبر من صفر.',
        });
        continue;
      }

      currentCol = 'WeightedAvgShares_Basis';
      const rawWasBasis = parseCleanText(getCol(r, 'WeightedAvgShares_Basis'));
      let weightedAvgSharesBasis: WeightedAvgSharesBasis | null = null;
      if (rawWasBasis) {
        try {
          weightedAvgSharesBasis = validateAndNormalizeWeightedAvgSharesBasis(rawWasBasis);
        } catch (basisErr) {
          rejected.push({
            rowNumber,
            column: 'WeightedAvgShares_Basis',
            ticker,
            reasonAr:
              basisErr instanceof Error
                ? basisErr.message
                : `قيمة WeightedAvgShares_Basis غير صالحة (${rawWasBasis}).`,
          });
          continue;
        }
      }

      currentCol = 'PeriodStartDate';
      const rawPeriodStartCell = getCol(r, 'PeriodStartDate');
      const parsedStartIso = await parseExcelDateValue(rawPeriodStartCell, XLSX);
      const rawStartText = parseCleanText(rawPeriodStartCell);
      const periodStartDate = parsedStartIso || rawStartText || null;

      currentCol = 'PeriodEndDate';
      const rawPeriodEndCell = getCol(r, 'PeriodEndDate');
      const parsedEndIso = await parseExcelDateValue(rawPeriodEndCell, XLSX);
      const rawEndText = parseCleanText(rawPeriodEndCell);
      const periodEndDate = parsedEndIso || rawEndText || null;

      if ((periodStartDate && !periodEndDate) || (!periodStartDate && periodEndDate)) {
        rejected.push({
          rowNumber,
          column: periodStartDate ? 'PeriodEndDate' : 'PeriodStartDate',
          ticker,
          reasonAr: 'يلزم إدخال تاريخي بداية ونهاية الفترة المالية معاً (PeriodStartDate و PeriodEndDate).',
        });
        continue;
      }

      currentCol = 'PeriodDays';
      const rawPeriodDays = numCol('PeriodDays');
      let periodDays: number | null = rawPeriodDays;

      if (periodStartDate && periodEndDate) {
        if (!isValidCalendarDate(periodStartDate) || !isValidCalendarDate(periodEndDate)) {
          rejected.push({
            rowNumber,
            column: !isValidCalendarDate(periodStartDate) ? 'PeriodStartDate' : 'PeriodEndDate',
            ticker,
            reasonAr: 'صيغة تاريخ بداية أو نهاية الفترة غير صالحة (المطلوب YYYY-MM-DD).',
          });
          continue;
        }
        if (periodStartDate > periodEndDate) {
          rejected.push({
            rowNumber,
            column: 'PeriodStartDate',
            ticker,
            reasonAr: `تاريخ بداية الفترة (${periodStartDate}) يجب أن يسبق أو يساوي تاريخ نهايتها (${periodEndDate}).`,
          });
          continue;
        }
        const computedDays = computeCalendarSpanDays(periodStartDate, periodEndDate);
        if (computedDays < 1 || computedDays > 370) {
          rejected.push({
            rowNumber,
            column: 'PeriodEndDate',
            ticker,
            reasonAr: `طول الفترة المالية (${computedDays} يوماً) خارج النطاق المسموح (1..370 يوماً).`,
          });
          continue;
        }
        if (periodDays !== null) {
          if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 370) {
            rejected.push({
              rowNumber,
              column: 'PeriodDays',
              ticker,
              reasonAr: 'عدد أيام الفترة (PeriodDays) يجب أن يكون عدداً صحيحاً بين 1 و 370.',
            });
            continue;
          }
          if (periodDays !== computedDays) {
            rejected.push({
              rowNumber,
              column: 'PeriodDays',
              ticker,
              reasonAr: `تعارض في طول الفترة: PeriodDays (${periodDays}) لا يطابق الفرق التقويمي (${computedDays} يوماً).`,
            });
            continue;
          }
        } else {
          periodDays = computedDays;
        }
      } else if (periodDays !== null) {
        if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 370) {
          rejected.push({
            rowNumber,
            column: 'PeriodDays',
            ticker,
            reasonAr: 'عدد أيام الفترة (PeriodDays) يجب أن يكون عدداً صحيحاً بين 1 و 370.',
          });
          continue;
        }
      }

      currentCol = 'NetIncomeCommon_Basis';
      const rawCommonBasis = parseCleanText(getCol(r, 'NetIncomeCommon_Basis'));
      let netIncomeCommonBasis: NetIncomeCommonBasis | null = null;
      if (rawCommonBasis) {
        const lowBasis = rawCommonBasis.toLowerCase();
        if (lowBasis === 'explicit_common' || lowBasis === 'attested_net_income_equals_common') {
          netIncomeCommonBasis = lowBasis;
        } else {
          rejected.push({
            rowNumber,
            column: 'NetIncomeCommon_Basis',
            ticker,
            reasonAr: `قيمة NetIncomeCommon_Basis غير صالحة (${rawCommonBasis})؛ يُقبل explicit_common أو attested_net_income_equals_common فقط.`,
          });
          continue;
        }
      }

      currentCol = 'NetIncomeCommon_Note';
      const rawCommonNote = parseCleanText(getCol(r, 'NetIncomeCommon_Note'));
      const netIncomeCommonNote = rawCommonNote ? rawCommonNote.slice(0, 400) : null;

      currentCol = 'EquityCommon';
      const equityCommonVal = parseCleanNumber(
        getCol(r, 'EquityCommon', 'CommonEquity'),
        `صف ${rowNumber} - EquityCommon`
      );

      currentCol = 'EquityCommon_Basis';
      const rawCommonEqBasis = parseCleanText(getCol(r, 'EquityCommon_Basis', 'CommonEquity_Basis'));
      let equityCommonBasis: CommonEquityBasis | null = null;
      if (rawCommonEqBasis) {
        const lowEqBasis = rawCommonEqBasis.toLowerCase();
        if (lowEqBasis === 'explicit_common' || lowEqBasis === 'attested_total_equals_common') {
          equityCommonBasis = lowEqBasis;
        } else {
          rejected.push({
            rowNumber,
            column: 'EquityCommon_Basis',
            ticker,
            reasonAr: `قيمة EquityCommon_Basis غير صالحة (${rawCommonEqBasis})؛ يُقبل explicit_common أو attested_total_equals_common فقط.`,
          });
          continue;
        }
      }

      currentCol = 'EquityCommon_Note';
      const rawCommonEqNote = parseCleanText(getCol(r, 'EquityCommon_Note', 'CommonEquity_Note'));
      const equityCommonNote = rawCommonEqNote ? rawCommonEqNote.slice(0, 400) : null;

      currentCol = 'IsCapitalActionAdjusted';
      const isCapitalActionAdjusted = parseCleanBoolean(getCol(r, 'IsCapitalActionAdjusted'));

      currentCol = 'ReportedEPS';
      const reportedEpsVal = numCol('ReportedEPS');
      const reportedEpsSource = parseCleanText(getCol(r, 'ReportedEPS_Source'));

      currentCol = 'ReportedEPS_PeriodStart';
      const rawRepStartCell = getCol(r, 'ReportedEPS_PeriodStart');
      const parsedRepStartIso = await parseExcelDateValue(rawRepStartCell, XLSX);
      const reportedEpsPeriodStartRaw = parsedRepStartIso || parseCleanText(rawRepStartCell) || null;

      currentCol = 'ReportedEPS_PeriodEnd';
      const rawRepEndCell = getCol(r, 'ReportedEPS_PeriodEnd');
      const parsedRepEndIso = await parseExcelDateValue(rawRepEndCell, XLSX);
      const reportedEpsPeriodEndRaw = parsedRepEndIso || parseCleanText(rawRepEndCell) || null;

      currentCol = 'ReportedEPS_PeriodType';
      const rawRepPeriodType = getCol(r, 'ReportedEPS_PeriodType');
      const rawRepFiscalYear = getCol(r, 'ReportedEPS_FiscalYear');
      const rawRepFiscalQuarter = getCol(r, 'ReportedEPS_FiscalQuarter');
      const rawRepLegacyPeriod = parseCleanText(getCol(r, 'ReportedEPS_Period'));

      const resolvedRepImport = resolveImportedReportedEpsPeriod(
        {
          reportedEps: reportedEpsVal,
          reportedEpsPeriodType: rawRepPeriodType,
          reportedEpsFiscalYear: rawRepFiscalYear,
          reportedEpsFiscalQuarter: rawRepFiscalQuarter,
          reportedEpsPeriodStart: reportedEpsPeriodStartRaw,
          reportedEpsPeriodEnd: reportedEpsPeriodEndRaw,
          reportedEpsPeriod: rawRepLegacyPeriod,
        },
        {
          year,
          quarter,
          periodStartDate,
          periodEndDate,
        }
      );
      const normalizedRepPeriod = resolvedRepImport.normalized;
      if (resolvedRepImport.warningAr) {
        warnings.push(`صف ${rowNumber} (${ticker} ${year}${quarter}): ${resolvedRepImport.warningAr}`);
      }

      const extendedFields: Record<string, any> = {};
      headerRow.forEach((colHeader, cIdx) => {
        if (colHeader && !standardKnownColumnsLower.has(colHeader.toLowerCase()) && r[cIdx] !== undefined) {
          extendedFields[colHeader] = r[cIdx];
        }
      });

      const dateRaw = await parseExcelDateValue(getCol(r, 'DateInsertData'), XLSX);
      const dateInsertData = dateRaw || parseCleanText(getCol(r, 'DateInsertData')) || '';

      seenKeys.add(dedupKey);
      records.push({
        ticker,
        stockName: parseCleanText(getCol(r, 'StockName', 'اسم السهم')) || ticker,
        yearQuarter: `${year}${quarter}`,
        year,
        quarter,
        shares,
        depreciationAmortizationYTD: daYtd,
        changeOperatingNwcYTD: numCol('DeltaOperatingNWC_YTD'),
        valuationTaxRate: taxParsed.value,
        valuationSource: parseCleanText(getCol(r, 'ValuationSource')),
        financialUnit: unitRaw || null,
        financialCurrency,
        netIncomeCommonYTD: numCol('NetIncomeCommon_YTD'),
        netIncomeCommonBasis,
        netIncomeCommonNote,
        equityCommon: equityCommonVal,
        equityCommonBasis,
        equityCommonNote,
        weightedAvgSharesYTD,
        weightedAvgSharesBasis,
        periodStartDate,
        periodEndDate,
        periodDays,
        reportedEps: reportedEpsVal,
        reportedEpsSource,
        reportedEpsPeriodType: normalizedRepPeriod.reportedEpsPeriodType,
        reportedEpsFiscalYear: normalizedRepPeriod.reportedEpsFiscalYear,
        reportedEpsFiscalQuarter: normalizedRepPeriod.reportedEpsFiscalQuarter,
        reportedEpsPeriodStart: normalizedRepPeriod.reportedEpsPeriodStart,
        reportedEpsPeriodEnd: normalizedRepPeriod.reportedEpsPeriodEnd,
        reportedEpsPeriod: normalizedRepPeriod.reportedEpsPeriod,
        isCapitalActionAdjusted,
        intangibleAssets: numCol('IntangibleAssets'),
        totalAssets: numCol('TotalAssets'),
        equity: numCol('Equity'),
        totalDebtWithoutTX: numCol('TotalDebtWithoutTX'),
        totalLiabilities: numCol('TotalLiabilities'),
        revenueYTD: numCol('RevenueYTD'),
        grossProfitYTD: numCol('GrossProfitYTD'),
        ebitYTD: numCol('EBIT_YTD'),
        pbtYTD: numCol('PBT_YTD'),
        netIncomeYTD: numCol('NetIncomeYTD'),
        ocfYTD: numCol('OCF_YTD'),
        netInvestingCfYTD: numCol('NetInvestingCF_YTD'),
        dividendsPaidYTD: numCol('DividendsPaidYTD'),
        cash: numCol('Cash'),
        interestExpenseYTD: numCol('InterestExpense_YTD'),
        financeCostsYTD: numCol('FinanceCosts_YTD'),
        interestIncomeYTD: numCol('InterestIncome_YTD'),
        taxExpenseYTD: numCol('TaxExpense_YTD'),
        interestPaidYTD: numCol('InterestPaid_YTD'),
        capexYTD: numCol('CapEx_YTD'),
        dateInsertData,
        extendedFields: Object.keys(extendedFields).length > 0 ? extendedFields : undefined,
        updatedAt: now,
        sourceRow: rowNumber,
      });
    } catch (err) {
      rejected.push({
        rowNumber,
        column: currentCol,
        ticker,
        reasonAr: err instanceof Error ? err.message : 'قيمة غير صالحة.',
      });
    }
  }

  return { sheetName: targetSheetName, totalRows, records, rejected, warnings };
}

/**
 * 3) افتراضات بيتا (Beta_Assumptions.xlsx -> ورقة Beta_Assumptions)
 * الأعمدة: Ticker | Beta | AsOfDate | Source
 */
export async function parseBetaAssumptionsExcelFile(
  file: File
): Promise<ParsedSourceResult<BetaAssumptionRecord & { sourceRow: number }>> {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const targetSheetName =
    workbook.SheetNames.find((s) => s.trim().toLowerCase() === 'beta_assumptions') ||
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[targetSheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (rows.length < 2) {
    return { sheetName: targetSheetName, totalRows: 0, records: [], rejected: [], warnings: [] };
  }

  const getCol = buildHeaderLookup(rows[0]);
  const records: (BetaAssumptionRecord & { sourceRow: number })[] = [];
  const rejected: ImportRejectedRow[] = [];
  const seenTickers = new Set<string>();
  const now = new Date().toISOString();
  let totalRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (isCompletelyEmptyRow(r)) continue;
    totalRows += 1;
    const rowNumber = i + 1;

    const tickerRaw = parseCleanText(getCol(r, 'Ticker', 'الرمز'));
    if (!tickerRaw) {
      rejected.push({ rowNumber, column: 'Ticker', reasonAr: 'عمود Ticker مطلوب.' });
      continue;
    }

    let ticker: string;
    try {
      ticker = normalizedTicker(tickerRaw);
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'Ticker',
        ticker: tickerRaw,
        reasonAr: err instanceof Error ? err.message : 'رمز السهم غير صالح.',
      });
      continue;
    }

    if (seenTickers.has(ticker)) {
      rejected.push({
        rowNumber,
        column: 'Ticker',
        ticker,
        reasonAr: `تعارض أو تكرار لرمز السهم ${ticker} في ملف Beta_Assumptions.`,
      });
      continue;
    }

    let betaVal: number | null = null;
    try {
      betaVal = parseCleanNumber(getCol(r, 'Beta', 'بيتا'), `صف ${rowNumber} - Beta`);
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'Beta',
        ticker,
        reasonAr: err instanceof Error ? err.message : 'قيمة Beta غير صالحة.',
      });
      continue;
    }

    if (betaVal === null || !Number.isFinite(betaVal)) {
      rejected.push({
        rowNumber,
        column: 'Beta',
        ticker,
        reasonAr: 'قيمة Beta مطلوبة ويجب أن تكون رقماً منتهياً (يُقبل 0 والسالب).',
      });
      continue;
    }

    const asOfDate = await parseExcelDateValue(getCol(r, 'AsOfDate', 'As_Of_Date', 'التاريخ'), XLSX);
    if (!asOfDate) {
      rejected.push({
        rowNumber,
        column: 'AsOfDate',
        ticker,
        reasonAr: 'تاريخ السريان AsOfDate مطلوب بصيغة YYYY-MM-DD صالحة.',
      });
      continue;
    }

    const source = parseCleanText(getCol(r, 'Source', 'المصدر'));
    if (!source) {
      rejected.push({
        rowNumber,
        column: 'Source',
        ticker,
        reasonAr: 'حقل المصدر Source مطلوب لتوثيق مصدر بيتا.',
      });
      continue;
    }

    seenTickers.add(ticker);
    records.push({
      ticker,
      beta: Object.is(betaVal, -0) ? 0 : betaVal,
      asOfDate,
      source,
      updatedAt: now,
      sourceRow: rowNumber,
    });
  }

  return { sheetName: targetSheetName, totalRows, records, rejected, warnings: [] };
}

/**
 * 4) جميع المعاملات (All_Parameters.xlsx -> ورقة All_Parameters)
 * العقد الموحد للأعمدة من `parameterExcelContract.ts`:
 * Key | NameAr | Value | ValueType | IsPercentage | Description | Scope | Ticker | Unit | AsOfDate | Source | RfMethodology | Currency | ForecastHorizonYears
 */
export async function parseAllParametersExcelFile(
  file: File
): Promise<ParsedSourceResult<ParsedParameterImportRow>> {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const targetSheetName =
    workbook.SheetNames.find(
      (s) => s.trim().toLowerCase() === ALL_PARAMETERS_SHEET_NAME.toLowerCase()
    ) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[targetSheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (rows.length < 2) {
    return { sheetName: targetSheetName, totalRows: 0, records: [], rejected: [], warnings: [] };
  }

  const getCol = buildHeaderLookup(rows[0]);
  const records: ParsedParameterImportRow[] = [];
  const rejected: ImportRejectedRow[] = [];
  const warnings: string[] = [];
  const seenKeys = new Set<string>();
  const now = new Date().toISOString();
  let totalRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (isCompletelyEmptyRow(r)) continue;
    totalRows += 1;
    const rowNumber = i + 1;

    const key = parseCleanText(getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.Key));
    if (!key || !/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(key)) {
      rejected.push({
        rowNumber,
        column: 'Key',
        reasonAr: `اسم المعامل Key غير صالح (${key ?? 'فارغ'}).`,
      });
      continue;
    }

    const def = getParameterDefinition(key);

    const scopeRaw = (
      parseCleanText(getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.Scope)) || 'global'
    ).toLowerCase();
    if (scopeRaw !== 'global' && scopeRaw !== 'company') {
      rejected.push({
        rowNumber,
        column: 'Scope',
        reasonAr: `عمود Scope للمعامل ${key} يجب أن يكون global أو company.`,
      });
      continue;
    }
    const scope: 'global' | 'company' = scopeRaw;

    if (def && !def.allowedScopes.includes(scope)) {
      rejected.push({
        rowNumber,
        column: 'Scope',
        reasonAr: `المعامل ${key} مخصص للنطاق ${def.allowedScopes.join('/')} فقط ولا يقبل النطاق ${scope}.`,
      });
      continue;
    }

    const rawTickerCell = parseCleanText(getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.Ticker));
    let ticker: string | null = null;
    if (scope === 'company') {
      if (!rawTickerCell) {
        rejected.push({
          rowNumber,
          column: 'Ticker',
          reasonAr: `المعامل ${key} بنطاق company يتطلب تحديد رمز سهم صالح في عمود Ticker.`,
        });
        continue;
      }
      try {
        ticker = normalizedTicker(rawTickerCell);
      } catch (err) {
        rejected.push({
          rowNumber,
          column: 'Ticker',
          ticker: rawTickerCell,
          reasonAr: err instanceof Error ? err.message : 'رمز السهم غير صالح.',
        });
        continue;
      }
    } else if (rawTickerCell !== null) {
      rejected.push({
        rowNumber,
        column: 'Ticker',
        ticker: rawTickerCell,
        reasonAr: `المعامل العام ${key} (Scope=global) يجب أن يكون عمود Ticker فيه فارغاً.`,
      });
      continue;
    }

    // Read & strictly validate explicit ValueType / IsPercentage columns from Excel.
    const rawValueTypeCell = getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.ValueType);
    let parsedValueType: ParameterValueType | undefined;
    try {
      const cleanedTypeText = parseCleanText(rawValueTypeCell);
      parsedValueType = parseOptionalParameterValueType(cleanedTypeText, key);
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'ValueType',
        ticker: ticker ?? undefined,
        reasonAr: `الصف ${rowNumber} — المعامل (${key}): ${err instanceof Error ? err.message : 'قيمة ValueType غير صالحة.'}`,
      });
      continue;
    }

    const rawIsPctCell = getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.IsPercentage);
    let parsedIsPct: boolean | null = null;
    try {
      parsedIsPct = parseCleanBoolean(rawIsPctCell);
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'IsPercentage',
        ticker: ticker ?? undefined,
        reasonAr: `الصف ${rowNumber} — المعامل (${key}): عمود IsPercentage غير صالح (${String(rawIsPctCell)})؛ القيم المسموحة TRUE أو FALSE.`,
      });
      continue;
    }

    // Reject internal contradiction between ValueType and IsPercentage in the same row.
    if (
      parsedValueType !== undefined &&
      parsedIsPct !== null &&
      (parsedValueType === 'pct') !== parsedIsPct
    ) {
      rejected.push({
        rowNumber,
        column: 'ValueType / IsPercentage',
        ticker: ticker ?? undefined,
        reasonAr: `الصف ${rowNumber} — المعامل (${key}): تعارض بين ValueType=${parsedValueType} وIsPercentage=${String(parsedIsPct)}. صحّح العمودين ليتطابقا (مثلاً ValueType=pct مع IsPercentage=TRUE، أو ValueType=number مع IsPercentage=FALSE).`,
      });
      continue;
    }

    // Custom (uncataloged) parameters MUST provide explicit type metadata to prevent silent type erasure.
    if (!def && parsedValueType === undefined && parsedIsPct === null) {
      rejected.push({
        rowNumber,
        column: 'ValueType / IsPercentage',
        ticker: ticker ?? undefined,
        reasonAr: `الصف ${rowNumber} — المعامل المخصص (${key}): يفتقد تعريف النوع الصريح. الحقول المطلوبة: حدّد ValueType (pct | number | integer | multiple | mode) و/أو IsPercentage (TRUE | FALSE) لمنع محو النوع أو سوء تفسير القيمة (لا يُستنتج النوع من Unit=decimal أو مقدار الرقم).`,
      });
      continue;
    }

    const rawUnitCell = parseCleanText(getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.Unit));
    const resolvedType = resolveCanonicalParameterType(key, {
      valueType: parsedValueType ?? null,
      isPercentage: parsedIsPct,
      unit: rawUnitCell,
    });

    if (def) {
      const registryMismatch =
        (parsedValueType !== undefined && parsedValueType !== resolvedType.valueType) ||
        (parsedIsPct !== null && parsedIsPct !== resolvedType.isPercentage);
      if (registryMismatch) {
        warnings.push(
          `الصف ${rowNumber}: المعامل المعروف (${key}) يتبع السجل المركزي (${resolvedType.valueType} / isPercentage=${String(resolvedType.isPercentage)})؛ تم تجاهل تعريف النوع المخالف في الملف.`
        );
      }
      if (!def.enabledInEngine) {
        warnings.push(
          `الصف ${rowNumber}: المعامل (${key}) محفوظ للشفافية المرجعية فقط — غير مفعّل حسابياً.`
        );
      }
    } else {
      warnings.push(
        `الصف ${rowNumber}: المعامل المخصص (${key}) غير معرف في سجل المحرك القياسي وسيُحفظ بنوع (${resolvedType.valueType}) دون تفعيل تلقائي في المحرك (enabledInEngine=false).`
      );
    }

    const rawValueCell = getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.Value);
    if (
      rawValueCell === undefined ||
      rawValueCell === null ||
      String(rawValueCell).trim() === '' ||
      (typeof rawValueCell === 'string' && parseCleanText(rawValueCell) === null)
    ) {
      rejected.push({
        rowNumber,
        column: 'Value',
        ticker: ticker ?? undefined,
        reasonAr: `الصف ${rowNumber} — المعامل (${key}): قيمة المعامل مطلوبة (الفراغ لا يُحوّل إلى صفر).`,
      });
      continue;
    }

    let numericValue: number | null = null;
    try {
      if (resolvedType.isPercentDecimal) {
        const pctParsed = parseStrictPercentage(rawValueCell, {
          contextLabel: `صف ${rowNumber} - ${key}`,
          rejectAmbiguousNumeric: true,
          min: def?.min,
          max: def?.max,
        });
        numericValue = pctParsed.value;
      } else {
        if (typeof rawValueCell === 'string' && /[٪%]/.test(rawValueCell)) {
          throw new Error(
            `القيمة (${rawValueCell}) للمعامل (${key}) تحتوي على علامة % رغم أنه معرّف كمعامل غير نسبي (${resolvedType.valueType}). أزل علامة % أو عرّفه كنسبة مئوية (ValueType=pct وIsPercentage=TRUE).`
          );
        }
        numericValue = parseCleanNumber(rawValueCell, `صف ${rowNumber} - ${key}`);
        if (numericValue !== null) {
          if (resolvedType.valueType === 'integer' && !Number.isInteger(numericValue)) {
            throw new Error(`المعامل ${key} من النوع integer ويجب أن يكون عدداً صحيحاً.`);
          }
          if (def) {
            if (
              def.valueType === 'mode' &&
              (!Number.isInteger(numericValue) || (def.allowedValues && !def.allowedValues.includes(numericValue)))
            ) {
              throw new Error(`المعامل ${key} يقبل القيم: ${def.allowedValues?.join(', ')}.`);
            }
            if (def.min !== undefined && numericValue < def.min) {
              throw new Error(`المعامل ${key} يجب أن لا يقل عن ${def.min}.`);
            }
            if (def.max !== undefined && numericValue > def.max) {
              throw new Error(`المعامل ${key} يجب أن لا يتجاوز ${def.max}.`);
            }
          }
        }
      }
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'Value',
        ticker: ticker ?? undefined,
        reasonAr: err instanceof Error ? err.message : 'قيمة غير صالحة.',
      });
      continue;
    }

    if (numericValue === null || !Number.isFinite(numericValue)) {
      rejected.push({
        rowNumber,
        column: 'Value',
        ticker: ticker ?? undefined,
        reasonAr: `الصف ${rowNumber} — المعامل (${key}): القيمة غير رقمية أو فارغة (الفراغ لا يُحوّل إلى صفر).`,
      });
      continue;
    }

    const dedupKey = scope === 'global' ? `global:${key}` : `company:${ticker}:${key}`;
    if (seenKeys.has(dedupKey)) {
      rejected.push({
        rowNumber,
        column: 'Key',
        ticker: ticker ?? undefined,
        reasonAr: `تعارض أو تكرار للمعامل ${key} (${ticker ?? 'global'}) في نفس الملف.`,
      });
      continue;
    }

    const rawAsOfDate = getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.AsOfDate);
    const asOfDate = await parseExcelDateValue(rawAsOfDate, XLSX);
    if (parseCleanText(rawAsOfDate) && !asOfDate) {
      rejected.push({
        rowNumber,
        column: 'AsOfDate',
        ticker: ticker ?? undefined,
        reasonAr: `تاريخ AsOfDate للمعامل ${key} غير صالح (YYYY-MM-DD).`,
      });
      continue;
    }

    const rawNameAr = parseCleanText(getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.NameAr));
    const nameAr = def?.nameAr || rawNameAr?.slice(0, 160) || key;
    const description =
      parseCleanText(getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.Description)) ||
      def?.descriptionAr ||
      '';
    const unit = rawUnitCell || def?.unit || resolvedType.defaultUnit;
    const source =
      parseCleanText(getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.Source)) ||
      'استيراد All_Parameters.xlsx';

    const rawRfMethodology = getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.RfMethodology);
    let rfMethodology: RfMethodologyClassification | undefined = undefined;
    if (parseCleanText(rawRfMethodology) !== null) {
      try {
        rfMethodology = normalizeRfMethodology(rawRfMethodology, { strict: true });
      } catch (err) {
        rejected.push({
          rowNumber,
          column: 'RfMethodology',
          ticker: ticker ?? undefined,
          reasonAr: err instanceof Error ? err.message : 'قيمة RfMethodology غير صالحة.',
        });
        continue;
      }
    }

    const rawCurrency = parseCleanText(getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.Currency));
    let currency: 'EGP' | 'USD' | null = null;
    if (rawCurrency !== null) {
      const normalized = normalizeStrictCurrency(rawCurrency);
      if (normalized.status !== 'valid' || !normalized.code) {
        rejected.push({
          rowNumber,
          column: 'Currency',
          ticker: ticker ?? undefined,
          reasonAr: `عملة غير مدعومة في عمود Currency (${rawCurrency})؛ المدعوم EGP أو USD فقط.`,
        });
        continue;
      }
      currency = normalized.code;
    }

    const rawHorizon = getCol(r, ...ALL_PARAMETERS_EXCEL_HEADER_ALIASES.ForecastHorizonYears);
    let forecastHorizonYears: number | null = null;
    if (rawHorizon !== undefined && rawHorizon !== null && String(rawHorizon).trim() !== '') {
      try {
        const parsedH = parseCleanNumber(rawHorizon, `صف ${rowNumber} - ForecastHorizonYears`);
        if (parsedH === null || !Number.isInteger(parsedH) || parsedH < 1 || parsedH > 20) {
          throw new Error('عمود ForecastHorizonYears يجب أن يكون عدداً صحيحاً بين 1 و 20.');
        }
        forecastHorizonYears = parsedH;
      } catch (err) {
        rejected.push({
          rowNumber,
          column: 'ForecastHorizonYears',
          ticker: ticker ?? undefined,
          reasonAr: err instanceof Error ? err.message : 'قيمة ForecastHorizonYears غير صالحة.',
        });
        continue;
      }
    }

    if (key === 'Projected_Terminal_EBITDA') {
      const unitUpper = unit.toUpperCase();
      const derivedUnitCurrency: 'EGP' | 'USD' | null =
        unitUpper.startsWith('USD') ? 'USD' : unitUpper.startsWith('EGP') ? 'EGP' : null;
      if (currency && derivedUnitCurrency && currency !== derivedUnitCurrency) {
        rejected.push({
          rowNumber,
          column: 'Currency',
          ticker: ticker ?? undefined,
          reasonAr: `تعارض بين Currency (${currency}) وUnit (${unit}) في Projected_Terminal_EBITDA.`,
        });
        continue;
      }
      currency = currency ?? derivedUnitCurrency ?? null;
    }

    seenKeys.add(dedupKey);
    const cleanVal = Object.is(numericValue, -0) ? 0 : numericValue;
    const item: ParsedParameterImportRow = {
      key,
      nameAr,
      value: cleanVal,
      valueType: resolvedType.valueType,
      isPercentage: resolvedType.isPercentage,
      parameterTypeSource: resolvedType.typeSource,
      description,
      scope,
      ticker,
      unit,
      asOfDate: asOfDate || '',
      source,
      rfMethodology,
      currency,
      forecastHorizonYears,
      sourceRow: rowNumber,
      toMacroParameter: () => ({
        key,
        nameAr,
        descriptionAr: description,
        value: cleanVal,
        category: def?.category || 'macro_inflation',
        valueType: resolvedType.valueType,
        isPercentage: resolvedType.isPercentage,
        parameterTypeSource: resolvedType.typeSource,
        unit,
        currency,
        forecastHorizonYears,
        scope: 'global',
        ticker: null,
        asOfDate: asOfDate || '',
        source,
        rfMethodology,
        enabledInEngine: def ? def.enabledInEngine : false,
        modeNoteAr: def?.modeNoteAr,
        updatedAt: now,
      }),
      toCompanyOverride: () => ({
        key,
        nameAr,
        value: cleanVal,
        valueType: resolvedType.valueType,
        isPercentage: resolvedType.isPercentage,
        parameterTypeSource: resolvedType.typeSource,
        description,
        scope: 'company',
        ticker: ticker!,
        unit,
        currency,
        forecastHorizonYears,
        rfMethodology,
        asOfDate: asOfDate || '',
        source,
        updatedAt: now,
      }),
    };
    records.push(item);
  }

  return { sheetName: targetSheetName, totalRows, records, rejected, warnings };
}

/**
 * دوال التوافق المباشر للاستدعاءات السابقة (ترفع استثناءً عند وجود أي صف مرفوض).
 */
export async function parseDailyTradingExcelFile(
  file: File
): Promise<{ date: string; records: DailyTradingRecord[] }> {
  const res = await parseDailyTradingExcelDetailed(file);
  if (res.rejected.length > 0) {
    const first = res.rejected[0];
    throw new Error(`صف ${first.rowNumber} (${first.column}): ${first.reasonAr}`);
  }
  return { date: res.tradeDate || '', records: res.records };
}

export async function parseQuarterlyFinancialsExcelFile(
  file: File
): Promise<QuarterlyFinancialRecord[]> {
  const res = await parseQuarterlyFinancialsExcelDetailed(file);
  if (res.rejected.length > 0) {
    const first = res.rejected[0];
    throw new Error(`صف ${first.rowNumber} (${first.column}): ${first.reasonAr}`);
  }
  return res.records;
}

function normalizeDividendRecordType(raw: unknown): DividendRecordType | null {
  const text = parseCleanText(raw);
  if (!text) return 'regular';
  const low = text.toLowerCase();
  if (low === 'regular' || low === 'عادي' || low === 'منتظم' || low === 'نقدي عادي') {
    return 'regular';
  }
  if (low === 'special' || low === 'استثنائي' || low === 'خاص' || low === 'توزيع استثنائي') {
    return 'special';
  }
  return null;
}

function normalizeDividendApprovalStatus(
  raw: unknown
): { value: DividendApprovalStatus | null; wasBlank: boolean } {
  const text = parseCleanText(raw);
  if (!text) return { value: null, wasBlank: true };
  const low = text.toLowerCase();
  if (low === 'proposed' || low === 'مقترح') return { value: 'proposed', wasBlank: false };
  if (low === 'approved' || low === 'معتمد' || low === 'مقر' || low === 'مصدق') {
    return { value: 'approved', wasBlank: false };
  }
  if (low === 'paid' || low === 'مدفوع' || low === 'مصروف') return { value: 'paid', wasBlank: false };
  if (low === 'cancelled' || low === 'canceled' || low === 'ملغى' || low === 'ملغي') {
    return { value: 'cancelled', wasBlank: false };
  }
  return { value: null, wasBlank: false };
}

function normalizeDividendSemantics(
  raw: unknown
): { value: DividendDistributionSemantics | null; wasBlank: boolean } {
  const text = parseCleanText(raw);
  if (!text) return { value: null, wasBlank: true };
  const low = text.toLowerCase().replace(/\s+/g, '_');
  if (low === 'annual_total' || low === 'annual' || low === 'إجمالي_سنوي' || low === 'اجمالي_سنوي' || low === 'سنوي') {
    return { value: 'annual_total', wasBlank: false };
  }
  if (low === 'standalone_event' || low === 'standalone' || low === 'event' || low === 'حدث_منفرد' || low === 'منفرد') {
    return { value: 'standalone_event', wasBlank: false };
  }
  if (low === 'installment' || low === 'tranche' || low === 'قسط' || low === 'دفعة') {
    return { value: 'installment', wasBlank: false };
  }
  return { value: null, wasBlank: false };
}

/**
 * 5) التوزيعات النقدية الفعلية (DPS_Actual.xlsx -> ورقة DPS_Actual)
 */
export async function parseDpsActualExcelFile(
  file: File,
  options?: {
    defaultSemantics?: DividendDistributionSemantics;
    defaultApprovalStatus?: DividendApprovalStatus;
  }
): Promise<ParsedSourceResult<DividendRecord>> {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });

  const targetSheetName =
    workbook.SheetNames.find((s) => s.trim().toLowerCase() === 'dps_actual') ||
    workbook.SheetNames.find((s) => s.trim().toLowerCase().includes('dps')) ||
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[targetSheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (rows.length < 2) {
    return { sheetName: targetSheetName, totalRows: 0, records: [], rejected: [], warnings: [] };
  }

  const getCol = buildHeaderLookup(rows[0]);
  const records: DividendRecord[] = [];
  const rejected: ImportRejectedRow[] = [];
  const warnings: string[] = [];
  const seenDocIds = new Set<string>();
  const fallbackSemantics: DividendDistributionSemantics =
    options?.defaultSemantics ?? 'standalone_event';
  const fallbackApprovalStatus: DividendApprovalStatus =
    options?.defaultApprovalStatus ?? 'proposed';
  let rowsMissingSemantics = 0;
  let rowsMissingApprovalCount = 0;
  let totalRows = 0;
  const now = new Date().toISOString();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (isCompletelyEmptyRow(r)) continue;
    totalRows += 1;
    const rowNumber = i + 1;

    const tickerRaw = parseCleanText(
      getCol(r, 'Ticker', 'الرمز', 'كود السهم', 'Symbol')
    );
    if (!tickerRaw) {
      rejected.push({
        rowNumber,
        column: 'Ticker',
        reasonAr: 'رمز السهم (Ticker) مطلوب في ملف التوزيعات.',
      });
      continue;
    }

    let ticker: string;
    try {
      ticker = normalizedTicker(tickerRaw);
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'Ticker',
        ticker: tickerRaw,
        reasonAr: err instanceof Error ? err.message : 'رمز السهم غير صالح.',
      });
      continue;
    }

    let fiscalYear: number | null = null;
    try {
      fiscalYear = parseCleanNumber(
        getCol(r, 'FiscalYear', 'Fiscal_Year', 'السنة المالية', 'السنة', 'Year'),
        `صف ${rowNumber} - FiscalYear`
      );
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'FiscalYear',
        ticker,
        reasonAr: err instanceof Error ? err.message : 'السنة المالية غير صالحة.',
      });
      continue;
    }

    if (
      fiscalYear === null ||
      !Number.isInteger(fiscalYear) ||
      fiscalYear < 1900 ||
      fiscalYear > 2200
    ) {
      rejected.push({
        rowNumber,
        column: 'FiscalYear',
        ticker,
        reasonAr: 'السنة المالية (FiscalYear) مطلوبة كرقم صحيح بين 1900 و2200.',
      });
      continue;
    }

    const rawDpsCell = getCol(
      r,
      'CashDPS',
      'Cash_DPS',
      'DPS',
      'DPS_Actual',
      'التوزيع النقدي للسهم',
      'التوزيع الفعلي'
    );
    let cashDps: number | null = null;
    try {
      cashDps = parseCleanNumber(rawDpsCell, `صف ${rowNumber} - CashDPS`);
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'CashDPS',
        ticker,
        reasonAr: err instanceof Error ? err.message : 'قيمة CashDPS غير صالحة.',
      });
      continue;
    }

    if (cashDps === null || !Number.isFinite(cashDps) || cashDps < 0) {
      rejected.push({
        rowNumber,
        column: 'CashDPS',
        ticker,
        reasonAr:
          'قيمة CashDPS مطلوبة ويجب أن تكون >= 0 (يُقبل 0 للتوزيع الصفري المؤكد؛ الفراغ يُرفض).',
      });
      continue;
    }
    cashDps = Object.is(cashDps, -0) ? 0 : cashDps;

    const rawAsOf = getCol(r, 'AsOfDate', 'As_Of_Date', 'تاريخ السريان', 'التاريخ');
    const asOfDate = await parseExcelDateValue(rawAsOf, XLSX);
    if (!asOfDate) {
      rejected.push({
        rowNumber,
        column: 'AsOfDate',
        ticker,
        reasonAr: 'تاريخ السريان (AsOfDate) مطلوب بصيغة YYYY-MM-DD صالحة.',
      });
      continue;
    }

    const recordType = normalizeDividendRecordType(
      getCol(r, 'RecordType', 'Record_Type', 'نوع التوزيع', 'النوع')
    );
    if (!recordType) {
      rejected.push({
        rowNumber,
        column: 'RecordType',
        ticker,
        reasonAr: 'عمود RecordType يقبل regular (عادي) أو special (استثنائي) فقط.',
      });
      continue;
    }

    const parsedApproval = normalizeDividendApprovalStatus(
      getCol(r, 'ApprovalStatus', 'Approval_Status', 'حالة الاعتماد', 'الحالة')
    );
    let approvalStatus: DividendApprovalStatus;
    if (parsedApproval.value) {
      approvalStatus = parsedApproval.value;
    } else if (parsedApproval.wasBlank) {
      rowsMissingApprovalCount += 1;
      approvalStatus = fallbackApprovalStatus;
    } else {
      rejected.push({
        rowNumber,
        column: 'ApprovalStatus',
        ticker,
        reasonAr:
          'عمود ApprovalStatus يقبل proposed أو approved أو paid أو cancelled فقط.',
      });
      continue;
    }

    const parsedSem = normalizeDividendSemantics(
      getCol(r, 'Semantics', 'DistributionSemantics', 'دلالة التوزيع', 'طبيعة التوزيع')
    );
    let distributionSemantics: DividendDistributionSemantics;
    if (parsedSem.value) {
      distributionSemantics = parsedSem.value;
    } else if (parsedSem.wasBlank) {
      rowsMissingSemantics += 1;
      distributionSemantics = fallbackSemantics;
    } else {
      rejected.push({
        rowNumber,
        column: 'Semantics',
        ticker,
        reasonAr:
          'عمود Semantics يقبل annual_total أو standalone_event أو installment فقط.',
      });
      continue;
    }

    const parseOptionalDateCol = async (
      rawVal: unknown,
      colName: string
    ): Promise<{ ok: boolean; value: string | null }> => {
      const txt = parseCleanText(rawVal);
      if (!txt && typeof rawVal !== 'number' && !(rawVal instanceof Date)) {
        return { ok: true, value: null };
      }
      const parsed = await parseExcelDateValue(rawVal, XLSX);
      if (!parsed) {
        rejected.push({
          rowNumber,
          column: colName,
          ticker,
          reasonAr: `عمود ${colName} يحتوي تاريخاً غير صالح (المطلوب YYYY-MM-DD).`,
        });
        return { ok: false, value: null };
      }
      return { ok: true, value: parsed };
    };

    const exRes = await parseOptionalDateCol(
      getCol(r, 'ExDividendDate', 'Ex_Dividend_Date', 'تاريخ الحق', 'تاريخ نهاية الحق'),
      'ExDividendDate'
    );
    if (!exRes.ok) continue;

    const payRes = await parseOptionalDateCol(
      getCol(r, 'PaymentDate', 'Payment_Date', 'تاريخ الصرف'),
      'PaymentDate'
    );
    if (!payRes.ok) continue;

    const recDateRes = await parseOptionalDateCol(
      getCol(r, 'RecordDate', 'Record_Date', 'تاريخ التسجيل'),
      'RecordDate'
    );
    if (!recDateRes.ok) continue;

    const rawParentId = parseCleanText(
      getCol(r, 'ParentAnnouncementId', 'Parent_Announcement_Id', 'معرف التوزيع الأب')
    );
    if (rawParentId && (rawParentId.includes('/') || rawParentId.includes('..'))) {
      rejected.push({
        rowNumber,
        column: 'ParentAnnouncementId',
        ticker,
        reasonAr: 'معرّف التوزيع الأب لا يجب أن يحتوي على / أو ...',
      });
      continue;
    }

    const rawDistId = parseCleanText(
      getCol(r, 'DistributionId', 'Distribution_Id', 'رقم التوزيع', 'معرف التوزيع')
    );
    const distributionId = (
      rawDistId || `${asOfDate}_${distributionSemantics}${rawParentId ? `_${rawParentId}` : ''}`
    )
      .replace(/\s+/g, '_')
      .slice(0, 80);

    if (distributionId.includes('/') || distributionId.includes('..')) {
      rejected.push({
        rowNumber,
        column: 'DistributionId',
        ticker,
        reasonAr: 'معرّف التوزيع لا يجب أن يحتوي على / أو ...',
      });
      continue;
    }

    let totalDistributionAmount: number | null = null;
    try {
      const parsedAmt = parseCleanNumber(
        getCol(
          r,
          'TotalDistributionAmount',
          'Total_Distribution_Amount',
          'إجمالي التوزيع النقدي',
          'إجمالي التوزيع'
        ),
        `صف ${rowNumber} - TotalDistributionAmount`
      );
      if (parsedAmt !== null) {
        if (!Number.isFinite(parsedAmt) || parsedAmt < 0) {
          throw new Error('إجمالي التوزيع يجب أن يكون >= 0.');
        }
        totalDistributionAmount = Object.is(parsedAmt, -0) ? 0 : parsedAmt;
      }
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'TotalDistributionAmount',
        ticker,
        reasonAr: err instanceof Error ? err.message : 'قيمة TotalDistributionAmount غير صالحة.',
      });
      continue;
    }

    let eligibleSharesCount: number | null = null;
    try {
      const parsedShares = parseCleanNumber(
        getCol(
          r,
          'EligibleSharesCount',
          'Eligible_Shares_Count',
          'الأسهم المستحقة',
          'عدد الأسهم المستحقة'
        ),
        `صف ${rowNumber} - EligibleSharesCount`
      );
      if (parsedShares !== null) {
        if (!Number.isFinite(parsedShares) || parsedShares <= 0) {
          throw new Error('عدد الأسهم المستحقة يجب أن يكون موجباً.');
        }
        eligibleSharesCount = parsedShares;
      }
    } catch (err) {
      rejected.push({
        rowNumber,
        column: 'EligibleSharesCount',
        ticker,
        reasonAr: err instanceof Error ? err.message : 'قيمة EligibleSharesCount غير صالحة.',
      });
      continue;
    }

    const rawCurrency = parseCleanText(getCol(r, 'Currency', 'العملة'));
    let currency: 'EGP' | 'USD' | null = null;
    if (rawCurrency !== null) {
      const cur = normalizeStrictCurrency(rawCurrency);
      if (cur.status !== 'valid' || !cur.code) {
        rejected.push({
          rowNumber,
          column: 'Currency',
          ticker,
          reasonAr: `العملة (${rawCurrency}) غير مدعومة؛ يُسمح بـ EGP أو USD فقط.`,
        });
        continue;
      }
      currency = cur.code;
    }

    const source = parseCleanText(getCol(r, 'Source', 'المصدر'))?.slice(0, 240) ?? null;
    const notes = parseCleanText(getCol(r, 'Notes', 'ملاحظات'))?.slice(0, 500) ?? null;

    const docId = buildDividendDocId({
      ticker,
      fiscalYear,
      recordType,
      distributionId,
    });
    if (seenDocIds.has(docId)) {
      rejected.push({
        rowNumber,
        column: 'DistributionId',
        ticker,
        reasonAr: `تعارض أو تكرار سجل التوزيع (${docId}) داخل نفس الورقة.`,
      });
      continue;
    }
    seenDocIds.add(docId);

    records.push({
      ticker,
      fiscalYear,
      cashDps,
      asOfDate,
      distributionId,
      recordType,
      approvalStatus,
      distributionSemantics,
      exDividendDate: exRes.value,
      paymentDate: payRes.value,
      recordDate: recDateRes.value,
      totalDistributionAmount,
      eligibleSharesCount,
      currency,
      source,
      parentAnnouncementId: rawParentId ? rawParentId.slice(0, 80) : null,
      notes,
      updatedAt: now,
      sourceRow: rowNumber,
    });
  }

  if (rowsMissingSemantics > 0) {
    warnings.push(
      `يوجد ${rowsMissingSemantics} صف دون عمود/قيمة Semantics صريحة؛ تم استخدام الدلالة (${fallbackSemantics}) مبدئياً ويجب تأكيد الدلالة في المعاينة قبل الحفظ.`
    );
  }
  if (rowsMissingApprovalCount > 0) {
    warnings.push(
      `يوجد ${rowsMissingApprovalCount} صف دون عمود/قيمة ApprovalStatus صريحة؛ تم وسمها مبدئياً كـ (${fallbackApprovalStatus}) ويجب تأكيد حالة الاعتماد في المعاينة قبل الحفظ.`
    );
  }

  return {
    sheetName: targetSheetName,
    totalRows,
    records,
    rejected,
    warnings,
    requiresSemanticsConfirmation: records.length > 0,
    defaultSemanticsUsed: fallbackSemantics,
    requiresApprovalConfirmation: rowsMissingApprovalCount > 0,
    rowsMissingApprovalCount,
  };
}

