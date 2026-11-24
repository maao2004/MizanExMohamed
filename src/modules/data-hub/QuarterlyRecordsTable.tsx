/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Download, Eye, FileText, Pencil, Search, Trash2 } from 'lucide-react';
import { QuarterlyFinancialRecord, UserRole } from '../../types';
import { inspectWeightedAvgSharesBasis } from '../../core/contracts';
import { sanitizeReadManualCorrections } from '../../core/domain/quarterlyManualAudit';
import { RecordDetailsModal } from './RecordDetailsModal';

interface QuarterlyRecordsTableProps {
  selectedTicker: string;
  records: QuarterlyFinancialRecord[];
  userRole: UserRole;
  onRequestEdit: (record: QuarterlyFinancialRecord) => void;
  onRequestDelete: (target: { ticker: string; year: number; quarter: string }) => void;
  onExportQuarterlyExcel?: () => void;
}

interface QuarterlyDisplayColumn {
  key: string;
  field: string;
  headerAr: string;
  subHeaderEn: string;
  kind: 'number' | 'pct' | 'dps' | 'date' | 'text' | 'boolean' | 'extended';
  align: 'start' | 'end' | 'center';
  accentClass?: string;
}

const CORE_QUARTERLY_COLUMNS: QuarterlyDisplayColumn[] = [
  { key: 'shares', field: 'shares', headerAr: 'الأسهم', subHeaderEn: 'Shares', kind: 'number', align: 'end', accentClass: 'font-bold text-amber-300' },
  { key: 'revenueYTD', field: 'revenueYTD', headerAr: 'الإيرادات', subHeaderEn: 'RevenueYTD', kind: 'number', align: 'end' },
  { key: 'grossProfitYTD', field: 'grossProfitYTD', headerAr: 'مجمل الربح', subHeaderEn: 'GrossProfitYTD', kind: 'number', align: 'end' },
  { key: 'ebitYTD', field: 'ebitYTD', headerAr: 'الربح التشغيلي', subHeaderEn: 'EBIT_YTD', kind: 'number', align: 'end' },
  { key: 'pbtYTD', field: 'pbtYTD', headerAr: 'قبل الضريبة', subHeaderEn: 'PBT_YTD', kind: 'number', align: 'end' },
  { key: 'netIncomeYTD', field: 'netIncomeYTD', headerAr: 'صافي الربح', subHeaderEn: 'NetIncomeYTD', kind: 'number', align: 'end', accentClass: 'font-bold text-emerald-400' },
  { key: 'netIncomeCommonYTD', field: 'netIncomeCommonYTD', headerAr: 'صافي ربح العادي', subHeaderEn: 'NetIncomeCommon_YTD', kind: 'number', align: 'end' },
  { key: 'netIncomeCommonBasis', field: 'netIncomeCommonBasis', headerAr: 'أساس ربح العادي', subHeaderEn: 'NetIncomeCommon_Basis', kind: 'text', align: 'center' },
  { key: 'netIncomeCommonNote', field: 'netIncomeCommonNote', headerAr: 'ملاحظة ربح العادي', subHeaderEn: 'NetIncomeCommon_Note', kind: 'text', align: 'start' },
  { key: 'weightedAvgSharesYTD', field: 'weightedAvgSharesYTD', headerAr: 'متوسط الأسهم المرجح', subHeaderEn: 'WeightedAvgSharesYTD', kind: 'number', align: 'end' },
  { key: 'weightedAvgSharesBasis', field: 'weightedAvgSharesBasis', headerAr: 'أساس متوسط الأسهم', subHeaderEn: 'WeightedAvgShares_Basis', kind: 'text', align: 'center' },
  { key: 'periodStartDate', field: 'periodStartDate', headerAr: 'بداية الفترة', subHeaderEn: 'PeriodStartDate', kind: 'date', align: 'center' },
  { key: 'periodEndDate', field: 'periodEndDate', headerAr: 'نهاية الفترة', subHeaderEn: 'PeriodEndDate', kind: 'date', align: 'center' },
  { key: 'periodDays', field: 'periodDays', headerAr: 'أيام الفترة', subHeaderEn: 'PeriodDays', kind: 'number', align: 'end' },
  { key: 'reportedEps', field: 'reportedEps', headerAr: 'EPS المعلن', subHeaderEn: 'ReportedEPS', kind: 'dps', align: 'end' },
  { key: 'reportedEpsSource', field: 'reportedEpsSource', headerAr: 'مصدر EPS', subHeaderEn: 'ReportedEpsSource', kind: 'text', align: 'start' },
  { key: 'reportedEpsPeriodType', field: 'reportedEpsPeriodType', headerAr: 'نوع فترة EPS', subHeaderEn: 'ReportedEPS_PeriodType', kind: 'text', align: 'center' },
  { key: 'reportedEpsPeriodStart', field: 'reportedEpsPeriodStart', headerAr: 'بداية فترة EPS', subHeaderEn: 'ReportedEPS_PeriodStart', kind: 'date', align: 'center' },
  { key: 'reportedEpsPeriodEnd', field: 'reportedEpsPeriodEnd', headerAr: 'نهاية فترة EPS', subHeaderEn: 'ReportedEPS_PeriodEnd', kind: 'date', align: 'center' },
  { key: 'reportedEpsPeriod', field: 'reportedEpsPeriod', headerAr: 'فترة EPS', subHeaderEn: 'ReportedEpsPeriod', kind: 'text', align: 'start' },
  { key: 'isCapitalActionAdjusted', field: 'isCapitalActionAdjusted', headerAr: 'تعديل رأسمالي', subHeaderEn: 'IsCapitalActionAdjusted', kind: 'boolean', align: 'center' },
  { key: 'ocfYTD', field: 'ocfYTD', headerAr: 'التدفق التشغيلي', subHeaderEn: 'OCF_YTD', kind: 'number', align: 'end' },
  { key: 'capexYTD', field: 'capexYTD', headerAr: 'الإنفاق الرأسمالي', subHeaderEn: 'CapEx_YTD', kind: 'number', align: 'end' },
  { key: 'netInvestingCfYTD', field: 'netInvestingCfYTD', headerAr: 'التدفق الاستثماري', subHeaderEn: 'NetInvestingCF_YTD', kind: 'number', align: 'end' },
  { key: 'depreciationAmortizationYTD', field: 'depreciationAmortizationYTD', headerAr: 'الإهلاك والاستهلاك', subHeaderEn: 'DA_YTD', kind: 'number', align: 'end' },
  { key: 'changeOperatingNwcYTD', field: 'changeOperatingNwcYTD', headerAr: 'تغير رأس المال العامل', subHeaderEn: 'DeltaOperatingNWC_YTD', kind: 'number', align: 'end' },
  { key: 'valuationTaxRate', field: 'valuationTaxRate', headerAr: 'ضريبة التقييم', subHeaderEn: 'ValuationTaxRate', kind: 'pct', align: 'end' },
  { key: 'valuationSource', field: 'valuationSource', headerAr: 'مصدر التقييم', subHeaderEn: 'ValuationSource', kind: 'text', align: 'start' },
  { key: 'financialCurrency', field: 'financialCurrency', headerAr: 'عملة القوائم', subHeaderEn: 'FinancialCurrency', kind: 'text', align: 'center' },
  { key: 'financialUnit', field: 'financialUnit', headerAr: 'وحدة السجل', subHeaderEn: 'FinancialUnit', kind: 'text', align: 'center' },
  { key: 'dividendsPaidYTD', field: 'dividendsPaidYTD', headerAr: 'توزيعات مدفوعة YTD', subHeaderEn: 'DividendsPaidYTD', kind: 'number', align: 'end' },
  { key: 'cash', field: 'cash', headerAr: 'النقدية', subHeaderEn: 'Cash', kind: 'number', align: 'end' },
  { key: 'equity', field: 'equity', headerAr: 'حقوق الملكية', subHeaderEn: 'Equity', kind: 'number', align: 'end', accentClass: 'font-semibold text-sky-400' },
  { key: 'equityCommon', field: 'equityCommon', headerAr: 'حقوق العاديين', subHeaderEn: 'EquityCommon', kind: 'number', align: 'end', accentClass: 'font-semibold text-cyan-300' },
  { key: 'equityCommonBasis', field: 'equityCommonBasis', headerAr: 'أساس حقوق العادي', subHeaderEn: 'EquityCommon_Basis', kind: 'text', align: 'center' },
  { key: 'equityCommonNote', field: 'equityCommonNote', headerAr: 'ملاحظة حقوق العادي', subHeaderEn: 'EquityCommon_Note', kind: 'text', align: 'start' },
  { key: 'totalAssets', field: 'totalAssets', headerAr: 'إجمالي الأصول', subHeaderEn: 'TotalAssets', kind: 'number', align: 'end' },
  { key: 'totalDebtWithoutTX', field: 'totalDebtWithoutTX', headerAr: 'إجمالي الديون', subHeaderEn: 'TotalDebtWithoutTX', kind: 'number', align: 'end' },
  { key: 'totalLiabilities', field: 'totalLiabilities', headerAr: 'إجمالي الالتزامات', subHeaderEn: 'TotalLiabilities', kind: 'number', align: 'end' },
  { key: 'intangibleAssets', field: 'intangibleAssets', headerAr: 'أصول غير ملموسة', subHeaderEn: 'IntangibleAssets', kind: 'number', align: 'end' },
  { key: 'financeCostsYTD', field: 'financeCostsYTD', headerAr: 'تكاليف التمويل', subHeaderEn: 'FinanceCosts_YTD', kind: 'number', align: 'end' },
  { key: 'interestExpenseYTD', field: 'interestExpenseYTD', headerAr: 'مصروف الفائدة', subHeaderEn: 'InterestExpense_YTD', kind: 'number', align: 'end' },
  { key: 'interestIncomeYTD', field: 'interestIncomeYTD', headerAr: 'إيراد الفائدة', subHeaderEn: 'InterestIncome_YTD', kind: 'number', align: 'end' },
  { key: 'taxExpenseYTD', field: 'taxExpenseYTD', headerAr: 'مصروف الضريبة', subHeaderEn: 'TaxExpense_YTD', kind: 'number', align: 'end' },
  { key: 'interestPaidYTD', field: 'interestPaidYTD', headerAr: 'الفوائد المدفوعة', subHeaderEn: 'InterestPaid_YTD', kind: 'number', align: 'end' },
  { key: 'stockName', field: 'stockName', headerAr: 'اسم الشركة', subHeaderEn: 'StockName', kind: 'text', align: 'start' },
  { key: 'dateInsertData', field: 'dateInsertData', headerAr: 'تاريخ الإدخال', subHeaderEn: 'DateInsertData', kind: 'date', align: 'center' },
  { key: 'updatedAt', field: 'updatedAt', headerAr: 'آخر تحديث', subHeaderEn: 'updatedAt', kind: 'date', align: 'center' },
];

