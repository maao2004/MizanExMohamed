/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertOctagon, Trash2, AlertTriangle } from 'lucide-react';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  title: string;
  itemName: string;
  cascadeImpacts?: string[];    // الآثار المترتبة على الحذف التدميري
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  title,
  itemName,
  cascadeImpacts = [],
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-red-900/60 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        
        {/* Header with warning icon */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-950 text-red-400 border border-red-800/80 flex items-center justify-center shrink-0">
            <AlertOctagon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">{title}</h3>
            <span className="text-xs text-slate-400 block mt-0.5">
              العنصر المستهدف: <strong className="text-red-300 font-mono">{itemName}</strong>
            </span>
          </div>
        </div>

        {/* Warning text */}
        <p className="text-xs text-slate-300 leading-relaxed">
          هذا الإجراء نهائي ولا يمكن التراجع عنه. سيتم حذف هذا السجل فوراً من قاعدة البيانات السحابية (Firestore) ومخزن الذاكرة المحلي (Cache).
        </p>

        {/* Cascade Impacts Checklist (الآثار المترتبة على الحذف التابع) */}
        {cascadeImpacts.length > 0 && (
          <div className="bg-red-950/40 border border-red-900/60 rounded-xl p-3.5 space-y-2 text-xs">
            <span className="font-bold text-red-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              الآثار المترتبة على الحذف النهائي (Cascade Effects):
            </span>
            <ul className="space-y-1.5 text-slate-300 text-[11px] list-disc list-inside">
              {cascadeImpacts.map((impact, idx) => (
                <li key={idx} className="leading-relaxed">
                  {impact}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            إلغاء الأمر
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white shadow-sm transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            تأكيد الحذف النهائي
          </button>
        </div>
      </div>
    </div>
  );
};
