/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
  Eye,
  FileSpreadsheet,
  FileText,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import {
  DividendApprovalStatus,
  DividendDistributionSemantics,
  ImportBatchReport,
  ImportPreviewResult,
  ImportSourceType,
  UserRole,
} from '../../types';
import { getSafeChunkSize, ParsedParameterImportRow } from '../../core/imports';

interface ImportWorkflowPanelProps {
  userRole: UserRole;
  previewBusy: boolean;
  batchExecuting: boolean;
  activePreview: ImportPreviewResult<any> | null;
  batchReport: ImportBatchReport | null;
  showAllRejected: boolean;
  dailyUploadMsg: string | null;
  quarterlyUploadMsg: string | null;
  dividendUploadMsg?: string | null;
  dividendSemantics?: DividendDistributionSemantics;
  dividendSemanticsConfirmed?: boolean;
  dividendApprovalDefault?: DividendApprovalStatus;
  dividendApprovalConfirmed?: boolean;
  onChangeDividendSemantics?: (semantics: DividendDistributionSemantics) => void;
  onChangeDividendSemanticsConfirmed?: (confirmed: boolean) => void;
  onChangeDividendApprovalDefault?: (status: DividendApprovalStatus) => void;
  onChangeDividendApprovalConfirmed?: (confirmed: boolean) => void;
  onToggleShowAllRejected: () => void;
  onClosePreview: () => void;
  onSelectFile: (sourceType: ImportSourceType) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  onConfirmOrResumeBatches: (resumeFromFailed: boolean) => void;
}

