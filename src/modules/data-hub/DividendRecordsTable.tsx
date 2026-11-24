/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { CalendarCheck2, Coins, Pencil, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import {
  DividendApprovalStatus,
  DividendDistributionSemantics,
  DividendRecord,
  DividendYearStatusRecord,
  DividendYearStatusValue,
  UserRole,
} from '../../types';
import {
  buildDividendDocId,
  buildDividendYearStatusDocId,
  isActiveDividendRecordForConflict,
  tryNormalizedTicker,
  validateDividendYearStatusPayload,
} from '../../core/contracts';

interface DividendRecordsTableProps {
  records: DividendRecord[];
  dividendYearStatuses?: DividendYearStatusRecord[];
  availableTickers?: string[];
  selectedBaseTicker: string;
  userRole: UserRole;
  canEdit?: boolean;
  onRequestAdd?: () => void;
  onRequestEdit?: (record: DividendRecord) => void;
  onRequestDelete?: (
    target: Pick<DividendRecord, 'ticker' | 'fiscalYear' | 'recordType' | 'distributionId'>
  ) => void;
  onSaveDividendYearStatus?: (record: DividendYearStatusRecord) => void | Promise<void>;
  onDeleteDividendYearStatus?: (ticker: string, fiscalYear: number) => void | Promise<void>;
}

const SEMANTICS_LABEL_AR: Record<DividendDistributionSemantics, string> = {
  annual_total: 'إجمالي سنوي',
  standalone_event: 'حدث منفرد',
  installment: 'قسط / دفعة',
};

const APPROVAL_BADGE: Record<DividendApprovalStatus, { label: string; cls: string }> = {
  approved: {
    label: 'معتمد',
    cls: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60',
  },
  paid: {
    label: 'مدفوع',
    cls: 'bg-sky-950/70 text-sky-300 border-sky-800/60',
  },
  proposed: {
    label: 'مقترح',
    cls: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
  },
  cancelled: {
    label: 'ملغى (مستبعد)',
    cls: 'bg-red-950/60 text-red-300 border-red-800/60',
  },
};

const YEAR_STATUS_BADGE: Record<DividendYearStatusValue, { label: string; cls: string }> = {
  unknown: {
    label: 'غير مؤكد (unknown)',
    cls: 'bg-slate-800 text-amber-300 border-slate-700',
  },
  partial: {
    label: 'جزئي (partial)',
    cls: 'bg-amber-950/60 text-amber-300 border-amber-800/60',
  },
  complete: {
    label: 'مكتمل (complete)',
    cls: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60',
  },
  confirmed_no_dividend: {
    label: 'لا توزيع مؤكد (confirmed_no_dividend)',
    cls: 'bg-sky-950/70 text-sky-300 border-sky-800/60',
  },
};

export const DividendRecordsTable: React.FC<DividendRecordsTableProps> = ({
  records,
  dividendYearStatuses = [],
  availableTickers = [],
  selectedBaseTicker,
  userRole,
  canEdit = false,
  onRequestAdd,
  onRequestEdit,
  onRequestDelete,
  onSaveDividendYearStatus,
  onDeleteDividendYearStatus,
}) => {
  const [filterScope, setFilterScope] = useState<'selected' | 'all'>(
    selectedBaseTicker ? 'selected' : 'all'
  );
  const [showCancelled, setShowCancelled] = useState<boolean>(true);

  const defaultYear = useMemo(() => new Date().getFullYear() - 1, []);
  const [statusTicker, setStatusTicker] = useState<string>(selectedBaseTicker || availableTickers[0] || '');
  const [statusFiscalYear, setStatusFiscalYear] = useState<string>(String(defaultYear));
  const [statusValue, setStatusValue] = useState<DividendYearStatusValue>('complete');
  const [statusConfirmedSource, setStatusConfirmedSource] = useState<string>('');
  const [statusConfirmedAt, setStatusConfirmedAt] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [statusNotes, setStatusNotes] = useState<string>('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSuccess, setStatusSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (selectedBaseTicker && !statusTicker) {
      setStatusTicker(selectedBaseTicker);
    }
  }, [selectedBaseTicker, statusTicker]);

  const visibleRecords = useMemo(() => {
    const filtered = records.filter((rec) => {
      if (rec.isDeleted === true) return false;
      if (!showCancelled && rec.approvalStatus === 'cancelled') return false;
      if (filterScope === 'selected' && selectedBaseTicker) {
        const tk = tryNormalizedTicker(rec.ticker) ?? rec.ticker;
        return tk === selectedBaseTicker;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (b.fiscalYear !== a.fiscalYear) return b.fiscalYear - a.fiscalYear;
      const dateCmp = (b.asOfDate || '').localeCompare(a.asOfDate || '');
      if (dateCmp !== 0) return dateCmp;
      return a.ticker.localeCompare(b.ticker);
    });
  }, [records, filterScope, selectedBaseTicker, showCancelled]);

  const visibleYearStatuses = useMemo(() => {
    const filtered = dividendYearStatuses.filter((item) => {
      if (item.isDeleted === true) return false;
      if (filterScope === 'selected' && selectedBaseTicker) {
        const tk = tryNormalizedTicker(item.ticker) ?? item.ticker;
        return tk === selectedBaseTicker;
      }
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (b.fiscalYear !== a.fiscalYear) return b.fiscalYear - a.fiscalYear;
      return a.ticker.localeCompare(b.ticker);
    });
  }, [dividendYearStatuses, filterScope, selectedBaseTicker]);

  const handleLoadStatusIntoForm = (item: DividendYearStatusRecord) => {
    setStatusTicker(tryNormalizedTicker(item.ticker) ?? item.ticker);
    setStatusFiscalYear(String(item.fiscalYear));
    setStatusValue(item.status);
    setStatusConfirmedSource(item.confirmedSource ?? '');
    setStatusConfirmedAt(item.confirmedAt ?? new Date().toISOString().slice(0, 10));
    setStatusNotes(item.notes ?? '');
    setStatusError(null);
    setStatusSuccess(null);
  };

  const handleSubmitYearStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSaveDividendYearStatus) return;
    setStatusError(null);
    setStatusSuccess(null);

    try {
      const validated = validateDividendYearStatusPayload({
        ticker: statusTicker || selectedBaseTicker,
        fiscalYear: Number(statusFiscalYear),
        status: statusValue,
        confirmedSource: statusConfirmedSource,
        confirmedAt: statusConfirmedAt || null,
        notes: statusNotes || null,
      });

      if (validated.status === 'confirmed_no_dividend') {
        const conflictingRecord = records.find((rec) => {
          const recTk = tryNormalizedTicker(rec.ticker) ?? rec.ticker;
          return (
            recTk === validated.ticker &&
            rec.fiscalYear === validated.fiscalYear &&
            isActiveDividendRecordForConflict(rec)
          );
        });
        if (conflictingRecord) {
          throw new Error(
            `لا يمكن اعتماد confirmed_no_dividend للسهم ${validated.ticker} لعام ${validated.fiscalYear} لوجود سجل توزيع نشط (${conflictingRecord.distributionId} - ${conflictingRecord.approvalStatus}).`
          );
        }
      }

      setStatusBusy(true);
      await onSaveDividendYearStatus({
        id: buildDividendYearStatusDocId(validated.ticker, validated.fiscalYear),
        ...validated,
      });
      setStatusSuccess(
        `تم حفظ حالة اكتمال توزيعات ${validated.ticker} لعام ${validated.fiscalYear} (${YEAR_STATUS_BADGE[validated.status].label}).`
      );
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'تعذر حفظ حالة اكتمال توزيعات السنة.');
    } finally {
      setStatusBusy(false);
    }
  };

  const handleDeleteYearStatus = async (ticker: string, fiscalYear: number) => {
    if (!onDeleteDividendYearStatus) return;
    setStatusError(null);
    setStatusSuccess(null);
    setStatusBusy(true);
    try {
      await onDeleteDividendYearStatus(ticker, fiscalYear);
      setStatusSuccess(`تم حذف حالة توزيعات ${ticker} لعام ${fiscalYear}.`);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'تعذر حذف حالة اكتمال توزيعات السنة.');
    } finally {
      setStatusBusy(false);
    }
  };

  const showActionsCol = (canEdit && Boolean(onRequestEdit)) || (userRole === 'admin' && Boolean(onRequestDelete));
  const showYearStatusActions =
    (canEdit && Boolean(onSaveDividendYearStatus)) ||
    (userRole === 'admin' && Boolean(onDeleteDividendYearStatus));

  return (
    <div className="space-y-5">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">
                سجلات التوزيعات النقدية الفعلية (DPS_Actual / dividend_records)
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              توزيعات <span className="font-mono">regular</span> تغذي DDM فقط (بما فيها الصفر 0 المؤكد) · توزيعات{' '}
              <span className="font-mono">special</span> مستبعدة من DDM وتدخل في إجمالي التوزيعات ونسبة التوزيع التاريخية.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {selectedBaseTicker && (
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => setFilterScope('selected')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                    filterScope === 'selected'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {selectedBaseTicker} فقط
                </button>
                <button
                  type="button"
                  onClick={() => setFilterScope('all')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                    filterScope === 'all'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  جميع الأسهم ({records.length})
                </button>
              </div>
            )}

            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showCancelled}
                onChange={(e) => setShowCancelled(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-emerald-500"
              />
              <span>إظهار الملغاة</span>
            </label>

            {canEdit && onRequestAdd && (
              <button
                type="button"
                onClick={onRequestAdd}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة توزيع</span>
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3 text-start">الرمز</th>
                <th className="p-3 text-center">السنة</th>
                <th className="p-3 text-center">النوع</th>
                <th className="p-3 text-end font-mono">CashDPS</th>
                <th className="p-3 text-center">تاريخ السريان / الحق</th>
                <th className="p-3 text-start">الدلالة ومنع الازدواج</th>
                <th className="p-3 text-center">الحالة</th>
                <th className="p-3 text-end font-mono">إجمالي التوزيع</th>
                <th className="p-3 text-start">العملة والمصدر</th>
                {showActionsCol && <th className="p-3 text-center">إجراء</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
              {visibleRecords.length === 0 ? (
                <tr>
                  <td colSpan={showActionsCol ? 10 : 9} className="p-8 text-center text-slate-400">
                    لا توجد سجلات توزيعات مطابقة في <span className="font-mono">dividend_records</span>.
                  </td>
                </tr>
              ) : (
                visibleRecords.map((rec) => {
                  const tk = tryNormalizedTicker(rec.ticker) ?? rec.ticker;
                  const isSelected = Boolean(selectedBaseTicker && tk === selectedBaseTicker);
                  let rowKey = `${tk}_${rec.fiscalYear}_${rec.recordType}_${rec.distributionId}`;
                  try {
                    rowKey = buildDividendDocId({
                      ticker: tk,
                      fiscalYear: rec.fiscalYear,
                      recordType: rec.recordType,
                      distributionId: rec.distributionId,
                    });
                  } catch {
                    // fallback key
                  }
                  const approvalBadge = APPROVAL_BADGE[rec.approvalStatus] ?? APPROVAL_BADGE.approved;

                  return (
                    <tr
                      key={rowKey}
                      className={
                        isSelected
                          ? 'bg-emerald-950/20 hover:bg-emerald-950/30'
                          : 'hover:bg-slate-800/40'
                      }
                    >
                      <td className="p-3 font-mono font-bold text-white">{tk}</td>
                      <td className="p-3 text-center font-mono text-slate-200">{rec.fiscalYear}</td>
                      <td className="p-3 text-center">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${
                            rec.recordType === 'special'
                              ? 'bg-purple-950/60 text-purple-300 border-purple-800/60'
                              : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                          }`}
                        >
                          {rec.recordType === 'special' ? 'استثنائي (special)' : 'عادي (regular)'}
                        </span>
                      </td>
                      <td className="p-3 text-end font-mono tabular-nums font-bold">
                        {rec.cashDps === 0 ? (
                          <span className="text-amber-300" title="توزيع صفري مؤكد">
                            0.00 (صفري مؤكد)
                          </span>
                        ) : (
                          <span className="text-emerald-400">
                            {rec.cashDps.toFixed(4).replace(/\.?0+$/, (m) => (m.length > 2 ? '.00' : m))}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center font-mono text-[11px] text-slate-300">
                        <div>{rec.asOfDate}</div>
                        {(rec.exDividendDate || rec.recordDate || rec.paymentDate) && (
                          <div className="text-[10px] text-slate-400">
                            {rec.recordDate
                              ? `تسجيل: ${rec.recordDate}`
                              : rec.exDividendDate
                              ? `حق: ${rec.exDividendDate}`
                              : `صرف: ${rec.paymentDate}`}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-[11px]">
                        <div className="text-slate-200 font-semibold">
                          {SEMANTICS_LABEL_AR[rec.distributionSemantics] ?? rec.distributionSemantics}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          ID: {rec.distributionId}
                          {rec.parentAnnouncementId ? ` · أب: ${rec.parentAnnouncementId}` : ''}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded border ${approvalBadge.cls}`}>
                          {approvalBadge.label}
                        </span>
                      </td>
                      <td className="p-3 text-end font-mono tabular-nums text-slate-300">
                        {rec.totalDistributionAmount !== null && rec.totalDistributionAmount !== undefined
                          ? rec.totalDistributionAmount.toLocaleString('ar-EG', { maximumFractionDigits: 2 })
                          : 'مشتق/BLANK'}
                      </td>
                      <td className="p-3 text-[11px] text-slate-400">
                        <span className="font-mono text-slate-300">{rec.currency ?? 'تبع القوائم'}</span>
                        {rec.source ? ` · ${rec.source}` : ''}
                      </td>
                      {showActionsCol && (
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {canEdit && onRequestEdit && (
                              <button
                                type="button"
                                onClick={() => onRequestEdit(rec)}
                                className="p-1.5 rounded-lg text-emerald-400 hover:text-white hover:bg-emerald-600/80 transition-colors"
                                title="تعديل سجل التوزيع"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {userRole === 'admin' && onRequestDelete && (
                              <button
                                type="button"
                                onClick={() =>
                                  onRequestDelete({
                                    ticker: tk,
                                    fiscalYear: rec.fiscalYear,
                                    recordType: rec.recordType,
                                    distributionId: rec.distributionId,
                                  })
                                }
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                                title="حذف سجل التوزيع"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Annual Dividend Completeness Governance Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <CalendarCheck2 className="w-4 h-4 text-sky-400" />
              <h3 className="text-sm font-bold text-white">
                حالة اكتمال توزيعات السنة (dividend_year_statuses)
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              غياب سجلات التوزيعات يُعد <span className="font-mono text-amber-300">unknown</span> ولا يُفترض أنه{' '}
              <span className="font-mono">complete</span> أو <span className="font-mono">confirmed_no_dividend</span> تلقائياً.
              السنة غير المكتملة (<span className="font-mono">unknown</span> / <span className="font-mono">partial</span>) لا تُغذي الاحتجاز التاريخي الرسمي أو نموذج RIM.
            </p>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            السجلات المعروضة: {visibleYearStatuses.length}
          </div>
        </div>

        {statusError && (
          <div className="flex items-start gap-2 rounded-xl border border-red-800/60 bg-red-950/40 p-3 text-xs text-red-200">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{statusError}</span>
          </div>
        )}
        {statusSuccess && (
          <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/40 p-3 text-xs text-emerald-200">
            {statusSuccess}
          </div>
        )}

        {canEdit && onSaveDividendYearStatus && (
          <form
            onSubmit={handleSubmitYearStatus}
            className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-slate-950/70 border border-slate-800 rounded-xl p-4 text-xs"
          >
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">رمز السهم (Ticker)</label>
              <input
                type="text"
                list="dividend-year-status-tickers"
                value={statusTicker}
                onChange={(e) => setStatusTicker(e.target.value.toUpperCase())}
                placeholder="مثال: COMI"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white"
                required
              />
              {availableTickers.length > 0 && (
                <datalist id="dividend-year-status-tickers">
                  {availableTickers.map((tk) => (
                    <option key={tk} value={tryNormalizedTicker(tk) ?? tk} />
                  ))}
                </datalist>
              )}
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">السنة المالية</label>
              <input
                type="number"
                min={1900}
                max={2200}
                value={statusFiscalYear}
                onChange={(e) => setStatusFiscalYear(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">حالة اكتمال السنة</label>
              <select
                value={statusValue}
                onChange={(e) => setStatusValue(e.target.value as DividendYearStatusValue)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
              >
                <option value="unknown">unknown — غير مؤكد</option>
                <option value="partial">partial — جزئي</option>
                <option value="complete">complete — مكتمل</option>
                <option value="confirmed_no_dividend">confirmed_no_dividend — لا توزيع مؤكد</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">مصدر التأكيد (confirmedSource)</label>
              <input
                type="text"
                value={statusConfirmedSource}
                onChange={(e) => setStatusConfirmedSource(e.target.value)}
                placeholder="مثال: قرار الجمعية العامة"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">تاريخ التأكيد (YYYY-MM-DD)</label>
              <input
                type="date"
                value={statusConfirmedAt}
                onChange={(e) => setStatusConfirmedAt(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-white"
              />
            </div>

            <div className="flex flex-col justify-between gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">ملاحظات (اختياري)</label>
                <input
                  type="text"
                  value={statusNotes}
                  onChange={(e) => setStatusNotes(e.target.value)}
                  placeholder="تفاصيل موثقة"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
                />
              </div>
              <button
                type="submit"
                disabled={statusBusy}
                className="w-full px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold transition-colors"
              >
                {statusBusy ? 'جارٍ الحفظ...' : 'حفظ / تحديث حالة السنة'}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3 text-start">الرمز</th>
                <th className="p-3 text-center">السنة</th>
                <th className="p-3 text-center">حالة الاكتمال</th>
                <th className="p-3 text-start">مصدر التأكيد (confirmedSource)</th>
                <th className="p-3 text-center">تاريخ التأكيد (confirmedAt)</th>
                <th className="p-3 text-start">الملاحظات</th>
                {showYearStatusActions && <th className="p-3 text-center">إجراء</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
              {visibleYearStatuses.length === 0 ? (
                <tr>
                  <td colSpan={showYearStatusActions ? 7 : 6} className="p-6 text-center text-slate-400">
                    لا توجد حالات سنوية مسجلة في <span className="font-mono">dividend_year_statuses</span> ضمن هذا النطاق؛ السنوات غير المسجلة تُعامل تلقائياً كـ{' '}
                    <span className="font-mono text-amber-300">unknown</span>.
                  </td>
                </tr>
              ) : (
                visibleYearStatuses.map((item) => {
                  const tk = tryNormalizedTicker(item.ticker) ?? item.ticker;
                  const badge = YEAR_STATUS_BADGE[item.status] ?? YEAR_STATUS_BADGE.unknown;
                  return (
                    <tr key={`${tk}_${item.fiscalYear}`} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono font-bold text-white">{tk}</td>
                      <td className="p-3 text-center font-mono text-slate-200">{item.fiscalYear}</td>
                      <td className="p-3 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="p-3 text-slate-200">{item.confirmedSource ?? '—'}</td>
                      <td className="p-3 text-center font-mono text-slate-300">{item.confirmedAt ?? '—'}</td>
                      <td className="p-3 text-slate-400">{item.notes ?? '—'}</td>
                      {showYearStatusActions && (
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {canEdit && onSaveDividendYearStatus && (
                              <button
                                type="button"
                                onClick={() => handleLoadStatusIntoForm(item)}
                                className="p-1.5 rounded-lg text-sky-400 hover:text-white hover:bg-sky-600/80 transition-colors"
                                title="تحرير حالة السنة في النموذج"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {userRole === 'admin' && onDeleteDividendYearStatus && (
                              <button
                                type="button"
                                disabled={statusBusy}
                                onClick={() => void handleDeleteYearStatus(tk, item.fiscalYear)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-colors disabled:opacity-50"
                                title="حذف حالة السنة"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

