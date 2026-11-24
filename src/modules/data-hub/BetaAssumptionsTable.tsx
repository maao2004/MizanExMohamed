/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Activity, Trash2 } from 'lucide-react';
import { BetaAssumptionRecord, UserRole } from '../../types';

interface BetaAssumptionsTableProps {
  records: BetaAssumptionRecord[];
  selectedBaseTicker: string | null;
  userRole: UserRole;
  canDelete: boolean;
  onRequestDelete: (ticker: string) => void;
}

export const BetaAssumptionsTable: React.FC<BetaAssumptionsTableProps> = ({
  records,
  selectedBaseTicker,
  userRole,
  canDelete,
  onRequestDelete,
}) => {
  const showDeleteCol = userRole === 'admin' && canDelete;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-sky-400" />
            <span>جدول افتراضات بيتا التاريخية المعتمدة (beta_assumptions)</span>
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            المصدر الوحيد لقيم بيتا الخام؛ لا تُستخدم بيتا 1.00 إلا بعد تأكيد الخادم غياب سجل السهم هنا.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-start">
          <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
            <tr>
              <th className="p-3 text-start">الرمز الموحد</th>
              <th className="p-3 text-end font-mono">Beta التاريخية الخام</th>
              <th className="p-3 text-center font-mono">تاريخ القياس (AsOfDate)</th>
              <th className="p-3 text-start">المصدر الموثق</th>
              <th className="p-3 text-start">تصنيف السجل</th>
              <th className="p-3 text-center font-mono">آخر تحديث</th>
              {showDeleteCol && <th className="p-3 text-center">حذف</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
            {records.length === 0 ? (
              <tr>
                <td colSpan={showDeleteCol ? 7 : 6} className="p-8 text-center text-slate-400">
                  لا توجد سجلات بيتا محفوظة حالياً في مجموعة beta_assumptions. استورد Beta_Assumptions.xlsx لتسجيل بيتا الأسهم.
                </td>
              </tr>
            ) : (
              records.map((rec) => (
                <tr
                  key={rec.ticker}
                  className={`hover:bg-slate-800/40 transition-colors ${
                    rec.ticker === selectedBaseTicker ? 'bg-emerald-950/20' : ''
                  }`}
                >
                  <td className="p-3 font-mono font-bold text-slate-100">{rec.ticker}</td>
                  <td className="p-3 text-end font-mono font-bold text-sky-300">{rec.beta.toFixed(4)}</td>
                  <td className="p-3 text-center font-mono text-slate-300">{rec.asOfDate || '-'}</td>
                  <td className="p-3 text-slate-300">{rec.source || '-'}</td>
                  <td className="p-3 text-sky-300/90 text-[11px]">
                    سجل تاريخي معتمد (<span className="font-mono">beta_assumptions</span>)
                  </td>
                  <td className="p-3 text-center font-mono text-[11px] text-slate-400">
                    {rec.updatedAt?.split('T')[0] || '-'}
                  </td>
                  {showDeleteCol && (
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => onRequestDelete(rec.ticker)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                        title="حذف سجل بيتا"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
