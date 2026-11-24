/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AlertCircle, Coins, Save, X } from 'lucide-react';
import {
  CurrencyCode,
  DividendApprovalStatus,
  DividendDistributionSemantics,
  DividendRecord,
  DividendRecordType,
} from '../../types';
import { normalizedTicker, sanitizeDistributionId } from '../../core/contracts';

interface EditDividendRecordModalProps {
  isOpen: boolean;
  onClose: () => void | Promise<void>;
  record?: DividendRecord | null;
  defaultTicker?: string;
  isNew?: boolean;
  onSave: (record: DividendRecord) => void | Promise<void>;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidStrictDate(dateStr: string): boolean {
  if (!DATE_REGEX.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const EditDividendRecordModal: React.FC<EditDividendRecordModalProps> = ({
  isOpen,
  onClose,
  record = null,
  defaultTicker = '',
  isNew = false,
  onSave,
}) => {
  const initialToday = new Date().toISOString().slice(0, 10);
  const [ticker, setTicker] = useState<string>(record?.ticker ?? defaultTicker);
  const [fiscalYearStr, setFiscalYearStr] = useState<string>(
    record ? String(record.fiscalYear) : String(new Date().getFullYear() - 1)
  );
  const [cashDpsStr, setCashDpsStr] = useState<string>(
    record !== null && record !== undefined ? String(record.cashDps) : ''
  );
  const [asOfDate, setAsOfDate] = useState<string>(record?.asOfDate ?? initialToday);
  const [recordType, setRecordType] = useState<DividendRecordType>(record?.recordType ?? 'regular');
  const [approvalStatus, setApprovalStatus] = useState<DividendApprovalStatus>(
    record?.approvalStatus ?? 'approved'
  );
  const [distributionSemantics, setDistributionSemantics] = useState<DividendDistributionSemantics>(
    record?.distributionSemantics ?? 'standalone_event'
  );
  const [distributionId, setDistributionId] = useState<string>(record?.distributionId ?? '');
  const [parentAnnouncementId, setParentAnnouncementId] = useState<string>(
    record?.parentAnnouncementId ?? ''
  );
  const [exDividendDate, setExDividendDate] = useState<string>(record?.exDividendDate ?? '');
  const [paymentDate, setPaymentDate] = useState<string>(record?.paymentDate ?? '');
  const [recordDate, setRecordDate] = useState<string>(record?.recordDate ?? '');
  const [totalAmountStr, setTotalAmountStr] = useState<string>(
    record?.totalDistributionAmount !== null && record?.totalDistributionAmount !== undefined
      ? String(record.totalDistributionAmount)
      : ''
  );
  const [eligibleSharesStr, setEligibleSharesStr] = useState<string>(
    record?.eligibleSharesCount !== null && record?.eligibleSharesCount !== undefined
      ? String(record.eligibleSharesCount)
      : ''
  );
  const [currency, setCurrency] = useState<'' | CurrencyCode>(record?.currency ?? '');
  const [source, setSource] = useState<string>(record?.source ?? '');
  const [notes, setNotes] = useState<string>(record?.notes ?? '');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const isEditingExisting = !isNew && Boolean(record);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    let canonicalTicker: string;
    try {
      canonicalTicker = normalizedTicker(ticker);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'رمز السهم غير صالح.');
      return;
    }

    const fiscalYear = Number(fiscalYearStr.trim());
    if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200) {
      setErrorMsg('السنة المالية مطلوبة كرقم صحيح بين 1900 و 2200.');
      return;
    }

    const dpsTrimmed = cashDpsStr.trim();
    if (dpsTrimmed === '') {
      setErrorMsg('التوزيع النقدي للسهم (CashDPS) مطلوب؛ أدخل 0 إذا كان التوزيع صفرياً مؤكداً.');
      return;
    }
    const cashDpsRaw = Number(dpsTrimmed);
    if (!Number.isFinite(cashDpsRaw) || cashDpsRaw < 0) {
      setErrorMsg('قيمة CashDPS يجب أن تكون رقماً غير سالب (>= 0).');
      return;
    }
    const cashDps = Object.is(cashDpsRaw, -0) ? 0 : cashDpsRaw;

    if (!isValidStrictDate(asOfDate.trim())) {
      setErrorMsg('تاريخ السريان (AsOfDate) مطلوب بصيغة YYYY-MM-DD صالحة.');
      return;
    }

    const checkOptionalDate = (val: string, label: string): string | null => {
      const t = val.trim();
      if (!t) return null;
      if (!isValidStrictDate(t)) {
        throw new Error(`تاريخ ${label} غير صالح (المطلوب YYYY-MM-DD).`);
      }
      return t;
    };

    let cleanExDate: string | null = null;
    let cleanPayDate: string | null = null;
    let cleanRecordDate: string | null = null;
    try {
      cleanExDate = checkOptionalDate(exDividendDate, 'نهاية الحق (ExDividendDate)');
      cleanPayDate = checkOptionalDate(paymentDate, 'الصرف (PaymentDate)');
      cleanRecordDate = checkOptionalDate(recordDate, 'التسجيل (RecordDate)');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تاريخ غير صالح.');
      return;
    }

    let totalDistributionAmount: number | null = null;
    if (totalAmountStr.trim() !== '') {
      const parsedAmt = Number(totalAmountStr.trim());
      if (!Number.isFinite(parsedAmt) || parsedAmt < 0) {
        setErrorMsg('إجمالي مبلغ التوزيع يجب أن يكون >= 0 أو يُترك فارغاً.');
        return;
      }
      totalDistributionAmount = Object.is(parsedAmt, -0) ? 0 : parsedAmt;
    }

    let eligibleSharesCount: number | null = null;
    if (eligibleSharesStr.trim() !== '') {
      const parsedShares = Number(eligibleSharesStr.trim());
      if (!Number.isFinite(parsedShares) || parsedShares <= 0) {
        setErrorMsg('عدد الأسهم المستحقة يجب أن يكون رقماً موجباً (> 0) أو يُترك فارغاً.');
        return;
      }
      eligibleSharesCount = parsedShares;
    }

    const cleanParent = parentAnnouncementId.trim() || null;
    if (cleanParent && (cleanParent.includes('/') || cleanParent.includes('..'))) {
      setErrorMsg('معرّف الإعلان الأب لا يجب أن يحتوي على / أو ...');
      return;
    }

    const rawDistId =
      distributionId.trim() ||
      `${asOfDate.trim()}_${distributionSemantics}${cleanParent ? `_${cleanParent}` : ''}`;
    let cleanDistId: string;
    try {
      cleanDistId = sanitizeDistributionId(rawDistId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'معرّف التوزيع (DistributionId) غير صالح.');
      return;
    }

    const payload: DividendRecord = {
      ...(record ?? {}),
      ticker: canonicalTicker,
      fiscalYear,
      cashDps,
      asOfDate: asOfDate.trim(),
      distributionId: cleanDistId,
      recordType,
      approvalStatus,
      distributionSemantics,
      exDividendDate: cleanExDate,
      paymentDate: cleanPayDate,
      recordDate: cleanRecordDate,
      totalDistributionAmount,
      eligibleSharesCount,
      currency: currency === 'EGP' || currency === 'USD' ? currency : null,
      source: source.trim() ? source.trim().slice(0, 240) : null,
      parentAnnouncementId: cleanParent ? cleanParent.slice(0, 80) : null,
      notes: notes.trim() ? notes.trim().slice(0, 500) : null,
      updatedAt: new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      await onSave(payload);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حفظ سجل التوزيع.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <Coins className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-white">
                {isEditingExisting
                  ? `تعديل سجل التوزيع النقدي: ${record!.ticker} (${record!.fiscalYear})`
                  : 'إضافة سجل توزيع نقدي فعلي (DPS_Actual)'}
              </h3>
              <p className="text-xs text-slate-400">
                يُقبل الرقم 0 للتوزيع الصفري المؤكد؛ القيم غير المدخلة تبقى فارغة (BLANK) دون تحويل لصفر.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-950/50 border border-red-800/70 text-red-200 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Core Identification & DPS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">رمز السهم (Ticker):</label>
              <input
                type="text"
                value={ticker}
                disabled={isEditingExisting}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="COMI"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-white disabled:opacity-60 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">السنة المالية (FiscalYear):</label>
              <input
                type="number"
                value={fiscalYearStr}
                disabled={isEditingExisting}
                onChange={(e) => setFiscalYearStr(e.target.value)}
                min={1900}
                max={2200}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-white disabled:opacity-60 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-emerald-400 font-bold mb-1">
                التوزيع النقدي للسهم (CashDPS):
              </label>
              <input
                type="number"
                step="any"
                min={0}
                value={cashDpsStr}
                onChange={(e) => setCashDpsStr(e.target.value)}
                placeholder="0 للتوزيع الصفري المؤكد"
                className="w-full bg-slate-950 border border-emerald-600/70 rounded-lg px-3 py-2 font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">تاريخ السريان (AsOfDate):</label>
              <input
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Governance: RecordType, ApprovalStatus, Semantics, DistributionId */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">نوع التوزيع (RecordType):</label>
              <select
                value={recordType}
                disabled={isEditingExisting}
                onChange={(e) => setRecordType(e.target.value as DividendRecordType)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 disabled:opacity-60 focus:outline-none focus:border-emerald-500"
              >
                <option value="regular">عادي (regular — يدخل DDM)</option>
                <option value="special">استثنائي (special — مستبعد من DDM)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">حالة الاعتماد (ApprovalStatus):</label>
              <select
                value={approvalStatus}
                onChange={(e) => setApprovalStatus(e.target.value as DividendApprovalStatus)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="approved">معتمد (approved)</option>
                <option value="paid">مدفوع (paid)</option>
                <option value="proposed">مقترح (proposed)</option>
                <option value="cancelled">ملغى (cancelled — مستبعد)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">دلالة التوزيع (Semantics):</label>
              <select
                value={distributionSemantics}
                onChange={(e) =>
                  setDistributionSemantics(e.target.value as DividendDistributionSemantics)
                }
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
              >
                <option value="annual_total">إجمالي سنوي (annual_total)</option>
                <option value="standalone_event">حدث منفرد (standalone_event)</option>
                <option value="installment">دفعة / قسط (installment)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">معرّف التوزيع (DistributionId):</label>
              <input
                type="text"
                value={distributionId}
                disabled={isEditingExisting}
                onChange={(e) => setDistributionId(e.target.value)}
                placeholder="اختياري عند الإضافة"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-200 disabled:opacity-60 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Dates & Parent Link */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">تاريخ نهاية الحق (ExDividendDate):</label>
              <input
                type="date"
                value={exDividendDate}
                onChange={(e) => setExDividendDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">تاريخ التسجيل (RecordDate):</label>
              <input
                type="date"
                value={recordDate}
                onChange={(e) => setRecordDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">تاريخ الصرف (PaymentDate):</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">معرّف التوزيع الأب (ParentAnnouncementId):</label>
              <input
                type="text"
                value={parentAnnouncementId}
                onChange={(e) => setParentAnnouncementId(e.target.value)}
                placeholder="BLANK"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Totals, Currency, Source & Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">إجمالي مبلغ التوزيع (اختياري):</label>
              <input
                type="number"
                step="any"
                min={0}
                value={totalAmountStr}
                onChange={(e) => setTotalAmountStr(e.target.value)}
                placeholder="BLANK (يُشتق تلقائياً)"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">عدد الأسهم المستحقة (اختياري):</label>
              <input
                type="number"
                step="any"
                min={0}
                value={eligibleSharesStr}
                onChange={(e) => setEligibleSharesStr(e.target.value)}
                placeholder="BLANK"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">العملة (Currency):</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as '' | CurrencyCode)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="">غير محددة (تتبع القوائم)</option>
                <option value="EGP">EGP (جنيه مصري)</option>
                <option value="USD">USD (دولار أمريكي)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">المصدر (Source):</label>
              <input
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="إفصاح البورصة / الجمعية العمومية"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">ملاحظات (Notes):</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="BLANK"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Actions */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
            >
              إلغاء
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 shadow-lg shadow-emerald-950/40 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>{submitting ? 'جارٍ الحفظ...' : 'حفظ سجل التوزيع في Firestore'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
