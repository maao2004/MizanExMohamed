/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Database,
  PlusCircle,
  FileSpreadsheet,
  Upload,
  Download,
  AlertOctagon,
  AlertTriangle,
  Info,
  CheckCircle2,
  Trash2,
  Edit,
  ShieldCheck,
  FileText,
} from 'lucide-react';
import {
  AuditWarning,
  Company,
  QuarterlyFinancial,
  QuarterType,
} from '../types/financial';
import {
  downloadExcelTemplate,
  exportCompanyValuationToExcel,
  parseFinancialsExcelFile,
} from '../utils/excelExport';

interface DataManagementViewProps {
  company: Company;
  financials: QuarterlyFinancial[];
  auditWarnings: AuditWarning[];
  onAddQuarter: (quarter: QuarterlyFinancial) => void;
  onUpdateQuarter: (id: string, updates: Partial<QuarterlyFinancial>) => void;
  onDeleteQuarter: (id: string) => void;
  onBulkImportQuarters: (quarters: QuarterlyFinancial[]) => void;
}

export const DataManagementView: React.FC<DataManagementViewProps> = ({
  company,
  financials,
  auditWarnings,
  onAddQuarter,
  onUpdateQuarter,
  onDeleteQuarter,
  onBulkImportQuarters,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingQuarter, setEditingQuarter] = useState<QuarterlyFinancial | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Form State for Add / Edit
  const [formYear, setFormYear] = useState<number>(2025);
  const [formQuarter, setFormQuarter] = useState<QuarterType>('Q1');
  const [formDate, setFormDate] = useState<string>('2025-03-31');
  const [formRevenue, setFormRevenue] = useState<string>('');
  const [formGrossProfit, setFormGrossProfit] = useState<string>('');
  const [formOperatingProfit, setFormOperatingProfit] = useState<string>('');
  const [formNetProfit, setFormNetProfit] = useState<string>('');
  const [formOcf, setFormOcf] = useState<string>('');
  const [formCapex, setFormCapex] = useState<string>('');
  const [formDividendsPaidYTD, setFormDividendsPaidYTD] = useState<string>('');
  const [formAssets, setFormAssets] = useState<string>('');
  const [formDebt, setFormDebt] = useState<string>('');
  const [formCash, setFormCash] = useState<string>('');
  const [formEquity, setFormEquity] = useState<string>('');
  const [formShares, setFormShares] = useState<string>(
    company.sharesOutstanding !== null ? String(company.sharesOutstanding) : ''
  );
  const [formNotes, setFormNotes] = useState<string>('');

  // تصفية أرباع الشركة الحالية وترتيبها زمنياً
  const companyFinancials = financials
    .filter((f) => f.companyId === company.id)
    .sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      const order: Record<string, number> = { Q1: 1, Q2: 2, Q3: 3, FY: 4 };
      return (order[a.quarter] || 0) - (order[b.quarter] || 0);
    });

  // فحص تنبيهات التدقيق الخاصة بالشركة
  const companyWarnings = auditWarnings.filter((w) => w.companyTicker === company.ticker);

  const resetForm = () => {
    setEditingQuarter(null);
    setFormYear(2025);
    setFormQuarter('Q1');
    setFormDate('2025-03-31');
    setFormRevenue('');
    setFormGrossProfit('');
    setFormOperatingProfit('');
    setFormNetProfit('');
    setFormOcf('');
    setFormCapex('');
    setFormDividendsPaidYTD('');
    setFormAssets('');
    setFormDebt('');
    setFormCash('');
    setFormEquity('');
    setFormShares(company.sharesOutstanding !== null ? String(company.sharesOutstanding) : '');
    setFormNotes('');
  };

  const openEditModal = (q: QuarterlyFinancial) => {
    setEditingQuarter(q);
    setFormYear(q.year);
    setFormQuarter(q.quarter);
    setFormDate(q.periodDate);
    setFormRevenue(q.revenueYTD !== null ? String(q.revenueYTD) : '');
    setFormGrossProfit(q.grossProfitYTD !== null ? String(q.grossProfitYTD) : '');
    setFormOperatingProfit(q.operatingProfitYTD !== null ? String(q.operatingProfitYTD) : '');
    setFormNetProfit(q.netProfitYTD !== null ? String(q.netProfitYTD) : '');
    setFormOcf(q.operatingCashFlowYTD !== null ? String(q.operatingCashFlowYTD) : '');
    setFormCapex(q.capexYTD !== null ? String(q.capexYTD) : '');
    setFormDividendsPaidYTD(q.dividendsPaidYTD !== null ? String(q.dividendsPaidYTD) : '');
    setFormAssets(q.totalAssets !== null ? String(q.totalAssets) : '');
    setFormDebt(q.totalDebt !== null ? String(q.totalDebt) : '');
    setFormCash(q.cashAndEquivalents !== null ? String(q.cashAndEquivalents) : '');
    setFormEquity(q.totalEquity !== null ? String(q.totalEquity) : '');
    setFormShares(
      q.sharesCount !== null
        ? String(q.sharesCount)
        : company.sharesOutstanding !== null
        ? String(company.sharesOutstanding)
        : ''
    );
    setFormNotes(q.notes || '');
    setIsAddModalOpen(true);
  };

  const parseOrNull = (val: string): number | null => {
    if (val.trim() === '' || val.trim().toUpperCase() === 'BLANK') return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const quarterData: QuarterlyFinancial = {
      id: editingQuarter ? editingQuarter.id : `${company.id}_${formYear}_${formQuarter.toLowerCase()}_${Date.now()}`,
      companyId: company.id,
      year: Number(formYear),
      quarter: formQuarter,
      periodDate: formDate,
      revenueYTD: parseOrNull(formRevenue),
      grossProfitYTD: parseOrNull(formGrossProfit),
      operatingProfitYTD: parseOrNull(formOperatingProfit),
      netProfitYTD: parseOrNull(formNetProfit),
      operatingCashFlowYTD: parseOrNull(formOcf),
      capexYTD: parseOrNull(formCapex),
      dividendsPaidYTD: parseOrNull(formDividendsPaidYTD),
      totalAssets: parseOrNull(formAssets),
      totalDebt: parseOrNull(formDebt),
      cashAndEquivalents: parseOrNull(formCash),
      totalEquity: parseOrNull(formEquity),
      sharesCount: parseOrNull(formShares),
      isAudited: true,
      notes: formNotes,
    };

    if (editingQuarter) {
      onUpdateQuarter(editingQuarter.id, quarterData);
    } else {
      onAddQuarter(quarterData);
    }

    setIsAddModalOpen(false);
    resetForm();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const parsedQuarters = await parseFinancialsExcelFile(file, company.id);
      if (parsedQuarters.length > 0) {
        onBulkImportQuarters(parsedQuarters);
        setImportStatus(`تم استيراد ${parsedQuarters.length} فترات مالية بنجاح!`);
      } else {
        setImportStatus('لم يتم العثور على أسطر صالحة للاستيراد في الملف.');
      }
    } catch (err) {
      setImportStatus('حدث خطأ أثناء قراءة الملف. تأكد من توافقه مع القالب القياسي.');
    }

    setTimeout(() => setImportStatus(null), 5000);
  };

  // تنسيق الخلية: إذا كانت null تعرض كـ BLANK
  const renderCell = (val: number | null) => {
    if (val === null) {
      return <span className="text-slate-500 font-mono italic text-[11px]">BLANK</span>;
    }
    return (
      <span className="font-mono text-slate-100">
        {val.toLocaleString('ar-EG', { maximumFractionDigits: 1 })}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white">
                إدارة البيانات المالية ومحرك التدقيق الذكي (Data Management & Audit Hub)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
              إدخال وتعديل القوائم المالية الربع سنوية التراكمية (YTD)، مع التدقيق المحاسبي الآلي لكشف التناقضات وحفظ قاعدة أن <strong className="text-slate-200">BLANK</strong> تعني غير مُدخل والصفر لا يُستخدم إلا إذا كان البند صفراً فعلياً.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Download Template */}
            <button
              onClick={downloadExcelTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              title="تنزيل قالب إكسيل جاهز للملء"
            >
              <Download className="w-3.5 h-3.5 text-teal-400" />
              تنزيل قالب Excel
            </button>

            {/* Upload Excel */}
            <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              استيراد Excel / CSV
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>

            {/* Add Quarter Manually */}
            <button
              onClick={() => {
                resetForm();
                setIsAddModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              إضافة ربع مالي
            </button>
          </div>
        </div>

        {importStatus && (
          <div className="mt-3 p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{importStatus}</span>
          </div>
        )}
      </div>

      {/* 2. Automated Data Audit Findings Panel */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">نتائج محرك التدقيق الآلي لجودة البيانات</h3>
          </div>
          <span className="text-xs text-slate-400">
            {companyWarnings.length === 0 ? (
              <span className="text-emerald-400 font-semibold">✓ لا توجد تناقضات محاسبية مرصودة</span>
            ) : (
              <span className="text-amber-400 font-semibold">تم رصد {companyWarnings.length} ملاحظات فحص</span>
            )}
          </span>
        </div>

        {companyWarnings.length === 0 ? (
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/60 text-xs text-slate-400 text-center">
            جميع القوائم المالية الربع سنوية لسهم {company.nameAr} متسقة محاسبياً ومطابقة لقواعد تراكم الإيرادات والإنفاق الاستثماري وهوامش الربحية.
          </div>
        ) : (
          <div className="space-y-3">
            {companyWarnings.map((warning) => {
              const isCrit = warning.severity === 'critical';
              const isWarn = warning.severity === 'warning';
              return (
                <div
                  key={warning.id}
                  className={`p-4 rounded-xl border text-xs space-y-2 ${
                    isCrit
                      ? 'bg-red-950/30 border-red-800/80'
                      : isWarn
                      ? 'bg-amber-950/25 border-amber-800/80'
                      : 'bg-slate-950 border-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isCrit ? (
                        <AlertOctagon className="w-4 h-4 text-red-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      )}
                      <h4 className="font-bold text-slate-100 text-sm">{warning.title}</h4>
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                        {warning.period}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        isCrit
                          ? 'bg-red-900/60 text-red-300'
                          : 'bg-amber-900/60 text-amber-300'
                      }`}
                    >
                      {isCrit ? 'خطأ حرج' : 'تحذير تدقيق'}
                    </span>
                  </div>

                  <p className="text-slate-300 leading-relaxed">
                    <strong className="text-slate-200">سبب الاشتباه المحاسبي: </strong>
                    {warning.reasonAr}
                  </p>

                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] text-emerald-300 flex items-start gap-2">
                    <span className="font-bold shrink-0 text-slate-300">الإجراء المطلوب للمراجعة:</span>
                    <span>{warning.reviewActionAr}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. High-Density Financial Statement Grid */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <span>جدول القوائم المالية الربع سنوية التراكمية (YTD) — {company.ticker}</span>
          </h3>
          <span className="text-[11px] text-slate-400">الأرقام بقيمتها الأساسية (ج.م)</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 whitespace-nowrap">
              <tr>
                <th className="p-3 text-start">الفترة المحاسبية</th>
                <th className="p-3 text-end font-mono">الإيرادات YTD</th>
                <th className="p-3 text-end font-mono">الربح التشغيلي EBIT</th>
                <th className="p-3 text-end font-mono">صافي الربح YTD</th>
                <th className="p-3 text-end font-mono">التدفق التشغيلي OCF</th>
                <th className="p-3 text-end font-mono">الإنفاق CapEx</th>
                <th className="p-3 text-end font-mono">توزيعات YTD</th>
                <th className="p-3 text-end font-mono">إجمالي الأصول</th>
                <th className="p-3 text-end font-mono">إجمالي الديون</th>
                <th className="p-3 text-end font-mono">النقدية</th>
                <th className="p-3 text-end font-mono">حقوق الملكية</th>
                <th className="p-3 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 whitespace-nowrap">
              {companyFinancials.length === 0 ? (
                <tr>
                  <td colSpan={12} className="p-8 text-center text-slate-400 font-sans">
                    لا توجد بيانات مالية مسجلة لهذه الشركة بعد. انقر على "إضافة ربع مالي" أو قم باستيراد ملف Excel.
                  </td>
                </tr>
              ) : (
                companyFinancials.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3 text-start">
                      <div className="font-bold text-slate-200">
                        {row.quarter} {row.year}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">{row.periodDate}</div>
                    </td>
                    <td className="p-3 text-end">{renderCell(row.revenueYTD)}</td>
                    <td className="p-3 text-end">{renderCell(row.operatingProfitYTD)}</td>
                    <td className="p-3 text-end font-semibold text-emerald-300">
                      {renderCell(row.netProfitYTD)}
                    </td>
                    <td className="p-3 text-end">{renderCell(row.operatingCashFlowYTD)}</td>
                    <td className="p-3 text-end">{renderCell(row.capexYTD)}</td>
                    <td className="p-3 text-end" title="تراكمي لا يُجمع">{renderCell(row.dividendsPaidYTD)}</td>
                    <td className="p-3 text-end">{renderCell(row.totalAssets)}</td>
                    <td className="p-3 text-end">{renderCell(row.totalDebt)}</td>
                    <td className="p-3 text-end">{renderCell(row.cashAndEquivalents)}</td>
                    <td className="p-3 text-end font-semibold text-slate-200">{renderCell(row.totalEquity)}</td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEditModal(row)}
                          className="p-1 text-slate-400 hover:text-emerald-400 transition-colors"
                          title="تعديل هذا الربع"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteQuarter(row.id)}
                          className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                          title="حذف هذا الربع"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Add / Edit Quarter Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">
                {editingQuarter ? 'تعديل بيانات الربع المالي' : 'إضافة ربع مالي جديد'} — {company.ticker}
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs text-slate-400">
              💡 <strong>تذكير مهم:</strong> اترك أي حقل غير معلن أو غير متاح فارغاً (BLANK). لا تكتب صفراً إلا إذا كان البند صفراً فعلياً.
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4 text-xs">
              {/* Year & Quarter & Date */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">السنة المالية</label>
                  <input
                    type="number"
                    value={formYear}
                    onChange={(e) => setFormYear(parseInt(e.target.value) || 2025)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">الربع المالي</label>
                  <select
                    value={formQuarter}
                    onChange={(e) => setFormQuarter(e.target.value as QuarterType)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    <option value="Q1">الربع الأول (Q1)</option>
                    <option value="Q2">الربع الثاني (Q2)</option>
                    <option value="Q3">الربع الثالث (Q3)</option>
                    <option value="FY">نهاية العام (FY / Q4)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">تاريخ نهاية الفترة</label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                  />
                </div>
              </div>

              {/* Income Statement YTD */}
              <div className="border-t border-slate-800 pt-3">
                <span className="text-slate-300 font-bold block mb-2">قائمة الدخل التراكمية (بالقيمة الأساسية):</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">الإيرادات YTD</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formRevenue}
                      onChange={(e) => setFormRevenue(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">مجمل الربح YTD</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formGrossProfit}
                      onChange={(e) => setFormGrossProfit(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">الربح التشغيلي EBIT</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formOperatingProfit}
                      onChange={(e) => setFormOperatingProfit(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">صافي الربح YTD</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formNetProfit}
                      onChange={(e) => setFormNetProfit(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Cash Flows & Dividends */}
              <div className="border-t border-slate-800 pt-3">
                <span className="text-slate-300 font-bold block mb-2">التدفقات النقدية والتوزيعات:</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">التدفق التشغيلي OCF</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formOcf}
                      onChange={(e) => setFormOcf(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">الإنفاق CapEx YTD</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formCapex}
                      onChange={(e) => setFormCapex(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">توزيعات مدفوعة YTD</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formDividendsPaidYTD}
                      onChange={(e) => setFormDividendsPaidYTD(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Balance Sheet Items */}
              <div className="border-t border-slate-800 pt-3">
                <span className="text-slate-300 font-bold block mb-2">المركز المالي لحظي (بالقيمة الأساسية):</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">إجمالي الأصول</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formAssets}
                      onChange={(e) => setFormAssets(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">إجمالي الديون</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formDebt}
                      onChange={(e) => setFormDebt(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">النقدية وما في حكمها</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formCash}
                      onChange={(e) => setFormCash(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">حقوق الملكية</label>
                    <input
                      type="text"
                      placeholder="BLANK"
                      value={formEquity}
                      onChange={(e) => setFormEquity(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-slate-400 mb-1">ملاحظات محاسبية</label>
                <input
                  type="text"
                  placeholder="أي تسويات، أرباح استثنائية، أو فروق عملة..."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                >
                  {editingQuarter ? 'حفظ التعديلات' : 'إضافة الربع'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
