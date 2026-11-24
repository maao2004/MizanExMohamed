import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  financialProjection,
  normalizedTicker,
  validateRecords,
} from '../src/core/contracts';
import {
  extractDateFromDailyFileName,
  parseQuarterlyFinancialsExcelFile,
} from '../src/services/parser/excelParser';

describe('records validation & projection', () => {
  it('normalizes EGX tickers and rejects invalid ticker strings', () => {
    assert.equal(normalizedTicker(' comi.ca '), 'COMI');
    assert.equal(normalizedTicker('etel'), 'ETEL');
    assert.throws(() => normalizedTicker(''));
    assert.throws(() => normalizedTicker('bad/ticker'));
  });

  it('validates quarterly records, FCFF constraints, shares > 0, and rejects duplicates', () => {
    const valid = validateRecords(
      [
        {
          ticker: 'COMI.CA',
          year: 2025,
          quarter: 'Q3',
          shares: 1000,
          revenueYTD: 500,
          depreciationAmortizationYTD: 25,
          valuationTaxRate: 0.225,
          financialUnit: 'EGP_millions',
          valuationSource: 'قوائم مالية Q3 2025',
        },
      ],
      true
    );
    assert.equal(valid.length, 1);
    assert.equal(valid[0].ticker, 'COMI');

    assert.throws(() => validateRecords([], true));
    assert.throws(() =>
      validateRecords([{ ticker: 'COMI', year: 2025, quarter: 'Q4', shares: 10 }], true)
    );
    assert.throws(() =>
      validateRecords([{ ticker: 'COMI', year: 2025, quarter: 'Q1', shares: 0 }], true)
    );
    assert.throws(() =>
      validateRecords(
        [{ ticker: 'COMI', year: 2025, quarter: 'Q1', shares: 10, valuationTaxRate: 1.2 }],
        true
      )
    );
    assert.throws(() =>
      validateRecords(
        [{ ticker: 'COMI', year: 2025, quarter: 'Q1', shares: 10, depreciationAmortizationYTD: -1 }],
        true
      )
    );
    const optionalUnitValid = validateRecords(
      [{ ticker: 'COMI', year: 2025, quarter: 'Q1', shares: 1000000, financialUnit: 'USD' }],
      true
    );
    assert.equal(optionalUnitValid.length, 1);
    assert.throws(() =>
      validateRecords(
        [
          {
            ticker: 'COMI',
            year: 2025,
            quarter: 'Q1',
            shares: 1000000,
            financialCurrency: 'EGP',
            financialUnit: 'USD_millions',
          },
        ],
        true
      )
    );
    assert.throws(() =>
      validateRecords(
        [
          { ticker: 'COMI', year: 2025, quarter: 'Q1', shares: 10 },
          { ticker: 'comi.CA', year: 2025, quarter: 'Q1', shares: 10 },
        ],
        true
      )
    );
  });

  it('validates real calendar trade dates on daily records', () => {
    const ok = validateRecords(
      [{ ticker: 'ETEL', tradeDate: '2026-02-28', lastPrice: 35 }],
      false
    );
    assert.equal(ok[0].tradeDate, '2026-02-28');

    assert.throws(() =>
      validateRecords([{ ticker: 'ETEL', tradeDate: '2026-02-30', lastPrice: 35 }], false)
    );
  });

  it('projects quarterly records to normalized financials schema with accurate quarter-end dates', () => {
    const projected = financialProjection({
      ticker: 'COMI.CA',
      year: 2025,
      quarter: 'Q2',
      revenueYTD: 1000,
      ebitYTD: 300,
      depreciationAmortizationYTD: 40,
      changeOperatingNwcYTD: 15,
      valuationTaxRate: 0.225,
      valuationSource: 'IFRS Q2',
      financialUnit: 'EGP_millions',
    });

    assert.equal(projected.id, 'comi_2025_q2');
    assert.equal(projected.periodDate, '2025-06-30');
    assert.equal(projected.operatingProfitYTD, 300);
    assert.equal(projected.depreciationAmortizationYTD, 40);
    assert.equal(projected.valuationSource, 'IFRS Q2');
    assert.equal(projected.isAudited, false);
  });

  it('extracts valid calendar dates from daily Excel file names and rejects invalid ones', () => {
    assert.equal(extractDateFromDailyFileName('2026-11-8.xlsx'), '2026-11-08');
    assert.equal(extractDateFromDailyFileName('EGX_2026_02_28.xlsx'), '2026-02-28');
    assert.equal(extractDateFromDailyFileName('2026-02-30.xlsx'), null);
    assert.equal(extractDateFromDailyFileName('daily_prices.xlsx'), null);
  });

  it('parses QuarterlyFinancials Excel cells containing literal "null", "N/A", and "BLANK" as null', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      [
        'الرمز',
        'StockName',
        'YearQuarter',
        'Shares',
        'RevenueYTD',
        'EBIT_YTD',
        'NetIncomeYTD',
        'CapEx_YTD',
        'DA_YTD',
        'DeltaOperatingNWC_YTD',
        'ValuationTaxRate',
        'ValuationSource',
        'FinancialUnit',
      ],
      [
        'COMI.CA',
        'التجاري الدولي',
        '2025Q3',
        3000,
        'null',
        0,
        'N/A',
        'BLANK',
        'NULL',
        '--',
        'null',
        'null',
        'null',
      ],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'QuarterlyFinancials');
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const file = new File([buffer], 'QuarterlyFinancialsData.xlsx');

    const parsed = await parseQuarterlyFinancialsExcelFile(file);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].ticker, 'COMI');
    assert.equal(parsed[0].revenueYTD, null);
    assert.equal(parsed[0].ebitYTD, 0);
    assert.equal(parsed[0].netIncomeYTD, null);
    assert.equal(parsed[0].capexYTD, null);
    assert.equal(parsed[0].depreciationAmortizationYTD, null);
    assert.equal(parsed[0].changeOperatingNwcYTD, null);
    assert.equal(parsed[0].valuationTaxRate, null);
    assert.equal(parsed[0].valuationSource, null);
    assert.equal(parsed[0].financialUnit, null);
  });
});
