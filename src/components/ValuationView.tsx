/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Info,
  RefreshCw,
  RotateCcw,
  Sliders,
  Table as TableIcon,
} from 'lucide-react';
import {
  AssumptionPriority,
  BetaAssumptionRecord,
  Company,
  CompanyParameterOverride,
  FinancialMetricsTTM,
  RequestedQuarterlyEditTarget,
  RimRetentionPolicy,
  SectorClassification,
  SectorDefinition,
  SectorPeLoadStatus,
  TerminalValueMethod,
  ValuationResults,
} from '../types/financial';
import type {
  DailyTradingRecord,
  MacroParameter,
  QuarterlyFinancialRecord,
} from '../types';
import {
  buildParameterUpdatePrecondition,
  getParameterDefinition,
  getValuationLabField,
  ParameterWritePrecondition,
  RELATIVE_WEIGHT_REGISTRY_KEYS,
  VALUATION_LAB_FIELD_REGISTRY,
  type ValuationLabFieldDefinition,
} from '../core/contracts';
import {
  classifyCompanySector,
  describeBetaEffectiveSource,
  formatNormalizedSharePct,
  formatRawRelativeWeight,
  formatScopedAssumptionStateAr,
  getSectorClassificationLabelAr,
  ValuationSaveConcurrencyController,
} from '../core/domain';
import { runValuationModels } from '../utils/financialCalculations';
import type {
  ParameterSaveReceipt,
  SaveCompanyOverrideInput,
} from '../services/firebase/firestoreService';
import { DcfDetailsView } from './DcfDetailsView';
import { DdmAuditCard } from './DdmAuditCard';
import { MetricAuditCard } from './MetricAuditCard';
import { ValuationSourcesCard } from './ValuationSourcesCard';
import { ValuationParameterCard } from './ValuationParameterCard';
import { ValuationBetaPanel } from './ValuationBetaPanel';
import { RimAuditSection } from './RimAuditSection';

interface ValuationViewProps {
  company: Company;
  metrics: FinancialMetricsTTM;
  valuation: ValuationResults;
  assumptionPriority: AssumptionPriority;
  onChangePriority: (priority: AssumptionPriority) => void;
  terminalValueMethod?: TerminalValueMethod;
  onChangeTerminalValueMethod?: (method: TerminalValueMethod) => void;
  rimRetentionPolicy?: RimRetentionPolicy;
  onChangeRimRetentionPolicy?: (policy: RimRetentionPolicy) => void;
  valuationDate?: string;
  onChangeValuationDate?: (date: string) => void;
  onUpdateCompanyParams: (updates: Partial<Company>) => void;
  companyOverridesMap?: Record<string, CompanyParameterOverride>;
  companyOverridesConfirmed?: boolean;
  paramsMap?: Record<string, number>;
  macroParams?: MacroParameter[];
  macroParamsConfirmed?: boolean;
  macroMetaMap?: Record<
    string,
    Pick<MacroParameter, 'asOfDate' | 'source' | 'enabledInEngine' | 'rfMethodology'>
  >;
  sectorPEMap?: Record<string, number>;
  sectorDefinitions?: SectorDefinition[];
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
  sectorPeError?: string | null;
  selectedBetaRecord?: BetaAssumptionRecord | null;
  betaConfirmed?: boolean;
  betaError?: boolean;
  selectedStockQuarterly?: QuarterlyFinancialRecord[];
  selectedLatestDaily?: DailyTradingRecord;
  isAdmin?: boolean;
  canEditFinancials?: boolean;
  onSaveCompanyOverride?: (input: SaveCompanyOverrideInput) => Promise<ParameterSaveReceipt>;
  onDeleteCompanyOverride?: (ticker: string, key: string) => Promise<{ docPath: string }>;
  onSaveBetaAssumption?: (record: BetaAssumptionRecord) => Promise<ParameterSaveReceipt>;
  onDeleteBetaAssumption?: (ticker: string) => Promise<{ docPath: string }>;
  onSaveGlobalMacroParam?: (
    param: MacroParameter,
    precondition: ParameterWritePrecondition
  ) => Promise<ParameterSaveReceipt>;
  onRequestEditTarget?: (target: RequestedQuarterlyEditTarget) => void;
  onOpenDividendRecords?: () => void;
  initialModelTab?: 'dcf' | 'ddm' | 'rim' | 'relative' | 'graham';
  userScopeKey?: string;
}

interface SaveFeedbackState {
  status: 'idle' | 'saving' | 'error' | 'confirmed';
  actionLabelAr?: string;
  docPath?: string;
  errorAr?: string;
  savedValueText?: string;
  effectiveValueText?: string;
  activeSourceText?: string;
  priorityOverrideWarningAr?: string;
  reloadNoteAr?: string;
}

const WACC_GROWTH_REGISTRY_KEYS = [
  'Rf_Egypt_10Y',
  'ERP_Developed',
  'Cost_of_Debt',
  'TaxRate',
  'Terminal_Growth',
] as const;

const RELATIVE_REGISTRY_KEYS = ['Target_PE', 'Target_PB'] as const;

const formatFieldValueText = (
  val: number | null | undefined,
  field: ValuationLabFieldDefinition | null
): string => {
  if (val === null || val === undefined || !Number.isFinite(val)) return 'غير متاح';
  if (field?.type === 'mode' && field.modeOptions?.length) {
    const matched = field.modeOptions.find((opt) => opt.value === val);
    return matched ? matched.shortLabelAr : `${val}`;
  }
  if (field?.scale === 100) return `${(val * 100).toFixed(2)}%`;
  if (field?.type === 'integer') return `${Math.round(val)}${field.unitSuffix ?? ''}`;
  return `${Number(val.toFixed(3))}${field?.unitSuffix ?? ''}`;
};

