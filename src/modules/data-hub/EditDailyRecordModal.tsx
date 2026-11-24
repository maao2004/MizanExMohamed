/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { X, TrendingUp, AlertCircle, Save, Search } from 'lucide-react';
import {
  DailyRawCellValue,
  DailyTradingRecord,
  DailyTradingSchemaRecord,
  ManualCorrectionsMap,
} from '../../types';

interface EditDailyRecordModalProps {
  isOpen: boolean;
  onClose: () => void | Promise<void>;
  record: DailyTradingRecord;
  dailySchema?: DailyTradingSchemaRecord | null;
  onSave: (updatedRecord: DailyTradingRecord) => void | Promise<void>;
}

export const EditDailyRecordModal: React.FC<EditDailyRecordModalProps> = ({
  isOpen,
  onClose,
  record,
  dailySchema = null,
  onSave,
}) => {
  const [formData, setFormData] = useState<DailyTradingRecord>({
    ...record,
    rawCells: record.rawCells ? { ...record.rawCells } : undefined,
  });
  const [dynamicFilter, setDynamicFilter] = useState('');

  const dynamicExtraCols = useMemo(() => {
    const seen = new Map<
      string,
      { colId: string; colLetter: string; headerName: string | null; mappedField: string | null; index: number }
    >();
    if (dailySchema?.columns) {
      for (const c of [...dailySchema.columns].sort((a, b) => a.index - b.index)) {
        seen.set(c.colId, {
          colId: c.colId,
          colLetter: c.colLetter,
          headerName: c.headerName,
          mappedField: c.mappedField,
          index: c.index,
        });
      }
    }
    if (formData.rawCells) {
      for (const colId of Object.keys(formData.rawCells)) {
        if (!seen.has(colId)) {
          const m = /^col_(\d+)$/.exec(colId);
          seen.set(colId, {
            colId,
            colLetter: colId,
            headerName: null,
            mappedField: null,
            index: m ? Number(m[1]) : Number.MAX_SAFE_INTEGER,
          });
        }
      }
    }
    const q = dynamicFilter.trim().toLowerCase();
    return [...seen.values()]
      .sort((a, b) => a.index - b.index || a.colId.localeCompare(b.colId))
      .filter((c) => {
        if (!q) return true;
        return (
          (c.headerName ?? '').toLowerCase().includes(q) ||
          c.colLetter.toLowerCase().includes(q) ||
          c.colId.toLowerCase().includes(q) ||
          (c.mappedField ?? '').toLowerCase().includes(q)
        );
      });
  }, [dailySchema, formData.rawCells, dynamicFilter]);

  if (!isOpen) return null;

  const syncRawCellsForMappedField = (
    prevRawCells: Record<string, DailyRawCellValue> | undefined,
    field: keyof DailyTradingRecord,
    nextVal: number | null
  ): Record<string, DailyRawCellValue> | undefined => {
    if (!prevRawCells || !dailySchema?.columns?.length) return prevRawCells;
    const matchingCols = dailySchema.columns.filter((c) => c.mappedField === field);
    if (matchingCols.length === 0) return prevRawCells;
    const nextRaw = { ...prevRawCells };
    for (const col of matchingCols) {
      if (nextVal === null) {
        delete nextRaw[col.colId];
      } else {
        nextRaw[col.colId] = {
          v: nextVal,
          t: 'n',
          w: String(nextVal),
        };
      }
    }
    return nextRaw;
  };

  const handleNumberChange = (field: keyof DailyTradingRecord, valueStr: string) => {
    const trimmed = valueStr.trim();
    if (trimmed === '' || trimmed.toUpperCase() === 'BLANK') {
      setFormData((prev) => ({
        ...prev,
        [field]: null,
        rawCells: syncRawCellsForMappedField(prev.rawCells, field, null),
      }));
      return;
    }
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      const normalizedNum = Object.is(num, -0) ? 0 : num;
      setFormData((prev) => ({
        ...prev,
        [field]: normalizedNum,
        rawCells: syncRawCellsForMappedField(prev.rawCells, field, normalizedNum),
      }));
    }
  };

  const handleDynamicRawCellChange = (
    colId: string,
    mappedField: string | null,
    inputVal: string
  ) => {
    const trimmed = inputVal.trim();
    setFormData((prev) => {
      const nextRaw = { ...(prev.rawCells ?? {}) };
      if (trimmed === '' || trimmed.toUpperCase() === 'BLANK') {
        delete nextRaw[colId];
        const patch: Partial<DailyTradingRecord> = mappedField
          ? ({ [mappedField]: null } as Partial<DailyTradingRecord>)
          : {};
        return { ...prev, ...patch, rawCells: nextRaw };
      }

      const existingCell = nextRaw[colId];
      const upper = trimmed.toUpperCase();
      if (upper === 'TRUE' || upper === 'FALSE') {
        nextRaw[colId] = { v: upper === 'TRUE', t: 'b', w: upper };
        return { ...prev, rawCells: nextRaw };
      }

      const looksLikeLeadingZeroCode = /^0\d+$/.test(trimmed);
      const asNum = Number(trimmed);
      const shouldStoreAsNumber =
        !looksLikeLeadingZeroCode &&
        existingCell?.t !== 's' &&
        Number.isFinite(asNum);

      if (shouldStoreAsNumber) {
        const cleanNum = Object.is(asNum, -0) ? 0 : asNum;
        nextRaw[colId] = { v: cleanNum, t: 'n', w: trimmed };
        const patch: Partial<DailyTradingRecord> = mappedField
          ? ({ [mappedField]: cleanNum } as Partial<DailyTradingRecord>)
          : {};
        return { ...prev, ...patch, rawCells: nextRaw };
      }

      nextRaw[colId] = { v: inputVal, t: 's', w: inputVal };
      const patch: Partial<DailyTradingRecord> = mappedField
        ? ({ [mappedField]: inputVal } as Partial<DailyTradingRecord>)
        : {};
      return { ...prev, ...patch, rawCells: nextRaw };
    });
  };

  const normalizeScalar = (v: unknown): string | number | boolean | null => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v) : null;
    if (typeof v === 'boolean' || typeof v === 'string') return v;
    return String(v);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nowIso = new Date().toISOString();
    const nextOriginalValues: Record<string, string | number | boolean | null> = {
      ...(record.originalValues ?? {}),
    };
    const nextManualCorrections: ManualCorrectionsMap = {
      ...(record.manualCorrections ?? {}),
    };

    const ignoreFields = new Set([
      'updatedAt',
      'originalValues',
      'manualCorrections',
      'rawCells',
      'contentHash',
      'serverUpdatedAt',
    ]);

    const applyCorrection = (
      correctionKey: string,
      beforeVal: string | number | boolean | null,
      afterVal: string | number | boolean | null
    ) => {
      if (beforeVal === afterVal) return;
      const baselineOriginal =
        correctionKey in nextOriginalValues ? nextOriginalValues[correctionKey] : beforeVal;
      if (afterVal === baselineOriginal) {
        delete nextManualCorrections[correctionKey];
      } else {
        nextOriginalValues[correctionKey] = baselineOriginal;
        nextManualCorrections[correctionKey] = {
          field: correctionKey,
          originalValue: baselineOriginal,
          correctedValue: afterVal,
          editedAt: nowIso,
        };
      }
    };

    const allTypedFields = new Set([...Object.keys(record), ...Object.keys(formData)]);
    for (const field of allTypedFields) {
      if (ignoreFields.has(field)) continue;
      applyCorrection(
        field,
        normalizeScalar((record as unknown as Record<string, unknown>)[field]),
        normalizeScalar((formData as unknown as Record<string, unknown>)[field])
      );
    }

    const mappedColIds = new Set(
      (dailySchema?.columns ?? [])
        .filter((c) => Boolean(c.mappedField))
        .map((c) => c.colId)
    );
    const allRawColIds = new Set([
      ...Object.keys(record.rawCells ?? {}),
      ...Object.keys(formData.rawCells ?? {}),
    ]);
    for (const colId of allRawColIds) {
      if (mappedColIds.has(colId)) continue;
      const beforeCell = record.rawCells?.[colId];
      const afterCell = formData.rawCells?.[colId];
      applyCorrection(
        colId,
        normalizeScalar(beforeCell?.v ?? null),
        normalizeScalar(afterCell?.v ?? null)
      );
    }

    await onSave({
      ...formData,
      ...(Object.keys(nextOriginalValues).length > 0 ? { originalValues: nextOriginalValues } : {}),
      ...(Object.keys(nextManualCorrections).length > 0 ? { manualCorrections: nextManualCorrections } : {}),
      updatedAt: nowIso,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-white">
                تعديل وتحديث سجل التداول اليومي: {record.ticker} ({record.tradeDate})
              </h3>
              <p className="text-xs text-slate-400">
                تطابق ديناميكي مع جميع أعمدة شاشة تداول البورصة ({(dailySchema?.totalColumns ?? Object.keys(formData.rawCells ?? {}).length) || 40} عموداً) — الحفظ في الكاش وFirestore مع تحديث السعر السوقي فوراً
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body (Scrollable Form) */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
          
          <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              أي تعديل على <strong>السعر الأخير (Last Price)</strong> أو <strong>إقفال اليوم (Close Price)</strong> سينعكس تلقائياً على السعر السوقي للسهم في نماذج التقييم وهامش الأمان.
            </span>
          </div>

          {/* Section 1: الأسعار الأساسية والتغير */}
          <div className="space-y-3">
            <h4 className="font-bold uppercase tracking-wider text-emerald-400 border-b border-slate-800 pb-1.5">
              1. الأسعار الرئيسية ومعدلات التغير (Prices & Daily Changes) — بالجنيه المصري
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-400 mb-1 font-bold text-emerald-400">السعر الأخير (أخر):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.lastPrice ?? ''}
                  onChange={(e) => handleNumberChange('lastPrice', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-emerald-600/60 rounded-lg px-3 py-2 font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-bold text-slate-200">إقفال اليوم (إقفال):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.closePrice ?? ''}
                  onChange={(e) => handleNumberChange('closePrice', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">سعر الفتح (فتح):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.openPrice ?? ''}
                  onChange={(e) => handleNumberChange('openPrice', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">إقفال سابق:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.prevClose ?? ''}
                  onChange={(e) => handleNumberChange('prevClose', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">التغير %:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.changePct ?? ''}
                  onChange={(e) => handleNumberChange('changePct', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">السعر الأدنى (الأدنى):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.lowPrice ?? ''}
                  onChange={(e) => handleNumberChange('lowPrice', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">السعر الأعلى (أعلى):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.highPrice ?? ''}
                  onChange={(e) => handleNumberChange('highPrice', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">متوسط السعر المرجح (VWAP):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.vwap ?? ''}
                  onChange={(e) => handleNumberChange('vwap', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 2: أحجام وقيم التداول والسيولة */}
          <div className="space-y-3">
            <h4 className="font-bold uppercase tracking-wider text-teal-400 border-b border-slate-800 pb-1.5">
              2. أحجام وقيم التداول وحركة السيولة (Liquidity & Volume)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">قيمة التداول (جنيه):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.turnoverValue ?? ''}
                  onChange={(e) => handleNumberChange('turnoverValue', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">حجم التداول (أسهم):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.volume ?? ''}
                  onChange={(e) => handleNumberChange('volume', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">صافي السيولة:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.netLiquidity ?? ''}
                  onChange={(e) => handleNumberChange('netLiquidity', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">عدد الصفقات المنفذة:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.tradesCount ?? ''}
                  onChange={(e) => handleNumberChange('tradesCount', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 text-emerald-300">السيولة الداخلة:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.inflowLiquidity ?? ''}
                  onChange={(e) => handleNumberChange('inflowLiquidity', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 text-red-300">السيولة الخارجة:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.outflowLiquidity ?? ''}
                  onChange={(e) => handleNumberChange('outflowLiquidity', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">أوامر السيولة الداخلة:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.inflowOrders ?? ''}
                  onChange={(e) => handleNumberChange('inflowOrders', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">حجم السيولة الداخلة:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.inflowVolume ?? ''}
                  onChange={(e) => handleNumberChange('inflowVolume', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 3: عمق السوق وعروض وطلبات التداول */}
          <div className="space-y-3">
            <h4 className="font-bold uppercase tracking-wider text-sky-400 border-b border-slate-800 pb-1.5">
              3. عمق السوق وعروض وطلبات التداول (Market Depth & Orders)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">إجمالي الطلبات:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.totalBids ?? ''}
                  onChange={(e) => handleNumberChange('totalBids', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">عدد الطلبات:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.bidsCount ?? ''}
                  onChange={(e) => handleNumberChange('bidsCount', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">إجمالي العروض:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.totalOffers ?? ''}
                  onChange={(e) => handleNumberChange('totalOffers', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">عدد العروض:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.offersCount ?? ''}
                  onChange={(e) => handleNumberChange('offersCount', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 4: نطاق الـ 52 أسبوعاً والمتوسطات المتحركة والأسهم المدرجة */}
          <div className="space-y-3">
            <h4 className="font-bold uppercase tracking-wider text-purple-400 border-b border-slate-800 pb-1.5">
              4. نطاق الـ 52 أسبوعاً والمتوسطات والتقييم (52W Range & Moving Averages)
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">الأعلى 52 أسبوعاً:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.high52W ?? ''}
                  onChange={(e) => handleNumberChange('high52W', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">الأدنى 52 أسبوعاً:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.low52W ?? ''}
                  onChange={(e) => handleNumberChange('low52W', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">مضاعف الربحية (P/E):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.peRatio ?? ''}
                  onChange={(e) => handleNumberChange('peRatio', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-teal-400 font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">الأسهم المدرجة (سهم):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.listedShares ?? ''}
                  onChange={(e) => handleNumberChange('listedShares', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">رأس المال السوقي (بالألف):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.marketCapThousands ?? ''}
                  onChange={(e) => handleNumberChange('marketCapThousands', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">متوسط الحجم 5 أيام:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.avgVolume5D ?? ''}
                  onChange={(e) => handleNumberChange('avgVolume5D', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">متوسط الحجم 30 يوم:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.avgVolume30D ?? ''}
                  onChange={(e) => handleNumberChange('avgVolume30D', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">متوسط الحجم 90 يوم:</label>
                <input
                  type="number"
                  step="any"
                  value={formData.avgVolume90D ?? ''}
                  onChange={(e) => handleNumberChange('avgVolume90D', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">مضاعف القيمة الدفترية (P/B):</label>
                <input
                  type="number"
                  step="any"
                  value={formData.pbRatio ?? ''}
                  onChange={(e) => handleNumberChange('pbRatio', e.target.value)}
                  placeholder="BLANK (غير متاح)"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-cyan-400 font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Section 5: الأعمدة الديناميكية الأصلية (Raw Cells) */}
          {(dailySchema?.columns?.length || Object.keys(formData.rawCells ?? {}).length > 0) && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
                <h4 className="font-bold uppercase tracking-wider text-amber-400">
                  5. الأعمدة الديناميكية الأصلية من الملف ({dynamicExtraCols.length} عموداً)
                </h4>
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={dynamicFilter}
                    onChange={(e) => setDynamicFilter(e.target.value)}
                    placeholder="تصفية الأعمدة..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pr-8 pl-2.5 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto p-1">
                {dynamicExtraCols.map((col) => {
                  const cell = formData.rawCells?.[col.colId];
                  const valStr =
                    cell === undefined || cell === null || cell.v === null || cell.v === undefined
                      ? ''
                      : cell.t === 'n' && cell.w
                      ? cell.w
                      : String(cell.v);
                  return (
                    <div key={col.colId} className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5">
                      <label className="flex items-center justify-between gap-1 text-[11px] text-slate-300 mb-1">
                        <span className="truncate font-medium" title={col.headerName ?? col.colId}>
                          {col.headerName ?? `العمود ${col.colLetter} (بدون عنوان)`}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {col.colLetter} · {col.colId}
                        </span>
                      </label>
                      <input
                        type="text"
                        value={valStr}
                        onChange={(e) =>
                          handleDynamicRawCellChange(col.colId, col.mappedField, e.target.value)
                        }
                        placeholder={
                          cell?.formulaMissingCachedResult
                            ? `صيغة بلا قيمة (=${cell.f ?? ''})`
                            : 'BLANK (غير متاح)'
                        }
                        className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 font-mono text-[11px] text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Submit Actions */}
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
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-950/40 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>حفظ وتحديث التداول في Firestore</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