const VIRTUAL_THRESHOLD = 60;
const ROW_HEIGHT = 44;
const VIEWPORT_HEIGHT = 520;
const OVERSCAN = 8;

function formatQuarterlyCellValue(
  rawVal: unknown,
  col: QuarterlyDisplayColumn,
  curSuffix: string
): React.ReactNode {
  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return <span className="text-slate-600 italic">BLANK</span>;
  }

  if (typeof rawVal === 'boolean') {
    return (
      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 text-[10px]">
        {rawVal ? 'TRUE' : 'FALSE'}
      </span>
    );
  }

  if (typeof rawVal === 'object') {
    const preview = Array.isArray(rawVal)
      ? `[قائمة: ${rawVal.length}]`
      : `{حقول: ${Object.keys(rawVal as Record<string, unknown>).length}}`;
    return (
      <span
        className="px-1.5 py-0.5 rounded bg-teal-950/60 border border-teal-800/60 text-teal-300 text-[10px]"
        title={JSON.stringify(rawVal)}
      >
        {preview}
      </span>
    );
  }

  if (typeof rawVal === 'number') {
    if (!Number.isFinite(rawVal)) {
      return <span className="text-red-400 italic">غير صالح</span>;
    }
    if (rawVal === 0) {
      return (
        <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-100 font-semibold">
          {col.kind === 'pct' ? '0.00%' : '0'}
        </span>
      );
    }
    if (col.kind === 'pct') {
      return <span>{(rawVal * 100).toFixed(2)}%</span>;
    }
    if (col.kind === 'dps') {
      return (
        <span>
          {rawVal.toFixed(2)}
          {curSuffix ? ` ${curSuffix}` : ''}
        </span>
      );
    }
    return <span>{rawVal.toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>;
  }

  if (col.field === 'weightedAvgSharesBasis') {
    const inspected = inspectWeightedAvgSharesBasis(rawVal);
    if (inspected.status === 'valid' && inspected.option) {
      return (
        <span
          className="text-slate-200"
          title={`${inspected.option.labelAr} — ${inspected.option.meaningAr}`}
        >
          <span className="font-mono">{inspected.option.code}</span>
          <span className="text-[10px] text-slate-400 block">{inspected.option.shortLabelAr}</span>
        </span>
      );
    }
    if (inspected.status === 'unrecognized') {
      return (
        <span
          className="text-amber-300 font-mono"
          title="قيمة محفوظة غير معروفة — لم تُغيَّر تلقائياً"
        >
          {inspected.rawValue}
        </span>
      );
    }
  }

  return <span className="text-slate-300">{String(rawVal)}</span>;
}