export const ValuationView: React.FC<ValuationViewProps> = ({
  company,
  metrics,
  valuation,
  assumptionPriority,
  onChangePriority,
  terminalValueMethod = 'perpetuity_growth',
  onChangeTerminalValueMethod,
  rimRetentionPolicy = 'rim_parameter',
  onChangeRimRetentionPolicy,
  valuationDate,
  onChangeValuationDate,
  onUpdateCompanyParams,
  companyOverridesMap = {},
  companyOverridesConfirmed = true,
  paramsMap = {},
  macroParams = [],
  macroParamsConfirmed = true,
  macroMetaMap,
  sectorPEMap = {},
  sectorDefinitions,
  sectorPeConfirmed,
  sectorPeStatus,
  sectorPeError,
  selectedBetaRecord = null,
  betaConfirmed = true,
  betaError = false,
  selectedStockQuarterly,
  selectedLatestDaily,
  isAdmin = false,
  canEditFinancials = false,
  onSaveCompanyOverride,
  onDeleteCompanyOverride,
  onSaveBetaAssumption,
  onDeleteBetaAssumption,
  onSaveGlobalMacroParam,
  onRequestEditTarget,
  onOpenDividendRecords,
  initialModelTab = 'dcf',
  userScopeKey = 'guest',
}) => {
  const [activeModelTab, setActiveModelTab] = useState<'dcf' | 'ddm' | 'rim' | 'relative' | 'graham'>(initialModelTab);

  // Mode 1: Local in-memory Sensitivity Drafts (ZERO Firestore writes, auto-cleared on ticker/user change)
  const [sensitivityDrafts, setSensitivityDrafts] = useState<Record<string, number>>({});
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedbackState>({ status: 'idle' });
  const [inFlightCompoundKeys, setInFlightCompoundKeys] = useState<string[]>([]);
  const activeUserScopeRef = useRef<string>(userScopeKey);
  activeUserScopeRef.current = userScopeKey;

  const saveControllerRef = useRef<ValuationSaveConcurrencyController | null>(null);
  if (!saveControllerRef.current) {
    saveControllerRef.current = new ValuationSaveConcurrencyController(company.ticker);
  }
  saveControllerRef.current.setActiveTicker(company.ticker);

  useEffect(() => {
    saveControllerRef.current = new ValuationSaveConcurrencyController(company.ticker);
    setSensitivityDrafts({});
    setSaveFeedback({ status: 'idle' });
    setInFlightCompoundKeys([]);
  }, [company.id, company.ticker, userScopeKey]);

  const activeValuationDate =
    valuationDate ||
    valuation.sourcesSummary?.valuationDate ||
    valuation.sourcesSummary?.dividendSummary?.valuationDate ||
    null;

  const hasActiveSensitivityDraft = Object.keys(sensitivityDrafts).length > 0;

  // Recompute locally in-memory when temporary sensitivity drafts are active
  const effectiveValuation = useMemo(() => {
    if (!hasActiveSensitivityDraft) return valuation;

    const draftCompanyOverrides: Record<string, CompanyParameterOverride> = {
      ...companyOverridesMap,
    };
    const draftParams: Record<string, number> = { ...paramsMap };
    const draftMacroMetaMap = macroMetaMap ? { ...macroMetaMap } : {};
    let draftBetaRecord: BetaAssumptionRecord | null = selectedBetaRecord;
    let draftBetaConfirmed = betaConfirmed;

    for (const [draftKey, draftVal] of Object.entries(sensitivityDrafts)) {
      if (!Number.isFinite(draftVal)) continue;
      if (draftKey === 'Beta') {
        draftBetaRecord = {
          ticker: company.ticker,
          beta: draftVal,
          asOfDate: '',
          source: 'مسودة حساسية مؤقتة (محلي)',
        };
        draftBetaConfirmed = true;
      } else {
        draftCompanyOverrides[draftKey] = {
          ticker: company.ticker,
          key: draftKey,
          value: draftVal,
          scope: 'company',
          source: 'مسودة حساسية مؤقتة (محلي)',
          asOfDate: undefined,
        };
        if (assumptionPriority === 'global_first' && draftKey in draftParams) {
          draftParams[draftKey] = draftVal;
          draftMacroMetaMap[draftKey] = {
            ...draftMacroMetaMap[draftKey],
            source: 'مسودة حساسية مؤقتة (محلي)',
            asOfDate: undefined,
          };
        }
      }
    }

    return runValuationModels(company, metrics, undefined, draftParams, {
      priority: assumptionPriority,
      sectorPEMap,
      sectorDefinitions,
      sectorPeConfirmed,
      sectorPeStatus,
      sectorPeError,
      quarterlyRecords: selectedStockQuarterly,
      latestDaily: selectedLatestDaily,
      betaRecord: draftBetaRecord,
      betaConfirmed: draftBetaConfirmed,
      betaError: betaError ? 'تعذر تأكيد مجموعة beta_assumptions من Firestore' : null,
      companyOverridesMap: draftCompanyOverrides,
      companyOverridesConfirmed,
      macroParamsConfirmed,
      macroMetaMap: draftMacroMetaMap,
      terminalValueMethod,
      rimRetentionPolicy,
      valuationDate: activeValuationDate,
      disableLegacyCompanyFallback: true,
      sensitivityDraftKeys: Object.keys(sensitivityDrafts),
    });
  }, [
    hasActiveSensitivityDraft,
    valuation,
    sensitivityDrafts,
    companyOverridesMap,
    companyOverridesConfirmed,
    paramsMap,
    macroParamsConfirmed,
    selectedBetaRecord,
    betaConfirmed,
    betaError,
    company,
    metrics,
    assumptionPriority,
    sectorPEMap,
    sectorDefinitions,
    sectorPeConfirmed,
    sectorPeStatus,
    sectorPeError,
    selectedStockQuarterly,
    selectedLatestDaily,
    macroMetaMap,
    terminalValueMethod,
    rimRetentionPolicy,
    activeValuationDate,
  ]);

  const effectiveMetrics: FinancialMetricsTTM = useMemo(() => {
    if (!hasActiveSensitivityDraft) return metrics;
    return {
      ...metrics,
      costOfEquity: effectiveValuation.engineOutputs?.costOfEquity ?? effectiveValuation.costOfEquity ?? metrics.costOfEquity,
      wacc: effectiveValuation.engineOutputs?.wacc ?? effectiveValuation.wacc ?? metrics.wacc,
    };
  }, [hasActiveSensitivityDraft, metrics, effectiveValuation]);

  const resolved = effectiveValuation.resolvedAssumptions ?? {};
  const sectorClass =
    effectiveValuation.sourcesSummary?.sectorClassification ??
    classifyCompanySector(company.sector, company.sectorClassification ?? null, {
      sectorId: company.sectorId ?? null,
      sectorDefinitions,
      sectorPeConfirmed,
      sectorPeStatus,
    });
  const finCurrency =
    effectiveValuation.engineOutputs?.financialCurrency ?? effectiveMetrics.financialCurrency ?? null;
  const finCurrencyLabel =
    finCurrency === 'EGP' ? 'ج.م' : finCurrency === 'USD' ? 'USD' : '';
  const mktCurrency =
    effectiveMetrics.marketPriceCurrency ?? effectiveValuation.engineOutputs?.marketPriceCurrency ?? null;
  const mktCurrencyLabel =
    mktCurrency === 'EGP' ? 'ج.م' : mktCurrency === 'USD' ? 'USD' : 'غير محددة';

  const handleSetSensitivityDraft = (key: string, val: number | null) => {
    setSensitivityDrafts((prev) => {
      const next = { ...prev };
      if (val === null || !Number.isFinite(val)) {
        delete next[key];
      } else {
        next[key] = val;
      }
      return next;
    });
  };

  const canEditCompanyParams = canEditFinancials || isAdmin;

  const scrollToElement = (elementId: string) => {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(elementId);
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const focusable = el.querySelector<HTMLElement>('input, select, button');
    if (focusable && typeof focusable.focus === 'function') {
      focusable.focus({ preventScroll: true });
    }
  };

  const isKeyBusy = (key: string): boolean =>
    inFlightCompoundKeys.includes(
      ValuationSaveConcurrencyController.makeCompoundKey(company.ticker, key)
    );

  const trackInFlightAdd = (compoundKey: string) => {
    setInFlightCompoundKeys((prev) => (prev.includes(compoundKey) ? prev : [...prev, compoundKey]));
  };

  const trackInFlightRemove = (compoundKey: string) => {
    setInFlightCompoundKeys((prev) => prev.filter((item) => item !== compoundKey));
  };

  const handleCommitCompanyOverride = async (
    key: string,
    value: number,
    meta?: { source?: string; asOfDate?: string }
  ) => {
    if (!onSaveCompanyOverride || !saveControllerRef.current) return;
    const handle = saveControllerRef.current.beginRequest(company.ticker, key);
    if (!handle) return;

    trackInFlightAdd(handle.compoundKey);
    const fieldDef = getValuationLabField(key);
    const activePrioritySnapshot = assumptionPriority;
    setSaveFeedback({
      status: 'saving',
      actionLabelAr: `جارٍ حفظ تخصيص ${key} للشركة (${handle.ticker}) في company_assumptions...`,
    });

    try {
      const receipt = await onSaveCompanyOverride({
        ticker: handle.ticker,
        key,
        value,
        source: meta?.source || 'معمل التقييم',
        asOfDate: meta?.asOfDate || new Date().toISOString().slice(0, 10),
      });

      const completion = saveControllerRef.current.completeRequest(handle);
      trackInFlightRemove(handle.compoundKey);
      if (!completion.shouldApplyUiState) return;

      // Clear local draft for this key once persisted cleanly on the active ticker
      handleSetSensitivityDraft(key, null);

      const resolvedField = fieldDef ? resolved[fieldDef.resolvedKey] : undefined;
      const globalRef = resolvedField?.globalValue ?? paramsMap[key] ?? null;
      const isGlobalActiveOverCompany =
        activePrioritySnapshot === 'global_first' && globalRef !== null && globalRef !== undefined;

      const effectiveVal = isGlobalActiveOverCompany ? globalRef : value;
      const activeSourceText = isGlobalActiveOverCompany
        ? key === 'Target_PE'
          ? 'sectorPE (الأولوية العامة نشطة)'
          : 'macro_params (الأولوية العامة نشطة)'
        : `company_assumptions (${receipt.docPath})`;

      setSaveFeedback({
        status: 'confirmed',
        actionLabelAr: `تم تأكيد حفظ ${key} في Firestore`,
        docPath: receipt.docPath,
        savedValueText: formatFieldValueText(value, fieldDef),
        effectiveValueText: formatFieldValueText(effectiveVal, fieldDef),
        activeSourceText,
        priorityOverrideWarningAr: isGlobalActiveOverCompany
          ? `تنبيه أولوية الافتراضات: تم حفظ تخصيص الشركة بنجاح في ${receipt.docPath}، لكن القيمة النشطة حالياً هي المرجع العام (${formatFieldValueText(globalRef, fieldDef)}) لأن وضع "الافتراض العام أولاً" مفعّل.`
          : undefined,
        reloadNoteAr: 'تم تأكيد الكتابة من الخادم وحفظها في السجل المعتمد بحيث تثبت بعد إعادة تحميل الصفحة.',
      });
    } catch (err) {
      const completion = saveControllerRef.current.completeRequest(handle);
      trackInFlightRemove(handle.compoundKey);
      if (!completion.shouldApplyUiState) return;
      setSaveFeedback({
        status: 'error',
        actionLabelAr: `فشل حفظ ${key}`,
        errorAr: err instanceof Error ? err.message : 'تعذر تأكيد الحفظ من الخادم.',
      });
    }
  };

  const handleCommitDeleteCompanyOverride = async (key: string) => {
    if (!onDeleteCompanyOverride || !saveControllerRef.current) return;
    const handle = saveControllerRef.current.beginRequest(company.ticker, key);
    if (!handle) return;

    trackInFlightAdd(handle.compoundKey);
    const fieldDef = getValuationLabField(key);
    setSaveFeedback({
      status: 'saving',
      actionLabelAr: `جارٍ مسح تخصيص ${key} (${handle.ticker}) من company_assumptions...`,
    });

    try {
      const res = await onDeleteCompanyOverride(handle.ticker, key);
      const completion = saveControllerRef.current.completeRequest(handle);
      trackInFlightRemove(handle.compoundKey);
      if (!completion.shouldApplyUiState) return;

      handleSetSensitivityDraft(key, null);

      const resolvedField = fieldDef ? resolved[fieldDef.resolvedKey] : undefined;
      const fallbackVal = resolvedField?.globalValue ?? paramsMap[key] ?? null;

      setSaveFeedback({
        status: 'confirmed',
        actionLabelAr: `تم مسح تخصيص الشركة لـ ${key}`,
        docPath: res.docPath,
        savedValueText: 'محذوف (بلا تخصيص شركة)',
        effectiveValueText: formatFieldValueText(fallbackVal, fieldDef),
        activeSourceText:
          fallbackVal !== null
            ? key === 'Target_PE'
              ? 'الرجوع إلى sectorPE العام'
              : 'الرجوع إلى macro_params العام'
            : 'غير متاح (بانتظار مرجع عام أو تخصيص جديد)',
        reloadNoteAr: 'تم إنشاء شاهد الحذف وتحديث الحالة بعد تأكيد الخادم.',
      });
    } catch (err) {
      const completion = saveControllerRef.current.completeRequest(handle);
      trackInFlightRemove(handle.compoundKey);
      if (!completion.shouldApplyUiState) return;
      setSaveFeedback({
        status: 'error',
        actionLabelAr: `فشل مسح تخصيص ${key}`,
        errorAr: err instanceof Error ? err.message : 'تعذر مسح تخصيص الشركة من الخادم.',
      });
    }
  };

  const handleCommitGlobalMacro = async (key: string, value: number) => {
    if (!onSaveGlobalMacroParam || !saveControllerRef.current) return;
    const startUserScope = activeUserScopeRef.current;
    const controller = saveControllerRef.current;
    const handle = controller.beginRequest(company.ticker, `macro:${key}`);
    if (!handle) return;

    trackInFlightAdd(handle.compoundKey);
    const fieldDef = getValuationLabField(key);
    const regDef = getParameterDefinition(key);
    const existingMacro = macroParams.find((p) => p.key === key);

    setSaveFeedback({
      status: 'saving',
      actionLabelAr: `جارٍ حفظ المرجع العام ${key} في macro_params...`,
    });

    try {
      const payload: MacroParameter = {
        key,
        nameAr: existingMacro?.nameAr || fieldDef?.labelAr || regDef?.nameAr || key,
        descriptionAr:
          existingMacro?.descriptionAr || fieldDef?.descriptionAr || regDef?.descriptionAr || key,
        value,
        category: existingMacro?.category || regDef?.category || 'tax_rf',
        isPercentage: existingMacro?.isPercentage ?? regDef?.isPercentage,
        unit: existingMacro?.unit || fieldDef?.unit || regDef?.unit || 'decimal',
        asOfDate: new Date().toISOString().slice(0, 10),
        source: 'معمل التقييم — تعديل المرجع العام',
        enabledInEngine: existingMacro?.enabledInEngine ?? regDef?.enabledInEngine ?? true,
        ...(existingMacro?.rfMethodology ? { rfMethodology: existingMacro.rfMethodology } : {}),
        ...(existingMacro?.currency ? { currency: existingMacro.currency } : {}),
      };

      const precondition: ParameterWritePrecondition = existingMacro
        ? buildParameterUpdatePrecondition(existingMacro)
        : { mode: 'create' };
      const receipt = await onSaveGlobalMacroParam(payload, precondition);
      const completion = controller.completeRequest(handle);
      const isSameSession =
        activeUserScopeRef.current === startUserScope && saveControllerRef.current === controller;
      if (!isSameSession || !completion.shouldApplyUiState) return;
      trackInFlightRemove(handle.compoundKey);

      const companyOverride = companyOverridesMap[key]?.value ?? null;
      const isCompanyOverridingGlobal =
        assumptionPriority === 'company_first' && companyOverride !== null;

      setSaveFeedback({
        status: 'confirmed',
        actionLabelAr: `تم تأكيد تحديث المرجع العام ${key}`,
        docPath: receipt.docPath,
        savedValueText: formatFieldValueText(value, fieldDef),
        effectiveValueText: formatFieldValueText(
          isCompanyOverridingGlobal ? companyOverride : value,
          fieldDef
        ),
        activeSourceText: isCompanyOverridingGlobal
          ? `تخصيص الشركة لا يزال نشطاً (${handle.ticker})`
          : 'macro_params (المرجع العام النشط)',
        priorityOverrideWarningAr: isCompanyOverridingGlobal
          ? `تم تحديث المرجع العام لجميع الشركات بنجاح، ولكن تخصيص هذه الشركة (${formatFieldValueText(companyOverride, fieldDef)}) لا يزال نشطاً لهذا السهم وفق أولوية company_first.`
          : undefined,
        reloadNoteAr: 'تم تأكيد تحديث macro_params من الخادم.',
      });
    } catch (err) {
      const completion = controller.completeRequest(handle);
      const isSameSession =
        activeUserScopeRef.current === startUserScope && saveControllerRef.current === controller;
      if (!isSameSession || !completion.shouldApplyUiState) return;
      trackInFlightRemove(handle.compoundKey);
      setSaveFeedback({
        status: 'error',
        actionLabelAr: `فشل حفظ المرجع العام ${key}`,
        errorAr: err instanceof Error ? err.message : 'تعذر تحديث المرجع العام من الخادم.',
      });
    }
  };

  const handleCommitBetaAssumption = async (record: BetaAssumptionRecord) => {
    if (!onSaveBetaAssumption || !saveControllerRef.current) return;
    const handle = saveControllerRef.current.beginRequest(record.ticker, 'Beta');
    if (!handle) return;

    trackInFlightAdd(handle.compoundKey);
    setSaveFeedback({
      status: 'saving',
      actionLabelAr: `جارٍ حفظ سجل بيتا التاريخية في beta_assumptions/${handle.ticker}...`,
    });

    try {
      const receipt = await onSaveBetaAssumption({ ...record, ticker: handle.ticker });
      const completion = saveControllerRef.current.completeRequest(handle);
      trackInFlightRemove(handle.compoundKey);
      if (!completion.shouldApplyUiState) return;

      handleSetSensitivityDraft('Beta', null);
      const analyticalVal = companyOverridesMap['Beta_Analytical']?.value ?? null;
      const rawW = resolved.betaRawWeight?.value ?? 0.67;
      const anchor = resolved.betaAnchor?.value ?? 1;
      const adj = rawW * record.beta + (1 - rawW) * anchor;
      const effectiveKeBeta = analyticalVal ?? adj;

      setSaveFeedback({
        status: 'confirmed',
        actionLabelAr: `تم حفظ بيتا التاريخية الخام للسهم ${handle.ticker}`,
        docPath: receipt.docPath,
        savedValueText: record.beta.toFixed(3),
        effectiveValueText: `${effectiveKeBeta.toFixed(3)} (Blume المعدلة: ${adj.toFixed(3)})`,
        activeSourceText: analyticalVal !== null
          ? 'Beta_Analytical مفعّل لـ Ke (مع بقاء سجل beta_assumptions محفوظاً)'
          : `beta_assumptions/${handle.ticker}`,
        reloadNoteAr: 'تم تأكيد الحفظ في مجموعة beta_assumptions من الخادم.',
      });
    } catch (err) {
      const completion = saveControllerRef.current.completeRequest(handle);
      trackInFlightRemove(handle.compoundKey);
      if (!completion.shouldApplyUiState) return;
      setSaveFeedback({
        status: 'error',
        actionLabelAr: 'فشل حفظ بيتا التاريخية',
        errorAr: err instanceof Error ? err.message : 'تعذر حفظ سجل beta_assumptions.',
      });
    }
  };

  const handleCommitDeleteBeta = async (tickerToDelete: string) => {
    if (!onDeleteBetaAssumption || !saveControllerRef.current) return;
    const handle = saveControllerRef.current.beginRequest(tickerToDelete, 'Beta');
    if (!handle) return;

    trackInFlightAdd(handle.compoundKey);
    setSaveFeedback({
      status: 'saving',
      actionLabelAr: `جارٍ حذف سجل beta_assumptions/${handle.ticker}...`,
    });
    try {
      const res = await onDeleteBetaAssumption(handle.ticker);
      const completion = saveControllerRef.current.completeRequest(handle);
      trackInFlightRemove(handle.compoundKey);
      if (!completion.shouldApplyUiState) return;

      handleSetSensitivityDraft('Beta', null);
      setSaveFeedback({
        status: 'confirmed',
        actionLabelAr: `تم حذف سجل بيتا التاريخية للسهم ${handle.ticker}`,
        docPath: res.docPath,
        savedValueText: 'محذوف (لا يوجد سجل)',
        effectiveValueText: '1.000 (سياسة غياب السجل المؤكدة)',
        activeSourceText: 'سياسة غياب السجل الموثقة = 1.00',
        reloadNoteAr: 'تم حذف السجل وإصدار شاهد حذف موثق على الخادم.',
      });
    } catch (err) {
      const completion = saveControllerRef.current.completeRequest(handle);
      trackInFlightRemove(handle.compoundKey);
      if (!completion.shouldApplyUiState) return;
      setSaveFeedback({
        status: 'error',
        actionLabelAr: 'فشل حذف سجل بيتا',
        errorAr: err instanceof Error ? err.message : 'تعذر حذف سجل beta_assumptions.',
      });
    }
  };

  const waccGrowthFields = WACC_GROWTH_REGISTRY_KEYS.map((k) => getValuationLabField(k)).filter(
    (f): f is ValuationLabFieldDefinition => f !== null
  );
  const relativeFields = RELATIVE_REGISTRY_KEYS.map((k) => getValuationLabField(k)).filter(
    (f): f is ValuationLabFieldDefinition => f !== null
  );
  const relativeWeightFields = RELATIVE_WEIGHT_REGISTRY_KEYS.map((k) => getValuationLabField(k)).filter(
    (f): f is ValuationLabFieldDefinition => f !== null
  );
  const relativeAudit =
    effectiveValuation.relativeAudit ??
    effectiveValuation.engineOutputs?.relativeAudit ??
    effectiveValuation.sourcesSummary?.relativeAudit ??
    null;

  return (
    <div className="space-y-6">
      {/* 1. Header & Navigation */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white">معمل التقييم المالي الشامل وحساسية السيناريوهات</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              تطبيق النماذج الخمسة بالتوازي لسهم <strong className="text-slate-200">{company.nameAr} ({company.ticker})</strong> ومقارنة السيناريوهات وحوكمة مصادر الافتراضات.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 bg-slate-950 p-2.5 rounded-xl border border-slate-800 shrink-0">
            <span className="text-xs text-slate-400">
              {hasActiveSensitivityDraft ? 'القيمة العادلة (مسودة حساسية):' : 'القيمة العادلة المرجحة:'}
            </span>
            <span className={`text-lg font-bold font-mono ${hasActiveSensitivityDraft ? 'text-purple-300' : 'text-emerald-400'}`}>
              {effectiveValuation.compositeFairValue?.toFixed(2) ?? 'غير متاح'}{finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}
            </span>
            <span className="text-xs text-slate-500">·</span>
            <span className="text-xs text-slate-300 font-mono">
              السوق: {company.marketPrice !== null ? `${company.marketPrice.toFixed(2)} ${mktCurrencyLabel}` : 'غير متاح'}
            </span>
            {company.latestTradeDate && (
              <>
                <span className="text-xs text-slate-500">·</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  آخر جلسة تداول: {company.latestTradeDate}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mode 1 Banner: Temporary Local Sensitivity Drafts */}
      {hasActiveSensitivityDraft && (
        <div
          role="status"
          className="rounded-xl p-3.5 border border-purple-700/80 bg-purple-950/35 text-xs text-purple-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2">
            <FlaskConical className="w-4 h-4 text-purple-300 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-purple-100">
                وضع تجربة الحساسية المؤقتة مفعّل (تعديل محلي في الذاكرة — بدون حفظ إلى Firestore)
              </div>
              <div className="text-[11px] text-purple-200/90 mt-0.5 font-mono">
                المفاتيح المعدلة مؤقتاً: {Object.keys(sensitivityDrafts).join(' ، ')} — يتم مسح المسودة تلقائياً عند تغيير السهم.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSensitivityDrafts({})}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 text-white text-xs font-semibold shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>إعادة ضبط مسودة الحساسية</span>
          </button>
        </div>
      )}

      {/* Post-Save Feedback Banner */}
      {saveFeedback.status !== 'idle' && (
        <div
          role={saveFeedback.status === 'error' ? 'alert' : 'status'}
          className={`rounded-xl p-3.5 border text-xs space-y-1.5 ${
            saveFeedback.status === 'saving'
              ? 'border-amber-700/70 bg-amber-950/35 text-amber-200'
              : saveFeedback.status === 'error'
              ? 'border-red-700/80 bg-red-950/40 text-red-200'
              : 'border-emerald-700/80 bg-emerald-950/35 text-emerald-100'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-bold">
              {saveFeedback.status === 'saving' && <RefreshCw className="w-4 h-4 animate-spin text-amber-300" />}
              {saveFeedback.status === 'error' && <AlertTriangle className="w-4 h-4 text-red-400" />}
              {saveFeedback.status === 'confirmed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              <span>{saveFeedback.actionLabelAr}</span>
            </div>
            {saveFeedback.status !== 'saving' && (
              <button
                type="button"
                onClick={() => setSaveFeedback({ status: 'idle' })}
                className="text-[11px] text-slate-300 hover:text-white"
              >
                إخفاء
              </button>
            )}
          </div>

          {saveFeedback.status === 'error' && saveFeedback.errorAr && (
            <div className="text-red-200">{saveFeedback.errorAr}</div>
          )}

          {saveFeedback.status === 'confirmed' && (
            <div className="space-y-1 text-[11px]">
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
                {saveFeedback.docPath && (
                  <span>المسار المعتمد: <strong className="text-emerald-300">{saveFeedback.docPath}</strong></span>
                )}
                {saveFeedback.savedValueText && (
                  <span>القيمة المحفوظة: <strong className="text-slate-100">{saveFeedback.savedValueText}</strong></span>
                )}
                {saveFeedback.effectiveValueText && (
                  <span>القيمة الفعالة الآن: <strong className="text-sky-300">{saveFeedback.effectiveValueText}</strong></span>
                )}
                {saveFeedback.activeSourceText && (
                  <span>المصدر النشط: <strong className="text-slate-200">{saveFeedback.activeSourceText}</strong></span>
                )}
              </div>
              {saveFeedback.priorityOverrideWarningAr && (
                <div className="p-2 rounded-lg bg-amber-950/50 border border-amber-700/60 text-amber-200 font-sans">
                  {saveFeedback.priorityOverrideWarningAr}
                </div>
              )}
              {saveFeedback.reloadNoteAr && (
                <div className="text-slate-300 font-sans">{saveFeedback.reloadNoteAr}</div>
              )}
            </div>
          )}
        </div>
      )}

      {effectiveValuation.currencyConsistencyBlockedReasonAr && (
        <div
          role="alert"
          className="rounded-xl p-3.5 border border-red-800/80 bg-red-950/40 text-xs text-red-200"
        >
          {effectiveValuation.currencyConsistencyBlockedReasonAr}
        </div>
      )}

      {/* 2. Unified Parameter Governance & Beta Lab */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-slate-800/80 pb-3 gap-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">
              مدخلات وافتراضات نموذج التقييم (WACC & Growth Rates — مسار الحفظ الموحد)
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* Assumption Priority Switcher */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <span className="text-[11px] text-slate-400 px-2">أولوية الافتراضات:</span>
              <button
                type="button"
                onClick={() => onChangePriority('company_first')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  assumptionPriority === 'company_first'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                تخصيص الشركة أولاً
              </button>
              <button
                type="button"
                onClick={() => onChangePriority('global_first')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  assumptionPriority === 'global_first'
                    ? 'bg-sky-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                الافتراض العام أولاً
              </button>
            </div>

            {/* Terminal Value Method Selector */}
            {onChangeTerminalValueMethod && (
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 px-2">القيمة النهائية (DCF):</span>
                <button
                  type="button"
                  onClick={() => onChangeTerminalValueMethod('perpetuity_growth')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                    terminalValueMethod === 'perpetuity_growth'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  النمو الدائم (g)
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTerminalValueMethod('exit_multiple')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                    terminalValueMethod === 'exit_multiple'
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  مضاعف الخروج (EV/EBITDA)
                </button>
              </div>
            )}

            {/* Sector Classification Selector */}
            <div className="flex items-center gap-2 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
              <span className="text-[11px] text-slate-400">
                القطاع: <strong className="text-slate-200">{company.sector || 'غير محدد'}</strong> · تصنيف النشاط:
              </span>
              <select
                aria-label="تصنيف النشاط لـ DCF"
                value={company.sectorClassification ?? sectorClass}
                onChange={(e) =>
                  onUpdateCompanyParams({
                    sectorClassification: e.target.value as SectorClassification,
                    sectorSource: 'admin_override',
                    sectorDate: new Date().toISOString().slice(0, 10),
                  })
                }
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200 font-semibold focus:outline-none focus:border-emerald-500"
              >
                <option value="unknown">قطاع غير معروف (DCF مستبعد)</option>
                <option value="non_financial">شركة غير مالية (مؤهلة لـ DCF)</option>
                <option value="financial">قطاع مالي / بنوك (DCF مستبعد)</option>
              </select>
            </div>

            {/* Valuation Date */}
            {(onChangeValuationDate || activeValuationDate) && (
              <div className="flex items-center gap-2 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">تاريخ التقييم المعتمد:</span>
                {onChangeValuationDate ? (
                  <input
                    type="date"
                    aria-label="تاريخ التقييم المعتمد"
                    value={activeValuationDate ?? ''}
                    onChange={(e) => {
                      if (e.target.value) onChangeValuationDate(e.target.value);
                    }}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-mono text-emerald-300 focus:outline-none focus:border-emerald-500"
                  />
                ) : (
                  <span className="font-mono text-[11px] text-emerald-300">{activeValuationDate}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Registry-Driven WACC & Growth Parameter Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {waccGrowthFields.map((field) => {
            const res = resolved[field.resolvedKey];
            const savedCompanyVal = companyOverridesMap[field.registryKey]?.value ?? null;
            const globalRefVal = res?.globalValue ?? paramsMap[field.registryKey] ?? null;
            return (
              <div key={field.key} id={`wacc-param-card-${field.registryKey}`}>
                <ValuationParameterCard
                  field={field}
                  companyId={company.id}
                  ticker={company.ticker}
                  savedCompanyValue={savedCompanyVal}
                  savedCompanyMeta={companyOverridesMap[field.registryKey]}
                  globalReferenceValue={globalRefVal}
                  globalMeta={macroMetaMap?.[field.registryKey]}
                  resolved={res}
                  sensitivityValue={sensitivityDrafts[field.registryKey]}
                  loadingUnconfirmed={companyOverridesConfirmed === false || macroParamsConfirmed === false}
                  companyScopeConfirmed={companyOverridesConfirmed}
                  globalScopeConfirmed={macroParamsConfirmed}
                  canEditCompany={canEditCompanyParams}
                  isAdmin={isAdmin}
                  isBusy={isKeyBusy(field.registryKey) || isKeyBusy(`macro:${field.registryKey}`)}
                  onSetSensitivityDraft={handleSetSensitivityDraft}
                  onSaveCompanyOverride={onSaveCompanyOverride ? (k, v) => handleCommitCompanyOverride(k, v) : undefined}
                  onDeleteCompanyOverride={onDeleteCompanyOverride ? (k) => handleCommitDeleteCompanyOverride(k) : undefined}
                  onSaveGlobalMacro={onSaveGlobalMacroParam ? (k, v) => handleCommitGlobalMacro(k, v) : undefined}
                />
              </div>
            );
          })}
        </div>

        {/* Beta Governance Panel */}
        <div id="valuation-beta-panel">
        <ValuationBetaPanel
          ticker={company.ticker}
          companyId={company.id}
          betaRecord={selectedBetaRecord}
          analyticalOverride={companyOverridesMap['Beta_Analytical'] ?? null}
          betaRaw={effectiveValuation.betaRaw ?? null}
          betaAdjusted={effectiveValuation.betaAdjusted ?? null}
          effectiveBetaForKe={
            effectiveValuation.effectiveBetaForKe ??
            effectiveValuation.betaAdjusted ??
            null
          }
          betaStatus={effectiveValuation.betaStatus}
          betaSourceNoteAr={effectiveValuation.betaSourceNoteAr}
          betaPolicyConflictAr={effectiveValuation.betaPolicyConflictAr}
          betaRawWeight={resolved.betaRawWeight?.value ?? null}
          betaAnchor={resolved.betaAnchor?.value ?? null}
          betaConfirmed={betaConfirmed}
          betaError={betaError}
          draftBeta={sensitivityDrafts['Beta']}
          draftAnalyticalBeta={sensitivityDrafts['Beta_Analytical']}
          canEdit={canEditCompanyParams}
          isBusy={isKeyBusy('Beta') || isKeyBusy('Beta_Analytical')}
          onSetDraftBeta={(val) => handleSetSensitivityDraft('Beta', val)}
          onSetDraftAnalyticalBeta={(val) => handleSetSensitivityDraft('Beta_Analytical', val)}
          onSaveBetaAssumption={onSaveBetaAssumption ? handleCommitBetaAssumption : undefined}
          onDeleteBetaAssumption={onDeleteBetaAssumption ? handleCommitDeleteBeta : undefined}
          onSaveAnalyticalBeta={
            onSaveCompanyOverride
              ? ({ value, source, asOfDate }) =>
                  handleCommitCompanyOverride('Beta_Analytical', value, { source, asOfDate })
              : undefined
          }
          onDeleteAnalyticalBeta={
            onDeleteCompanyOverride ? () => handleCommitDeleteCompanyOverride('Beta_Analytical') : undefined
          }
        />
        </div>

        {/* Computed Rates & Active Methodology Parameters Strip */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-col gap-2 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-4">
            <span>
              تكلفة حقوق الملكية (Ke):{' '}
              <strong className="font-mono text-slate-200">
                {effectiveMetrics.costOfEquity === null ? 'غير متاح' : `${(effectiveMetrics.costOfEquity * 100).toFixed(2)}%`}
              </strong>
            </span>
            <span className="text-slate-600">|</span>
            <span>
              تكلفة الدين بعد الضريبة (Kd × (1-t)):{' '}
              <strong className="font-mono text-slate-200">
                {resolved.costOfDebt?.value !== null &&
                resolved.costOfDebt?.value !== undefined &&
                resolved.taxRate?.value !== null &&
                resolved.taxRate?.value !== undefined
                  ? `${(resolved.costOfDebt.value * (1 - resolved.taxRate.value) * 100).toFixed(2)}%`
                  : 'غير متاح'}
              </strong>
            </span>
            <span className="text-slate-600">|</span>
            <span>
              متوسط تكلفة رأس المال (WACC):{' '}
              <strong className="font-mono text-emerald-400 font-bold">
                {effectiveMetrics.wacc === null ? 'غير متاح' : `${(effectiveMetrics.wacc * 100).toFixed(2)}%`}
              </strong>
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-sky-300">{getSectorClassificationLabelAr(sectorClass)}</span>
            {effectiveValuation.sourcesSummary?.rfMethodology && (
              <>
                <span className="text-slate-600">|</span>
                <span className="font-mono text-slate-300">
                  Rf: {effectiveValuation.sourcesSummary.rfResolvedKey ?? '-'} ({effectiveValuation.sourcesSummary.rfMethodology})
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono bg-slate-950/60 px-3 py-2 rounded-xl border border-slate-800/70">
            <span className="text-slate-400 font-sans">معاملات المنهجية المحفوظة (بدون قيم افتراضية صامتة):</span>
            <span>Forecast_Years: <strong className="text-emerald-300">{resolved.forecastYears?.value ?? 'غير متاح'}</strong></span>
            <span>Exit_Multiple: <strong className="text-slate-200">{resolved.exitMultiple?.value ?? 'غير متاح'}</strong></span>
            <span>r_Mode: <strong className="text-slate-200">{resolved.rMode?.value ?? 'غير متاح'}</strong></span>
            <span>WACC_Mode: <strong className="text-slate-200">{resolved.waccMode?.value ?? 'غير متاح'}</strong></span>
            <span>Lambda: <strong className="text-slate-200">{resolved.countryRiskLambda?.value ?? 'غير متاح'}</strong></span>
            <span>Beta_Raw_W: <strong className="text-slate-200">{resolved.betaRawWeight?.value ?? 'غير متاح'}</strong></span>
            <span>Beta_Anchor: <strong className="text-slate-200">{resolved.betaAnchor?.value ?? 'غير متاح'}</strong></span>
            <span>
              <span className="font-sans text-slate-300">وزن دمج قيمة P/E</span>{' '}
              <span className="text-slate-500">(Relative_PE_Weight)</span>:{' '}
              <strong className="text-slate-200">
                {relativeAudit
                  ? relativeAudit.peWeight.scope === 'loading_unconfirmed'
                    ? 'قيد تأكيد التحميل'
                    : formatRawRelativeWeight(relativeAudit.peWeight.rawValue)
                  : formatRawRelativeWeight(resolved.relativePeWeight?.value)}
              </strong>
              {relativeAudit && relativeAudit.peWeight.rawValue !== null && (
                <span className="text-slate-400 font-sans">
                  {' '}
                  [{relativeAudit.peWeight.scope === 'company' ? 'تخصيص الشركة' : 'المتغيرات الكلية'}]
                </span>
              )}
            </span>
            <span>
              <span className="font-sans text-slate-300">وزن دمج قيمة P/B</span>{' '}
              <span className="text-slate-500">(Relative_PB_Weight)</span>:{' '}
              <strong className="text-slate-200">
                {relativeAudit
                  ? relativeAudit.pbWeight.scope === 'loading_unconfirmed'
                    ? 'قيد تأكيد التحميل'
                    : formatRawRelativeWeight(relativeAudit.pbWeight.rawValue)
                  : formatRawRelativeWeight(resolved.relativePbWeight?.value)}
              </strong>
              {relativeAudit && relativeAudit.pbWeight.rawValue !== null && (
                <span className="text-slate-400 font-sans">
                  {' '}
                  [{relativeAudit.pbWeight.scope === 'company' ? 'تخصيص الشركة' : 'المتغيرات الكلية'}]
                </span>
              )}
            </span>
          </div>
          {effectiveValuation.sourcesSummary?.historicalRestatementLimitationAr && (
            <div className="text-[11px] text-slate-300 bg-slate-950/60 border border-slate-800/70 rounded-xl px-3 py-2 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
              <span>{effectiveValuation.sourcesSummary.historicalRestatementLimitationAr}</span>
            </div>
          )}
        </div>

        {effectiveValuation.sourcesSummary?.sectorPeConflictDetected && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-red-950/30 border border-red-800/60 text-xs text-red-200 space-y-1"
          >
            <div className="font-bold text-red-300">
              تنبيه تعارض مضاعف ربحية القطاع (Sector P/E Conflict):
            </div>
            <div>
              {effectiveValuation.sourcesSummary.sectorPeLookupReasonAr ||
                'تم تعطيل الربط الآلي لمضاعف P/E القطاعي لتعارض القيم المحفوظة لنفس القطاع.'}
            </div>
            {effectiveValuation.sourcesSummary.sectorPeConflictingEntries &&
              effectiveValuation.sourcesSummary.sectorPeConflictingEntries.length > 0 && (
                <div className="font-mono text-[11px] text-red-200/90">
                  المفاتيح المتعارضة:{' '}
                  {effectiveValuation.sourcesSummary.sectorPeConflictingEntries
                    .map((e) => `${e.key} = ${e.value}x`)
                    .join(' | ')}
                </div>
              )}
          </div>
        )}

        {effectiveValuation.modelNotes && effectiveValuation.modelNotes.length > 0 && (
          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/50 text-xs text-amber-200 space-y-1">
            {effectiveValuation.modelNotes.map((note, idx) => (
              <div key={idx}>• {note}</div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Five Models Tabbed Explorer */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
          <div className="flex items-center gap-1 overflow-x-auto">
            <button
              onClick={() => setActiveModelTab('dcf')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeModelTab === 'dcf'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              1. نموذج DCF (التدفقات المخصومة)
            </button>
            <button
              onClick={() => setActiveModelTab('ddm')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeModelTab === 'ddm'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              2. نموذج DDM (خصم التوزيعات)
            </button>
            <button
              onClick={() => setActiveModelTab('rim')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeModelTab === 'rim'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              3. نموذج RIM (الدخل المتبقي)
            </button>
            <button
              onClick={() => setActiveModelTab('relative')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeModelTab === 'relative'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              4. التقييم النسبي بالمضاعفات
            </button>
            <button
              onClick={() => setActiveModelTab('graham')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeModelTab === 'graham'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              5. صيغة جراهام (Graham)
            </button>
          </div>

          <div className="text-xs font-mono text-slate-300">
            وزن النموذج الحالي في المجموع:{' '}
            <span className="font-bold text-emerald-400">
              {activeModelTab === 'dcf'
                ? effectiveValuation.weights.dcf
                : activeModelTab === 'ddm'
                ? effectiveValuation.weights.ddm
                : activeModelTab === 'rim'
                ? effectiveValuation.weights.rim
                : activeModelTab === 'relative'
                ? effectiveValuation.weights.relative
                : effectiveValuation.weights.graham}
              %
            </span>
          </div>
        </div>

        {/* Tab Content */}
        <div className="mt-5">
          {/* TAB 1: DCF */}
          {activeModelTab === 'dcf' && (
            <DcfDetailsView metrics={effectiveMetrics} valuation={effectiveValuation} />
          )}

          {/* TAB 2: DDM */}
          {activeModelTab === 'ddm' && (() => {
            const divSummary =
              effectiveValuation.sourcesSummary?.dividendSummary ?? effectiveMetrics.dividendSummary ?? null;
            const ddmAudit =
              effectiveValuation.ddmAudit ??
              effectiveValuation.sourcesSummary?.ddmAudit ??
              effectiveValuation.engineOutputs?.ddmAudit ??
              null;
            const ddmGrowthField = getValuationLabField('DDM_Growth');
            const crpField = getValuationLabField('CRP_Egypt');
            const ddmLoadingUnconfirmed =
              companyOverridesConfirmed === false || macroParamsConfirmed === false;
            const activeRMode = ddmAudit?.keMode ?? resolved.rMode?.value ?? null;
            const isCrpActiveForKe = activeRMode === 1 || activeRMode === 2;
            const isUsdRfActiveForKe = activeRMode === 2;
            const isEgyptRfActiveForKe = activeRMode === 1 || activeRMode === 3 || activeRMode === null;
            const effectiveBetaVal =
              effectiveValuation.effectiveBetaForKe ?? effectiveValuation.betaAdjusted ?? null;
            const betaSourcePresentation = describeBetaEffectiveSource({
              betaStatus: effectiveValuation.betaStatus,
              betaSourceNoteAr: effectiveValuation.betaSourceNoteAr,
              effectiveBetaForKe: effectiveBetaVal,
              savedAnalyticalBetaValue: companyOverridesMap['Beta_Analytical']?.value ?? null,
              draftBeta: sensitivityDrafts['Beta'],
              draftAnalyticalBeta: sensitivityDrafts['Beta_Analytical'],
              betaConfirmed,
              betaError,
            });
            const betaSourceBadgeCls =
              betaSourcePresentation.badgeTone === 'purple'
                ? 'bg-purple-950/70 text-purple-200 border-purple-700/70'
                : betaSourcePresentation.badgeTone === 'emerald'
                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                : betaSourcePresentation.badgeTone === 'amber'
                ? 'bg-amber-950/70 text-amber-200 border-amber-700/70'
                : 'bg-red-950/70 text-red-200 border-red-800/70';

            const describeResolvedScopeAr = (
              item: (typeof resolved)[string] | undefined,
              loadingFlag: boolean,
              registryKeyForDraft?: string
            ): string => {
              if (
                registryKeyForDraft &&
                sensitivityDrafts[registryKeyForDraft] !== undefined &&
                Number.isFinite(sensitivityDrafts[registryKeyForDraft])
              ) {
                return 'مسودة حساسية مؤقتة (محلي في الذاكرة — غير محفوظة)';
              }
              if (!item || item.source === 'missing') {
                return loadingFlag
                  ? 'قيد تأكيد التحميل (لم يكتمل التأكيد من الخادم)'
                  : 'غير محفوظ (غياب مؤكد)';
              }
              return item.source === 'company'
                ? 'تخصيص الشركة (company_assumptions)'
                : 'المتغيرات الكلية (macro_params)';
            };

            const regularDps = effectiveMetrics.dpsRegular ?? null;
            const specialDps = effectiveMetrics.dpsSpecial ?? null;
            const totalDps = divSummary?.totalDps ?? (regularDps !== null ? regularDps : null);
            const regularYield = effectiveMetrics.dividendYieldRegular ?? effectiveMetrics.dividendYield;
            const totalYield = effectiveMetrics.dividendYieldTotal ?? regularYield;
            const payoutRatio = effectiveMetrics.historicalPayoutRatio ?? divSummary?.historicalPayoutRatio ?? null;
            const partialPayout = effectiveMetrics.partialPayoutRatio ?? divSummary?.partialPayoutRatio ?? null;
            const sourceLabel =
              divSummary?.source === 'dividend_records'
                ? `DPS_Actual (${divSummary.targetFiscalYear ?? '-'}${divSummary.cutoffDate ? ` · قطع ${divSummary.cutoffDate}` : ''})`
                : divSummary?.source === 'confirmed_no_dividend'
                ? `سنة بدون توزيعات مؤكدة (${divSummary.targetFiscalYear ?? '-'})`
                : 'غير متاح';

            const yearStatusBadge =
              divSummary?.dividendYearStatus === 'complete'
                ? { text: 'سنة مكتملة (complete)', cls: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60' }
                : divSummary?.dividendYearStatus === 'confirmed_no_dividend'
                ? { text: 'بدون توزيعات مؤكدة', cls: 'bg-sky-950/70 text-sky-300 border-sky-800/60' }
                : divSummary?.dividendYearStatus === 'partial'
                ? { text: 'سجل توزيعات جزئي (partial)', cls: 'bg-amber-950/70 text-amber-300 border-amber-800/60' }
                : { text: 'اكتمال غير مؤكد (unknown)', cls: 'bg-slate-800 text-slate-300 border-slate-700' };

            const ddmGrowthActiveSourceText =
              sensitivityDrafts['DDM_Growth'] !== undefined
                ? 'مسودة حساسية مؤقتة (محلي — بدون حفظ)'
                : ddmAudit?.growthSourceLabelAr ??
                  describeResolvedScopeAr(resolved.ddmGrowth, ddmLoadingUnconfirmed);

            return (
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between bg-slate-950/70 p-4 rounded-xl border border-slate-800 gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-white">نموذج خصم التوزيعات النقدية (Dividend Discount Model)</h4>
                      <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${yearStatusBadge.cls}`}>
                        {yearStatusBadge.text}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                      يعتمد صيغة جوردون للنمو: <span className="font-mono text-emerald-400">P₀ = DPS₁ / (Ke - g)</span>{' '}
                      باستخدام التوزيعات المنتظمة فقط (<span className="font-mono">regular</span>)، مع استبعاد التوزيعات الاستثنائية (<span className="font-mono">special</span>) من التقييم المستدام.
                    </p>
                  </div>
                  <div className="text-end shrink-0">
                    <span className="text-xs text-slate-400 block">القيمة العادلة للسهم (DDM)</span>
                    <span
                      data-testid="ddm-tab-fair-value"
                      className="text-2xl font-bold font-mono text-teal-400"
                    >
                      {effectiveValuation.ddmFairValue !== null ? `${effectiveValuation.ddmFairValue.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                    </span>
                  </div>
                </div>

                {/* Section 1: DDM_Growth Customization Card (Central Registry + Existing Governance) */}
                {ddmGrowthField && (
                  <div
                    data-testid="ddm-growth-customization-section"
                    className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h5 className="text-xs font-bold text-emerald-300">
                          تخصيص معدل نمو التوزيعات لنموذج DDM ({company.ticker})
                        </h5>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                          يستخدم العقد المركزي القائم لـ <span className="font-mono text-slate-200">DDM_Growth</span> (تخصيص الشركة في{' '}
                          <span className="font-mono">company_assumptions</span> والمرجع العام في{' '}
                          <span className="font-mono">macro_params</span>) بنفس أولوية المصادر وصلاحيات الحفظ القائمة.
                        </p>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded border border-slate-700 bg-slate-900 text-slate-300 font-mono shrink-0">
                        {assumptionPriority === 'company_first' ? 'الأولوية: company_first' : 'الأولوية: global_first'}
                      </span>
                    </div>

                    <ValuationParameterCard
                      field={ddmGrowthField}
                      companyId={company.id}
                      ticker={company.ticker}
                      savedCompanyValue={companyOverridesMap['DDM_Growth']?.value ?? null}
                      savedCompanyMeta={companyOverridesMap['DDM_Growth']}
                      globalReferenceValue={resolved.ddmGrowth?.globalValue ?? paramsMap['DDM_Growth'] ?? null}
                      globalMeta={macroMetaMap?.['DDM_Growth']}
                      resolved={resolved.ddmGrowth}
                      sensitivityValue={sensitivityDrafts['DDM_Growth']}
                      loadingUnconfirmed={ddmLoadingUnconfirmed}
                      companyScopeConfirmed={companyOverridesConfirmed}
                      globalScopeConfirmed={macroParamsConfirmed}
                      showRichDetails={true}
                      canEditCompany={canEditCompanyParams}
                      isAdmin={isAdmin}
                      isBusy={isKeyBusy('DDM_Growth') || isKeyBusy('macro:DDM_Growth')}
                      onSetSensitivityDraft={handleSetSensitivityDraft}
                      onSaveCompanyOverride={onSaveCompanyOverride ? (k, v) => handleCommitCompanyOverride(k, v) : undefined}
                      onDeleteCompanyOverride={onDeleteCompanyOverride ? (k) => handleCommitDeleteCompanyOverride(k) : undefined}
                      onSaveGlobalMacro={onSaveGlobalMacroParam ? (k, v) => handleCommitGlobalMacro(k, v) : undefined}
                      stageLabelAr="نموذج DDM فقط"
                      stageEffectAr="يُستخدم في D1 = D0 × (1 + g) والمقام (Ke − g)"
                      requirementBadgeAr={
                        ddmLoadingUnconfirmed && resolved.ddmGrowth?.value === null
                          ? 'قيد تأكيد التحميل'
                          : 'صيغة جوردون: g < Ke'
                      }
                      missingRequirementAr="احفظ تخصيص DDM_Growth للشركة في company_assumptions أو مرجعاً عاماً في macro_params (لا توجد قيمة افتراضية صامتة)."
                      footerExtra={
                        <div className="text-[10px] text-slate-400 bg-slate-900/70 border border-slate-800/80 rounded-lg px-2.5 py-1.5 space-y-0.5 leading-relaxed">
                          <div>
                            • مسح تخصيص الشركة يعيد تطبيق أولوية المصادر القائمة (الرجوع إلى{' '}
                            <span className="font-mono">macro_params</span> إن وُجد أو «غير متاح» عند غيابه) ولا يفترض صفراً أبداً.
                          </div>
                          <div>
                            • القيمة الصفرية (<span className="font-mono">0%</span>) أو السالبة المسموحة (حتى{' '}
                            <span className="font-mono">-50%</span>) تُعامل كقيم صريحة صالحة وليست غياباً للبيانات.
                          </div>
                        </div>
                      }
                    />
                  </div>
                )}

                {/* Section 2: Derived Cost of Equity (Ke) & Active Inputs per r_Mode */}
                <div
                  data-testid="ddm-ke-panel"
                  className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-3 text-xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h5 className="font-bold text-amber-300">
                          تكلفة حقوق الملكية المشتقة (Ke) ومدخلاتها النشطة
                        </h5>
                        <span className="text-[10px] px-2 py-0.5 rounded border border-amber-800/60 bg-amber-950/40 text-amber-200">
                          مخرج مشتق من المحرك — لا يوجد تجاوز يدوي مباشر لـ Ke
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-1">
                        النمط النشط: <strong className="text-slate-100">{ddmAudit?.keModeLabelAr ?? 'غير محدد'}</strong>
                      </p>
                      <p className="text-[11px] font-mono text-emerald-300/90 mt-0.5">
                        {ddmAudit?.keFormulaAr ?? 'غير متاحة'}
                      </p>
                    </div>
                    <div className="text-end shrink-0">
                      <span className="text-[10px] text-slate-400 block">Ke المشتقة حالياً</span>
                      <span className="text-xl font-bold font-mono text-amber-300">
                        {effectiveMetrics.costOfEquity !== null
                          ? `${(effectiveMetrics.costOfEquity * 100).toFixed(2)}%`
                          : 'غير متاح'}
                      </span>
                    </div>
                  </div>

                  {/* Explicit Shared-Impact Notice */}
                  <div className="bg-sky-950/35 border border-sky-800/60 rounded-lg p-2.5 text-[11px] text-sky-200 flex items-start gap-2 leading-relaxed">
                    <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>تأثير مشترك عبر النماذج:</strong> تعديل مدخلات <span className="font-mono">Ke</span> المشتركة (
                      <span className="font-mono">Rf_Egypt_10Y</span>، <span className="font-mono">ERP_Developed</span>،{' '}
                      <span className="font-mono">CRP_Egypt</span>، <span className="font-mono">Beta</span> /{' '}
                      <span className="font-mono">Beta_Analytical</span>) يؤثر أيضاً على نماذج التقييم الأخرى (DCF، RIM، WACC) وليس على DDM وحده.
                    </span>
                  </div>

                  {/* Active Ke Inputs Grid (No visual duplication of top WACC/Beta panels) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Active Risk-Free Rate */}
                    {isEgyptRfActiveForKe && (
                      <div className="bg-slate-900/75 border border-slate-800 rounded-lg p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-200">العائد الخالي من المخاطر (Rf_Egypt_10Y)</span>
                          <span className="font-mono font-bold text-emerald-300">
                            {resolved.riskFreeRate?.value !== null && resolved.riskFreeRate?.value !== undefined
                              ? `${(resolved.riskFreeRate.value * 100).toFixed(2)}%`
                              : 'غير متاح'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 space-y-0.5">
                          <div>النطاق: {describeResolvedScopeAr(resolved.riskFreeRate, ddmLoadingUnconfirmed, 'Rf_Egypt_10Y')}</div>
                          {resolved.riskFreeRate?.asOfDate && sensitivityDrafts['Rf_Egypt_10Y'] === undefined && (
                            <div className="font-mono">التاريخ: {resolved.riskFreeRate.asOfDate}</div>
                          )}
                          <div className="text-sky-300/90">مدخل مشترك (DCF / DDM / RIM / WACC)</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => scrollToElement('wacc-param-card-Rf_Egypt_10Y')}
                          className="inline-flex items-center gap-1 text-[10px] text-emerald-300 hover:text-emerald-200 font-semibold pt-1"
                        >
                          <ArrowUpRight className="w-3 h-3" />
                          <span>تخصيص أو تجربة من بطاقة WACC بالأعلى</span>
                        </button>
                      </div>
                    )}

                    {isUsdRfActiveForKe && (
                      <div className="bg-slate-900/75 border border-slate-800 rounded-lg p-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-200">عائد الخزانة الأمريكية (Rf_USD_10Y)</span>
                          <span className="font-mono font-bold text-emerald-300">
                            {resolved.riskFreeRateUSD?.value !== null && resolved.riskFreeRateUSD?.value !== undefined
                              ? `${(resolved.riskFreeRateUSD.value * 100).toFixed(2)}%`
                              : 'غير متاح'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 space-y-0.5">
                          <div>النطاق: {describeResolvedScopeAr(resolved.riskFreeRateUSD, !macroParamsConfirmed)}</div>
                          {resolved.riskFreeRateUSD?.asOfDate && (
                            <div className="font-mono">التاريخ: {resolved.riskFreeRateUSD.asOfDate}</div>
                          )}
                          <div className="text-slate-400">للقراءة فقط هنا (نطاق عام macro_params فقط حسب العقد المركزي).</div>
                        </div>
                      </div>
                    )}

                    {/* Active ERP_Developed */}
                    <div className="bg-slate-900/75 border border-slate-800 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-200">علاوة مخاطر السوق (ERP_Developed)</span>
                        <span className="font-mono font-bold text-emerald-300">
                          {resolved.equityRiskPremium?.value !== null && resolved.equityRiskPremium?.value !== undefined
                            ? `${(resolved.equityRiskPremium.value * 100).toFixed(2)}%`
                            : 'غير متاح'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 space-y-0.5">
                        <div>النطاق: {describeResolvedScopeAr(resolved.equityRiskPremium, ddmLoadingUnconfirmed, 'ERP_Developed')}</div>
                        {resolved.equityRiskPremium?.asOfDate && sensitivityDrafts['ERP_Developed'] === undefined && (
                          <div className="font-mono">التاريخ: {resolved.equityRiskPremium.asOfDate}</div>
                        )}
                        <div className="text-sky-300/90">مدخل مشترك (DCF / DDM / RIM / WACC)</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => scrollToElement('wacc-param-card-ERP_Developed')}
                        className="inline-flex items-center gap-1 text-[10px] text-emerald-300 hover:text-emerald-200 font-semibold pt-1"
                      >
                        <ArrowUpRight className="w-3 h-3" />
                        <span>تخصيص أو تجربة من بطاقة WACC بالأعلى</span>
                      </button>
                    </div>

                    {/* Active Effective Beta for Ke */}
                    <div
                      data-testid="ddm-ke-beta-card"
                      className={`rounded-lg p-3 space-y-1.5 border ${
                        betaSourcePresentation.isSensitivityDraft
                          ? 'bg-purple-950/25 border-purple-700/70'
                          : 'bg-slate-900/75 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-200">بيتا الفعالة في Ke (Beta_eff)</span>
                        <span
                          data-testid="ddm-ke-beta-value"
                          className="font-mono font-bold text-emerald-300"
                        >
                          {effectiveBetaVal !== null ? effectiveBetaVal.toFixed(3) : 'غير متاح'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          data-testid="ddm-ke-beta-source-badge"
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${betaSourceBadgeCls}`}
                        >
                          {betaSourcePresentation.shortBadgeAr}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 space-y-1">
                        <div>
                          المصدر النشط:{' '}
                          <span data-testid="ddm-ke-beta-source-label" className="text-slate-200">
                            {betaSourcePresentation.labelAr}
                          </span>
                        </div>
                        <div data-testid="ddm-ke-beta-source-explanation" className="text-slate-300/90 leading-relaxed">
                          {betaSourcePresentation.explanationAr}
                        </div>
                        <div className="text-slate-400">
                          التقدير التحليلي (<span className="font-mono">Beta_Analytical</span>) منفصل تماماً عن سجل{' '}
                          <span className="font-mono">beta_assumptions</span> ولا يُكتب فيه.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => scrollToElement('valuation-beta-panel')}
                        className="inline-flex items-center gap-1 text-[10px] text-emerald-300 hover:text-emerald-200 font-semibold pt-1"
                      >
                        <ArrowUpRight className="w-3 h-3" />
                        <span>الانتقال إلى لوحة حوكمة بيتا بالأعلى</span>
                      </button>
                    </div>
                  </div>

                  {/* Active CRP_Egypt customization card (only when active in r_Mode 1 or 2; not in top WACC bar) */}
                  {isCrpActiveForKe && crpField ? (
                    <div className="pt-1">
                      <ValuationParameterCard
                        field={crpField}
                        companyId={company.id}
                        ticker={company.ticker}
                        savedCompanyValue={companyOverridesMap['CRP_Egypt']?.value ?? null}
                        savedCompanyMeta={companyOverridesMap['CRP_Egypt']}
                        globalReferenceValue={resolved.countryRiskPremium?.globalValue ?? paramsMap['CRP_Egypt'] ?? null}
                        globalMeta={macroMetaMap?.['CRP_Egypt']}
                        resolved={resolved.countryRiskPremium}
                        loadingUnconfirmed={ddmLoadingUnconfirmed}
                        companyScopeConfirmed={companyOverridesConfirmed}
                        globalScopeConfirmed={macroParamsConfirmed}
                        showRichDetails={true}
                        canEditCompany={canEditCompanyParams}
                        isAdmin={isAdmin}
                        isBusy={isKeyBusy('CRP_Egypt') || isKeyBusy('macro:CRP_Egypt')}
                        onSetSensitivityDraft={handleSetSensitivityDraft}
                        onSaveCompanyOverride={onSaveCompanyOverride ? (k, v) => handleCommitCompanyOverride(k, v) : undefined}
                        onDeleteCompanyOverride={onDeleteCompanyOverride ? (k) => handleCommitDeleteCompanyOverride(k) : undefined}
                        onSaveGlobalMacro={onSaveGlobalMacroParam ? (k, v) => handleCommitGlobalMacro(k, v) : undefined}
                        stageLabelAr={`نشط في r_Mode=${activeRMode}`}
                        stageEffectAr="يؤثر على Ke المشتركة بين DDM وRIM وWACC/DCF"
                        footerExtra={
                          <div className="text-[10px] text-sky-300/90">
                            • تنبيه: <span className="font-mono">CRP_Egypt</span> مدخل مشترك لا يدعم المسودة المؤقتة وفق العقد المركزي؛ الحفظ هنا يحدّث Ke في جميع النماذج المرتبطة.
                          </div>
                        }
                      />
                    </div>
                  ) : activeRMode === 3 ? (
                    <div className="rounded-lg bg-slate-900/60 border border-slate-800 px-3 py-2 text-[11px] text-slate-400">
                      علاوة مخاطر الدولة (<span className="font-mono text-slate-300">CRP_Egypt</span>) ومعامل التعرض (
                      <span className="font-mono text-slate-300">Country_Risk_Lambda</span>) غير نشطين في النمط الحالي{' '}
                      <span className="font-mono text-slate-200">r_Mode = 3</span> (محلي بدون CRP).
                    </div>
                  ) : null}

                  {/* Read-only methodology parameters affecting Ke */}
                  <div className="bg-slate-900/50 border border-slate-800/80 rounded-lg px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-300">مدخلات منهجية للقراءة فقط:</span>
                    <span className="font-mono">
                      r_Mode: <strong className="text-slate-200">{resolved.rMode?.value ?? 'غير متاح'}</strong>{' '}
                      <span className="font-sans text-[10px]">({describeResolvedScopeAr(resolved.rMode, ddmLoadingUnconfirmed)})</span>
                    </span>
                    {isCrpActiveForKe && (
                      <span className="font-mono">
                        Country_Risk_Lambda:{' '}
                        <strong className="text-slate-200">{resolved.countryRiskLambda?.value ?? 'غير متاح'}</strong>{' '}
                        <span className="font-sans text-[10px]">({describeResolvedScopeAr(resolved.countryRiskLambda, ddmLoadingUnconfirmed)})</span>
                      </span>
                    )}
                    <span className="font-mono">
                      Beta_Raw_Weight: <strong className="text-slate-200">{resolved.betaRawWeight?.value ?? 'غير متاح'}</strong>
                    </span>
                    <span className="font-mono">
                      Beta_Anchor: <strong className="text-slate-200">{resolved.betaAnchor?.value ?? 'غير متاح'}</strong>
                    </span>
                  </div>
                </div>

                {divSummary?.ddmVsRetentionDifferenceReasonAr && (
                  <div className="bg-sky-950/35 border border-sky-800/60 rounded-xl p-3 text-xs text-sky-200 flex items-start gap-2 leading-relaxed">
                    <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                    <span>{divSummary.ddmVsRetentionDifferenceReasonAr}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block">التوزيع العادي السنوي (Regular DPS)</span>
                    <span className="text-lg font-bold font-mono text-white mt-1 block">
                      {regularDps === 0
                        ? `0.00${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''} (صفري مؤكد)`
                        : regularDps !== null
                        ? `${regularDps.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}`
                        : 'غير متاح'}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      عائد التوزيع العادي: {regularYield !== null ? `${regularYield.toFixed(2)}%` : 'غير متاح'}
                    </span>
                    <span className="text-[10px] text-emerald-300/90 font-mono block mt-0.5">
                      المصدر: {sourceLabel}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      بيانات فعلية من سجل التوزيعات (dividend_records) وليست افتراضاً يدوياً.
                    </span>
                    {divSummary?.paidRegularDps !== null && divSummary?.paidRegularDps !== undefined && (
                      <span className="text-[10px] text-sky-300/90 font-mono block mt-0.5">
                        المدفوع فعلياً (Paid): {divSummary.paidRegularDps.toFixed(2)} ({divSummary.paidRecordsCount ?? 0} سجل)
                      </span>
                    )}
                    {onOpenDividendRecords && (
                      <button
                        type="button"
                        data-testid="ddm-open-dividend-records-btn"
                        onClick={onOpenDividendRecords}
                        className="inline-flex items-center gap-1 text-[10px] text-emerald-300 hover:text-emerald-200 font-semibold mt-1.5"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>مراجعة سجل التوزيعات (DPS_Actual)</span>
                      </button>
                    )}
                  </div>

                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block">التوزيع الاستثنائي والإجمالي (Special / Total)</span>
                    <span className="text-lg font-bold font-mono text-purple-300 mt-1 block">
                      {specialDps !== null
                        ? `${specialDps.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}`
                        : 'غير متاح'}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      مستبعد من DDM · الإجمالي:{' '}
                      {totalDps !== null ? `${totalDps.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                      {totalYield !== null ? ` (${totalYield.toFixed(2)}%)` : ''}
                    </span>
                    <span className="text-[10px] text-sky-300 block mt-0.5 font-mono">
                      نسبة التوزيع الرسمية: {payoutRatio !== null ? `${(payoutRatio * 100).toFixed(1)}%` : 'غير متاح'}
                      {divSummary?.fiscalYearIncomeSource && divSummary.fiscalYearIncomeSource !== 'unavailable'
                        ? ` (مقام FY: ${divSummary.fiscalYearIncomeSource})`
                        : ''}
                    </span>
                    {payoutRatio === null && partialPayout !== null && (
                      <span className="text-[10px] text-amber-300/90 block mt-0.5 font-mono">
                        نسبة جزئية للتدقيق فقط: {(partialPayout * 100).toFixed(1)}%
                      </span>
                    )}
                    {payoutRatio === null && divSummary?.payoutUnavailableReasonAr && (
                      <span className="text-[10px] text-amber-300/90 block mt-0.5 leading-relaxed">
                        {divSummary.payoutUnavailableReasonAr}
                      </span>
                    )}
                  </div>

                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block">تكلفة حقوق الملكية (Ke)</span>
                    <span className="text-lg font-bold font-mono text-white mt-1 block">
                      {effectiveMetrics.costOfEquity !== null ? `${(effectiveMetrics.costOfEquity * 100).toFixed(2)}%` : 'غير متاح'}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {ddmAudit?.keMode != null
                        ? `قيمة مشتقة من المحرك (r_Mode=${ddmAudit.keMode})`
                        : 'قيمة مشتقة من المحرك'}
                    </span>
                  </div>

                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block">معدل نمو التوزيعات (DDM_Growth)</span>
                    <span className="text-lg font-bold font-mono text-white mt-1 block">
                      {ddmAudit?.growthSource === 'loading_unconfirmed'
                        ? 'قيد تأكيد التحميل'
                        : resolved.ddmGrowth?.value !== null && resolved.ddmGrowth?.value !== undefined
                        ? `${(resolved.ddmGrowth.value * 100).toFixed(2)}%`
                        : 'غير متاح'}
                    </span>
                    <span className="text-[10px] text-slate-400 block mt-0.5 leading-snug">
                      المصدر الفعلي: {ddmGrowthActiveSourceText}
                      {ddmAudit?.growthAsOfDate && sensitivityDrafts['DDM_Growth'] === undefined
                        ? ` · ${ddmAudit.growthAsOfDate}`
                        : ''}
                    </span>
                  </div>
                </div>

                {divSummary && (divSummary.excludedProposedCount || divSummary.completedFiscalYear || (divSummary.interimFiscalYears && divSummary.interimFiscalYears.length > 0) || divSummary.dividendDatePolicyNoteAr) && (
                  <div className="bg-slate-950/50 border border-slate-800 rounded-xl px-3 py-2 text-[11px] text-slate-300 space-y-1">
                    <div className="flex flex-wrap gap-3">
                      {divSummary.valuationDate && (
                        <span>تاريخ التقييم/القطع: <strong className="font-mono text-emerald-300">{divSummary.valuationDate}</strong></span>
                      )}
                      {divSummary.completedFiscalYear && (
                        <span>أحدث سنة مالية مكتملة (FY): <strong className="font-mono text-slate-100">{divSummary.completedFiscalYear}</strong></span>
                      )}
                      {divSummary.interimFiscalYears && divSummary.interimFiscalYears.length > 0 && (
                        <span>سنوات مرحلية فقط: <strong className="font-mono text-amber-300">{divSummary.interimFiscalYears.join(', ')}</strong></span>
                      )}
                      {(divSummary.excludedProposedCount ?? 0) > 0 && (
                        <span className="text-amber-300">توزيعات مقترحة مستبعدة (proposed): {divSummary.excludedProposedCount}</span>
                      )}
                    </div>
                    {divSummary.dividendDatePolicyNoteAr && (
                      <div className="text-[10px] text-slate-400">{divSummary.dividendDatePolicyNoteAr}</div>
                    )}
                  </div>
                )}

                {divSummary?.warningsAr && divSummary.warningsAr.length > 0 && (
                  <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-3 text-xs text-amber-200 space-y-1">
                    {divSummary.warningsAr.map((w, idx) => (
                      <div key={idx}>• {w}</div>
                    ))}
                  </div>
                )}

                <DdmAuditCard
                  ddmAudit={ddmAudit}
                  finCurrencyLabel={finCurrencyLabel}
                  onOpenDividendRecords={onOpenDividendRecords}
                />
              </div>
            );
          })()}

          {/* TAB 3: RIM */}
          {activeModelTab === 'rim' && (() => {
            const divSummary =
              effectiveValuation.sourcesSummary?.dividendSummary ?? effectiveMetrics.dividendSummary ?? null;
            const activeRetention =
              effectiveValuation.activeRimRetentionUsed ??
              effectiveValuation.sourcesSummary?.activeRimRetentionUsed ??
              null;
            const savedRimRetention = resolved.rimRetention?.value ?? null;
            const histRetention =
              effectiveValuation.historicalRetentionRatio ??
              effectiveValuation.sourcesSummary?.historicalRetentionRatio ??
              effectiveMetrics.historicalRetentionRatio ??
              null;

            return (
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between bg-slate-950/70 p-4 rounded-xl border border-slate-800 gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-white">نموذج الدخل المتبقي (Residual Income Model - Edwards-Bell-Ohlson)</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                      يعتبر النموذج الأمثل للبنوك والمؤسسات المالية وشركات التطوير العقاري: يربط القيمة الدفترية للسهم (BVPS) بالقدرة على تحقيق عائد على حقوق الملكية (ROE) يفوق تكلفة رأس المال (Ke).
                    </p>
                  </div>
                  <div className="text-end shrink-0">
                    <span className="text-xs text-slate-400 block">القيمة العادلة للسهم (RIM)</span>
                    <span className="text-2xl font-bold font-mono text-cyan-400">
                      {effectiveValuation.rimFairValue !== null ? `${effectiveValuation.rimFairValue.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                    </span>
                  </div>
                </div>

                {/* RIM Retention Governance Selector (Persisted Per Company) */}
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-cyan-300">
                        سياسة نسبة الاحتجاز لنموذج RIM — محفوظة لكل شركة ({company.ticker})
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                        {effectiveValuation.sourcesSummary?.rimRetentionSelectionRuleNoteAr ||
                          'خيار الحد الأدنى يطبق قاعدة اختيار حسابية min(RIM_Retention, Historical_Retention) على مستوى الشركة دون تعديل معامل RIM_Retention العام المحفوظ في macro_params.'}
                      </p>
                      {!onChangeRimRetentionPolicy && (
                        <p className="text-[10px] text-amber-300/90 mt-0.5">
                          للعرض فقط: تعديل سياسة الاحتجاز المحفوظة للشركة يتطلب صلاحية محرر مالي أو مدير.
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 shrink-0">
                      <button
                        type="button"
                        disabled={!onChangeRimRetentionPolicy}
                        onClick={() => onChangeRimRetentionPolicy?.('rim_parameter')}
                        className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                          rimRetentionPolicy === 'rim_parameter'
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        RIM_Retention المحفوظ (الافتراضي)
                      </button>
                      <button
                        type="button"
                        disabled={!onChangeRimRetentionPolicy}
                        onClick={() => onChangeRimRetentionPolicy?.('historical_retention')}
                        className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                          rimRetentionPolicy === 'historical_retention'
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        الاحتجاز التاريخي (1 - Payout)
                      </button>
                      <button
                        type="button"
                        disabled={!onChangeRimRetentionPolicy}
                        onClick={() => onChangeRimRetentionPolicy?.('minimum')}
                        className={`px-2.5 py-1.5 rounded-lg font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                          rimRetentionPolicy === 'minimum'
                            ? 'bg-cyan-600 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        الحد الأدنى min(RIM, Historical)
                      </button>
                    </div>
                  </div>

                  {divSummary?.ddmVsRetentionDifferenceReasonAr && (
                    <div className="bg-sky-950/35 border border-sky-800/60 rounded-lg px-3 py-2 text-[11px] text-sky-200 flex items-start gap-2">
                      <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                      <span>{divSummary.ddmVsRetentionDifferenceReasonAr}</span>
                    </div>
                  )}

                  {effectiveValuation.sourcesSummary?.historicalRetentionSuitableForRim === false &&
                    effectiveValuation.sourcesSummary?.historicalRetentionRimBlockReasonAr && (
                      <div className="bg-amber-950/30 border border-amber-800/50 rounded-lg px-3 py-2 text-[11px] text-amber-200">
                        • {effectiveValuation.sourcesSummary.historicalRetentionRimBlockReasonAr}
                      </div>
                    )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 font-mono">
                    <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-2.5">
                      <span className="text-[10px] text-slate-400 font-sans block">RIM_Retention المحفوظ</span>
                      <span className="text-sm font-bold text-slate-200">
                        {savedRimRetention !== null ? `${(savedRimRetention * 100).toFixed(1)}%` : 'غير متاح'}
                      </span>
                    </div>
                    <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-2.5">
                      <span className="text-[10px] text-slate-400 font-sans block">نسبة الاحتجاز التاريخية (1 - Payout)</span>
                      <span
                        className={`text-sm font-bold ${
                          histRetention !== null && (histRetention < 0 || histRetention > 1)
                            ? 'text-red-300'
                            : 'text-teal-300'
                        }`}
                      >
                        {histRetention !== null ? `${(histRetention * 100).toFixed(1)}%` : 'غير متاح'}
                      </span>
                    </div>
                    <div className="bg-slate-900/70 border border-cyan-800/50 rounded-lg p-2.5">
                      <span className="text-[10px] text-cyan-300 font-sans block">الاحتجاز الفعلي المستخدم في RIM</span>
                      <span className="text-sm font-bold text-cyan-300">
                        {activeRetention !== null ? `${(activeRetention * 100).toFixed(1)}%` : 'غير متاح'}
                      </span>
                    </div>
                  </div>
                </div>

                {(() => {
                  const rimAudit =
                    effectiveValuation.rimAudit ??
                    effectiveValuation.engineOutputs?.rimAudit ??
                    effectiveValuation.sourcesSummary?.rimAudit ??
                    null;

                  return (
                    <RimAuditSection
                      company={company}
                      effectiveMetrics={effectiveMetrics}
                      effectiveValuation={effectiveValuation}
                      rimAudit={rimAudit}
                      rimRetentionPolicy={rimRetentionPolicy}
                      resolved={resolved}
                      companyOverridesMap={companyOverridesMap}
                      paramsMap={paramsMap}
                      macroMetaMap={macroMetaMap}
                      sensitivityDrafts={sensitivityDrafts}
                      canEditCompanyParams={canEditCompanyParams}
                      isAdmin={isAdmin}
                      finCurrencyLabel={finCurrencyLabel}
                      isKeyBusy={isKeyBusy}
                      onSetSensitivityDraft={handleSetSensitivityDraft}
                      onCommitCompanyOverride={
                        onSaveCompanyOverride ? handleCommitCompanyOverride : undefined
                      }
                      onCommitDeleteCompanyOverride={
                        onDeleteCompanyOverride ? handleCommitDeleteCompanyOverride : undefined
                      }
                      onCommitGlobalMacro={
                        onSaveGlobalMacroParam ? handleCommitGlobalMacro : undefined
                      }
                    />
                  );
                })()}
              </div>
            );
          })()}

          {/* TAB 4: RELATIVE (Registry-Driven Target_PE, Target_PB & Blending Weights) */}
          {activeModelTab === 'relative' && (() => {
            const relStatus = effectiveValuation.modelStatuses?.find((m) => m.model === 'relative');
            const weightDiagnostics = relativeAudit
              ? [relativeAudit.peWeight, relativeAudit.pbWeight]
              : [];
            const relativeLoadingUnconfirmed =
              !companyOverridesConfirmed || !macroParamsConfirmed;
            const statusBadgeCls =
              relativeAudit?.status === 'blended_both'
                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                : relativeAudit?.status === 'single_pe_only' ||
                  relativeAudit?.status === 'single_pb_only'
                ? 'bg-sky-950/70 text-sky-300 border-sky-800/60'
                : relativeAudit?.status === 'loading_unconfirmed'
                ? 'bg-indigo-950/70 text-indigo-300 border-indigo-800/60'
                : 'bg-amber-950/70 text-amber-300 border-amber-800/60';

            return (
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between bg-slate-950/70 p-4 rounded-xl border border-slate-800 gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-white">التقييم النسبي بمضاعفات السوق والقطاع (Relative Multiples)</h4>
                      {relativeAudit && (
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${statusBadgeCls}`}>
                          {relativeAudit.statusLabelAr}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                      يقيم السهم بناءً على مضاعف الربحية المستهدف (<span className="font-mono">Target_PE</span> × Analytical EPS_TTM) ومضاعف القيمة الدفترية (<span className="font-mono">Target_PB</span> × Valuation BVPS) المحفوظين في <span className="font-mono">company_assumptions</span> ومقارنتها بمضاعف القطاع المحفوظ في <span className="font-mono">sectorPE</span>.
                    </p>
                  </div>
                  <div className="text-end shrink-0">
                    <span className="text-xs text-slate-400 block">القيمة العادلة النسبية</span>
                    <span className="text-2xl font-bold font-mono tabular-nums text-sky-400">
                      {effectiveValuation.relativeFairValue !== null ? `${effectiveValuation.relativeFairValue.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-950/60 border border-slate-800 rounded-xl px-3.5 py-2.5 text-[11px] text-slate-300 space-y-1">
                  <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono tabular-nums">
                    <span>
                      أساس P/E — Analytical EPS_TTM:{' '}
                      <strong className="text-slate-100">
                        {effectiveMetrics.epsTTM !== null ? `${effectiveMetrics.epsTTM.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                      </strong>
                    </span>
                    <span>
                      أساس P/B — BVPS ({effectiveMetrics.bvpsBasisLabelAr || 'إجمالي الملكية'}):{' '}
                      <strong className="text-slate-100">
                        {effectiveMetrics.bvps !== null ? `${effectiveMetrics.bvps.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                      </strong>
                    </span>
                  </div>
                  {relStatus?.inputBasisSummaryAr && (
                    <div className="text-[10px] text-sky-300">{relStatus.inputBasisSummaryAr}</div>
                  )}
                  {(relativeAudit?.blockingReasonAr || (relStatus?.status === 'excluded' && relStatus.reasonAr)) && (
                    <div
                      role="alert"
                      data-testid="relative-blocking-alert"
                      className="mt-2 p-2.5 rounded-lg bg-amber-950/35 border border-amber-800/60 text-[11px] text-amber-200 space-y-1 leading-relaxed"
                    >
                      <div className="font-semibold">
                        {relativeAudit?.blockingReasonAr ?? relStatus?.reasonAr}
                      </div>
                      {relativeAudit?.remediationAr && (
                        <div className="text-amber-100/90">{relativeAudit.remediationAr}</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  {relativeFields.map((field) => {
                    const res = resolved[field.resolvedKey];
                    const savedCompanyVal = companyOverridesMap[field.registryKey]?.value ?? null;
                    const globalRefVal = res?.globalValue ?? null;
                    const isPE = field.registryKey === 'Target_PE';
                    const impliedVal = relativeAudit
                      ? isPE
                        ? relativeAudit.peImplied
                        : relativeAudit.pbImplied
                      : null;

                    return (
                      <ValuationParameterCard
                        key={field.key}
                        field={field}
                        companyId={company.id}
                        ticker={company.ticker}
                        savedCompanyValue={savedCompanyVal}
                        globalReferenceValue={globalRefVal}
                        resolved={res}
                        sensitivityValue={sensitivityDrafts[field.registryKey]}
                        canEditCompany={canEditCompanyParams}
                        isAdmin={isAdmin}
                        isBusy={isKeyBusy(field.registryKey)}
                        onSetSensitivityDraft={handleSetSensitivityDraft}
                        onSaveCompanyOverride={onSaveCompanyOverride ? (k, v) => handleCommitCompanyOverride(k, v) : undefined}
                        onDeleteCompanyOverride={onDeleteCompanyOverride ? (k) => handleCommitDeleteCompanyOverride(k) : undefined}
                        footerExtra={
                          <div className="space-y-1 pt-1 border-t border-slate-800/70">
                            {isPE && effectiveValuation.sourcesSummary?.sectorPeLookupReasonAr && (
                              <div className="text-[10px] text-slate-400">
                                {effectiveValuation.sourcesSummary.sectorPeLookupReasonAr}
                              </div>
                            )}
                            <div className="flex justify-between text-[11px] text-slate-400">
                              <span>{isPE ? 'السعر الضمني وفق P/E:' : 'السعر الضمني وفق P/B:'}</span>
                              <span className="font-mono tabular-nums text-slate-200">
                                {impliedVal !== null
                                  ? `${impliedVal.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}`
                                  : isPE && effectiveMetrics.epsTTM !== null && effectiveMetrics.epsTTM <= 0
                                  ? 'مستبعد (EPS ≤ 0)'
                                  : !isPE && effectiveMetrics.bvps !== null && effectiveMetrics.bvps <= 0
                                  ? 'مستبعد (BVPS ≤ 0)'
                                  : 'غير متاح'}
                              </span>
                            </div>
                          </div>
                        }
                      />
                    );
                  })}
                </div>

                {/* Relative Blending Weights Clarity, Provenance & Unified Controls */}
                {relativeAudit && (
                  <div
                    data-testid="relative-weights-section"
                    className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-4 text-xs"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h5 className="text-sm font-bold text-white">
                            أوزان دمج التقييم النسبي ومصادرها (دمج قيمتي P/E وP/B)
                          </h5>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-sky-300 font-mono">
                            الأولوية النشطة: {relativeAudit.priorityLabelAr}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed max-w-3xl">
                          {relativeAudit.meaningNoteAr}
                        </p>
                      </div>
                      <div className="shrink-0 text-[11px] font-mono text-slate-300 bg-slate-900/80 border border-slate-800 rounded-lg px-3 py-2 space-y-0.5">
                        <div>
                          حالة الدمج: <strong className="text-sky-300 font-sans">{relativeAudit.statusLabelAr}</strong>
                        </div>
                        <div>
                          مجموع الوزنين الخام:{' '}
                          <strong className="text-slate-100">
                            {relativeAudit.blendingApplied && relativeAudit.weightsSum !== null
                              ? formatRawRelativeWeight(relativeAudit.weightsSum)
                              : 'غير منطبق'}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900/60 border border-slate-800/80 rounded-lg px-3 py-2 text-[11px] text-slate-200 flex items-start gap-2 leading-relaxed">
                      <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                      <span>{relativeAudit.formulaNoteAr}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {weightDiagnostics.map((w) => (
                        <div
                          key={w.registryKey}
                          data-testid={`relative-weight-summary-${w.registryKey}`}
                          className="bg-slate-900/70 border border-slate-800 rounded-xl p-3 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-bold text-slate-100">{w.shortLabelAr}</div>
                              <div className="text-[10px] font-mono text-slate-400">
                                المفتاح التقني: {w.registryKey}
                              </div>
                            </div>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                                w.scope === 'company'
                                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                                  : w.scope === 'global'
                                  ? 'bg-sky-950/70 text-sky-300 border-sky-800/60'
                                  : w.scope === 'loading_unconfirmed'
                                  ? 'bg-indigo-950/70 text-indigo-300 border-indigo-800/60'
                                  : 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                              }`}
                            >
                              {w.scopeLabelAr}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2">
                              <span className="text-[10px] text-slate-400 font-sans block">
                                الوزن الرقمي الخام المعتمد
                              </span>
                              <strong className="text-sm text-white">
                                {w.scope === 'loading_unconfirmed'
                                  ? 'قيد تأكيد التحميل'
                                  : formatRawRelativeWeight(w.rawValue)}
                              </strong>
                            </div>
                            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-2">
                              <span className="text-[10px] text-slate-400 font-sans block">
                                حصة الدمج المطبّعة (%)
                              </span>
                              <strong
                                className={`text-sm ${
                                  relativeAudit.blendingApplied && w.normalizedSharePct !== null
                                    ? 'text-emerald-300'
                                    : 'text-slate-400'
                                }`}
                              >
                                {relativeAudit.blendingApplied && w.normalizedSharePct !== null
                                  ? formatNormalizedSharePct(w.normalizedSharePct)
                                  : 'غير منطبق'}
                              </strong>
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-300 space-y-1 border-t border-slate-800/70 pt-2">
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">النطاق المعتمد:</span>
                              <span className="text-slate-200">{w.scopeLabelAr}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">المصدر التوثيقي:</span>
                              <span className="text-slate-200">
                                {w.rawValue !== null
                                  ? w.documentarySource ?? 'المصدر التوثيقي غير موثق (القيمة متاحة)'
                                  : w.scope === 'loading_unconfirmed'
                                  ? 'قيد تأكيد التحميل'
                                  : 'لا توجد قيمة معتمدة (غياب مؤكد)'}
                              </span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">تاريخ السريان:</span>
                              <span className="font-mono text-slate-200">{w.asOfDate ?? 'غير محدد'}</span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">تخصيص الشركة (company_assumptions):</span>
                              <span className="font-mono text-slate-200">
                                {
                                  formatScopedAssumptionStateAr({
                                    value: w.companyValue,
                                    scopeConfirmed: companyOverridesConfirmed,
                                    formatValue: formatRawRelativeWeight,
                                    documentarySource: w.companyDocumentarySource,
                                    asOfDate: w.companyAsOfDate,
                                    includeMissingDocumentaryNote: true,
                                  }).fullTextAr
                                }
                              </span>
                            </div>
                            <div className="flex justify-between gap-2">
                              <span className="text-slate-400">المتغيرات الكلية (macro_params):</span>
                              <span className="font-mono text-sky-300">
                                {
                                  formatScopedAssumptionStateAr({
                                    value: w.globalValue,
                                    scopeConfirmed: macroParamsConfirmed,
                                    formatValue: formatRawRelativeWeight,
                                    documentarySource: w.globalDocumentarySource,
                                    asOfDate: w.globalAsOfDate,
                                    includeMissingDocumentaryNote: true,
                                  }).fullTextAr
                                }
                              </span>
                            </div>
                            {w.priorityExplanationAr && (
                              <div className="text-[10px] text-sky-300 pt-1">
                                • {w.priorityExplanationAr}
                              </div>
                            )}
                            {w.issueAr && relativeAudit.blendingRequired && (
                              <div className="text-[10px] text-amber-300 pt-1">• {w.issueAr}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Unified Parameter Cards reusing existing company_assumptions / macro_params / sensitivity draft path */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                      {relativeWeightFields.map((field) => {
                        const res = resolved[field.resolvedKey];
                        const savedCompanyOv = companyOverridesMap[field.registryKey];
                        const savedCompanyVal = savedCompanyOv?.value ?? null;
                        const globalRefVal = res?.globalValue ?? null;
                        const globalMeta = macroMetaMap?.[field.registryKey];
                        const weightDiag =
                          field.registryKey === 'Relative_PE_Weight'
                            ? relativeAudit.peWeight
                            : relativeAudit.pbWeight;

                        return (
                          <ValuationParameterCard
                            key={field.key}
                            field={field}
                            companyId={company.id}
                            ticker={company.ticker}
                            savedCompanyValue={savedCompanyVal}
                            globalReferenceValue={globalRefVal}
                            savedCompanyMeta={
                              savedCompanyOv
                                ? { source: savedCompanyOv.source ?? null, asOfDate: savedCompanyOv.asOfDate ?? null }
                                : undefined
                            }
                            globalMeta={
                              globalMeta
                                ? { source: globalMeta.source ?? null, asOfDate: globalMeta.asOfDate ?? null }
                                : undefined
                            }
                            resolved={res}
                            sensitivityValue={sensitivityDrafts[field.registryKey]}
                            canEditCompany={canEditCompanyParams}
                            isAdmin={isAdmin}
                            isBusy={isKeyBusy(field.registryKey)}
                            showRichDetails={true}
                            loadingUnconfirmed={
                              relativeLoadingUnconfirmed && weightDiag.rawValue === null
                            }
                            companyScopeConfirmed={companyOverridesConfirmed}
                            globalScopeConfirmed={macroParamsConfirmed}
                            stageLabelAr="دمج التقييم النسبي (P/E + P/B)"
                            requirementBadgeAr={
                              relativeAudit.blendingRequired
                                ? 'مطلوب عند توفر الفرعين معاً'
                                : 'غير مطلوب حالياً (فرع واحد فقط متاح)'
                            }
                            missingRequirementAr={
                              relativeAudit.blendingRequired
                                ? `احفظ ${field.registryKey} في تخصيص الشركة (company_assumptions) أو المتغيرات الكلية (macro_params).`
                                : null
                            }
                            onSetSensitivityDraft={handleSetSensitivityDraft}
                            onSaveCompanyOverride={
                              onSaveCompanyOverride
                                ? (k, v) => handleCommitCompanyOverride(k, v)
                                : undefined
                            }
                            onDeleteCompanyOverride={
                              onDeleteCompanyOverride
                                ? (k) => handleCommitDeleteCompanyOverride(k)
                                : undefined
                            }
                            onSaveGlobalMacro={
                              onSaveGlobalMacroParam
                                ? (k, v) => handleCommitGlobalMacro(k, v)
                                : undefined
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* TAB 5: GRAHAM */}
          {activeModelTab === 'graham' && (() => {
            const grahamStatus = effectiveValuation.modelStatuses?.find((m) => m.model === 'graham');
            return (
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between bg-slate-950/70 p-4 rounded-xl border border-slate-800 gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-white">صيغة بنجامين جراهام (Benjamin Graham Fair Value)</h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                      تستند لمعادلة الأب الروحي للاستثمار في القيمة: <span className="font-mono text-indigo-400">V = √(22.5 × EPS × BVPS)</span>{' '}
                      والتي تدمج بين الربحية التحليلية (<span className="font-mono">EPS_TTM &gt; 0</span>) والقيمة الدفترية (<span className="font-mono">BVPS &gt; 0</span>).
                    </p>
                  </div>
                  <div className="text-end shrink-0">
                    <span className="text-xs text-slate-400 block">رقم جراهام العادل</span>
                    <span className="text-2xl font-bold font-mono tabular-nums text-indigo-400">
                      {effectiveValuation.grahamFairValue !== null ? `${effectiveValuation.grahamFairValue.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'غير متاح'}
                    </span>
                  </div>
                </div>

                {grahamStatus?.status === 'excluded' && grahamStatus.reasonAr && (
                  <div className="bg-amber-950/35 border border-amber-800/60 rounded-xl p-3 text-xs text-amber-200">
                    {grahamStatus.reasonAr}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block">مدخلات المعادلة للسهم:</span>
                    <div className="mt-2 space-y-1 font-mono tabular-nums text-slate-200">
                      <div>
                        • ربحية السهم التحليلية (Analytical EPS_TTM):{' '}
                        {effectiveMetrics.epsTTM !== null ? `${effectiveMetrics.epsTTM.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'BLANK'}
                      </div>
                      <div>
                        • القيمة الدفترية (BVPS):{' '}
                        {effectiveMetrics.bvps !== null ? `${effectiveMetrics.bvps.toFixed(2)}${finCurrencyLabel ? ` ${finCurrencyLabel}` : ''}` : 'BLANK'}{' '}
                        <span className="font-sans text-[10px] text-slate-400">
                          ({effectiveMetrics.bvpsBasisLabelAr || 'إجمالي الملكية'})
                        </span>
                      </div>
                      <div>• المعامل القياسي: 22.5 (15 P/E × 1.5 P/B)</div>
                    </div>
                  </div>
                  <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-400 block">تفسير نتيجة جراهام:</span>
                    <p className="mt-2 text-slate-300 leading-relaxed text-[11px]">
                      {grahamStatus?.inputBasisSummaryAr ||
                        (company.marketPrice !== null
                          ? `إذا كان السعر السوقي (${company.marketPrice.toFixed(2)} ${mktCurrencyLabel}) أدنى من رقم جراهام، فإن السهم يوفر حماية مزدوجة ضد مخاطر التراجع في الأرباح وتآكل الأصول.`
                          : 'يلزم توفر السعر السوقي من سجل التداول اليومي لمقارنة السهم برقم جراهام.')}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* 4. 2D Sensitivity Matrix Heatmap */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 mb-4 gap-2">
          <div>
            <div className="flex items-center gap-2">
              <TableIcon className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">مصفوفة الحساسية ثنائية الأبعاد (2D Sensitivity Matrix)</h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              تأثير تغير معدل النمو المستدام (g) على الأعمدة مقابل معدل الخصم / Ke على الصفوف
            </p>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-emerald-600/80 inline-block" /> خصم عميق &gt; 35%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-emerald-800/60 inline-block" /> أقل من العادل 12-35%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-amber-900/40 inline-block" /> عادل ±10%
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded bg-red-900/50 inline-block" /> مبالغ فيه
            </span>
          </div>
        </div>

        {/* Heatmap Grid */}
        {effectiveValuation.sensitivityMatrix.length === 0 ? (
          <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-amber-300 text-center">
            مصفوفة الحساسية غير متاحة: يلزم توفر تكلفة حقوق الملكية (Ke) ومعدل النمو الدائم (g) والسعر السوقي أو نموذج تقييم صالح.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-center border-collapse">
              <thead>
                <tr className="bg-slate-950 text-slate-400">
                  <th className="p-3 text-start border border-slate-800/80 font-medium">
                    معدل الخصم \ النمو (g)
                  </th>
                  {effectiveValuation.growthRates.map((gr) => (
                    <th key={gr} className="p-3 border border-slate-800/80 font-mono">
                      {(gr * 100).toFixed(0)}%
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {effectiveValuation.sensitivityMatrix.map((row, rowIdx) => {
                  const discRate = effectiveValuation.discountRates[rowIdx];
                  const activeG = resolved.terminalGrowth?.value ?? null;
                  return (
                    <tr key={rowIdx}>
                      <td className="p-3 text-start font-mono font-medium text-slate-300 bg-slate-950/60 border border-slate-800/80">
                        {(discRate * 100).toFixed(1)}%
                      </td>
                      {row.map((cell, cellIdx) => {
                        const isBaseCell =
                          activeG !== null &&
                          effectiveMetrics.costOfEquity !== null &&
                          Math.abs(cell.growthRate - activeG) < 0.015 &&
                          Math.abs(cell.discountRate - effectiveMetrics.costOfEquity) < 0.015;

                        let cellBg = 'bg-slate-950/40 text-slate-200';
                        if (cell.status === 'deeply_undervalued') {
                          cellBg = 'bg-emerald-950/80 text-emerald-300 font-bold';
                        } else if (cell.status === 'undervalued') {
                          cellBg = 'bg-emerald-950/40 text-emerald-400';
                        } else if (cell.status === 'overvalued') {
                          cellBg = 'bg-red-950/50 text-red-300';
                        } else {
                          cellBg = 'bg-amber-950/40 text-amber-300';
                        }

                        return (
                          <td
                            key={cellIdx}
                            className={`p-3 border border-slate-800/80 transition-colors font-mono relative ${cellBg} ${
                              isBaseCell ? 'ring-2 ring-emerald-500 shadow-md' : ''
                            }`}
                          >
                            {isBaseCell && (
                              <span className="absolute top-1 left-1 text-[8px] px-1 rounded bg-emerald-600 text-white font-sans">
                                الأساسي
                              </span>
                            )}
                            <div className="text-sm font-semibold">{cell.fairValue?.toFixed(2) ?? 'غير متاح'}</div>
                            <div className="text-[10px] opacity-75">
                              {cell.diffPct !== null
                                ? `${cell.diffPct > 0 ? '+' : ''}${cell.diffPct.toFixed(0)}%`
                                : 'غير متاح'}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Metric Accounting Audit Card */}
      <MetricAuditCard
        metricAudit={
          effectiveMetrics.metricAudit ??
          effectiveValuation.metricAudit ??
          effectiveValuation.sourcesSummary?.metricAudit
        }
        finCurrencyLabel={finCurrencyLabel}
        ticker={company.ticker}
        onRequestEditTarget={onRequestEditTarget}
      />

      {/* 6. Valuation Sources & Completeness Summary Card */}
      <ValuationSourcesCard summary={effectiveValuation.sourcesSummary} />
    </div>
  );
};
