/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, FlaskConical, Globe, RotateCcw } from 'lucide-react';
import {
  validateValuationLabFieldValue,
  type ValuationLabFieldDefinition,
} from '../core/contracts';
import { formatScopedAssumptionStateAr } from '../core/domain';
import type { ResolvedAssumption } from '../types/financial';

export interface ValuationParameterCardProps {
  field: ValuationLabFieldDefinition;
  companyId: string;
  ticker: string;
  savedCompanyValue: number | null;
  globalReferenceValue: number | null;
  resolved?: ResolvedAssumption;
  sensitivityValue?: number;
  canEditCompany: boolean;
  isAdmin: boolean;
  isBusy?: boolean;
  onSetSensitivityDraft: (key: string, value: number | null) => void;
  onSaveCompanyOverride?: (key: string, value: number) => Promise<void>;
  onDeleteCompanyOverride?: (key: string) => Promise<void>;
  onSaveGlobalMacro?: (key: string, value: number) => Promise<void>;
  footerExtra?: React.ReactNode;
  savedCompanyMeta?: { source?: string | null; asOfDate?: string | null };
  globalMeta?: { source?: string | null; asOfDate?: string | null };
  stageLabelAr?: string;
  stageEffectAr?: string;
  requirementBadgeAr?: string;
  inactiveForMethod?: boolean;
  inactiveReasonAr?: string | null;
  missingRequirementAr?: string | null;
  loadingUnconfirmed?: boolean;
  companyScopeConfirmed?: boolean;
  globalScopeConfirmed?: boolean;
  showRichDetails?: boolean;
}

const formatDisplayValue = (
  val: number | null | undefined,
  field: ValuationLabFieldDefinition
): string => {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'غير متاح';
  if (field.type === 'mode' && field.modeOptions?.length) {
    const matched = field.modeOptions.find((opt) => opt.value === val);
    return matched ? matched.shortLabelAr : `${val}`;
  }
  if (field.scale === 100) return `${(val * 100).toFixed(2)}%`;
  if (field.type === 'integer') return `${Math.round(val)}${field.unitSuffix}`;
  return `${Number(val.toFixed(4))}${field.unitSuffix}`;
};

const formatDraftInput = (
  val: number | null | undefined,
  scale: number
): string => {
  if (val === null || val === undefined || !Number.isFinite(val)) return '';
  return Number((val * scale).toFixed(4)).toString();
};

