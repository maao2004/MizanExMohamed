/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, Ban, RefreshCw, Trash2, X } from 'lucide-react';
import type { Company, SectorDefinition } from '../../types/financial';
import type { SectorMutationReport } from '../../core/contracts';

export interface SectorGovernanceActionModalProps {
  mode: 'disable' | 'delete';
  sector: SectorDefinition;
  linkedCompanies: Company[];
  activeReplacementSectors: SectorDefinition[];
  reassignToSectorId: string;
  onChangeReassignToSectorId: (nextId: string) => void;
  busy: boolean;
  errorText: string | null;
  pendingReport: SectorMutationReport | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const CLASSIFICATION_AR: Record<SectorDefinition['classification'], string> = {
  financial: 'مالي / بنوك (DCF مستبعد)',
  non_financial: 'غير مالي (مؤهل DCF)',
  unknown: 'غير معروف (DCF مستبعد)',
};

export const SectorGovernanceActionModal: React.FC<SectorGovernanceActionModalProps> = ({
  mode,
  sector,
  linkedCompanies,
  activeReplacementSectors,
  reassignToSectorId,
  onChangeReassignToSectorId,
  busy,
  errorText,
  pendingReport,
  onConfirm,
  onCancel,
}) => {
  const isDelete = mode === 'delete';
  const linkedCount = linkedCompanies.length;
  const requiresReassignment = isDelete && linkedCount > 0;
  const hasReplacementChoices = activeReplacementSectors.length > 0;
  const confirmBlockedByLinks = requiresReassignment && !reassignToSectorId;
  const isResuming = Boolean(pendingReport && !pendingReport.completed);

  const previewCompanies = linkedCompanies.slice(0, 8);
  const extraCompaniesCount = Math.max(0, linkedCount - previewCompanies.length);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isDelete ? 'تأكيد حذف القطاع من sectorPE' : 'تأكيد تعطيل القطاع في sectorPE'}
      data-testid={isDelete ? 'sector-delete-dialog' : 'sector-disable-dialog'}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm"
      dir="rtl"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden text-xs text-slate-100">
        {/* Header */}
        <div
          className={`px-5 py-4 border-b border-slate-800 flex items-center justify-between ${
            isDelete ? 'bg-red-950/35' : 'bg-amber-950/30'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                isDelete
                  ? 'bg-red-950/70 border-red-800/70 text-red-400'
                  : 'bg-amber-950/70 border-amber-800/70 text-amber-400'
              }`}
            >
              {isDelete ? <Trash2 className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">
                {isDelete ? 'تأكيد حذف القطاع من سجل sectorPE' : 'تأكيد تعطيل القطاع في سجل sectorPE'}
              </h4>
              <p className="text-[11px] text-slate-400">
                القطاع: <strong className="text-slate-200">{sector.nameAr}</strong> ·{' '}
                <span className="font-mono text-slate-300">{sector.sectorId}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="إغلاق نافذة التأكيد"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Sector Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-950/70 border border-slate-800 rounded-xl p-3">
            <div>
              <div className="text-[10px] text-slate-400">التصنيف المعتمد</div>
              <div className="font-semibold text-sky-300 mt-0.5">{CLASSIFICATION_AR[sector.classification]}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">مضاعف الربحية P/E</div>
              <div className="font-mono font-bold text-emerald-300 mt-0.5">
                {sector.multiple !== null && sector.multiple !== undefined
                  ? `${sector.multiple}x`
                  : 'بدون مضاعف (null)'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">الشركات المرتبطة حالياً</div>
              <div
                data-testid="sector-dialog-linked-count"
                className={`font-mono font-bold mt-0.5 ${
                  linkedCount > 0 ? 'text-amber-300' : 'text-emerald-300'
                }`}
              >
                {linkedCount} شركة
              </div>
            </div>
          </div>

          {/* Linked Companies Preview */}
          {linkedCount > 0 && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3 space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-300">
                الشركات المرتبطة بهذا القطاع ({linkedCount}):
              </div>
              <div className="flex flex-wrap gap-1.5">
                {previewCompanies.map((c) => (
                  <span
                    key={c.ticker}
                    className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[10px] text-slate-200"
                  >
                    {c.ticker} — {c.nameAr}
                  </span>
                ))}
                {extraCompaniesCount > 0 && (
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                    +{extraCompaniesCount} شركة أخرى
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Impact Explanation */}
          <div
            className={`p-3 rounded-xl border space-y-1.5 text-[11px] leading-relaxed ${
              isDelete
                ? 'bg-red-950/25 border-red-900/60 text-red-200'
                : 'bg-amber-950/25 border-amber-900/60 text-amber-200'
            }`}
          >
            <div className="font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>أثر الإجراء قبل التنفيذ:</span>
            </div>
            {isDelete ? (
              <ul className="list-disc list-inside space-y-1">
                <li>سيتم حذف تعريف القطاع من مجموعة <span className="font-mono">sectorPE</span> وإصدار شاهد حذف موثق (tombstone).</li>
                <li>لا يتم حذف أي شركات أو قوائم مالية ربع سنوية أو سجلات تداول يومية إطلاقاً.</li>
                <li>يعيد الخادم التحقق من الارتباطات لحظة التنفيذ لمنع المراجع المعلقة في حال تغيرت الروابط.</li>
                {linkedCount > 0 && (
                  <li className="font-semibold text-red-100">
                    لا يُسمح بالحذف المباشر لوجود {linkedCount} شركة مرتبطة؛ يجب تحديد قطاع بديل نشط صراحةً أو استخدام التعطيل بدلاً من الحذف.
                  </li>
                )}
              </ul>
            ) : (
              <ul className="list-disc list-inside space-y-1">
                <li>التعطيل يُخفي القطاع من الاختيارات الجديدة فقط، مع إبقاء السجل محفوظاً وقابلاً للتدقيق وإعادة التفعيل.</li>
                <li>عند عدم اختيار قطاع بديل، تظل روابط الشركات القائمة مفهومة وقابلة للتدقيق (<span className="font-mono">disabled_sector</span>).</li>
                <li>لا يتم حذف أي شركات أو سجلات مالية أو تداول يومية؛ كما يعيد الخادم التحقق من الروابط قبل الحفظ.</li>
              </ul>
            )}
          </div>

          {/* Explicit Reassignment Selector (NEVER auto-selected) */}
          {(linkedCount > 0 || isDelete) && (
            <div className="space-y-1.5">
              <label className="block text-[11px] font-semibold text-slate-200">
                {isDelete
                  ? linkedCount > 0
                    ? 'إعادة إسناد الشركات المرتبطة إلى قطاع بديل نشط (مطلوب للحذف):'
                    : 'إعادة إسناد احترازية في حال ظهور شركات مرتبطة أثناء الحفظ (اختياري):'
                  : 'إعادة إسناد الشركات المرتبطة إلى قطاع بديل نشط (اختياري — يُترك فارغاً لحفظ الروابط للتدقيق):'}
              </label>
              <select
                aria-label={isDelete ? 'قطاع بديل لإعادة الإسناد قبل الحذف' : 'قطاع بديل اختياري عند التعطيل'}
                data-testid={isDelete ? 'sector-delete-reassign-select' : 'sector-disable-reassign-select'}
                disabled={busy || !hasReplacementChoices || isResuming}
                value={reassignToSectorId}
                onChange={(e) => onChangeReassignToSectorId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              >
                <option value="">
                  {isDelete
                    ? linkedCount > 0
                      ? '-- يجب اختيار قطاع بديل نشط صراحةً --'
                      : '-- بدون إعادة إسناد (القطاع غير مرتبط) --'
                    : '-- إبقاء الروابط القائمة كما هي لأغراض التدقيق (بدون نقل) --'}
                </option>
                {activeReplacementSectors.map((alt) => (
                  <option key={alt.sectorId} value={alt.sectorId}>
                    {alt.nameAr} ({alt.sectorId}) — {CLASSIFICATION_AR[alt.classification]}
                    {alt.multiple !== null ? ` · P/E ${alt.multiple}x` : ' · بدون مضاعف'}
                  </option>
                ))}
              </select>

              {requiresReassignment && !hasReplacementChoices && (
                <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-800 text-red-200 text-[11px]">
                  لا يوجد قطاع بديل نشط في <span className="font-mono">sectorPE</span> لنقل الشركات إليه؛ أنشئ قطاعاً نشطاً بديلاً أولاً أو استخدم التعطيل بدلاً من الحذف.
                </div>
              )}
            </div>
          )}

          {/* Resumable Multi-Batch Report (if server returned partial progress) */}
          {pendingReport && !pendingReport.completed && (
            <div
              role="status"
              data-testid="sector-dialog-partial-report"
              className="p-3 rounded-xl bg-sky-950/50 border border-sky-700/70 text-sky-200 space-y-1.5 text-[11px]"
            >
              <div className="font-bold">تقرير تنفيذ مرحلي (متعدد الدفعات — غير ذري عبر الدفعات):</div>
              <div>{pendingReport.messageAr}</div>
              {pendingReport.warningAr && <div className="text-amber-300">{pendingReport.warningAr}</div>}
              <div className="font-mono text-[10px] text-sky-300 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>نُقل: {pendingReport.reassignedCount}</span>
                <span>المتبقي: {pendingReport.remainingLinkedCount}</span>
                {pendingReport.conflictedCount > 0 && (
                  <span className="text-amber-300">تعارضات: {pendingReport.conflictedCount}</span>
                )}
                {pendingReport.failedCount > 0 && (
                  <span className="text-red-300">أخطاء: {pendingReport.failedCount}</span>
                )}
                {pendingReport.legacyTextLinkedCount > 0 && (
                  <span className="text-slate-300">روابط نصية قديمة: {pendingReport.legacyTextLinkedCount}</span>
                )}
                {pendingReport.mutationId && (
                  <span className="text-slate-400">ID: {pendingReport.mutationId}</span>
                )}
              </div>
              {pendingReport.conflictsAr && pendingReport.conflictsAr.length > 0 && (
                <ul className="list-disc list-inside text-[10px] text-amber-200 space-y-0.5 pt-1 border-t border-sky-800/60">
                  {pendingReport.conflictsAr.slice(0, 5).map((c, idx) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Error Banner */}
          {errorText && (
            <div
              role="alert"
              data-testid="sector-dialog-error"
              className="p-3 rounded-xl bg-red-950/70 border border-red-800 text-red-200 text-[11px] flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorText}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            data-testid={isDelete ? 'confirm-sector-delete-btn' : 'confirm-sector-disable-btn'}
            disabled={busy || confirmBlockedByLinks || (requiresReassignment && !hasReplacementChoices)}
            onClick={() => void onConfirm()}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-white transition-colors disabled:opacity-50 ${
              isDelete
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-amber-600 hover:bg-amber-500'
            }`}
          >
            {busy && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>
              {busy
                ? 'جارٍ التنفيذ والتحقق في الخادم...'
                : isResuming
                ? 'استئناف الدفعة التالية'
                : isDelete
                ? linkedCount > 0
                  ? 'إعادة الإسناد وحذف القطاع'
                  : 'تأكيد حذف القطاع'
                : reassignToSectorId
                ? 'إعادة الإسناد وتعطيل القطاع'
                : 'تأكيد تعطيل القطاع'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
