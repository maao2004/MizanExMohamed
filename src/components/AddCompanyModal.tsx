/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  CommonEquityBasis,
  CompanyMetadataPatch,
  CurrencyCode,
  NetIncomeCommonBasis,
  SectorDefinition,
  SectorPeLoadStatus,
  WeightedAvgSharesBasis,
} from '../types/financial';
import { QuarterlyFinancialRecord } from '../types';
import {
  computeCalendarSpanDays,
  inspectWeightedAvgSharesBasis,
  isValidCalendarDate,
  normalizedTicker,
  validateAndNormalizeReportedEpsPeriod,
  validateAndNormalizeWeightedAvgSharesBasis,
  validateQuarterlyPeriodInputs,
  WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR,
  WEIGHTED_AVG_SHARES_BASIS_EMPTY_OPTION_AR,
  WEIGHTED_AVG_SHARES_BASIS_OPTIONS,
  WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR,
} from '../core/contracts';
import {
  ReportedEpsPeriodFieldset,
  ReportedEpsPeriodFieldValue,
} from '../shared/ui/ReportedEpsPeriodFieldset';
import { PlusCircle, AlertCircle, Info, ShieldAlert } from 'lucide-react';

interface AddCompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveStockAndQuarter: (payload: {
    quarterlyRecord: QuarterlyFinancialRecord;
    companyMetadata?: CompanyMetadataPatch;
  }) => Promise<void>;
  sectorDefinitions?: SectorDefinition[];
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
  sectorPeError?: string | null;
}

const parseOptionalNumeric = (raw: string, fieldLabel: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'BLANK') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`القيمة المدخلة في حقل "${fieldLabel}" غير صالحة رقمياً.`);
  }
  return parsed;
};