const getSourceBadge = (
  resolved: ResolvedAssumption | undefined,
  hasSensitivity: boolean,
  inactiveForMethod: boolean,
  loadingUnconfirmed: boolean
): { text: string; cls: string } => {
  if (inactiveForMethod) {
    return { text: 'غير مستخدم بالطريقة الحالية', cls: 'bg-slate-900 text-slate-400 border-slate-700' };
  }
  if (hasSensitivity) {
    return { text: 'مسودة حساسية مؤقتة', cls: 'bg-purple-950/70 text-purple-300 border-purple-800/60' };
  }
  if (!resolved || resolved.source === 'missing') {
    if (loadingUnconfirmed) {
      return { text: 'قيد تأكيد التحميل', cls: 'bg-sky-950/70 text-sky-300 border-sky-800/60' };
    }
    return { text: 'غير متاح', cls: 'bg-amber-950/60 text-amber-300 border-amber-800/60' };
  }
  if (resolved.source === 'company') {
    return { text: 'company_assumptions', cls: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60' };
  }
  return {
    text: resolved.key === 'targetPE' ? 'sectorPE (عام)' : 'macro_params (عام)',
    cls: 'bg-sky-950/70 text-sky-300 border-sky-800/60',
  };
};

const formatUnitLabelAr = (field: ValuationLabFieldDefinition): string => {
  if (field.type === 'pct') {
    if (field.min !== undefined && field.min < 0 && field.max !== undefined) {
      return `نسبة مئوية — تُدخل بالنسبة مثل 5 وتُحفظ ككسر عشري 0.05 (النطاق ${(field.min * 100).toFixed(0)}%..${(field.max * 100).toFixed(0)}%)`;
    }
    return 'نسبة مئوية — تُدخل بالنسبة مثل 5 وتُحفظ ككسر عشري 0.05';
  }
  if (field.type === 'mode') return 'رمز اختياري (1 / 2 / 3)';
  if (field.type === 'integer' && field.unit === 'years') return 'عدد صحيح (سنوات 1..20)';
  if (field.unit === 'ratio' && field.type === 'number') return 'رقم غير سالب (ليس نسبة مئوية)';
  return field.unit || 'رقم';
};

export const ValuationParameterCard: React.FC<ValuationParameterCardProps> = ({
  field,
  companyId,
  ticker,
  savedCompanyValue,
  globalReferenceValue,
  resolved,
  sensitivityValue,
  canEditCompany,
  isAdmin,
  isBusy = false,
  onSetSensitivityDraft,
  onSaveCompanyOverride,
  onDeleteCompanyOverride,
  onSaveGlobalMacro,
  footerExtra,
  savedCompanyMeta,
  globalMeta,
  stageLabelAr,
  stageEffectAr,
  requirementBadgeAr,
  inactiveForMethod = false,
  inactiveReasonAr,
  missingRequirementAr,
  loadingUnconfirmed = false,
  companyScopeConfirmed,
  globalScopeConfirmed,
  showRichDetails = false,
}) => {
  const hasSensitivity = sensitivityValue !== undefined && Number.isFinite(sensitivityValue);
  const currentBaseValue = hasSensitivity ? sensitivityValue! : savedCompanyValue;

  const [draft, setDraft] = useState<string>(() => formatDraftInput(currentBaseValue, field.scale));
  const [inputError, setInputError] = useState<string | null>(null);
  const [confirmGlobalOpen, setConfirmGlobalOpen] = useState(false);

  useEffect(() => {
    setDraft(formatDraftInput(hasSensitivity ? sensitivityValue : savedCompanyValue, field.scale));
    setInputError(null);
    setConfirmGlobalOpen(false);
  }, [companyId, savedCompanyValue, sensitivityValue, hasSensitivity, field.scale]);

  const parseDraftValue = (): number | null | 'invalid' => {
    const trimmed = draft.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setInputError('أدخل قيمة رقمية منتهية صالحة.');
      return 'invalid';
    }
    const storedValue = parsed / field.scale;
    const check = validateValuationLabFieldValue(field.key, storedValue);
    if (!check.valid) {
      setInputError(check.reasonAr || 'القيمة خارج النطاق المسموح.');
      return 'invalid';
    }
    setInputError(null);
    return storedValue;
  };

  const handleApplySensitivity = () => {
    if (inactiveForMethod) return;
    const val = parseDraftValue();
    if (val === 'invalid') return;
    onSetSensitivityDraft(field.registryKey, val);
  };

  const handleSaveCompany = async () => {
    if (inactiveForMethod || !onSaveCompanyOverride || !canEditCompany) return;
    const val = parseDraftValue();
    if (val === 'invalid') return;
    if (val === null) {
      if (savedCompanyValue !== null && onDeleteCompanyOverride) {
        await onDeleteCompanyOverride(field.registryKey);
      } else {
        setInputError('أدخل قيمة صالحة للحفظ أو استخدم زر المسح لحذف التخصيص.');
      }
      return;
    }
    await onSaveCompanyOverride(field.registryKey, val);
  };

  const handleSaveGlobalConfirmed = async () => {
    if (inactiveForMethod || !onSaveGlobalMacro || !isAdmin) return;
    const val = parseDraftValue();
    if (val === 'invalid' || val === null) {
      if (val === null) setInputError('أدخل قيمة رقمية صالحة لحفظ المرجع العام.');
      return;
    }
    setConfirmGlobalOpen(false);
    await onSaveGlobalMacro(field.registryKey, val);
  };

  const badge = getSourceBadge(resolved, hasSensitivity, inactiveForMethod, loadingUnconfirmed);
  const isOverriddenByPriority = Boolean(resolved?.isOverriddenByPriority);
  const canSaveGlobalHere =
    !inactiveForMethod && isAdmin && field.allowedScopes.includes('global') && Boolean(onSaveGlobalMacro);
  const canEditCompanyHere = !inactiveForMethod && canEditCompany && field.allowedScopes.includes('company');
  const controlsDisabled = isBusy || inactiveForMethod;
  const isMissingEffective =
    !inactiveForMethod &&
    !loadingUnconfirmed &&
    (!resolved || resolved.source === 'missing') &&
    !hasSensitivity;

  const activeSourceLabel = hasSensitivity
    ? 'مسودة حساسية مؤقتة (محلي — بدون حفظ)'
    : resolved?.source === 'company'
    ? `تخصيص الشركة (company_assumptions/${ticker}/parameters/${field.registryKey})`
    : resolved?.source === 'global'
    ? resolved.key === 'targetPE'
      ? 'المرجع العام للقطاع (sectorPE)'
      : `المتغيرات الكلية (macro_params/${field.registryKey})`
    : loadingUnconfirmed
    ? 'قيد تأكيد التحميل من الخادم'
    : 'غير متاح';

  const activeAsOfDate = hasSensitivity
    ? null
    : resolved?.asOfDate ||
      (resolved?.source === 'company' ? savedCompanyMeta?.asOfDate : resolved?.source === 'global' ? globalMeta?.asOfDate : null) ||
      null;
  const activeSourceRef = hasSensitivity
    ? 'تجربة محلية في الذاكرة'
    : resolved?.parameterSource ||
      (resolved?.source === 'company' ? savedCompanyMeta?.source : resolved?.source === 'global' ? globalMeta?.source : null) ||
      null;

  return (
    <div
      data-testid={`param-card-${field.registryKey}`}
      data-inactive-for-method={inactiveForMethod ? 'true' : 'false'}
      className={`p-3 rounded-xl border space-y-2 transition-opacity ${
        inactiveForMethod
          ? 'bg-slate-950/45 border-slate-800/70 opacity-75'
          : hasSensitivity
          ? 'bg-slate-950/80 border-purple-700/80'
          : 'bg-slate-950/80 border-slate-800'
      }`}
    >
      <div className="flex justify-between items-start gap-2 text-slate-300 font-medium">
        <div className="space-y-0.5">
          <span className="leading-snug block">{field.labelAr}</span>
          {(stageLabelAr || requirementBadgeAr) && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              {stageLabelAr && (
                <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                  {stageLabelAr}
                </span>
              )}
              {requirementBadgeAr && (
                <span
                  className={`px-1.5 py-0.5 rounded border ${
                    inactiveForMethod
                      ? 'bg-slate-900 border-slate-700 text-slate-400'
                      : 'bg-cyan-950/60 border-cyan-800/60 text-cyan-300'
                  }`}
                >
                  {requirementBadgeAr}
                </span>
              )}
            </div>
          )}
        </div>
        <span
          className={`font-mono font-bold shrink-0 text-end ${
            inactiveForMethod ? 'text-slate-400' : 'text-emerald-400'
          }`}
        >
          {formatDisplayValue(resolved?.value, field)}
        </span>
      </div>

      {showRichDetails && (
        <div className="text-[10px] text-slate-400 leading-relaxed space-y-0.5">
          <div>{field.descriptionAr}</div>
          <div>
            وحدة الإدخال: <span className="text-slate-300 font-mono">{formatUnitLabelAr(field)}</span>
            {stageEffectAr ? (
              <>
                {' · '}
                <span>{stageEffectAr}</span>
              </>
            ) : null}
          </div>
        </div>
      )}

      {inactiveForMethod && inactiveReasonAr && (
        <div className="rounded-lg bg-slate-900/90 border border-slate-700/80 px-2.5 py-1.5 text-[10px] text-slate-300 leading-relaxed">
          {inactiveReasonAr}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className={`text-[10px] px-2 py-0.5 rounded border font-mono ${badge.cls}`}>{badge.text}</span>
        <div className="flex items-center gap-2">
          {hasSensitivity && !inactiveForMethod && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onSetSensitivityDraft(field.registryKey, null)}
              className="inline-flex items-center gap-1 text-[10px] text-purple-300 hover:text-purple-200 disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" />
              <span>إلغاء المسودة</span>
            </button>
          )}
          {savedCompanyValue !== null && canEditCompanyHere && onDeleteCompanyOverride && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setInputError(null);
                void onDeleteCompanyOverride(field.registryKey);
              }}
              className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-amber-300 disabled:opacity-50"
              title={`حذف تخصيص company_assumptions/${ticker}/parameters/${field.registryKey}`}
            >
              <RotateCcw className="w-3 h-3" />
              <span>مسح تخصيص الشركة</span>
            </button>
          )}
        </div>
      </div>

      <div className="relative">
        {field.type === 'mode' && field.modeOptions?.length ? (
          <select
            disabled={controlsDisabled}
            value={draft}
            aria-label={field.labelAr}
            onChange={(e) => {
              setDraft(e.target.value);
              if (inputError) setInputError(null);
            }}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">— غير محدد (بدون اختيار افتراضي صامت) —</option>
            {field.modeOptions.map((opt) => (
              <option key={opt.value} value={String(opt.value)}>
                {opt.labelAr}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              type="number"
              inputMode="decimal"
              step={field.step}
              disabled={controlsDisabled}
              value={draft}
              placeholder={field.placeholder}
              aria-label={field.labelAr}
              onChange={(e) => {
                setDraft(e.target.value);
                if (inputError) setInputError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDraft(formatDraftInput(hasSensitivity ? sensitivityValue : savedCompanyValue, field.scale));
                  setInputError(null);
                }
              }}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {field.unitSuffix && (
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 pointer-events-none">
                {field.unitSuffix}
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {field.supportsSensitivityDraft && (
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={handleApplySensitivity}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-950/80 hover:bg-purple-900 border border-purple-700/70 text-purple-200 text-[10px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="إعادة حساب فورية في الذاكرة فقط بدون أي كتابة في Firestore"
          >
            <FlaskConical className="w-3 h-3" />
            <span>تجربة مؤقتة</span>
          </button>
        )}

        {canEditCompanyHere && onSaveCompanyOverride && (
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={() => void handleSaveCompany()}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={`حفظ في company_assumptions/${ticker}/parameters/${field.registryKey}`}
          >
            <Check className="w-3 h-3" />
            <span>حفظ للشركة</span>
          </button>
        )}

        {canSaveGlobalHere && (
          <button
            type="button"
            disabled={controlsDisabled}
            onClick={() => {
              const parsed = parseDraftValue();
              if (parsed === 'invalid' || parsed === null) {
                if (parsed === null) setInputError('أدخل قيمة صالحة قبل تعديل المرجع العام.');
                return;
              }
              setConfirmGlobalOpen((v) => !v);
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-950/80 hover:bg-sky-900 border border-sky-700/70 text-sky-200 text-[10px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={`حفظ في المرجع العام macro_params/${field.registryKey} (للمدير فقط)`}
          >
            <Globe className="w-3 h-3" />
            <span>تعديل العام</span>
          </button>
        )}
      </div>

      {confirmGlobalOpen && canSaveGlobalHere && (
        <div className="p-2 rounded-lg bg-amber-950/50 border border-amber-700/70 text-[10px] text-amber-200 space-y-1.5">
          <div className="flex items-start gap-1.5 font-semibold">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <span>
              تحذير تأثير شامل: سيُحفظ هذا التعديل في <span className="font-mono">macro_params/{field.registryKey}</span> ويؤثر على كافة شركات السوق غير المخصصة.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleSaveGlobalConfirmed()}
              className="px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold"
            >
              تأكيد حفظ المرجع العام
            </button>
            <button
              type="button"
              onClick={() => setConfirmGlobalOpen(false)}
              className="px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {inputError && <span className="text-[10px] text-red-400 block">{inputError}</span>}

      {(() => {
        const effectiveCompanyConfirmed = companyScopeConfirmed ?? !loadingUnconfirmed;
        const effectiveGlobalConfirmed = globalScopeConfirmed ?? !loadingUnconfirmed;
        const companyScopePres = formatScopedAssumptionStateAr({
          value: savedCompanyValue,
          scopeConfirmed: effectiveCompanyConfirmed,
          formatValue: (v) => formatDisplayValue(v, field),
          documentarySource: savedCompanyMeta?.source,
          asOfDate: savedCompanyMeta?.asOfDate,
          includeMissingDocumentaryNote: showRichDetails,
        });
        const globalScopePres = formatScopedAssumptionStateAr({
          value: globalReferenceValue,
          scopeConfirmed: effectiveGlobalConfirmed,
          formatValue: (v) => formatDisplayValue(v, field),
          documentarySource: globalMeta?.source,
          asOfDate: globalMeta?.asOfDate,
          includeMissingDocumentaryNote: showRichDetails,
        });
        return (
          <div className="text-[10px] text-slate-400 space-y-0.5 leading-relaxed">
            <div>
              تخصيص الشركة:{' '}
              <span className="font-mono text-slate-200">{companyScopePres.valueTextAr}</span>
              {companyScopePres.documentaryNoteAr && (
                <span className="text-slate-500"> ({companyScopePres.documentaryNoteAr})</span>
              )}
              {' · '}
              المرجع العام:{' '}
              <span className="font-mono text-sky-300">{globalScopePres.valueTextAr}</span>
              {globalScopePres.documentaryNoteAr && (
                <span className="text-slate-500"> ({globalScopePres.documentaryNoteAr})</span>
              )}
            </div>
        {showRichDetails && (
          <div className="space-y-0.5">
            <div>
              الفعلي المستخدم بعد الأولوية:{' '}
              <span className="font-mono text-emerald-300">{formatDisplayValue(resolved?.value, field)}</span>
              {' · '}
              النطاق المعتمد: <span className="text-slate-300">{activeSourceLabel}</span>
            </div>
            {(resolved?.value !== null && resolved?.value !== undefined) || hasSensitivity ? (
              <div>
                المصدر التوثيقي:{' '}
                <span className="text-slate-300">
                  {activeSourceRef || 'المصدر التوثيقي غير موثق (القيمة متاحة)'}
                </span>
                {' · '}
                تاريخ السريان:{' '}
                <span className="font-mono text-slate-300">{activeAsOfDate || 'غير محدد'}</span>
              </div>
            ) : null}
          </div>
        )}
        {isOverriddenByPriority && savedCompanyValue !== null && (
          <div className="text-sky-300">
            • تخصيص الشركة محفوظ، لكن المرجع العام نشط حالياً وفق أولوية (global_first).
          </div>
        )}
        {isMissingEffective && missingRequirementAr && (
          <div className="text-amber-300">• {missingRequirementAr}</div>
        )}
          </div>
        );
      })()}

      {footerExtra}
    </div>
  );
};
