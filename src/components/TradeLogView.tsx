/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  History,
  PlusCircle,
  FileSpreadsheet,
  Trash2,
  CheckCircle,
  Clock,
  TrendingUp,
  AlertCircle,
  Filter,
} from 'lucide-react';
import { Company, TradeLog } from '../types/financial';
import { exportTradeLogToExcel } from '../utils/excelExport';

interface TradeLogViewProps {
  companies: Company[];
  trades: TradeLog[];
  onAddTrade: (trade: TradeLog) => void;
  onUpdateTrade: (id: string, updates: Partial<TradeLog>) => void;
  onDeleteTrade: (id: string) => void;
}

export const TradeLogView: React.FC<TradeLogViewProps> = ({
  companies,
  trades,
  onAddTrade,
  onUpdateTrade,
  onDeleteTrade,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // New trade modal form state
  const [newCompanyId, setNewCompanyId] = useState(companies[0]?.id || '');
  const [newAction, setNewAction] = useState<TradeLog['action']>('شراء');
  const [newPlannedPrice, setNewPlannedPrice] = useState<number>(companies[0]?.marketPrice ?? 0);
  const [newTargetFairValue, setNewTargetFairValue] = useState<number>(0);
  const [newStopLoss, setNewStopLoss] = useState<number>(
    companies[0]?.marketPrice != null ? Number((companies[0].marketPrice * 0.9).toFixed(2)) : 0
  );
  const [newWeight, setNewWeight] = useState<number>(10);
  const [newNotes, setNewNotes] = useState<string>('');

  React.useEffect(() => {
    if (companies.length === 0) {
      setNewCompanyId('');
      return;
    }
    if (!companies.some((c) => c.id === newCompanyId)) {
      const first = companies[0];
      setNewCompanyId(first.id);
      setNewPlannedPrice(first.marketPrice ?? 0);
      setNewStopLoss(first.marketPrice != null ? Number((first.marketPrice * 0.9).toFixed(2)) : 0);
    }
  }, [companies, newCompanyId]);

  const filteredTrades = trades.filter((t) => {
    if (filterStatus === 'all') return true;
    return t.status === filterStatus;
  });

  const handleCreateTrade = (e: React.FormEvent) => {
    e.preventDefault();
    const comp = companies.find((c) => c.id === newCompanyId) || companies[0];
    if (!comp) return;
    const trade: TradeLog = {
      id: `trade_${Date.now()}`,
      companyId: comp.id,
      ticker: comp.ticker,
      companyName: comp.nameAr,
      action: newAction,
      plannedEntryPrice: Number(newPlannedPrice),
      targetFairValue: Number(newTargetFairValue),
      stopLoss: Number(newStopLoss),
      portfolioWeightPct: Number(newWeight),
      status: 'مخطط',
      entryDate: new Date().toISOString().split('T')[0],
      notes: newNotes,
    };
    onAddTrade(trade);
    setIsModalOpen(false);
    setNewNotes('');
  };

  const getStatusBadge = (status: TradeLog['status']) => {
    switch (status) {
      case 'مخطط':
        return 'bg-amber-950/80 text-amber-300 border-amber-800';
      case 'قيد التنفيذ':
        return 'bg-sky-950/80 text-sky-300 border-sky-800';
      case 'مفعل':
        return 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
      case 'مغلق':
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white">سجل الصفقات وقرارات التداول (Trade Log)</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              توثيق ومتابعة قرارات الدخول المخططة، مستويات وقف الخسارة، وتحقيق العوائد الفعلية ومطابقتها بالقيمة العادلة.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => exportTradeLogToExcel(trades)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              تصدير السجل Excel
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              disabled={companies.length === 0}
              title={companies.length === 0 ? 'لا يوجد أسهم لها بيانات مالية مسجلة بعد' : undefined}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              تسجيل صفقة جديدة
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="mt-4 pt-3 border-t border-slate-800 flex items-center gap-2 text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-400">تصفية حسب الحالة:</span>
          {['all', 'مخطط', 'قيد التنفيذ', 'مفعل', 'مغلق'].map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-2.5 py-1 rounded-md transition-all ${
                filterStatus === st
                  ? 'bg-emerald-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {st === 'all' ? 'جميع الصفقات' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Trades Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3 text-start">السهم والشركة</th>
                <th className="p-3 text-center">الإجراء</th>
                <th className="p-3 text-end font-mono">سعر الدخول المخطط</th>
                <th className="p-3 text-end font-mono">السعر المنفذ</th>
                <th className="p-3 text-end font-mono">المستهدف العادل</th>
                <th className="p-3 text-end font-mono">وقف الخسارة</th>
                <th className="p-3 text-center">الوزن بالمحفظة</th>
                <th className="p-3 text-center">الحالة</th>
                <th className="p-3 text-center font-mono">تاريخ الدخول</th>
                <th className="p-3 text-center">ملاحظات وإدارة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-900/60 font-mono">
              {filteredTrades.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-400 font-sans">
                    لا توجد صفقات مطابقة للفئة المحددة حالياً.
                  </td>
                </tr>
              ) : (
                filteredTrades.map((trade) => (
                  <tr key={trade.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3 text-start font-sans">
                      <div className="font-bold text-slate-100">{trade.companyName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{trade.ticker}</div>
                    </td>
                    <td className="p-3 text-center font-sans">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-semibold border border-slate-700">
                        {trade.action}
                      </span>
                    </td>
                    <td className="p-3 text-end text-slate-200">
                      {trade.plannedEntryPrice.toFixed(2)} ج.م
                    </td>
                    <td className="p-3 text-end text-emerald-400 font-semibold">
                      {trade.executedPrice ? `${trade.executedPrice.toFixed(2)} ج.م` : '-'}
                    </td>
                    <td className="p-3 text-end text-teal-300">
                      {trade.targetFairValue.toFixed(2)} ج.م
                    </td>
                    <td className="p-3 text-end text-red-400">
                      {trade.stopLoss.toFixed(2)} ج.م
                    </td>
                    <td className="p-3 text-center text-slate-300">
                      {trade.portfolioWeightPct}%
                    </td>
                    <td className="p-3 text-center font-sans">
                      <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${getStatusBadge(trade.status)}`}>
                        {trade.status}
                      </span>
                    </td>
                    <td className="p-3 text-center text-slate-400 text-[11px]">
                      {trade.entryDate}
                    </td>
                    <td className="p-3 text-center font-sans">
                      <div className="flex items-center justify-center gap-1.5">
                        {trade.status === 'مخطط' && (
                          <button
                            onClick={() =>
                              onUpdateTrade(trade.id, {
                                status: 'مفعل',
                                executedPrice: trade.plannedEntryPrice,
                              })
                            }
                            className="px-2 py-1 text-[11px] rounded bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900 transition-colors"
                            title="تأكيد التنفيذ والشراء"
                          >
                            تفعيل
                          </button>
                        )}
                        {trade.status === 'مفعل' && (
                          <button
                            onClick={() =>
                              onUpdateTrade(trade.id, {
                                status: 'مغلق',
                                exitDate: new Date().toISOString().split('T')[0],
                                returnPct: Number(
                                  (
                                    ((trade.targetFairValue - (trade.executedPrice || trade.plannedEntryPrice)) /
                                      (trade.executedPrice || trade.plannedEntryPrice)) *
                                    100
                                  ).toFixed(1)
                                ),
                              })
                            }
                            className="px-2 py-1 text-[11px] rounded bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
                            title="إغلاق الصفقة وجني الأرباح"
                          >
                            إغلاق
                          </button>
                        )}
                        <button
                          onClick={() => onDeleteTrade(trade.id)}
                          className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                          title="حذف الصفقة"
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

      {/* Add Trade Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">تسجيل صفقة جديدة في سجل التداول</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTrade} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">الشركة المستهدفة</label>
                <select
                  value={newCompanyId}
                  onChange={(e) => {
                    const cId = e.target.value;
                    setNewCompanyId(cId);
                    const sel = companies.find((c) => c.id === cId);
                    if (sel) {
                      const p = sel.marketPrice ?? 0;
                      setNewPlannedPrice(p);
                      setNewStopLoss(sel.marketPrice != null ? Number((sel.marketPrice * 0.9).toFixed(2)) : 0);
                    }
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameAr} ({c.ticker}) - السعر:{' '}
                      {c.marketPrice !== null ? `${c.marketPrice.toFixed(2)} ج.م` : 'غير متاح'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">نوع الإجراء</label>
                  <select
                    value={newAction}
                    onChange={(e) => setNewAction(e.target.value as TradeLog['action'])}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    <option value="شراء">شراء</option>
                    <option value="تجميع">تجميع تدريجي</option>
                    <option value="بيع">بيع / جني أرباح</option>
                    <option value="وقف خسارة">وقف خسارة</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">الوزن من المحفظة (%)</label>
                  <input
                    type="number"
                    value={newWeight}
                    onChange={(e) => setNewWeight(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">سعر الدخول المخطط</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newPlannedPrice}
                    onChange={(e) => setNewPlannedPrice(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">المستهدف العادل</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newTargetFairValue}
                    onChange={(e) => setNewTargetFairValue(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">وقف الخسارة</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newStopLoss}
                    onChange={(e) => setNewStopLoss(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">ملاحظات الصفقة</label>
                <textarea
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  rows={2}
                  placeholder="سبب الدخول، المحفز المنتظر، استراتيجية التخارج..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                >
                  حفظ الصفقة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
