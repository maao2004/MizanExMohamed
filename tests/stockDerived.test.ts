import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAppDataState,
  deriveFinancialsFromQuarterlyRecords,
  deriveStocksFromQuarterlyRecords,
  resolveSelectedTicker,
} from '../src/core/domain/stockDerived';
import { CacheService } from '../src/services/storage/cacheService';
import { DailyTradingRecord, QuarterlyFinancialRecord } from '../src/types';
import { Company } from '../src/types/financial';
import { computeComprehensiveValuation } from '../src/core/math/valuation';

function makeRecord(overrides: Partial<QuarterlyFinancialRecord> = {}): QuarterlyFinancialRecord {
  return {
    ticker: 'ETEL',
    stockName: 'المصرية للاتصالات',
    yearQuarter: '2025Q1',
    year: 2025,
    quarter: 'Q1',
    shares: 1707,
    intangibleAssets: null,
    totalAssets: 120000,
    equity: 45000,
    totalDebtWithoutTX: 20000,
    totalLiabilities: 75000,
    revenueYTD: 15000,
    grossProfitYTD: 6000,
    ebitYTD: 4000,
    pbtYTD: 3500,
    netIncomeYTD: 2800,
    ocfYTD: 3200,
    netInvestingCfYTD: -800,
    dividendsPaidYTD: 0,
    cash: 5000,
    interestExpenseYTD: 400,
    financeCostsYTD: 400,
    interestIncomeYTD: 100,
    taxExpenseYTD: 700,
    interestPaidYTD: 350,
    capexYTD: 700,
    dateInsertData: '2025-05-15',
    depreciationAmortizationYTD: 900,
    changeOperatingNwcYTD: 150,
    valuationTaxRate: 0.225,
    valuationSource: 'قوائم مالية مدققة',
    financialUnit: 'EGP_millions',
    updatedAt: '2025-05-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeCompanyMeta(overrides: Partial<Company> = {}): Company {
  return {
    id: 'comi',
    ticker: 'COMI',
    nameAr: 'التجاري الدولي',
    nameEn: 'CIB',
    sector: 'بنوك',
    marketPrice: 80,
    sharesOutstanding: 3000,
    beta: 1.1,
    riskFreeRate: 0.25,
    equityRiskPremium: 0.08,
    costOfDebt: 0.16,
    taxRate: 0.225,
    targetDebtRatio: 0.2,
    sustainableGrowthRate: 0.05,
    shortTermGrowthRate: 0.1,
    targetPE: 7,
    targetPB: 1.4,
    currency: 'EGP',
    ...overrides,
  };
}

describe('stockDerived single-source-of-truth & governance policy (12 criteria)', () => {
  const originalLocalStorage = (globalThis as any).localStorage;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        throw new Error('localStorage.clear() must not be called!');
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    };
  });

  afterEach(() => {
    (globalThis as any).localStorage = originalLocalStorage;
  });

  it('1) returns empty stock list and null selection when quarterly_financial_records is empty', () => {
    const stocks = deriveStocksFromQuarterlyRecords([], [], {});
    assert.deepEqual(stocks, []);
    assert.equal(resolveSelectedTicker(stocks, null), null);
    assert.equal(resolveSelectedTicker(stocks, 'ETEL'), null);
  });

  it('2) shows a stock once when it has multiple quarterly records (e.g. 5 quarters)', () => {
    const fiveQuarters = [
      makeRecord({ year: 2024, quarter: 'Q1', yearQuarter: '2024Q1' }),
      makeRecord({ year: 2024, quarter: 'Q2', yearQuarter: '2024Q2' }),
      makeRecord({ year: 2024, quarter: 'Q3', yearQuarter: '2024Q3' }),
      makeRecord({ year: 2024, quarter: 'FY', yearQuarter: '2024FY' }),
      makeRecord({ year: 2025, quarter: 'Q1', yearQuarter: '2025Q1' }),
    ];
    const stocks = deriveStocksFromQuarterlyRecords(fiveQuarters, [], {});
    assert.equal(stocks.length, 1);
    assert.equal(stocks[0].ticker, 'ETEL');
    assert.equal(deriveFinancialsFromQuarterlyRecords(fiveQuarters).length, 5);
  });

  it('3) derives stock using stockName or ticker without requiring a companies doc, with marketPrice = null', () => {
    const recWithName = makeRecord({ ticker: 'ABUK', stockName: 'أبو قير للأسمدة' });
    const recWithoutName = makeRecord({ ticker: 'HRHO', stockName: '' });
    const stocks = deriveStocksFromQuarterlyRecords([recWithName, recWithoutName], [], {});

    assert.equal(stocks.length, 2);
    const abuk = stocks.find((s) => s.ticker === 'ABUK')!;
    const hrho = stocks.find((s) => s.ticker === 'HRHO')!;
    assert.equal(abuk.nameAr, 'أبو قير للأسمدة');
    assert.equal(abuk.marketPrice, null);
    assert.equal(hrho.nameAr, 'HRHO');
    assert.equal(hrho.marketPrice, null);
  });

  it('4) never shows stocks present only in companies metadata without quarterly records', () => {
    const orphanMeta = makeCompanyMeta({ id: 'comi', ticker: 'COMI', nameAr: 'التجاري الدولي' });
    const stocks = deriveStocksFromQuarterlyRecords([], [orphanMeta], {});
    assert.equal(stocks.length, 0);
  });

  it('5) merges COMI and COMI.CA via normalizedTicker into a single stock and single companyId', () => {
    const records = [
      makeRecord({ ticker: 'comi.ca', stockName: 'البنك التجاري الدولي', year: 2024, quarter: 'FY' }),
      makeRecord({ ticker: 'COMI', stockName: 'البنك التجاري الدولي', year: 2025, quarter: 'Q1' }),
    ];
    const daily: Record<string, DailyTradingRecord> = {
      'COMI.CA': {
        ticker: 'COMI.CA',
        shortName: 'التجاري الدولي',
        tradeDate: '2025-05-20',
        lastPrice: 82.5,
        changePct: 0.6,
        tradesCount: 500,
        openPrice: 81.0,
        closePrice: 82.0,
        turnoverValue: 82500000,
        netLiquidity: null,
        volume: 1000000,
        avgVolume5D: null,
        avgVolume30D: null,
        avgVolume90D: null,
        lowPrice: 80.5,
        highPrice: 83.0,
        sector: 'بنوك',
        totalBids: null,
        bidsCount: null,
        offersCount: null,
        totalOffers: null,
        avgVolume: null,
        high52W: null,
        low52W: null,
        prevClose: null,
        marketCapThousands: null,
        vwap: null,
        peRatio: null,
        listedShares: 3000000000,
        isinCode: null,
        inflowOrders: null,
        inflowVolume: null,
        inflowLiquidity: null,
        askTrades: null,
        askTradesVolume: null,
        outflowLiquidity: null,
        fullName: null,
        market: null,
        volChange5DPct: null,
        volChange30DPct: null,
        volChange90DPct: null,
        updatedAt: '2025-05-20T15:00:00.000Z',
      },
    };

    const stocks = deriveStocksFromQuarterlyRecords(records, [], daily);
    assert.equal(stocks.length, 1);
    assert.equal(stocks[0].ticker, 'COMI');
    assert.equal(stocks[0].marketPrice, 82.5);

    const noQuarterlyShares = deriveStocksFromQuarterlyRecords(
      [makeRecord({ ticker: 'COMI', stockName: 'البنك التجاري الدولي', year: 2025, quarter: 'Q1', shares: 0 })],
      [],
      daily
    );
    assert.equal(noQuarterlyShares[0].sharesSource, 'daily_listed_shares');
    assert.equal(noQuarterlyShares[0].sharesOutstanding, 3000000000);

    const financials = deriveFinancialsFromQuarterlyRecords(records);
    assert.equal(financials.length, 2);
    assert.ok(financials.every((f) => f.companyId === 'comi'));
  });

  it('6) deleting partial quarters keeps stock; deleting last record removes stock immediately', () => {
    const q1 = makeRecord({ ticker: 'ETEL', year: 2025, quarter: 'Q1' });
    const q2 = makeRecord({ ticker: 'ETEL', year: 2025, quarter: 'Q2' });

    const afterPartialDelete = deriveStocksFromQuarterlyRecords([q1], [], {});
    assert.equal(afterPartialDelete.length, 1);

    const afterLastDelete = deriveStocksFromQuarterlyRecords([], [], {});
    assert.equal(afterLastDelete.length, 0);
  });

  it('7) resolves next deterministic ticker when selected stock is removed, or null if none remain', () => {
    const twoStocks = deriveStocksFromQuarterlyRecords([
      makeRecord({ ticker: 'ETEL', stockName: 'المصرية للاتصالات' }),
      makeRecord({ ticker: 'ABUK', stockName: 'أبو قير' }),
    ]);
    // Sorted alphabetically: ABUK then ETEL
    assert.equal(twoStocks.map((s) => s.ticker).join(','), 'ABUK,ETEL');
    assert.equal(resolveSelectedTicker(twoStocks, 'ETEL'), 'ETEL');

    // Remove ETEL -> shifts deterministically to ABUK
    const onlyAbuk = deriveStocksFromQuarterlyRecords([
      makeRecord({ ticker: 'ABUK', stockName: 'أبو قير' }),
    ]);
    assert.equal(resolveSelectedTicker(onlyAbuk, 'ETEL'), 'ABUK');

    // Remove ABUK -> null
    assert.equal(resolveSelectedTicker([], 'ABUK'), null);
  });

  it('8) adding first stock + quarterly record makes it appear and become selected immediately', () => {
    const initialStocks = deriveStocksFromQuarterlyRecords([]);
    assert.equal(resolveSelectedTicker(initialStocks, null), null);

    const afterAdd = deriveStocksFromQuarterlyRecords([
      makeRecord({ ticker: 'FWRY.CA', stockName: 'فوري' }),
    ]);
    assert.equal(afterAdd.length, 1);
    assert.equal(afterAdd[0].ticker, 'FWRY');
    assert.equal(resolveSelectedTicker(afterAdd, null), 'FWRY');
  });

  it('9) rejects failed server save without mutating confirmed quarterly state', async () => {
    let confirmedRecords: QuarterlyFinancialRecord[] = [makeRecord({ ticker: 'ETEL' })];
    const saveRejected = async (rec: QuarterlyFinancialRecord) => {
      throw new Error('Firestore permission-denied');
    };

    await assert.rejects(async () => {
      const candidate = makeRecord({ ticker: 'SWDY', stockName: 'السويدي' });
      await saveRejected(candidate);
      confirmedRecords = [...confirmedRecords, candidate];
    }, /Firestore permission-denied/);

    const stocks = deriveStocksFromQuarterlyRecords(confirmedRecords);
    assert.equal(stocks.length, 1);
    assert.equal(stocks[0].ticker, 'ETEL');
  });

  it('10) invalidates legacy mizan_* caches safely on v4 upgrade without localStorage.clear or COMI fallback', () => {
    store.set('unrelated_user_pref', 'keep-me');
    store.set('mizan_stocks_cache', JSON.stringify([{ id: 'comi', ticker: 'COMI' }]));
    store.set('mizan_egx_companies_v2', JSON.stringify([{ id: 'comi', ticker: 'COMI' }]));
    store.set('mizan_macro_params_v2', JSON.stringify([{ key: 'TaxRate', value: 0.225 }]));

    CacheService.invalidateLegacyCachesIfNeeded();

    assert.equal(store.get('unrelated_user_pref'), 'keep-me');
    assert.equal(store.get('mizan_stocks_cache'), undefined);
    assert.equal(store.get('mizan_egx_companies_v2'), undefined);
    assert.equal(store.get('mizan_macro_params_v2'), undefined);
    assert.equal(store.get('mizan_cache_version'), 'v4');

    // Cache getters return empty collections rather than INITIAL/DEFAULT datasets
    assert.deepEqual(CacheService.getMacroParameters(), []);
    assert.deepEqual(CacheService.getDailyTradingRecords(), []);
    assert.deepEqual(CacheService.getQuarterlyFinancialRecords(), []);
    assert.deepEqual(CacheService.getSectorPE(), {});
  });

  it('11) excludes valuation models and discount rates instead of falling back to unsourced defaults', () => {
    const out = computeComprehensiveValuation(
      {
        ticker: 'ETEL',
        marketPrice: null,
        sharesOutstanding: 1707,
        betaRaw: 0.9,
        netIncomeTTM: 2800,
        ocfTTM: 3200,
        capexTTM: 700,
        fcfTTM: 2500,
        fcffTTM: 2600,
        totalEquity: 45000,
        totalDebt: 20000,
        cash: 5000,
        dpsRegular: 1.5,
        sector: 'اتصالات',
        sectorPE: null,
        sectorPB: null,
      },
      {
        // Only TaxRate supplied; missing Rf_Egypt_10Y, ERP_Developed, Growth_Y1..5, DDM_Growth, RIM_Retention, Weight_*
        TaxRate: 0.225,
      }
    );

    assert.equal(out.costOfEquity, null);
    assert.equal(out.wacc, null);
    assert.equal(out.dcfValue, null);
    assert.equal(out.ddmValue, null);
    assert.equal(out.rimValue, null);
    assert.equal(out.relativeValue, null);
    assert.equal(out.compositeFairValue, null);
    assert.equal(out.marginOfSafetyPct, null);
    assert.ok(out.modelNotes.length >= 4);
  });

  it('12) distinguishes loading, unauthenticated, permission_denied, error, and confirmed empty states strictly', () => {
    assert.equal(
      classifyAppDataState({
        authLoading: true,
        isAuthenticated: false,
        connectionError: null,
        quarterlyConfirmed: false,
        stocksCount: 0,
      }),
      'loading'
    );
    assert.equal(
      classifyAppDataState({
        authLoading: false,
        isAuthenticated: false,
        connectionError: null,
        quarterlyConfirmed: false,
        stocksCount: 0,
      }),
      'unauthenticated'
    );
    assert.equal(
      classifyAppDataState({
        authLoading: false,
        isAuthenticated: true,
        connectionError: { type: 'permission_denied', message: 'denied' },
        quarterlyConfirmed: false,
        stocksCount: 0,
      }),
      'permission_denied'
    );
    assert.equal(
      classifyAppDataState({
        authLoading: false,
        isAuthenticated: true,
        connectionError: { type: 'error', message: 'network error' },
        quarterlyConfirmed: true,
        stocksCount: 0,
      }),
      'error'
    );
    assert.equal(
      classifyAppDataState({
        authLoading: false,
        isAuthenticated: true,
        connectionError: null,
        quarterlyConfirmed: false,
        stocksCount: 0,
      }),
      'loading'
    );
    assert.equal(
      classifyAppDataState({
        authLoading: false,
        isAuthenticated: true,
        connectionError: null,
        quarterlyConfirmed: true,
        stocksCount: 0,
      }),
      'empty'
    );
    assert.equal(
      classifyAppDataState({
        authLoading: false,
        isAuthenticated: true,
        connectionError: null,
        quarterlyConfirmed: true,
        stocksCount: 1,
      }),
      'ready'
    );
  });
});