export const AddCompanyModal: React.FC<AddCompanyModalProps> = ({
  isOpen,
  onClose,
  onSaveStockAndQuarter,
  sectorDefinitions = [],
  sectorPeConfirmed = false,
  sectorPeStatus = 'loading',
  sectorPeError = null,
}) => {
  const todayIso = new Date().toISOString().split('T')[0];

  // الأعمدة الأساسية وفق ترتيب QuarterlyFinancialsData.xlsx
  const [ticker, setTicker] = useState('');
  const [stockName, setStockName] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState<'Q1' | 'Q2' | 'Q3' | 'FY'>('FY');
  const [shares, setShares] = useState('');
  const [intangibleAssets, setIntangibleAssets] = useState('');
  const [totalAssets, setTotalAssets] = useState('');
  const [equity, setEquity] = useState('');
  const [totalDebtWithoutTX, setTotalDebtWithoutTX] = useState('');
  const [totalLiabilities, setTotalLiabilities] = useState('');
  const [revenueYTD, setRevenueYTD] = useState('');
  const [grossProfitYTD, setGrossProfitYTD] = useState('');
  const [ebitYTD, setEbitYTD] = useState('');
  const [pbtYTD, setPbtYTD] = useState('');
  const [netIncomeYTD, setNetIncomeYTD] = useState('');
  const [ocfYTD, setOcfYTD] = useState('');
  const [netInvestingCfYTD, setNetInvestingCfYTD] = useState('');
  const [dividendsPaidYTD, setDividendsPaidYTD] = useState('');
  const [cash, setCash] = useState('');
  const [interestExpenseYTD, setInterestExpenseYTD] = useState('');
  const [financeCostsYTD, setFinanceCostsYTD] = useState('');
  const [interestIncomeYTD, setInterestIncomeYTD] = useState('');
  const [taxExpenseYTD, setTaxExpenseYTD] = useState('');
  const [interestPaidYTD, setInterestPaidYTD] = useState('');
  const [capexYTD, setCapexYTD] = useState('');
  const [dateInsertData, setDateInsertData] = useState(todayIso);

  // الحقول المحاسبية والفترية الإلزامية في العقد (بدون تعبئة تلقائية أو إقرار افتراضي)
  const [netIncomeCommonYTD, setNetIncomeCommonYTD] = useState('');
  const [netIncomeCommonBasis, setNetIncomeCommonBasis] = useState<'' | NetIncomeCommonBasis>('');
  const [netIncomeCommonNote, setNetIncomeCommonNote] = useState('');
  const [equityCommon, setEquityCommon] = useState('');
  const [equityCommonBasis, setEquityCommonBasis] = useState<'' | CommonEquityBasis>('');
  const [equityCommonNote, setEquityCommonNote] = useState('');
  const [weightedAvgSharesYTD, setWeightedAvgSharesYTD] = useState('');
  const [weightedAvgSharesBasis, setWeightedAvgSharesBasis] = useState<'' | WeightedAvgSharesBasis>('');
  const [periodStartDate, setPeriodStartDate] = useState('');
  const [periodEndDate, setPeriodEndDate] = useState('');
  const [periodDays, setPeriodDays] = useState('');
  const [periodDaysAutoFilled, setPeriodDaysAutoFilled] = useState(false);

  // إفصاحات EPS والعملة الاختيارية
  const [reportedEps, setReportedEps] = useState('');
  const [reportedEpsPeriodState, setReportedEpsPeriodState] = useState<ReportedEpsPeriodFieldValue>({
    reportedEpsPeriodType: null,
    reportedEpsFiscalYear: null,
    reportedEpsFiscalQuarter: null,
    reportedEpsPeriodStart: null,
    reportedEpsPeriodEnd: null,
    reportedEpsPeriod: null,
  });
  const [reportedEpsSource, setReportedEpsSource] = useState('');
  const [isCapitalActionAdjusted, setIsCapitalActionAdjusted] = useState<'' | 'true' | 'false'>('');
  const [financialCurrency, setFinancialCurrency] = useState<'' | CurrencyCode>('');

  // أعمدة FCFF التقييمية
  const [daYTD, setDaYTD] = useState('');
  const [deltaOperatingNwcYTD, setDeltaOperatingNwcYTD] = useState('');
  const [valuationTaxRate, setValuationTaxRate] = useState('');
  const [valuationSource, setValuationSource] = useState('');

  // إثراء اختياري في مجموعة companies — القطاع يُختار حصراً من سجل sectorPE النشط
  const [selectedSectorId, setSelectedSectorId] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeSectors = useMemo(
    () =>
      sectorDefinitions
        .filter((d) => d.isDeleted !== true && d.status === 'active')
        .sort((a, b) => a.nameAr.localeCompare(b.nameAr, 'ar')),
    [sectorDefinitions]
  );

  const selectedSectorDef = useMemo(
    () => activeSectors.find((d) => d.sectorId === selectedSectorId) ?? null,
    [activeSectors, selectedSectorId]
  );

  // Calculate calendar span preview when both period dates are valid (never fabricating Jan 1)
  const liveCalendarSpan = useMemo(() => {
    const start = periodStartDate.trim();
    const end = periodEndDate.trim();
    if (!start || !end) return null;
    if (!isValidCalendarDate(start) || !isValidCalendarDate(end) || start > end) return null;
    const days = computeCalendarSpanDays(start, end);
    return days >= 1 && days <= 370 ? days : null;
  }, [periodStartDate, periodEndDate]);

  useEffect(() => {
    if (liveCalendarSpan !== null && (periodDays.trim() === '' || periodDaysAutoFilled)) {
      setPeriodDays(String(liveCalendarSpan));
      setPeriodDaysAutoFilled(true);
    } else if (liveCalendarSpan === null && periodDaysAutoFilled) {
      setPeriodDays('');
      setPeriodDaysAutoFilled(false);
    }
  }, [liveCalendarSpan, periodDays, periodDaysAutoFilled]);

  // Reset selectedSectorId if the sector registry reloads and it is no longer active
  useEffect(() => {
    if (selectedSectorId && !activeSectors.some((s) => s.sectorId === selectedSectorId)) {
      setSelectedSectorId('');
    }
  }, [activeSectors, selectedSectorId]);

  const sharesBasisInspection = useMemo(
    () => inspectWeightedAvgSharesBasis(weightedAvgSharesBasis),
    [weightedAvgSharesBasis]
  );

  if (!isOpen) return null;

  const resetForm = () => {
    setTicker('');
    setStockName('');
    setYear(String(new Date().getFullYear()));
    setQuarter('FY');
    setShares('');
    setIntangibleAssets('');
    setTotalAssets('');
    setEquity('');
    setTotalDebtWithoutTX('');
    setTotalLiabilities('');
    setRevenueYTD('');
    setGrossProfitYTD('');
    setEbitYTD('');
    setPbtYTD('');
    setNetIncomeYTD('');
    setOcfYTD('');
    setNetInvestingCfYTD('');
    setDividendsPaidYTD('');
    setCash('');
    setInterestExpenseYTD('');
    setFinanceCostsYTD('');
    setInterestIncomeYTD('');
    setTaxExpenseYTD('');
    setInterestPaidYTD('');
    setCapexYTD('');
    setDateInsertData(new Date().toISOString().split('T')[0]);
    setNetIncomeCommonYTD('');
    setNetIncomeCommonBasis('');
    setNetIncomeCommonNote('');
    setEquityCommon('');
    setEquityCommonBasis('');
    setEquityCommonNote('');
    setWeightedAvgSharesYTD('');
    setWeightedAvgSharesBasis('');
    setPeriodStartDate('');
    setPeriodEndDate('');
    setPeriodDays('');
    setPeriodDaysAutoFilled(false);
    setReportedEps('');
    setReportedEpsPeriodState({
      reportedEpsPeriodType: null,
      reportedEpsFiscalYear: null,
      reportedEpsFiscalQuarter: null,
      reportedEpsPeriodStart: null,
      reportedEpsPeriodEnd: null,
      reportedEpsPeriod: null,
    });
    setReportedEpsSource('');
    setIsCapitalActionAdjusted('');
    setFinancialCurrency('');
    setDaYTD('');
    setDeltaOperatingNwcYTD('');
    setValuationTaxRate('');
    setValuationSource('');
    setSelectedSectorId('');
    setNameEn('');
    setDescription('');
    setErrorMsg(null);
  };

  const handleCloseModal = () => {
    if (submitting) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);

    try {
      const tk = normalizedTicker(ticker);
      const parsedYear = Number(year);
      if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2200) {
        throw new Error('السنة المالية يجب أن تكون رقماً صحيحاً بين 1900 و 2200.');
      }

      const parsedShares = parseOptionalNumeric(shares, 'Shares');
      if (parsedShares === null || parsedShares <= 0) {
        throw new Error('عدد الأسهم (Shares) مطلوب ويجب أن يكون أكبر من صفر.');
      }

      const parsedWeightedAvgShares = parseOptionalNumeric(
        weightedAvgSharesYTD,
        'WeightedAvgSharesYTD'
      );
      if (parsedWeightedAvgShares !== null && parsedWeightedAvgShares <= 0) {
        throw new Error('المتوسط المرجح للأسهم (WeightedAvgSharesYTD) يجب أن يكون أكبر من صفر عند إدخاله.');
      }
      const validatedSharesBasis = validateAndNormalizeWeightedAvgSharesBasis(
        weightedAvgSharesBasis === '' ? null : weightedAvgSharesBasis
      );

      const parsedDa = parseOptionalNumeric(daYTD, 'DA_YTD');
      if (parsedDa !== null && parsedDa < 0) {
        throw new Error('قيمة الإهلاك والاستنفاد (DA_YTD) يجب أن تكون موجبة أو صفراً.');
      }

      const parsedTax = parseOptionalNumeric(valuationTaxRate, 'ValuationTaxRate');
      if (parsedTax !== null && (parsedTax < 0 || parsedTax > 1)) {
        throw new Error('ضريبة التقييم (ValuationTaxRate) يجب أن تكون كسراً عشرياً بين 0 و 1.');
      }

      // Single Source of Truth period validation (real dates, leap years, start <= end, no conflicting periodDays, never fabricating Jan 1)
      const validatedPeriod = validateQuarterlyPeriodInputs({
        periodStartDate: periodStartDate.trim() || null,
        periodEndDate: periodEndDate.trim() || null,
        periodDays: periodDays.trim() === '' ? null : periodDays.trim(),
      });

      const parsedReportedEps = parseOptionalNumeric(reportedEps, 'ReportedEPS');
      const validatedReportedEpsPeriod = validateAndNormalizeReportedEpsPeriod({
        reportedEps: parsedReportedEps,
        reportedEpsPeriodType: reportedEpsPeriodState.reportedEpsPeriodType,
        reportedEpsFiscalYear: reportedEpsPeriodState.reportedEpsFiscalYear,
        reportedEpsFiscalQuarter: reportedEpsPeriodState.reportedEpsFiscalQuarter,
        reportedEpsPeriodStart: reportedEpsPeriodState.reportedEpsPeriodStart,
        reportedEpsPeriodEnd: reportedEpsPeriodState.reportedEpsPeriodEnd,
        reportedEpsPeriod: reportedEpsPeriodState.reportedEpsPeriod,
      });

      const resolvedStockName = stockName.trim() || tk;
      const nowIso = new Date().toISOString();

      const quarterlyRecord: QuarterlyFinancialRecord = {
        ticker: tk,
        stockName: resolvedStockName,
        yearQuarter: `${parsedYear}${quarter}`,
        year: parsedYear,
        quarter,
        shares: parsedShares,
        intangibleAssets: parseOptionalNumeric(intangibleAssets, 'IntangibleAssets'),
        totalAssets: parseOptionalNumeric(totalAssets, 'TotalAssets'),
        equity: parseOptionalNumeric(equity, 'Equity'),
        equityCommon: parseOptionalNumeric(equityCommon, 'EquityCommon'),
        equityCommonBasis: equityCommonBasis === '' ? null : equityCommonBasis,
        equityCommonNote: equityCommonNote.trim() || null,
        totalDebtWithoutTX: parseOptionalNumeric(totalDebtWithoutTX, 'TotalDebtWithoutTX'),
        totalLiabilities: parseOptionalNumeric(totalLiabilities, 'TotalLiabilities'),
        revenueYTD: parseOptionalNumeric(revenueYTD, 'RevenueYTD'),
        grossProfitYTD: parseOptionalNumeric(grossProfitYTD, 'GrossProfitYTD'),
        ebitYTD: parseOptionalNumeric(ebitYTD, 'EBIT_YTD'),
        pbtYTD: parseOptionalNumeric(pbtYTD, 'PBT_YTD'),
        netIncomeYTD: parseOptionalNumeric(netIncomeYTD, 'NetIncomeYTD'),
        netIncomeCommonYTD: parseOptionalNumeric(netIncomeCommonYTD, 'NetIncomeCommon_YTD'),
        netIncomeCommonBasis: netIncomeCommonBasis === '' ? null : netIncomeCommonBasis,
        netIncomeCommonNote: netIncomeCommonNote.trim() || null,
        weightedAvgSharesYTD: parsedWeightedAvgShares,
        weightedAvgSharesBasis: validatedSharesBasis,
        periodStartDate: validatedPeriod.periodStartDate,
        periodEndDate: validatedPeriod.periodEndDate,
        periodDays: validatedPeriod.periodDays,
        reportedEps: parsedReportedEps,
        reportedEpsPeriodType: validatedReportedEpsPeriod.reportedEpsPeriodType,
        reportedEpsFiscalYear: validatedReportedEpsPeriod.reportedEpsFiscalYear,
        reportedEpsFiscalQuarter: validatedReportedEpsPeriod.reportedEpsFiscalQuarter,
        reportedEpsPeriodStart: validatedReportedEpsPeriod.reportedEpsPeriodStart,
        reportedEpsPeriodEnd: validatedReportedEpsPeriod.reportedEpsPeriodEnd,
        reportedEpsPeriod: validatedReportedEpsPeriod.reportedEpsPeriod,
        reportedEpsSource: reportedEpsSource.trim() || null,
        isCapitalActionAdjusted:
          isCapitalActionAdjusted === 'true'
            ? true
            : isCapitalActionAdjusted === 'false'
            ? false
            : null,
        financialCurrency: financialCurrency === '' ? null : financialCurrency,
        ocfYTD: parseOptionalNumeric(ocfYTD, 'OCF_YTD'),
        netInvestingCfYTD: parseOptionalNumeric(netInvestingCfYTD, 'NetInvestingCF_YTD'),
        dividendsPaidYTD: parseOptionalNumeric(dividendsPaidYTD, 'DividendsPaidYTD'),
        cash: parseOptionalNumeric(cash, 'Cash'),
        interestExpenseYTD: parseOptionalNumeric(interestExpenseYTD, 'InterestExpense_YTD'),
        financeCostsYTD: parseOptionalNumeric(financeCostsYTD, 'FinanceCosts_YTD'),
        interestIncomeYTD: parseOptionalNumeric(interestIncomeYTD, 'InterestIncome_YTD'),
        taxExpenseYTD: parseOptionalNumeric(taxExpenseYTD, 'TaxExpense_YTD'),
        interestPaidYTD: parseOptionalNumeric(interestPaidYTD, 'InterestPaid_YTD'),
        capexYTD: parseOptionalNumeric(capexYTD, 'CapEx_YTD'),
        dateInsertData: dateInsertData.trim() || todayIso,
        depreciationAmortizationYTD: parsedDa,
        changeOperatingNwcYTD: parseOptionalNumeric(deltaOperatingNwcYTD, 'DeltaOperatingNWC_YTD'),
        valuationTaxRate: parsedTax,
        valuationSource: valuationSource.trim() || null,
        updatedAt: nowIso,
      };

      const metadataPatch: CompanyMetadataPatch = {
        id: tk.toLowerCase(),
        ticker: tk,
      };
      let hasCompanyMeta = false;
      if (stockName.trim()) {
        metadataPatch.nameAr = stockName.trim();
        hasCompanyMeta = true;
      }
      if (nameEn.trim()) {
        metadataPatch.nameEn = nameEn.trim();
        hasCompanyMeta = true;
      }
      // Sector classification is strictly attested from active sectorPE registry; never inferred or fabricated on load failure
      if (sectorPeConfirmed && selectedSectorDef) {
        metadataPatch.sectorId = selectedSectorDef.sectorId;
        metadataPatch.sector = selectedSectorDef.nameAr;
        metadataPatch.sectorClassification = selectedSectorDef.classification;
        metadataPatch.sectorSource = 'sector_registry';
        metadataPatch.sectorDate = todayIso;
        hasCompanyMeta = true;
      }
      if (description.trim()) {
        metadataPatch.description = description.trim();
        hasCompanyMeta = true;
      }

      setSubmitting(true);
      await onSaveStockAndQuarter({
        quarterlyRecord,
        companyMetadata: hasCompanyMeta ? metadataPatch : undefined,
      });

      resetForm();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حفظ السجل في Firestore.');
    } finally {
      setSubmitting(false);
    }
  };

  const sectorRegistryUnavailable =
    sectorPeStatus === 'error' || sectorPeStatus === 'permission_denied';
  const sectorRegistryLoading = sectorPeStatus === 'loading';
  const canSelectSector = sectorPeConfirmed && !sectorRegistryUnavailable && activeSectors.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-5xl w-full p-6 shadow-2xl space-y-4 my-8 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white">
              إضافة سهم وأول سجل مالي ربع سنوي (Firestore — quarterly_financial_records)
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed bg-slate-950/70 p-3 rounded-xl border border-slate-800">
          وفق سياسة المنصة، يظهر السهم في القائمة بمجرد حفظ أول سجل مالي صالح له في{' '}
          <span className="font-mono text-emerald-400">quarterly_financial_records</span>. اترك الحقول غير المعلنة
          فارغة (<span className="font-mono text-slate-300">BLANK</span>) دون كتابة أصفار تقديرية، وتبقى المبالغ
          وأعداد الأسهم بقيمتها الأساسية كما أُدخلت. السعر السوقي يُجلب حصرياً من سجل التداول اليومي.
        </p>

        {errorMsg && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-red-950/70 border border-red-800 text-xs text-red-200 flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5 text-xs">
          {/* 1. هوية السهم والفترة */}
          <div className="space-y-2">
            <h4 className="font-bold text-emerald-400 text-xs border-b border-slate-800 pb-1">
              1. هوية السهم والفترة (الأعمدة الأساسية — QuarterlyFinancialsData.xlsx)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">الرمز (Ticker)*</label>
                <input
                  type="text"
                  placeholder="مثال: COMI أو COMI.CA"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200 uppercase"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">اسم السهم (StockName)</label>
                <input
                  type="text"
                  placeholder="اتركه فارغاً لاستخدام الرمز"
                  value={stockName}
                  onChange={(e) => setStockName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">السنة (Year)*</label>
                <input
                  type="number"
                  min={1900}
                  max={2200}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">الربع (Quarter)*</label>
                <select
                  value={quarter}
                  onChange={(e) => setQuarter(e.target.value as 'Q1' | 'Q2' | 'Q3' | 'FY')}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                >
                  <option value="Q1">Q1</option>
                  <option value="Q2">Q2</option>
                  <option value="Q3">Q3</option>
                  <option value="FY">FY</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">عدد الأسهم (Shares)*</label>
                <input
                  type="text"
                  placeholder="مثال: 3070850000"
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-amber-300"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">عملة القوائم (اختياري)</label>
                <select
                  value={financialCurrency}
                  onChange={(e) => setFinancialCurrency(e.target.value as '' | CurrencyCode)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                >
                  <option value="">غير محددة (BLANK)</option>
                  <option value="EGP">EGP (جنيه مصري)</option>
                  <option value="USD">USD (دولار أمريكي)</option>
                </select>
              </div>
            </div>
          </div>

          {/* 2. تواريخ الفترة المالية والمتوسط المرجح للأسهم */}
          <div className="space-y-2">
            <h4 className="font-bold text-cyan-400 text-xs border-b border-slate-800 pb-1">
              2. حدود الفترة المالية والمتوسط المرجح للأسهم (مطلوب لحساب AccountingEPS و TTM الموزون زمنياً)
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              لا يفترض النظام بداية السنة في 1 يناير للشركات ذات السنوات المالية غير التقويمية؛ أدخل تاريخي البداية والنهاية معاً لاحتساب عدد الأيام الفعلي بدقة (بما يشمل السنوات الكبيسة).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">بداية الفترة (PeriodStartDate)</label>
                <input
                  type="date"
                  value={periodStartDate}
                  onChange={(e) => setPeriodStartDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">نهاية الفترة (PeriodEndDate)</label>
                <input
                  type="date"
                  value={periodEndDate}
                  onChange={(e) => setPeriodEndDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">
                  عدد أيام الفترة (PeriodDays)
                  {liveCalendarSpan !== null && (
                    <span className="text-emerald-400 font-mono mr-1">({liveCalendarSpan} يوماً)</span>
                  )}
                </label>
                <input
                  type="number"
                  min={1}
                  max={370}
                  step={1}
                  placeholder="يُحسب تلقائياً من التاريخين"
                  value={periodDays}
                  onChange={(e) => {
                    setPeriodDays(e.target.value);
                    setPeriodDaysAutoFilled(false);
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">
                  المتوسط المرجح (WeightedAvgSharesYTD — عدد أسهم)
                </label>
                <input
                  type="text"
                  data-field="weightedAvgSharesYTD"
                  placeholder="BLANK (عدد أسهم كامل وليس EPS)"
                  value={weightedAvgSharesYTD}
                  onChange={(e) => setWeightedAvgSharesYTD(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                />
                <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">
                  {WEIGHTED_AVG_SHARES_YTD_FIELD_GUIDANCE_AR}
                </p>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">أساس المتوسط المرجح (WeightedAvgShares_Basis)</label>
                <select
                  data-field="weightedAvgSharesBasis"
                  value={weightedAvgSharesBasis}
                  onChange={(e) =>
                    setWeightedAvgSharesBasis(e.target.value as '' | WeightedAvgSharesBasis)
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                >
                  <option value="">{WEIGHTED_AVG_SHARES_BASIS_EMPTY_OPTION_AR}</option>
                  {WEIGHTED_AVG_SHARES_BASIS_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.selectLabelAr}
                    </option>
                  ))}
                </select>
                {sharesBasisInspection.option && (
                  <p className="mt-1 text-[10px] text-slate-400 leading-relaxed">
                    {sharesBasisInspection.option.meaningAr} {sharesBasisInspection.option.usageLimitsAr}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">
                  {WEIGHTED_AVG_SHARES_BASIS_CAPITAL_ACTION_NOTE_AR}
                </p>
              </div>
            </div>
          </div>

          {/* 3. المركز المالي وحقوق المساهمين العاديين */}
          <div className="space-y-2">
            <h4 className="font-bold text-sky-400 text-xs border-b border-slate-800 pb-1">
              3. المركز المالي وفصل حقوق المساهمين العاديين (القيمة الأساسية — BLANK إذا لم يُعلن)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">IntangibleAssets</label>
                <input type="text" placeholder="BLANK" value={intangibleAssets} onChange={(e) => setIntangibleAssets(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">TotalAssets</label>
                <input type="text" placeholder="BLANK" value={totalAssets} onChange={(e) => setTotalAssets(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Equity (الإجمالي)</label>
                <input type="text" placeholder="BLANK" value={equity} onChange={(e) => setEquity(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-sky-300" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">TotalDebtWithoutTX</label>
                <input type="text" placeholder="BLANK" value={totalDebtWithoutTX} onChange={(e) => setTotalDebtWithoutTX(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">TotalLiabilities</label>
                <input type="text" placeholder="BLANK" value={totalLiabilities} onChange={(e) => setTotalLiabilities(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Cash</label>
                <input type="text" placeholder="BLANK" value={cash} onChange={(e) => setCash(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="block text-sky-300 mb-1">حقوق المساهمين العاديين (EquityCommon)</label>
                <input
                  type="text"
                  placeholder="BLANK (بدون حقوق الأقلية)"
                  value={equityCommon}
                  onChange={(e) => setEquityCommon(e.target.value)}
                  className="w-full bg-slate-950 border border-sky-800/60 rounded-lg p-2 font-mono text-sky-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">أساس حقوق العاديين (EquityCommon_Basis)</label>
                <select
                  value={equityCommonBasis}
                  onChange={(e) => setEquityCommonBasis(e.target.value as '' | CommonEquityBasis)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                >
                  <option value="">غير محدد (BLANK — لا يُفترض التطابق تلقائياً)</option>
                  <option value="explicit_common">explicit_common (مسجلة صراحة للشركة الأم)</option>
                  <option value="attested_total_equals_common">
                    attested_total_equals_common (إقرار صريح بتطابق Equity الكلي)
                  </option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">ملاحظة التوثيق (EquityCommon_Note)</label>
                <input
                  type="text"
                  maxLength={400}
                  placeholder="مثال: قوائم مستقلة دون حقوق أقلية"
                  value={equityCommonNote}
                  onChange={(e) => setEquityCommonNote(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>
            </div>
          </div>

          {/* 4. قائمة الدخل والتدفقات وصافي ربح المساهمين العاديين */}
          <div className="space-y-2">
            <h4 className="font-bold text-teal-400 text-xs border-b border-slate-800 pb-1">
              4. قائمة الدخل والتدفقات التراكمية (YTD) وفصل صافي ربح المساهمين العاديين
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">RevenueYTD</label>
                <input type="text" placeholder="BLANK" value={revenueYTD} onChange={(e) => setRevenueYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">GrossProfitYTD</label>
                <input type="text" placeholder="BLANK" value={grossProfitYTD} onChange={(e) => setGrossProfitYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">EBIT_YTD</label>
                <input type="text" placeholder="BLANK" value={ebitYTD} onChange={(e) => setEbitYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">PBT_YTD</label>
                <input type="text" placeholder="BLANK" value={pbtYTD} onChange={(e) => setPbtYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">NetIncomeYTD</label>
                <input type="text" placeholder="BLANK" value={netIncomeYTD} onChange={(e) => setNetIncomeYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-emerald-300" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">OCF_YTD</label>
                <input type="text" placeholder="BLANK" value={ocfYTD} onChange={(e) => setOcfYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">NetInvestingCF_YTD</label>
                <input type="text" placeholder="BLANK" value={netInvestingCfYTD} onChange={(e) => setNetInvestingCfYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">DividendsPaidYTD</label>
                <input type="text" placeholder="BLANK" value={dividendsPaidYTD} onChange={(e) => setDividendsPaidYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">InterestExpense_YTD</label>
                <input type="text" placeholder="BLANK" value={interestExpenseYTD} onChange={(e) => setInterestExpenseYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">FinanceCosts_YTD</label>
                <input type="text" placeholder="BLANK" value={financeCostsYTD} onChange={(e) => setFinanceCostsYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">InterestIncome_YTD</label>
                <input type="text" placeholder="BLANK" value={interestIncomeYTD} onChange={(e) => setInterestIncomeYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">TaxExpense_YTD</label>
                <input type="text" placeholder="BLANK" value={taxExpenseYTD} onChange={(e) => setTaxExpenseYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">InterestPaid_YTD</label>
                <input type="text" placeholder="BLANK" value={interestPaidYTD} onChange={(e) => setInterestPaidYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">CapEx_YTD</label>
                <input type="text" placeholder="BLANK" value={capexYTD} onChange={(e) => setCapexYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">DateInsertData</label>
                <input type="date" value={dateInsertData} onChange={(e) => setDateInsertData(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="block text-sky-300 mb-1">صافي ربح العاديين (NetIncomeCommon_YTD)</label>
                <input
                  type="text"
                  placeholder="BLANK (نصيب الشركة الأم)"
                  value={netIncomeCommonYTD}
                  onChange={(e) => setNetIncomeCommonYTD(e.target.value)}
                  className="w-full bg-slate-950 border border-sky-800/60 rounded-lg p-2 font-mono text-sky-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">أساس ربح العاديين (NetIncomeCommon_Basis)</label>
                <select
                  value={netIncomeCommonBasis}
                  onChange={(e) =>
                    setNetIncomeCommonBasis(e.target.value as '' | NetIncomeCommonBasis)
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                >
                  <option value="">غير محدد (BLANK — لا يُفترض التطابق تلقائياً)</option>
                  <option value="explicit_common">explicit_common (مسجل صراحة للشركة الأم)</option>
                  <option value="attested_net_income_equals_common">
                    attested_net_income_equals_common (إقرار صريح بتطابق NetIncomeYTD)
                  </option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">ملاحظة التوثيق (NetIncomeCommon_Note)</label>
                <input
                  type="text"
                  maxLength={400}
                  placeholder="مثال: قوائم مستقلة بدون حقوق أقلية"
                  value={netIncomeCommonNote}
                  onChange={(e) => setNetIncomeCommonNote(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="block text-slate-400 mb-1">ReportedEPS (المعلن)</label>
                <input
                  type="text"
                  data-testid="add-company-reported-eps-input"
                  placeholder="BLANK"
                  value={reportedEps}
                  onChange={(e) => setReportedEps(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">ReportedEPS_Source</label>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="مثال: قوائم مدققة"
                  value={reportedEpsSource}
                  onChange={(e) => setReportedEpsSource(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">IsCapitalActionAdjusted</label>
                <select
                  value={isCapitalActionAdjusted}
                  onChange={(e) => setIsCapitalActionAdjusted(e.target.value as '' | 'true' | 'false')}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                >
                  <option value="">غير محدد (BLANK)</option>
                  <option value="true">TRUE — معدل لأحداث رأس المال</option>
                  <option value="false">FALSE — غير معدل</option>
                </select>
              </div>
              <ReportedEpsPeriodFieldset
                value={reportedEpsPeriodState}
                onChange={setReportedEpsPeriodState}
                recordYear={Number.isInteger(Number(year)) ? Number(year) : null}
                recordQuarter={quarter}
                recordPeriodStartDate={periodStartDate.trim() || null}
                recordPeriodEndDate={periodEndDate.trim() || null}
              />
            </div>
          </div>

          {/* 5. أعمدة FCFF الإضافية */}
          <div className="space-y-2">
            <h4 className="font-bold text-amber-300 text-xs border-b border-slate-800 pb-1">
              5. أعمدة FCFF التقييمية الإضافية (اختيارية — مطلوبة لتفعيل DCF)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">DA_YTD</label>
                <input type="text" placeholder="BLANK" value={daYTD} onChange={(e) => setDaYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">DeltaOperatingNWC_YTD</label>
                <input type="text" placeholder="BLANK" value={deltaOperatingNwcYTD} onChange={(e) => setDeltaOperatingNwcYTD(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">ValuationTaxRate (0..1)</label>
                <input type="text" placeholder="BLANK" value={valuationTaxRate} onChange={(e) => setValuationTaxRate(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200" />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">ValuationSource</label>
                <input type="text" placeholder="مثال: قوائم مالية مدققة 2025" value={valuationSource} onChange={(e) => setValuationSource(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200" />
              </div>
            </div>
          </div>

          {/* 6. إثراء اختياري لبيانات الشركة — القطاع من سجل sectorPE الرسمي فقط */}
          <div className="space-y-2.5 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
            <h4 className="font-bold text-slate-300 text-xs">
              6. إثراء اختياري في مجموعة companies — القطاع يُختار حصراً من السجل الرسمي النشط (sectorPE)
            </h4>

            {sectorRegistryLoading && (
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-sky-300 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>جارٍ تحميل السجل الرسمي للقطاعات (sectorPE) من Firestore...</span>
              </div>
            )}

            {sectorRegistryUnavailable && (
              <div
                role="status"
                className="p-2.5 rounded-lg bg-red-950/50 border border-red-800/70 text-[11px] text-red-200 flex items-start gap-2"
              >
                <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>
                  تعذر تأكيد السجل الرسمي للقطاعات (
                  {sectorPeStatus === 'permission_denied' ? 'لا توجد صلاحية قراءة sectorPE' : 'فشل تحميل sectorPE'}
                  {sectorPeError ? `: ${sectorPeError}` : ''}). يمكنك حفظ السجل المالي الآن وربط القطاع لاحقاً بعد استعادة التحميل، ولن يُصدر تصنيف قطاعي مؤكد قبل ذلك.
                </span>
              </div>
            )}

            {!sectorRegistryLoading && !sectorRegistryUnavailable && sectorPeConfirmed && activeSectors.length === 0 && (
              <div className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-800/60 text-[11px] text-amber-200 flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  سجل القطاعات الرسمي (sectorPE) فارغ من القطاعات النشطة حالياً. يمكنك حفظ السجل المالي الآن وإضافة القطاعات النشطة من لوحة الإدارة.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">القطاع الرسمي النشط (sectorPE)</label>
                <select
                  aria-label="القطاع الرسمي النشط"
                  value={selectedSectorId}
                  onChange={(e) => setSelectedSectorId(e.target.value)}
                  disabled={!canSelectSector}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200 disabled:opacity-50"
                >
                  <option value="">
                    {canSelectSector
                      ? 'بدون ربط قطاعي حالياً (يُربط لاحقاً)'
                      : sectorRegistryLoading
                      ? 'جارٍ التحميل...'
                      : sectorRegistryUnavailable
                      ? 'سجل القطاعات غير مؤكد حالياً'
                      : 'لا توجد قطاعات نشطة في sectorPE'}
                  </option>
                  {activeSectors.map((sec) => (
                    <option key={sec.sectorId} value={sec.sectorId}>
                      {sec.nameAr} — {sec.classification === 'financial' ? 'مالي' : 'غير مالي'} (
                      {sec.multiple !== null ? `${sec.multiple}x` : 'بدون مضاعف'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">التصنيف القطاعي الموثق (من sectorPE)</label>
                <div className="w-full bg-slate-900/90 border border-slate-800 rounded-lg p-2 text-[11px] text-slate-300 min-h-[34px] flex items-center">
                  {selectedSectorDef ? (
                    <span>
                      {selectedSectorDef.classification === 'financial'
                        ? 'قطاع مالي / بنوك (DCF مستبعد)'
                        : 'شركة غير مالية (مؤهلة لـ DCF)'}{' '}
                      · المضاعف:{' '}
                      <span className="font-mono text-emerald-300">
                        {selectedSectorDef.multiple !== null
                          ? `${selectedSectorDef.multiple}x`
                          : 'غير محدد (null — مسموح)'}
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-500">يُشتق تلقائياً عند اختيار قطاع نشط من sectorPE</span>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">الاسم بالإنجليزية</label>
                <input
                  type="text"
                  placeholder="English Name"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">نبذة مختصرة عن النشاط</label>
                <input
                  type="text"
                  placeholder="وصف النشاط..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={handleCloseModal}
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-sm disabled:opacity-50"
            >
              {submitting ? 'جارٍ الحفظ في Firestore...' : 'حفظ السهم وأول سجل مالي'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