export const ImportWorkflowPanel: React.FC<ImportWorkflowPanelProps> = ({
  userRole,
  previewBusy,
  batchExecuting,
  activePreview,
  batchReport,
  showAllRejected,
  dailyUploadMsg,
  quarterlyUploadMsg,
  dividendUploadMsg = null,
  dividendSemantics = 'standalone_event',
  dividendSemanticsConfirmed = false,
  dividendApprovalDefault = 'proposed',
  dividendApprovalConfirmed = false,
  onChangeDividendSemantics,
  onChangeDividendSemanticsConfirmed,
  onChangeDividendApprovalDefault,
  onChangeDividendApprovalConfirmed,
  onToggleShowAllRejected,
  onClosePreview,
  onSelectFile,
  onConfirmOrResumeBatches,
}) => {
  const dailySafeChunk = getSafeChunkSize('daily');
  const quarterlySafeChunk = getSafeChunkSize('quarterly');
  const dividendSafeChunk = getSafeChunkSize('dividend');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 1) Daily Trading Uploader (40 columns) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-bold text-white">1. التداول اليومي للبورصة المصرية</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              ملف بصيغة <strong className="text-slate-200">2026-11-8.xlsx</strong>. يستخرج تاريخ التداول تلقائياً ويستورد <strong className="text-slate-200">جميع أعمدة الملف ديناميكياً</strong> على مستوى الخلايا (بما فيها الأعمدة بعد 40 أو 61، والعناوين المكررة أو الفارغة، والصيغ، والأكواد ذات الأصفار البادئة).
            </p>

            <label className="border-2 border-dashed border-slate-700 hover:border-emerald-500/70 rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer bg-slate-950/60 transition-colors">
              <Upload className="w-7 h-7 text-emerald-400 mb-2" />
              <span className="text-xs font-semibold text-slate-200">
                {previewBusy ? 'جارٍ تحليل ومقارنة الملف...' : 'اختر ملف التداول اليومي للمعاينة'}
              </span>
              <span className="text-[11px] text-slate-400 font-mono mt-1">2026-11-8.xlsx</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                disabled={previewBusy || batchExecuting}
                onChange={onSelectFile('daily')}
                className="hidden"
              />
            </label>

            {dailyUploadMsg && (
              <div className="mt-3 p-3 rounded-xl bg-emerald-950/80 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{dailyUploadMsg}</span>
              </div>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
            ✓ الدفعة الواحدة ≤ {dailySafeChunk} سجلاً عبر الخادم مع تجاهل الصفوف غير المتغيرة.
          </div>
        </div>

        {/* 2) Quarterly Financials Uploader (26+ columns) */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-5 h-5 text-teal-400" />
              <h3 className="text-base font-bold text-white">2. القوائم المالية الربع سنوية (QuarterlyFinancials)</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              ملف <strong className="text-slate-200">QuarterlyFinancialsData.xlsx</strong> مع أعمدة FCFF الموثقة (<span className="font-mono">DA_YTD · DeltaOperatingNWC_YTD · ValuationTaxRate</span>) وحفظ قاعدة الفراغ مقابل الصفر.
            </p>

            <label className="border-2 border-dashed border-slate-700 hover:border-teal-500/70 rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer bg-slate-950/60 transition-colors">
              <FileSpreadsheet className="w-7 h-7 text-teal-400 mb-2" />
              <span className="text-xs font-semibold text-slate-200">
                {previewBusy ? 'جارٍ تحليل ومقارنة الملف...' : 'اختر ملف القوائم الربع سنوية للمعاينة'}
              </span>
              <span className="text-[11px] text-slate-400 font-mono mt-1">QuarterlyFinancialsData.xlsx</span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={previewBusy || batchExecuting}
                onChange={onSelectFile('quarterly')}
                className="hidden"
              />
            </label>

            {quarterlyUploadMsg && (
              <div className="mt-3 p-3 rounded-xl bg-teal-950/80 border border-teal-800 text-xs text-teal-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{quarterlyUploadMsg}</span>
              </div>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
            ✓ الدفعة الواحدة ≤ {quarterlySafeChunk} سجلاً ({quarterlySafeChunk * 2} عملية كتابة ذرية داخل حد Firestore).
          </div>
        </div>

        {/* 3) Beta Assumptions Uploader */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-5 h-5 text-sky-400" />
              <h3 className="text-base font-bold text-white">3. افتراضات بيتا التاريخية (Beta_Assumptions.xlsx)</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              يُحدّث مجموعة <span className="font-mono text-slate-200">beta_assumptions</span> بالحقول المعتمدة: <span className="font-mono">Ticker · Beta · AsOfDate · Source</span>. يُقبل الصفر والسالب مع رفض التكرار داخل الملف.
            </p>

            <label className="border-2 border-dashed border-slate-700 hover:border-sky-500/70 rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer bg-slate-950/60 transition-colors">
              <Upload className="w-7 h-7 text-sky-400 mb-2" />
              <span className="text-xs font-semibold text-slate-200">
                {previewBusy ? 'جارٍ تحليل ومقارنة الملف...' : 'اختر ملف Beta_Assumptions.xlsx للمعاينة'}
              </span>
              <span className="text-[11px] text-slate-400 font-mono mt-1">ورقة: Beta_Assumptions</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                disabled={previewBusy || batchExecuting}
                onChange={onSelectFile('beta')}
                className="hidden"
              />
            </label>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
            ✓ لا تُطبَّق بيتا المرجعية (1.00) إلا بعد تأكيد الخادم غياب سجل السهم هنا.
          </div>
        </div>

        {/* 4) All Parameters Uploader */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <SlidersHorizontal className="w-5 h-5 text-amber-400" />
              <h3 className="text-base font-bold text-white">4. معاملات التقييم والماكرو (All_Parameters.xlsx)</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              يدعم النطاق العام (<span className="font-mono">Scope=global</span> للمدير) ونطاق الشركات (<span className="font-mono">Scope=company</span>). في Excel تُدخل النسب ككسر عشري مخزّن (<span className="font-mono">0.15</span>) أو بعلامة <span className="font-mono">%</span> صريحة (<span className="font-mono">15%</span>) على خلاف الإدخال المئوي المباشر في لوحة المدير، ويجب تحديد <span className="font-mono">ValueType</span> و/أو <span className="font-mono">IsPercentage</span> صراحةً لأي معامل مخصص لمنع محو النوع.
            </p>

            <label className="border-2 border-dashed border-slate-700 hover:border-amber-500/70 rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer bg-slate-950/60 transition-colors">
              <FileSpreadsheet className="w-7 h-7 text-amber-400 mb-2" />
              <span className="text-xs font-semibold text-slate-200">
                {previewBusy ? 'جارٍ تحليل ومقارنة الملف...' : 'اختر ملف All_Parameters.xlsx للمعاينة'}
              </span>
              <span className="text-[11px] text-slate-400 font-mono mt-1">ورقة: All_Parameters</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                disabled={previewBusy || batchExecuting}
                onChange={onSelectFile('parameters')}
                className="hidden"
              />
            </label>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
            ✓ التعديلات العامة في macro_params مقصورة على مدير النظام (Admin)، والمعاملات المخصصة لا تُفعّل تلقائياً في المحرك.
          </div>
        </div>

        {/* 5) DPS_Actual Uploader */}
        <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Coins className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-bold text-white">5. سجل التوزيعات النقدية الفعلي (DPS_Actual.xlsx)</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed mb-4">
              ملف <strong className="text-slate-200">DPS_Actual.xlsx</strong> (ورقة <span className="font-mono">DPS_Actual</span>) — يستورد التوزيعات المنتظمة (<span className="font-mono">regular</span> لـ DDM) والاستثنائية (<span className="font-mono">special</span>) مع احترام الصفر المؤكد (<span className="font-mono">CashDPS = 0</span>) وتاريخ القطع (<span className="font-mono">AsOfDate</span>) ومنع الازدواج بين <span className="font-mono">annual_total</span> و <span className="font-mono">installment</span>، ودون إضافة أسهم خارج القوائم المالية.
            </p>

            <label className="border-2 border-dashed border-slate-700 hover:border-emerald-500/70 rounded-2xl p-5 flex flex-col items-center justify-center cursor-pointer bg-slate-950/60 transition-colors">
              <Upload className="w-7 h-7 text-emerald-400 mb-2" />
              <span className="text-xs font-semibold text-slate-200">
                {previewBusy ? 'جارٍ تحليل ومقارنة الملف...' : 'اختر ملف DPS_Actual.xlsx للمعاينة'}
              </span>
              <span className="text-[11px] text-slate-400 font-mono mt-1">ورقة: DPS_Actual</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                disabled={previewBusy || batchExecuting}
                onChange={onSelectFile('dividend')}
                className="hidden"
              />
            </label>

            {dividendUploadMsg && (
              <div className="mt-3 p-3 rounded-xl bg-emerald-950/80 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{dividendUploadMsg}</span>
              </div>
            )}
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
            ✓ الدفعة الواحدة ≤ {dividendSafeChunk} سجلاً عبر الخادم — يتطلب تأكيد دلالة صفوف التوزيع في المعاينة قبل الحفظ.
          </div>
        </div>
      </div>

      {/* Non-Mutating Preview & Batch Execution Card */}
      {activePreview && (
        <div className="bg-slate-900 border border-emerald-700/60 rounded-2xl p-5 shadow-md space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">معاينة الاستيراد قبل الحفظ — {activePreview.fileName}</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {activePreview.sheetName}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                لم تُكتب أي بيانات بعد في Firestore. راجع الإضافات والتعديلات والصفوف المرفوضة ثم اعتمد التنفيذ المجزأ.
              </p>
            </div>

            <button
              type="button"
              disabled={batchExecuting}
              onClick={onClosePreview}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
              <span>إغلاق المعاينة</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-slate-400 text-[11px]">إجمالي الصفوف</div>
              <div className="font-mono text-base font-bold text-white mt-0.5">{activePreview.totalRows}</div>
            </div>
            <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-3">
              <div className="text-emerald-300 text-[11px]">إضافات جديدة</div>
              <div className="font-mono text-base font-bold text-emerald-400 mt-0.5">{activePreview.inserts.length}</div>
            </div>
            <div className="bg-sky-950/40 border border-sky-800/60 rounded-xl p-3">
              <div className="text-sky-300 text-[11px]">تحديثات فعلية</div>
              <div className="font-mono text-base font-bold text-sky-400 mt-0.5">{activePreview.updates.length}</div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <div className="text-slate-400 text-[11px]">بدون تغيير (متجاهَل)</div>
              <div className="font-mono text-base font-bold text-slate-300 mt-0.5">{activePreview.unchanged.length}</div>
            </div>
            <div className="bg-red-950/40 border border-red-800/60 rounded-xl p-3">
              <div className="text-red-300 text-[11px]">صفوف مرفوضة</div>
              <div className="font-mono text-base font-bold text-red-400 mt-0.5">{activePreview.rejected.length}</div>
            </div>
          </div>

          {activePreview.dailySchema && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-[11px] flex flex-wrap items-center justify-between gap-2 text-slate-300">
              <span>
                مخطط الأعمدة المكتشف:{' '}
                <strong className="font-mono text-emerald-400">
                  {activePreview.dailySchema.totalColumns} عموداً أصلياً
                </strong>{' '}
                (معرف المخطط: <span className="font-mono text-slate-400">{activePreview.dailySchema.schemaId}</span>)
              </span>
              <span className="font-mono text-slate-400">
                بدون عنوان: {activePreview.dailySchema.columns.filter((c) => !c.headerName).length} · مكررة:{' '}
                {activePreview.dailySchema.columns.filter((c) => c.isDuplicateHeader).length} · إضافية غير مربوطة:{' '}
                {activePreview.dailySchema.columns.filter((c) => !c.mappedField).length}
              </span>
            </div>
          )}

          {activePreview.warnings.length > 0 && (
            <div className="bg-amber-950/40 border border-amber-800/60 rounded-xl p-3 text-xs text-amber-200 space-y-1">
              {activePreview.warnings.map((w, idx) => (
                <div key={idx} className="flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {activePreview.sourceType === 'dividend' && (
            <div className="bg-slate-950 border border-emerald-800/60 rounded-xl p-4 space-y-3 text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="font-bold text-emerald-300">
                    حوكمة دلالة التوزيعات ومنع الازدواج الحسابي (DPS_Actual Semantics Gate)
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    حدد الدلالة الافتراضية للصفوف التي لا تحتوي عمود <span className="font-mono">Semantics</span> صريحاً، ثم أكّد ملاءمة الدلالات قبل الاعتماد.
                  </p>
                </div>

                {onChangeDividendSemantics && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-400">الدلالة الافتراضية:</span>
                    <select
                      aria-label="دلالة صفوف التوزيع الافتراضية"
                      value={activePreview.defaultSemanticsUsed ?? dividendSemantics}
                      disabled={previewBusy || batchExecuting}
                      onChange={(e) =>
                        onChangeDividendSemantics(e.target.value as DividendDistributionSemantics)
                      }
                      className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-emerald-300 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="annual_total">annual_total (إجمالي سنوي للسنة والنوع)</option>
                      <option value="standalone_event">standalone_event (حدث توزيع منفرد)</option>
                      <option value="installment">installment (دفعة / قسط توزيع)</option>
                    </select>
                  </div>
                )}
              </div>

              <label
                className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  dividendSemanticsConfirmed
                    ? 'bg-emerald-950/40 border-emerald-700/70 text-emerald-200'
                    : 'bg-amber-950/30 border-amber-700/60 text-amber-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={dividendSemanticsConfirmed}
                  disabled={batchExecuting}
                  onChange={(e) => onChangeDividendSemanticsConfirmed?.(e.target.checked)}
                  className="mt-0.5 rounded border-slate-600 bg-slate-900 text-emerald-500"
                />
                <span className="text-[11px] leading-relaxed">
                  أؤكد مراجعة دلالة صفوف التوزيع (إجمالي سنوي <span className="font-mono">annual_total</span> مقابل حدث منفرد <span className="font-mono">standalone_event</span> أو دفعة <span className="font-mono">installment</span>) وتواريخ السريان والنوع (<span className="font-mono">regular / special</span>) منعاً للازدواج الحسابي قبل الحفظ في Firestore.
                </span>
              </label>

              {activePreview.requiresApprovalConfirmation && (activePreview.rowsMissingApprovalCount ?? 0) > 0 && (
                <div className="pt-3 mt-2 border-t border-slate-800 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-amber-300">
                        بوابة اعتماد حالة التوزيعات المفقودة ({activePreview.rowsMissingApprovalCount} صفاً بدون ApprovalStatus)
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        الوضع الافتراضي الآمن هو <span className="font-mono text-amber-300">proposed</span> (يُحفظ دون الدخول في احتساب DDM أو Payout حتى الاعتماد). اختر الحالة الافتراضية ثم أكّد الصلاحية.
                      </p>
                    </div>

                    {onChangeDividendApprovalDefault && (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-slate-400">حالة الاعتماد الافتراضية:</span>
                        <select
                          aria-label="حالة اعتماد التوزيعات الافتراضية"
                          value={dividendApprovalDefault}
                          disabled={previewBusy || batchExecuting}
                          onChange={(e) =>
                            onChangeDividendApprovalDefault(e.target.value as DividendApprovalStatus)
                          }
                          className="bg-slate-900 border border-amber-700/60 rounded-lg px-2.5 py-1.5 text-xs font-mono text-amber-200 focus:outline-none focus:border-amber-500"
                        >
                          <option value="proposed">proposed (مقترح — آمن غير معتمد)</option>
                          <option value="approved">approved (معتمد من الجمعية)</option>
                          <option value="paid">paid (مصروف فعلياً)</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <label
                    className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      dividendApprovalConfirmed
                        ? 'bg-emerald-950/40 border-emerald-700/70 text-emerald-200'
                        : 'bg-amber-950/30 border-amber-700/60 text-amber-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={dividendApprovalConfirmed}
                      disabled={batchExecuting}
                      onChange={(e) => onChangeDividendApprovalConfirmed?.(e.target.checked)}
                      className="mt-0.5 rounded border-slate-600 bg-slate-900 text-amber-500"
                    />
                    <span className="text-[11px] leading-relaxed">
                      أؤكد تعيين حالة <span className="font-mono font-bold">{dividendApprovalDefault}</span> للـ {activePreview.rowsMissingApprovalCount} صفاً التي خلت من عمود <span className="font-mono">ApprovalStatus</span> قبل الحفظ.
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}

          {activePreview.sourceType === 'parameters' &&
            userRole !== 'admin' &&
            [...activePreview.inserts, ...activePreview.updates].some(
              (i) => (i.record as ParsedParameterImportRow).scope === 'global'
            ) && (
              <div className="bg-red-950/50 border border-red-800/70 rounded-xl p-3 text-xs text-red-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  يحتوي الملف على معاملات عامة (Scope=global)؛ سيرفض الخادم حفظ المعاملات العامة لغير مدير النظام (Admin).
                </span>
              </div>
            )}

          {activePreview.rejected.length > 0 && (
            <div className="bg-slate-950 border border-red-900/50 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-red-300">
                  تفاصيل الصفوف المرفوضة ({activePreview.rejected.length}) — لن تُحفظ
                </span>
                {activePreview.rejected.length > 10 && (
                  <button
                    type="button"
                    onClick={onToggleShowAllRejected}
                    className="text-slate-300 hover:text-white underline"
                  >
                    {showAllRejected ? 'عرض أول 10 صفوف فقط' : `عرض الكل (${activePreview.rejected.length})`}
                  </button>
                )}
              </div>
              <div className="max-h-52 overflow-auto">
                <table className="w-full text-[11px] text-start">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-2">الصف</th>
                      <th className="p-2">العمود</th>
                      <th className="p-2">السهم</th>
                      <th className="p-2">سبب الرفض</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {(showAllRejected ? activePreview.rejected : activePreview.rejected.slice(0, 10)).map(
                      (rej, idx) => (
                        <tr key={idx}>
                          <td className="p-2 font-mono text-red-300">{rej.rowNumber}</td>
                          <td className="p-2 font-mono text-slate-300">{rej.column}</td>
                          <td className="p-2 font-mono text-slate-300">{rej.ticker || '-'}</td>
                          <td className="p-2 text-red-200">{rej.reasonAr}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activePreview.updates.length > 0 && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5 text-[11px]">
              <div className="font-bold text-sky-300">
                التعديلات المرصودة ({activePreview.updates.length}) — نموذج لأول السجلات المتغيرة:
              </div>
              <div className="max-h-36 overflow-auto space-y-1">
                {activePreview.updates.slice(0, 15).map((u) => (
                  <div key={u.docId} className="flex flex-wrap items-center justify-between gap-2 text-slate-300 border-b border-slate-900 pb-1">
                    <span className="font-mono font-semibold text-white">{u.label}</span>
                    <span className="font-mono text-[10px] text-sky-300">
                      {u.changedFields && u.changedFields.length > 0
                        ? `الحقول: ${u.changedFields.join(', ')}`
                        : 'تحديث بصمة المحتوى'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batchReport && (
            <div
              role="status"
              className={`rounded-xl p-3 border text-xs space-y-2 ${
                batchReport.failedBatchIndex !== null
                  ? 'bg-red-950/60 border-red-800 text-red-200'
                  : 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                <span>
                  تقدم الدفعات: {batchReport.completedBatches} / {batchReport.totalBatches}
                </span>
                <span className="font-mono">
                  +{batchReport.insertedCount} إضافة · ~{batchReport.updatedCount} تحديث · ={batchReport.skippedUnchangedCount} دون تغيير
                </span>
              </div>
              {batchReport.failedError && (
                <div className="text-red-200">
                  توقفت الدفعة #{(batchReport.failedBatchIndex ?? 0) + 1}: {batchReport.failedError} (المتبقي {batchReport.remainingItemsCount} سجلاً).
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800 text-xs">
            <div className="text-slate-400">
              عدد الدفعات المطلوبة:{' '}
              <strong className="font-mono text-slate-200">
                {Math.ceil(
                  (activePreview.inserts.length + activePreview.updates.length) /
                    getSafeChunkSize(activePreview.sourceType)
                )}
              </strong>{' '}
              (حجم الدفعة ≤ {getSafeChunkSize(activePreview.sourceType)} سجلاً)
            </div>

            <div className="flex items-center gap-2">
              {batchReport && batchReport.failedBatchIndex !== null && (
                <button
                  type="button"
                  disabled={batchExecuting}
                  onClick={() => onConfirmOrResumeBatches(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>استئناف الدفعات المتبقية</span>
                </button>
              )}

              <button
                type="button"
                disabled={
                  batchExecuting ||
                  activePreview.inserts.length + activePreview.updates.length === 0 ||
                  batchReport?.failedBatchIndex === null ||
                  (activePreview.sourceType === 'dividend' &&
                    (!dividendSemanticsConfirmed ||
                      (Boolean(activePreview.requiresApprovalConfirmation) && !dividendApprovalConfirmed)))
                }
                onClick={() => onConfirmOrResumeBatches(false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold shadow-sm"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  {batchExecuting
                    ? 'جارٍ الحفظ بالدفعات...'
                    : batchReport?.failedBatchIndex === null
                    ? 'تم الاعتماد والحفظ'
                    : `اعتماد وحفظ (${activePreview.inserts.length + activePreview.updates.length} سجلاً)`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