export const QuarterlyRecordsTable: React.FC<QuarterlyRecordsTableProps> = ({
  selectedTicker,
  records,
  userRole,
  onRequestEdit,
  onRequestDelete,
  onExportQuarterlyExcel,
}) => {
  const [columnQuery, setColumnQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [inspectRecord, setInspectRecord] = useState<QuarterlyFinancialRecord | null>(null);

  const rowCurrencySuffix = (q: QuarterlyFinancialRecord): string => {
    if (q.financialCurrency === 'USD' || q.financialUnit?.toUpperCase().startsWith('USD')) return 'USD';
    return 'ج.م';
  };

  const allColumns = useMemo<QuarterlyDisplayColumn[]>(() => {
    const coreKeySet = new Set<string>([
      ...CORE_QUARTERLY_COLUMNS.map((c) => c.field),
      'id',
      'ticker',
      'year',
      'quarter',
      'yearQuarter',
      'extendedFields',
      'originalValues',
      'manualCorrections',
      'contentHash',
      'serverUpdatedAt',
      'updatedBy',
      'importId',
      'sourceFile',
      'sourceSheet',
      'sourceRow',
      'schemaVersion',
      'isDeleted',
      'dpsCurrent',
      'DPS_Current',
      'dps_current',
    ]);
    const extKeys = new Set<string>();
    const extraTopKeys = new Set<string>();
    for (const r of records) {
      if (r.extendedFields && typeof r.extendedFields === 'object') {
        for (const k of Object.keys(r.extendedFields)) {
          if (k !== 'dpsCurrent' && k !== 'DPS_Current' && k !== 'dps_current') {
            extKeys.add(k);
          }
        }
      }
      for (const k of Object.keys(r)) {
        if (!coreKeySet.has(k) && (r as unknown as Record<string, unknown>)[k] !== undefined) {
          extraTopKeys.add(k);
        }
      }
    }
    const extColumns: QuarterlyDisplayColumn[] = Array.from(extKeys)
      .sort((a, b) => a.localeCompare(b))
      .map((extKey) => ({
        key: `ext:${extKey}`,
        field: extKey,
        headerAr: `حقل ممتد: ${extKey}`,
        subHeaderEn: `extendedFields.${extKey}`,
        kind: 'extended',
        align: 'start',
        accentClass: 'text-teal-300',
      }));
    const extraTopColumns: QuarterlyDisplayColumn[] = Array.from(extraTopKeys)
      .sort((a, b) => a.localeCompare(b))
      .map((extraKey) => ({
        key: `extra:${extraKey}`,
        field: extraKey,
        headerAr: `حقل إضافي: ${extraKey}`,
        subHeaderEn: `extra.${extraKey}`,
        kind: 'text',
        align: 'start',
        accentClass: 'text-amber-200',
      }));
    return [...CORE_QUARTERLY_COLUMNS, ...extColumns, ...extraTopColumns];
  }, [records]);

  const filteredColumns = useMemo(() => {
    const q = columnQuery.trim().toLowerCase();
    if (!q) return allColumns;
    return allColumns.filter(
      (col) =>
        col.headerAr.toLowerCase().includes(q) ||
        col.subHeaderEn.toLowerCase().includes(q) ||
        col.field.toLowerCase().includes(q)
    );
  }, [allColumns, columnQuery]);

  const useVirtual = records.length > VIRTUAL_THRESHOLD;
  const visibleWindow = useMemo(() => {
    if (!useVirtual) {
      return {
        startIndex: 0,
        endIndex: records.length,
        padTop: 0,
        padBottom: 0,
      };
    }
    const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT);
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIndex = Math.min(records.length, startIndex + visibleCount + OVERSCAN * 2);
    return {
      startIndex,
      endIndex,
      padTop: startIndex * ROW_HEIGHT,
      padBottom: Math.max(0, (records.length - endIndex) * ROW_HEIGHT),
    };
  }, [records.length, scrollTop, useVirtual]);

  const displayedRows = useMemo(
    () => records.slice(visibleWindow.startIndex, visibleWindow.endIndex),
    [records, visibleWindow.startIndex, visibleWindow.endIndex]
  );

  const unitNote = records.some(
    (r) => r.financialCurrency === 'USD' || r.financialUnit?.toUpperCase().startsWith('USD')
  )
    ? 'تُعرض المبالغ بقيمتها الأساسية كما أُدخلت (بالجنيه المصري أو الدولار حسب عملة السجل).'
    : 'تُعرض المبالغ بقيمتها الأساسية كما أُدخلت (الافتراضي بالجنيه المصري).';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-sm overflow-hidden p-5 space-y-4">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">
              القوائم المالية الربع سنوية الشاملة لسهم {selectedTicker}
            </h3>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            عرض موحّد لكافة الحقول المحفوظة وحقول FCFF وEPS والحقول الإضافية الممتدة ({allColumns.length} عموداً). {unitNote}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onExportQuarterlyExcel && records.length > 0 && (
            <button
              type="button"
              onClick={onExportQuarterlyExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-emerald-300 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير Excel الشامل ({allColumns.length} عموداً)</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 text-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={columnQuery}
            onChange={(e) => setColumnQuery(e.target.value)}
            placeholder="ابحث باسم العمود (مثل: EBIT، DA_YTD، ReportedEPS، extendedFields)..."
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pr-8 pl-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="text-[11px] text-slate-400 font-mono">
          يُعرض {filteredColumns.length} من أصل {allColumns.length} عموداً · عدد الفترات: {records.length}
        </div>
      </div>

      <div
        className={`overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700 ${
          useVirtual ? 'max-h-[520px] overflow-y-auto' : ''
        }`}
        onScroll={(e) => {
          if (useVirtual) {
            setScrollTop(e.currentTarget.scrollTop);
          }
        }}
      >
        <table className="w-full text-xs text-start whitespace-nowrap divide-y divide-slate-800">
          <thead className="bg-slate-950 text-slate-400 sticky top-0 z-20">
            <tr>
              <th className="p-3 text-start sticky right-0 bg-slate-950 z-30 border-b border-slate-800">
                السنة والربع
              </th>
              {filteredColumns.map((col) => (
                <th
                  key={col.key}
                  className={`p-3 font-mono border-b border-slate-800 ${
                    col.align === 'end' ? 'text-end' : col.align === 'center' ? 'text-center' : 'text-start'
                  }`}
                  title={col.subHeaderEn}
                >
                  <div className="flex flex-col">
                    <span className={col.kind === 'extended' ? 'text-teal-300' : 'text-slate-200'}>
                      {col.headerAr}
                    </span>
                    <span className="text-[10px] text-slate-500">{col.subHeaderEn}</span>
                  </div>
                </th>
              ))}
              <th className="p-3 text-center sticky left-0 bg-slate-950 z-30 border-b border-slate-800">
                إجراءات
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 font-mono tabular-nums">
            {records.length === 0 ? (
              <tr>
                <td colSpan={filteredColumns.length + 2} className="p-8 text-center text-slate-400 font-sans">
                  لا توجد قوائم مالية مسجلة بعد لهذا السهم. ارفع ملف `QuarterlyFinancialsData.xlsx` لبدء التحليل وتغذية قاعدة البيانات.
                </td>
              </tr>
            ) : (
              <>
                {visibleWindow.padTop > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={filteredColumns.length + 2} style={{ height: `${visibleWindow.padTop}px`, padding: 0 }} />
                  </tr>
                )}
                {displayedRows.map((q) => {
                  const curSuffix = rowCurrencySuffix(q);
                  const activeCorrections = sanitizeReadManualCorrections(q.manualCorrections);
                  const correctionsCount = activeCorrections ? Object.keys(activeCorrections).length : 0;
                  return (
                    <tr
                      key={`${q.ticker}_${q.year}_${q.quarter}`}
                      className="hover:bg-slate-800/40 transition-colors"
                      style={useVirtual ? { height: `${ROW_HEIGHT}px` } : undefined}
                    >
                      <td className="p-3 font-bold text-slate-200 sticky right-0 bg-slate-900/95 z-10 border-l border-slate-800/60">
                        <div className="flex items-center gap-1.5">
                          <span>
                            {q.quarter} {q.year}
                          </span>
                          {correctionsCount > 0 && (
                            <span
                              className="text-[9px] px-1 py-0.5 rounded bg-amber-950/70 border border-amber-700/60 text-amber-300"
                              title={`يحتوي ${correctionsCount} تعديلاً يدوياً موثقاً`}
                            >
                              معدّل ({correctionsCount})
                            </span>
                          )}
                        </div>
                      </td>

                      {filteredColumns.map((col) => {
                        const rawVal =
                          col.kind === 'extended'
                            ? q.extendedFields?.[col.field]
                            : (q as Record<string, any>)[col.field];
                        const manualCorrection = activeCorrections?.[col.field] ?? null;
                        const origVal = manualCorrection?.originalValue ?? q.originalValues?.[col.field];
                        return (
                          <td
                            key={col.key}
                            className={`p-3 ${
                              col.align === 'end' ? 'text-end' : col.align === 'center' ? 'text-center' : 'text-start'
                            } ${col.accentClass ?? ''}`}
                            title={
                              manualCorrection
                                ? `تعديل يدوي موثق · القيمة الأصلية: ${String(origVal ?? 'BLANK')}`
                                : col.field === 'dividendsPaidYTD'
                                ? 'قيمة تراكمية لا تُجمع عبر الأرباع'
                                : undefined
                            }
                          >
                            <div className="inline-flex items-center gap-1">
                              {formatQuarterlyCellValue(rawVal, col, curSuffix)}
                              {manualCorrection && (
                                <span className="text-[9px] px-1 rounded bg-amber-950/70 border border-amber-700/60 text-amber-300">
                                  معدّل
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}

                      <td className="p-3 text-center sticky left-0 bg-slate-900/95 z-10 border-r border-slate-800/60">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setInspectRecord(q)}
                            className="p-1.5 rounded-lg text-sky-400 hover:text-white hover:bg-sky-600/80 transition-colors"
                            title="تفاصيل السجل الكاملة والحقول المتداخلة"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onRequestEdit(q)}
                            className="p-1.5 rounded-lg text-emerald-400 hover:text-white hover:bg-emerald-600/80 transition-colors"
                            title="تعديل هذا الربع المالي وتحديث قاعدة البيانات"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          {userRole === 'admin' && (
                            <button
                              type="button"
                              onClick={() => onRequestDelete({ ticker: q.ticker, year: q.year, quarter: q.quarter })}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                              title="حذف هذا الربع المالي"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleWindow.padBottom > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={filteredColumns.length + 2} style={{ height: `${visibleWindow.padBottom}px`, padding: 0 }} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      <RecordDetailsModal
        isOpen={Boolean(inspectRecord)}
        onClose={() => setInspectRecord(null)}
        title={
          inspectRecord
            ? `تفاصيل القائمة المالية — ${inspectRecord.ticker} (${inspectRecord.quarter} ${inspectRecord.year})`
            : ''
        }
        subtitle="عرض كامل لجميع الحقول المحفوظة، الحقول الممتدة، وسجل التعديلات اليدوية دون أي استعلام إضافي"
        record={inspectRecord}
      />
    </div>
  );
};
