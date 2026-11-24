/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { SlidersHorizontal, Trash2 } from 'lucide-react';
import { CompanyParameterOverride, UserRole } from '../../types';

interface CompanyOverridesTableProps {
  visibleOverrides: CompanyParameterOverride[];
  totalCount: number;
  selectedBaseTicker: string | null;
  filterScope: 'selected' | 'all';
  userRole: UserRole;
  canDelete: boolean;
  onChangeFilterScope: (scope: 'selected' | 'all') => void;
  onRequestDelete: (target: { ticker: string; key: string }) => void;
}

export const CompanyOverridesTable: React.FC<CompanyOverridesTableProps> = ({
  visibleOverrides,
  totalCount,
  selectedBaseTicker,
  filterScope,
  userRole,
  canDelete,
  onChangeFilterScope,
  onRequestDelete,
}) => {
  const showDeleteCol = (userRole === 'admin' || userRole === 'data_entry') && canDelete;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-amber-400" />
            <span>تخصيصات معاملات الشركات (company_assumptions / parameters)</span>
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            المعاملات الخاصة بكل شركة المستوردة من All_Parameters.xlsx (Scope=company).
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs shrink-0">
          <button
            type="button"
            onClick={() => onChangeFilterScope('selected')}
            className={`px-2.5 py-1 rounded-lg font-semibold ${
              filterScope === 'selected' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            السهم المحدد ({selectedBaseTicker || '-'})
          </button>
          <button
            type="button"
            onClick={() => onChangeFilterScope('all')}
            className={`px-2.5 py-1 rounded-lg font-semibold ${
              filterScope === 'all' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            كافة الشركات ({totalCount})
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-start">
          <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
            <tr>
              <th className="p-3 text-start">السهم</th>
              <th className="p-3 text-start">المعامل (Key)</th>
              <th className="p-3 text-end font-mono">القيمة</th>
              <th className="p-3 text-center font-mono">الوحدة</th>
              <th className="p-3 text-center font-mono">AsOfDate</th>
              <th className="p-3 text-start">المصدر والوصف</th>
              {showDeleteCol && <th className="p-3 text-center">حذف</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
            {visibleOverrides.length === 0 ? (
              <tr>
                <td colSpan={showDeleteCol ? 7 : 6} className="p-8 text-center text-slate-400">
                  لا توجد تخصيصات معاملات مسجلة حالياً في هذا النطاق.
                </td>
              </tr>
            ) : (
              visibleOverrides.map((ov) => (
                <tr key={`${ov.ticker}_${ov.key}`} className="hover:bg-slate-800/40 transition-colors">
                  <td className="p-3 font-mono font-bold text-slate-100">{ov.ticker}</td>
                  <td className="p-3 font-mono text-emerald-300">{ov.key}</td>
                  <td className="p-3 text-end font-mono font-bold text-amber-300">{ov.value}</td>
                  <td className="p-3 text-center font-mono text-slate-400">{ov.unit || '-'}</td>
                  <td className="p-3 text-center font-mono text-slate-400">{ov.asOfDate || '-'}</td>
                  <td className="p-3 text-[11px] text-slate-300">
                    <div>{ov.source || '-'}</div>
                    {ov.description && <div className="text-slate-500">{ov.description}</div>}
                  </td>
                  {showDeleteCol && (
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={() => onRequestDelete({ ticker: ov.ticker, key: ov.key })}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/40 transition-colors"
                        title="حذف التخصيص وإنشاء شاهد حذف"
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
