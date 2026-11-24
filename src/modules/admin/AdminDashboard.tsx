/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import {
  ShieldAlert,
  Sliders,
  Users,
  PlusCircle,
  Save,
  CheckCircle2,
  Trash2,
  Building,
  Wrench,
  RefreshCw,
  AlertTriangle,
  FileSearch,
  Download,
  Copy,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import {
  AppUser,
  BetaAssumptionRecord,
  Company,
  CompanyMetadataPatch,
  CompanyParameterOverride,
  DailyTradingRecord,
  MacroParameter,
  QuarterlyFinancialRecord,
  SectorClassification,
  SubscriptionTier,
  UserRole,
} from '../../types';
import { ConfirmDeleteModal } from '../../shared/ui/ConfirmDeleteModal';
import {
  CanonicalRfMethodology,
  ParameterWritePrecondition,
  SectorDefinitionPayload,
  SectorDeletePayload,
  SectorMutationReport,
  SectorStatusTogglePayload,
  companyMatchesSectorDefinition,
  getParameterDefinition,
  matchSectorFromRegistry,
  normalizeRfMethodology,
  sanitizeSectorId,
  suggestSectorId,
  tryNormalizedTicker,
} from '../../core/contracts';
import type {
  SectorDefinition,
  SectorPeLoadStatus,
  SectorStatus,
} from '../../types/financial';
import type { StockUniverseDiagnostics } from '../../core/domain/stockDerived';
import {
  analyzeLegacyMigration,
  type LegacyMigrationReport,
} from '../../core/domain/legacyMigrationTool';
import {
  buildNewMacroParameterFromDraft,
  getMacroParameterInputSpec,
  getMissingGlobalParameterDefinitions,
  storedValueToEditString,
} from '../../core/domain/macroParameterInput';
import {
  buildEffectiveParamFromEntry,
  createMacroParamDraftStore,
  getMacroParamDraftSummary,
  type CustomParameterTypeChoice,
  type MacroParamDraftStore,
  type MacroParamSaveOutcome,
} from '../../core/domain/macroParameterDraftController';
import { extractParameterConcurrencyConflicts } from '../../services/firebase/firestoreWriters';
import { exportAllParametersToExcel } from '../../utils/excelExport';
import { SectorGovernanceActionModal } from './SectorGovernanceActionModal';

const RF_METHODOLOGY_KEYS = new Set(['Rf_Egypt_10Y', 'Rf_USD_10Y']);

export interface MacroDraftNavigationGuard {
  hasUnsavedChanges: boolean;
  dirtyCount: number;
  hasBlockingIssues: boolean;
  saveDirtyDrafts: () => Promise<MacroParamSaveOutcome>;
  discardDrafts: () => void;
}

export type AdminMaintenanceOperation =
  | 'migrate_legacy_beta'
  | 'migrate_legacy_company_overrides'
  | 'backfill_server_timestamps'
  | 'cleanup_expired_tombstones';

export interface AdminMaintenanceResult {
  processedCount?: number;
  insertedCount?: number;
  updatedCount?: number;
  skippedUnchangedCount?: number;
}

interface AdminDashboardProps {
  macroParams: MacroParameter[];
  onSaveMacroParams: (
    params: MacroParameter[],
    preconditionsByKey: Record<string, ParameterWritePrecondition>
  ) => Promise<MacroParameter[] | void>;
  onDeleteMacroParam?: (key: string) => Promise<void>;
  onMacroDraftGuardChange?: (guard: MacroDraftNavigationGuard | null) => void;
  onRunMaintenance?: (operationType: AdminMaintenanceOperation) => Promise<AdminMaintenanceResult>;
  sectorDefinitions?: SectorDefinition[];
  sectorPeConfirmed?: boolean;
  sectorPeStatus?: SectorPeLoadStatus;
  sectorPeError?: string | null;
  sectorPEMap: Record<string, number>;
  onSaveSectorPE: (peMap: Record<string, number>) => Promise<void> | void;
  onUpsertSector?: (
    payload: SectorDefinitionPayload
  ) => Promise<SectorDefinition | { definition: SectorDefinition; report?: SectorMutationReport }>;
  onToggleSectorStatus?: (payload: SectorStatusTogglePayload) => Promise<SectorMutationReport | void>;
  onDeleteSector?: (payload: SectorDeletePayload) => Promise<SectorMutationReport | void>;
  stocks?: Company[];
  companiesMeta?: Company[];
  quarterlyRecords?: QuarterlyFinancialRecord[];
  dailyRecords?: DailyTradingRecord[];
  companyOverrides?: CompanyParameterOverride[];
  betaAssumptions?: BetaAssumptionRecord[];
  universeDiagnostics?: StockUniverseDiagnostics;
  onPatchCompanyMetadata?: (patch: CompanyMetadataPatch) => Promise<void>;
  users: AppUser[];
  onSaveUsers: (users: AppUser[]) => void;
  currentUser: AppUser;
  onSwitchUser: (user: AppUser) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  macroParams,
  onSaveMacroParams,
  onDeleteMacroParam,
  onMacroDraftGuardChange,
  onRunMaintenance,
  sectorDefinitions = [],
  sectorPeConfirmed = true,
  sectorPeStatus = 'ready',
  sectorPeError = null,
  sectorPEMap,
  onSaveSectorPE,
  onUpsertSector,
  onToggleSectorStatus,
  onDeleteSector,
  stocks = [],
  companiesMeta = [],
  quarterlyRecords = [],
  dailyRecords = [],
  companyOverrides = [],
  betaAssumptions = [],
  universeDiagnostics,
  onPatchCompanyMetadata,
  users,
  onSaveUsers,
  currentUser,
  onSwitchUser,
}) => {
  const [activeAdminTab, setActiveAdminTab] = useState<'params' | 'sectors' | 'users' | 'governance'>('params');
  const [pendingAdminTab, setPendingAdminTab] = useState<'params' | 'sectors' | 'users' | 'governance' | null>(null);
  const [pendingTabFeedback, setPendingTabFeedback] = useState<{
    kind: 'error' | 'info';
    text: string;
  } | null>(null);
  const [paramToDelete, setParamToDelete] = useState<MacroParameter | null>(null);
  const [maintenanceRunning, setMaintenanceRunning] = useState<AdminMaintenanceOperation | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Central macro_params editing store (single source of truth, pure transitions, StrictMode-safe)
  const userScopeKey = currentUser?.id || 'guest';
  const draftStoreRef = useRef<MacroParamDraftStore | null>(null);
  if (!draftStoreRef.current) {
    draftStoreRef.current = createMacroParamDraftStore(macroParams, userScopeKey);
  }
  const draftStore = draftStoreRef.current;
  const draftState = useSyncExternalStore(
    draftStore.subscribe,
    draftStore.getState,
    draftStore.getState
  );

  const [saveParamNotice, setSaveParamNotice] = useState<string | null>(null);
  const [isAddingParam, setIsAddingParam] = useState(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCreateReqIdRef = useRef<string | null>(null);

  const showScopedSaveNotice = useCallback(
    (expectedScopeKey: string, text: string) => {
      if (draftStore.getState().userScopeKey !== expectedScopeKey) return;
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
      setSaveParamNotice(text);
      noticeTimerRef.current = setTimeout(() => {
        noticeTimerRef.current = null;
        if (draftStore.getState().userScopeKey === expectedScopeKey) {
          setSaveParamNotice(null);
        }
      }, 3500);
    },
    [draftStore]
  );

  useEffect(() => {
    draftStore.reconcileServer(macroParams, userScopeKey);
  }, [draftStore, macroParams, userScopeKey]);

  useEffect(() => {
    // Clear transient notices, errors, and create-modal flags whenever authenticated user changes.
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    activeCreateReqIdRef.current = null;
    setSaveParamNotice(null);
    setAddParamError(null);
    setIsAddingParam(false);
    setPendingAdminTab(null);
    setPendingTabFeedback(null);
  }, [userScopeKey]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
    };
  }, []);

  const draftSummary = getMacroParamDraftSummary(draftState);

  useEffect(() => {
    if (!draftSummary.hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [draftSummary.hasUnsavedChanges]);

  // New parameter state (no pre-filled commercial numbers)
  const [isAddParamModalOpen, setIsAddParamModalOpen] = useState(false);
  const [newParamKey, setNewParamKey] = useState('');
  const [newParamNameAr, setNewParamNameAr] = useState('');
  const [newParamDesc, setNewParamDesc] = useState('');
  const [newParamVal, setNewParamVal] = useState('');
  const [newParamRfMethodology, setNewParamRfMethodology] = useState<CanonicalRfMethodology>('unspecified');
  const [newParamCustomIsPercent, setNewParamCustomIsPercent] = useState(false);
  const [addParamError, setAddParamError] = useState<string | null>(null);

  // Sectors editing & governance state synced with Firestore sectorPE collection
  const visibleSectorDefs = sectorDefinitions.filter((d) => d.isDeleted !== true);
  const activeSectorDefs = visibleSectorDefs.filter((d) => d.status === 'active');

  const [sectorAssignNotice, setSectorAssignNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [assigningTicker, setAssigningTicker] = useState<string | null>(null);
  const [sectorCrudBusy, setSectorCrudBusy] = useState(false);
  const [sectorFormMode, setSectorFormMode] = useState<'closed' | 'create' | 'edit'>('closed');
  const [sectorForm, setSectorForm] = useState<{
    sectorId: string;
    nameAr: string;
    classification: SectorClassification;
    multipleStr: string;
    multipleSource: string;
    multipleAsOfDate: string;
    aliasesStr: string;
    status: SectorStatus;
    notes: string;
    propagateToCompanies: boolean;
  }>({
    sectorId: '',
    nameAr: '',
    classification: 'unknown',
    multipleStr: '',
    multipleSource: '',
    multipleAsOfDate: '',
    aliasesStr: '',
    status: 'active',
    notes: '',
    propagateToCompanies: true,
  });
  const [sectorDeleteDialog, setSectorDeleteDialog] = useState<{
    def: SectorDefinition;
    reassignToSectorId: string;
    errorText: string | null;
    pendingReport: SectorMutationReport | null;
  } | null>(null);
  const [sectorDisableDialog, setSectorDisableDialog] = useState<{
    def: SectorDefinition;
    reassignToSectorId: string;
    errorText: string | null;
    pendingReport: SectorMutationReport | null;
  } | null>(null);

  const getLinkedCompaniesForSector = (def: SectorDefinition): Company[] => {
    const byTicker = new Map<string, Company>();
    for (const c of [...companiesMeta, ...stocks]) {
      const tk = tryNormalizedTicker(c.ticker || c.id) ?? c.ticker ?? c.id;
      if (!tk) continue;
      if (!byTicker.has(tk)) {
        byTicker.set(tk, c);
      } else {
        const existing = byTicker.get(tk)!;
        byTicker.set(tk, {
          ...existing,
          ...c,
          sectorId: c.sectorId ?? existing.sectorId,
          sector: c.sector || existing.sector,
          rawSector: c.rawSector ?? existing.rawSector,
        });
      }
    }
    return Array.from(byTicker.values()).filter((c) =>
      companyMatchesSectorDefinition(c, def.sectorId, def, visibleSectorDefs)
    );
  };

  const [dryRunReport, setDryRunReport] = useState<LegacyMigrationReport | null>(null);
  const [copiedDryRun, setCopiedDryRun] = useState(false);

  // Delete modal state
  const [userToDelete, setUserToDelete] = useState<AppUser | null>(null);

  const orderedDraftEntries = draftState.keyOrder
    .map((key) => draftState.entries[key])
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const activeServerParams = orderedDraftEntries
    .map((entry) => entry.serverRecord)
    .filter((p): p is MacroParameter => Boolean(p));

  const missingDefinitions = getMissingGlobalParameterDefinitions(activeServerParams);
  const invalidGlobalScopeParams = activeServerParams.filter((p) => {
    const reg = getParameterDefinition(p.key);
    return Boolean(reg && !reg.allowedScopes.includes('global'));
  });
  const newParamSpec = getMacroParameterInputSpec(newParamKey.trim(), {
    valueType: newParamCustomIsPercent ? 'pct' : 'number',
    isPercentage: newParamCustomIsPercent,
    unit: newParamCustomIsPercent ? 'decimal' : 'number',
  });

  const handleParamValueChange = (key: string, valStr: string) => {
    draftStore.editValue(key, valStr);
  };

  const handleCustomParamTypeChange = (
    key: string,
    nextChoice: CustomParameterTypeChoice
  ) => {
    draftStore.editCustomType(key, nextChoice);
  };

  const handleParamRfMethodologyChange = (key: string, methodology: CanonicalRfMethodology) => {
    draftStore.editRfMethodology(key, methodology);
  };

  const handleSaveDirtyParams = useCallback(async (): Promise<MacroParamSaveOutcome> => {
    const prep = draftStore.prepareDirtySave();
    if (!prep.ok) {
      return prep.outcome;
    }

    const reqContext = {
      requestId: prep.requestId,
      userScopeKey: prep.userScopeKey,
      mode: 'update' as const,
    };

    try {
      const saved = await onSaveMacroParams(prep.paramsToSave, prep.preconditionsByKey);
      const confirmedParams = Array.isArray(saved) && saved.length > 0 ? saved : prep.paramsToSave;
      const outcome = draftStore.completeSaveSuccess(
        confirmedParams,
        prep.submittedSnapshots,
        undefined,
        reqContext
      );
      if (outcome.shouldShowSuccessNotice && outcome.noticeAr) {
        showScopedSaveNotice(reqContext.userScopeKey, outcome.noticeAr);
      }
      return outcome;
    } catch (err) {
      const conflicts = extractParameterConcurrencyConflicts(err);
      const errMsg =
        err instanceof Error ? err.message : 'تعذر حفظ المعاملات العامة في Firestore.';
      return draftStore.completeSaveFailure(errMsg, conflicts ?? undefined, reqContext);
    }
  }, [draftStore, onSaveMacroParams, showScopedSaveNotice]);

  const handleDiscardAllDrafts = useCallback(() => {
    draftStore.discardAll();
  }, [draftStore]);

  useEffect(() => {
    if (!onMacroDraftGuardChange) return;
    onMacroDraftGuardChange({
      hasUnsavedChanges: draftSummary.hasUnsavedChanges,
      dirtyCount: draftSummary.dirtyKeys.length,
      hasBlockingIssues: draftSummary.hasBlockingIssues,
      saveDirtyDrafts: handleSaveDirtyParams,
      discardDrafts: handleDiscardAllDrafts,
    });
  }, [
    onMacroDraftGuardChange,
    draftSummary.hasUnsavedChanges,
    draftSummary.dirtyKeys.length,
    draftSummary.hasBlockingIssues,
    handleSaveDirtyParams,
    handleDiscardAllDrafts,
  ]);

  useEffect(() => {
    return () => {
      onMacroDraftGuardChange?.(null);
    };
  }, [onMacroDraftGuardChange]);

  const requestSwitchAdminTab = (nextTab: 'params' | 'sectors' | 'users' | 'governance') => {
    if (nextTab === activeAdminTab) return;
    if (activeAdminTab === 'params' && draftSummary.hasUnsavedChanges) {
      setPendingTabFeedback(null);
      setPendingAdminTab(nextTab);
      return;
    }
    setActiveAdminTab(nextTab);
  };

  const handleAddNewParam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draftStore.getState().isSaving || isAddingParam) return;
    setAddParamError(null);

    const built = buildNewMacroParameterFromDraft({
      key: newParamKey,
      nameAr: newParamNameAr,
      descriptionAr: newParamDesc,
      draftValue: newParamVal,
      rfMethodology: newParamRfMethodology,
      customValueType: newParamCustomIsPercent ? 'pct' : 'number',
      customIsPercentDecimal: newParamCustomIsPercent,
    });

    if (!built.ok) {
      setAddParamError(built.errorAr);
      return;
    }

    const prep = draftStore.prepareCreateParam(built.param);
    if (!prep.ok) {
      setAddParamError(prep.errorAr);
      return;
    }

    const reqContext = {
      requestId: prep.requestId,
      userScopeKey: prep.userScopeKey,
      mode: 'create' as const,
    };
    activeCreateReqIdRef.current = prep.requestId;
    setIsAddingParam(true);

    try {
      const saved = await onSaveMacroParams([built.param], {
        [built.param.key]: prep.precondition,
      });
      const confirmedParams = Array.isArray(saved) && saved.length > 0 ? saved : [built.param];
      const outcome = draftStore.completeSaveSuccess(
        confirmedParams,
        undefined,
        undefined,
        reqContext
      );
      if (!outcome.appliedToCurrentSession) {
        return;
      }
      if (outcome.shouldShowSuccessNotice && outcome.noticeAr) {
        showScopedSaveNotice(reqContext.userScopeKey, outcome.noticeAr);
      }
      if (outcome.status === 'saved_with_conflict' && outcome.errorAr) {
        setAddParamError(outcome.errorAr);
        return;
      }
      setIsAddParamModalOpen(false);
      setNewParamKey('');
      setNewParamNameAr('');
      setNewParamDesc('');
      setNewParamVal('');
      setNewParamRfMethodology('unspecified');
      setNewParamCustomIsPercent(false);
      setAddParamError(null);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'تعذر إنشاء المتغير الجديد في Firestore.';
      const outcome = draftStore.completeSaveFailure(errMsg, undefined, reqContext);
      if (outcome.appliedToCurrentSession && outcome.errorAr) {
        setAddParamError(outcome.errorAr);
      }
    } finally {
      if (activeCreateReqIdRef.current === prep.requestId) {
        activeCreateReqIdRef.current = null;
        setIsAddingParam(false);
      }
    }
  };

  const openCreateSectorForm = (prefillRawName?: string) => {
    const cleanName = prefillRawName?.trim() ?? '';
    setSectorFormMode('create');
    setSectorForm({
      sectorId: cleanName ? suggestSectorId(cleanName) : '',
      nameAr: cleanName,
      classification: 'unknown',
      multipleStr: '',
      multipleSource: '',
      multipleAsOfDate: new Date().toISOString().slice(0, 10),
      aliasesStr: '',
      status: 'active',
      notes: '',
      propagateToCompanies: true,
    });
    setSectorAssignNotice(null);
  };

  const openEditSectorForm = (def: SectorDefinition) => {
    setSectorFormMode('edit');
    setSectorForm({
      sectorId: def.sectorId,
      nameAr: def.nameAr,
      classification: def.classification,
      multipleStr: def.multiple !== null && def.multiple !== undefined ? String(def.multiple) : '',
      multipleSource: def.multipleSource ?? '',
      multipleAsOfDate: def.multipleAsOfDate ?? '',
      aliasesStr: def.aliases.join(', '),
      status: def.status,
      notes: def.notes ?? '',
      propagateToCompanies: true,
    });
    setSectorAssignNotice(null);
  };

  const handleSaveSectorDefinition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUpsertSector) return;
    setSectorAssignNotice(null);

    const nameAr = sectorForm.nameAr.trim();
    const sectorId = sanitizeSectorId(sectorForm.sectorId.trim() || suggestSectorId(nameAr));
    if (!nameAr || !sectorId) {
      setSectorAssignNotice({
        ok: false,
        text: 'الاسم الرسمي للقطاع (nameAr) ومعرّف القطاع (sectorId) مطلوبان وبصيغة صالحة.',
      });
      return;
    }

    const multTrim = sectorForm.multipleStr.trim();
    let multiple: number | null = null;
    if (multTrim !== '') {
      const parsedMult = Number(multTrim);
      if (!Number.isFinite(parsedMult) || parsedMult <= 0 || parsedMult > 500) {
        setSectorAssignNotice({
          ok: false,
          text: 'مضاعف القطاع (P/E) يجب أن يكون رقماً موجباً أكبر من صفر وحتى 500، أو اتركه فارغاً (null).',
        });
        return;
      }
      multiple = parsedMult;
    }

    const aliases = sectorForm.aliasesStr
      .split(/[,،\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: SectorDefinitionPayload = {
      sectorId,
      nameAr,
      aliases,
      classification: sectorForm.classification,
      multiple,
      multipleSource: sectorForm.multipleSource.trim() || null,
      multipleAsOfDate: sectorForm.multipleAsOfDate.trim() || null,
      status: sectorForm.status,
      notes: sectorForm.notes.trim() || null,
      propagateToCompanies: sectorForm.propagateToCompanies,
    };

    setSectorCrudBusy(true);
    try {
      const upsertRes = await onUpsertSector(payload);
      const savedDef = 'definition' in upsertRes ? upsertRes.definition : upsertRes;
      const report = 'report' in upsertRes ? upsertRes.report : undefined;
      setSectorFormMode('closed');
      setSectorAssignNotice({
        ok: true,
        text:
          report?.messageAr ||
          `تم حفظ القطاع "${savedDef.nameAr}" (${savedDef.sectorId}) في مجموعة sectorPE بنجاح.`,
      });
    } catch (err) {
      setSectorAssignNotice({
        ok: false,
        text: err instanceof Error ? err.message : 'فشل حفظ تعريف القطاع في sectorPE.',
      });
    } finally {
      setSectorCrudBusy(false);
    }
  };

  const handleConfirmToggleSectorStatus = async (
    def: SectorDefinition,
    nextStatus: SectorStatus,
    reassignToSectorId?: string,
    resumeAfterCompanyId?: string | null,
    mutationId?: string | null
  ) => {
    if (!onToggleSectorStatus || sectorCrudBusy) return;
    setSectorCrudBusy(true);
    setSectorAssignNotice(null);
    if (nextStatus === 'disabled') {
      setSectorDisableDialog((prev) => (prev ? { ...prev, errorText: null } : prev));
    }
    try {
      const report = await onToggleSectorStatus({
        sectorId: def.sectorId,
        status: nextStatus,
        ...(reassignToSectorId ? { reassignToSectorId } : {}),
        ...(mutationId ? { mutationId } : {}),
        ...(resumeAfterCompanyId ? { resumeAfterCompanyId } : {}),
      });
      if (report && !report.completed) {
        setSectorDisableDialog((prev) =>
          prev ? { ...prev, pendingReport: report, errorText: null } : prev
        );
        return;
      }
      setSectorDisableDialog(null);
      setSectorAssignNotice({
        ok: true,
        text:
          report?.messageAr ||
          (nextStatus === 'disabled'
            ? `تم تعطيل القطاع "${def.nameAr}" (${def.sectorId}) في sectorPE.`
            : `تم إعادة تفعيل القطاع "${def.nameAr}" (${def.sectorId}).`),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل تحديث حالة القطاع في sectorPE.';
      if (nextStatus === 'disabled') {
        setSectorDisableDialog((prev) => (prev ? { ...prev, errorText: msg } : prev));
      } else {
        setSectorAssignNotice({ ok: false, text: msg });
      }
    } finally {
      setSectorCrudBusy(false);
    }
  };

  const handleConfirmDeleteSector = async () => {
    if (!sectorDeleteDialog || !onDeleteSector || sectorCrudBusy) return;
    const linked = getLinkedCompaniesForSector(sectorDeleteDialog.def);
    if (linked.length > 0 && !sectorDeleteDialog.reassignToSectorId) {
      setSectorDeleteDialog((prev) =>
        prev
          ? {
              ...prev,
              errorText: `لا يمكن حذف القطاع "${prev.def.nameAr}" لوجود ${linked.length} شركة مرتبطة؛ اختر قطاعاً بديلاً نشطاً صراحةً أو استخدم التعطيل.`,
            }
          : prev
      );
      return;
    }

    setSectorCrudBusy(true);
    setSectorAssignNotice(null);
    setSectorDeleteDialog((prev) => (prev ? { ...prev, errorText: null } : prev));
    try {
      const report = await onDeleteSector({
        sectorId: sectorDeleteDialog.def.sectorId,
        ...(sectorDeleteDialog.reassignToSectorId
          ? { reassignToSectorId: sectorDeleteDialog.reassignToSectorId }
          : {}),
        ...(sectorDeleteDialog.pendingReport?.mutationId
          ? { mutationId: sectorDeleteDialog.pendingReport.mutationId }
          : {}),
        ...(sectorDeleteDialog.pendingReport?.resumeAfterCompanyId
          ? { resumeAfterCompanyId: sectorDeleteDialog.pendingReport.resumeAfterCompanyId }
          : {}),
      });
      if (report && !report.completed) {
        setSectorDeleteDialog((prev) =>
          prev ? { ...prev, pendingReport: report, errorText: null } : prev
        );
        return;
      }
      setSectorAssignNotice({
        ok: true,
        text:
          report?.messageAr ||
          `تم حذف القطاع "${sectorDeleteDialog.def.nameAr}" (${sectorDeleteDialog.def.sectorId}) وإصدار شاهد حذف موثق.`,
      });
      setSectorDeleteDialog(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل حذف القطاع من sectorPE.';
      setSectorDeleteDialog((prev) => (prev ? { ...prev, errorText: msg } : prev));
    } finally {
      setSectorCrudBusy(false);
    }
  };

  const handleAssignStockSector = async (
    company: Company,
    sectorIdOrEmpty: string,
    classificationOverride?: SectorClassification
  ) => {
    if (!onPatchCompanyMetadata) return;
    setAssigningTicker(company.ticker);
    setSectorAssignNotice(null);
    const today = new Date().toISOString().slice(0, 10);
    try {
      const matchedDef = sectorIdOrEmpty
        ? activeSectorDefs.find((d) => d.sectorId === sectorIdOrEmpty) ?? null
        : null;
      const patch: CompanyMetadataPatch = {
        id: company.id,
        ticker: company.ticker,
        sector: matchedDef ? matchedDef.nameAr : company.sector || '',
        sectorId: matchedDef ? matchedDef.sectorId : sectorIdOrEmpty === '' ? null : company.sectorId ?? null,
        sectorClassification:
          classificationOverride ?? matchedDef?.classification ?? company.sectorClassification ?? 'unknown',
        sectorSource: 'admin_override',
        sectorDate: today,
      };
      await onPatchCompanyMetadata(patch);
      setSectorAssignNotice({
        ok: true,
        text: `تم حفظ تعيين القطاع للسهم ${company.ticker}: ${patch.sector || 'غير محدد'} (${patch.sectorClassification}).`,
      });
    } catch (err) {
      setSectorAssignNotice({
        ok: false,
        text: err instanceof Error ? err.message : `فشل حفظ تعيين القطاع للسهم ${company.ticker}.`,
      });
    } finally {
      setAssigningTicker(null);
    }
  };

  const handleRunDryRunMigration = () => {
    const sourceCompanies = companiesMeta.length > 0 ? companiesMeta : stocks;
    const report = analyzeLegacyMigration({
      companies: sourceCompanies,
      sectorDefinitions,
      sectorPEMap,
      quarterlyRecords,
      dailyRecords,
      conflicts: universeDiagnostics?.metadataConflicts ?? [],
      companyOverrides,
      betaAssumptions,
      macroParams,
    });
    setDryRunReport(report);
    setCopiedDryRun(false);
  };

  const handleDownloadDryRunJson = () => {
    if (!dryRunReport) return;
    const blob = new Blob([JSON.stringify(dryRunReport, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Mizan_Migration_DryRun_${dryRunReport.generatedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyDryRunJson = async () => {
    if (!dryRunReport || !navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(dryRunReport, null, 2));
      setCopiedDryRun(true);
      setTimeout(() => setCopiedDryRun(false), 2500);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleConfirmDeleteUser = () => {
    if (!userToDelete) return;
    const updated = users.filter((u) => u.id !== userToDelete.id);
    onSaveUsers(updated);
    setUserToDelete(null);
  };

  const handleConfirmDeleteParam = async () => {
    if (!paramToDelete || !onDeleteMacroParam) return;
    const startScopeKey = draftStore.getState().userScopeKey;
    try {
      const targetKey = paramToDelete.key;
      await onDeleteMacroParam(targetKey);
      if (draftStore.getState().userScopeKey !== startScopeKey) {
        return;
      }
      draftStore.discardDeleted(targetKey);
      setParamToDelete(null);
      showScopedSaveNotice(startScopeKey, `تم حذف المعامل ${targetKey} وإصدار شاهد حذف`);
    } catch {
      if (draftStore.getState().userScopeKey === startScopeKey) {
        setParamToDelete(null);
      }
    }
  };

  const triggerMaintenance = async (operationType: AdminMaintenanceOperation, titleAr: string) => {
    if (!onRunMaintenance) return;
    setMaintenanceRunning(operationType);
    setMaintenanceMessage(null);
    try {
      const res = await onRunMaintenance(operationType);
      setMaintenanceMessage({
        ok: true,
        text: `${titleAr}: تمت المعالجة بنجاح (تم فحص ${res.processedCount ?? 0} · إضافة ${res.insertedCount ?? 0} · تحديث ${res.updatedCount ?? 0} · دون تغيير ${res.skippedUnchangedCount ?? 0}).`,
      });
    } catch (err) {
      setMaintenanceMessage({
        ok: false,
        text: err instanceof Error ? err.message : `فشل تنفيذ ${titleAr}.`,
      });
    } finally {
      setMaintenanceRunning(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white">
                لوحة تحكم المدير التجاري والنظام (Admin Management Console)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
              إدارة المتغيرات الكلية والتقييمية الـ 29، مضاعفات ربحية القطاعات، وباقات الاشتراكات وصلاحيات المستخدمين (RBAC) لنموذج العمل التجاري.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {saveParamNotice && (
              <span
                role="status"
                data-testid="macro-save-notice"
                className="text-xs text-emerald-400 flex items-center gap-1 font-semibold"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {saveParamNotice}
              </span>
            )}
          </div>
        </div>

        {/* Tab Controls */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-800 text-xs">
          <button
            onClick={() => requestSwitchAdminTab('params')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeAdminTab === 'params'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            المتغيرات الكلية الـ 29 (Macro Hub)
            {draftSummary.hasUnsavedChanges && (
              <span className="ms-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 text-[10px] font-mono">
                {draftSummary.dirtyKeys.length}
              </span>
            )}
          </button>

          <button
            onClick={() => requestSwitchAdminTab('sectors')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeAdminTab === 'sectors'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Building className="w-3.5 h-3.5" />
            مضاعفات P/E القطاعية
          </button>

          <button
            onClick={() => requestSwitchAdminTab('users')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeAdminTab === 'users'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            المستخدمين والاشتراكات التجارية ({users.length})
          </button>

          <button
            onClick={() => requestSwitchAdminTab('governance')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-semibold transition-all ${
              activeAdminTab === 'governance'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            صيانة وحوكمة البيانات
          </button>
        </div>
      </div>

      {/* 2. TAB 1: 29 Macro & Valuation Parameters Hub */}
      {activeAdminTab === 'params' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex flex-wrap items-center gap-2">
                <span>المتغيرات الكلية ومعاملات التقييم المعتمدة</span>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono tabular-nums">
                  {activeServerParams.length} متغيراً
                </span>
                {draftSummary.dirtyKeys.length > 0 && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-amber-950 text-amber-200 border border-amber-700/60 font-medium">
                    {draftSummary.dirtyKeys.length} مسودات غير محفوظة
                  </span>
                )}
                {draftSummary.conflictKeys.length > 0 && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-red-950 text-red-200 border border-red-700/70 font-medium">
                    {draftSummary.conflictKeys.length} تعارض تزامن
                  </span>
                )}
                {draftSummary.deletedKeys.length > 0 && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-rose-950 text-rose-200 border border-rose-700/70 font-medium">
                    {draftSummary.deletedKeys.length} محذوف على الخادم
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                تُحفظ التعديلات المقصودة فقط عند الضغط على زر الحفظ، مع فحص إصدار الخادم ذرياً لمنع استبدال تعديلات أحدث بصمت.
              </p>
              <p className="text-[11px] text-emerald-300/90 mt-1">
                وحدة الإدخال: المعاملات النسبية تُعرض وتُدخل هنا بالمئة (%) وتُحفظ ككسر عشري (مثال: 15% ← 0.15)، بينما في استيراد وتصدير Excel (<span className="font-mono">All_Parameters.xlsx</span>) تُكتب القيمة المخزنة العشرية (<span className="font-mono">0.15</span>) أو نص صريح بعلامة % (<span className="font-mono">15%</span>) دون تحويل مزدوج.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={macroParams.length === 0 && companyOverrides.length === 0}
                onClick={() =>
                  void exportAllParametersToExcel({
                    macroParams,
                    companyOverrides,
                  })
                }
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-amber-300 hover:bg-slate-700 disabled:opacity-40 border border-slate-700"
              >
                <Download className="w-3.5 h-3.5" />
                تصدير Excel
              </button>
              <button
                type="button"
                disabled={draftState.isSaving || isAddingParam}
                onClick={() => {
                  setAddParamError(null);
                  setIsAddParamModalOpen(true);
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-emerald-400 hover:bg-slate-700 disabled:opacity-40 border border-slate-700"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                إضافة متغير محفوظ
              </button>
              {draftSummary.hasUnsavedChanges && (
                <button
                  type="button"
                  disabled={draftState.isSaving}
                  onClick={handleDiscardAllDrafts}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 border border-slate-700"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  تجاهل المسودات
                </button>
              )}
              <button
                type="button"
                disabled={
                  draftState.isSaving ||
                  draftSummary.dirtyKeys.length === 0 ||
                  draftSummary.hasBlockingIssues
                }
                onClick={() => void handleSaveDirtyParams()}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-sm"
              >
                {draftState.isSaving ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {draftState.isSaving
                  ? 'جارٍ حفظ التعديلات...'
                  : draftSummary.dirtyKeys.length > 0
                  ? `حفظ التعديلات (${draftSummary.dirtyKeys.length})`
                  : 'لا توجد تعديلات للحفظ'}
              </button>
            </div>
          </div>

          {(invalidGlobalScopeParams.length > 0 || draftState.bannerErrorAr) && (
            <div
              role="alert"
              className="p-3 rounded-xl border border-red-800/80 bg-red-950/40 text-red-200 text-xs space-y-1"
            >
              {invalidGlobalScopeParams.length > 0 && (
                <div>
                  • تحذير سلامة النطاق: تم رصد معاملات مخصصة لنطاق الشركة فقط (
                  <span className="font-mono font-bold">
                    {invalidGlobalScopeParams.map((p) => p.key).join('، ')}
                  </span>
                  ) ضمن المعاملات العامة (<span className="font-mono">macro_params</span>)؛ يُرجى حذفها من هنا وتحديدها في{' '}
                  <span className="font-mono">company_assumptions</span>.
                </div>
              )}
              {draftState.bannerErrorAr && <div>• {draftState.bannerErrorAr}</div>}
            </div>
          )}

          {/* Parameters Table Grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-medium">
                <tr>
                  <th className="p-3 text-start">رمز المتغير البرمجي</th>
                  <th className="p-3 text-start">التسمية العربية</th>
                  <th className="p-3 text-center">التفعيل والحالة</th>
                  <th className="p-3 text-end font-mono">القيمة الحالية</th>
                  <th className="p-3 text-start">الوحدة · التاريخ · المصدر</th>
                  <th className="p-3 text-start">الدور المحاسبي والمالي في التقييم</th>
                  {onDeleteMacroParam && <th className="p-3 text-center">حذف</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                {orderedDraftEntries.length === 0 ? (
                  <tr>
                    <td colSpan={onDeleteMacroParam ? 7 : 6} className="p-8 text-center text-slate-400">
                      لا توجد متغيرات كلية محفوظة بعد في Firestore. أضف المتغيرات المطلوبة يدوياً عبر زر "إضافة متغير محفوظ" أو استورد All_Parameters.xlsx من مركز البيانات.
                    </td>
                  </tr>
                ) : (
                  orderedDraftEntries.map((entry) => {
                    const param = buildEffectiveParamFromEntry(entry);
                    if (!param) return null;
                    const spec = getMacroParameterInputSpec(param.key, param);
                    const reg = spec.definition;
                    const isEnabledInEngine = reg
                      ? (param.enabledInEngine ?? reg.enabledInEngine)
                      : false;
                    const modeNote = param.modeNoteAr || spec.modeNoteAr;
                    const isRfParam = RF_METHODOLOGY_KEYS.has(param.key);
                    const isInvalidGlobalScope = !spec.allowedScopes.includes('global');
                    const draftValue = entry.draftValue;
                    const fieldError = entry.errorAr;
                    const isConflict = entry.status === 'conflict';
                    const isDeletedOnServer = entry.status === 'deleted_on_server';
                    const isRowSaving = entry.status === 'saving';
                    const isRowDirty = entry.dirty;
                    const customTypeSelectValue: CustomParameterTypeChoice = entry.draftCustomType;
                    const serverConflictDisplay =
                      entry.conflictServerRecord
                        ? `${storedValueToEditString(
                            param.key,
                            entry.conflictServerRecord.value,
                            entry.conflictServerRecord
                          )}${spec.inputSuffix ?? ''}`
                        : '—';

                    return (
                      <tr
                        key={param.key}
                        className={`transition-colors ${
                          isConflict || isDeletedOnServer || isInvalidGlobalScope || entry.status === 'error'
                            ? 'bg-red-950/25 hover:bg-red-950/40'
                            : isRowDirty
                            ? 'bg-amber-950/20 hover:bg-amber-950/30'
                            : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="p-3 font-mono font-bold text-slate-200 align-top">
                          <div>{param.key}</div>
                          {typeof entry.serverRecord?.revision === 'number' && (
                            <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                              rev {entry.serverRecord.revision}
                            </span>
                          )}
                          {isInvalidGlobalScope && (
                            <span className="text-[10px] text-red-300 font-sans block mt-0.5">
                              نطاق غير صالح (خاص بالشركة فقط)
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-slate-300 font-semibold align-top">
                          <div>{param.nameAr}</div>
                          {modeNote && (
                            <div className="text-[10px] text-amber-300 font-normal mt-0.5">
                              {modeNote}
                            </div>
                          )}
                          {!spec.isCataloged && (
                            <div className="mt-1.5 flex items-center gap-1.5 font-normal">
                              <span className="text-[10px] text-slate-400">نوع المخصص:</span>
                              <select
                                aria-label={`نوع المعامل ${param.key}`}
                                value={customTypeSelectValue}
                                disabled={isDeletedOnServer}
                                onChange={(e) =>
                                  handleCustomParamTypeChange(
                                    param.key,
                                    e.target.value as CustomParameterTypeChoice
                                  )
                                }
                                className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                              >
                                <option value="unspecified">غير محدد (سجل قديم)</option>
                                <option value="number">معامل عددي (بدون تحويل)</option>
                                <option value="pct">نسبة مئوية (% ← كسر عشري)</option>
                              </select>
                            </div>
                          )}
                          {isRfParam && (
                            <div className="mt-1.5 flex items-center gap-1.5 font-normal">
                              <span className="text-[10px] text-slate-400">منهجية Rf:</span>
                              <select
                                aria-label={`منهجية ${param.key}`}
                                value={normalizeRfMethodology(entry.draftRfMethodology ?? param.rfMethodology)}
                                disabled={isDeletedOnServer}
                                onChange={(e) =>
                                  handleParamRfMethodologyChange(
                                    param.key,
                                    e.target.value as CanonicalRfMethodology
                                  )
                                }
                                className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-slate-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                              >
                                <option value="unspecified">unspecified (غير مصنف)</option>
                                <option value="sovereign_yield">sovereign_yield (عائد سيادي خام)</option>
                                <option value="default_free">default_free (خالٍ من التعثر)</option>
                                <option value="synthetic">synthetic (تركيبي)</option>
                              </select>
                            </div>
                          )}

                          {isConflict && (
                            <div className="mt-2 p-2.5 rounded-lg border border-red-700/70 bg-red-950/60 text-[11px] font-normal space-y-1.5">
                              <div className="text-red-200 font-semibold flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                تعارض تزامن — تم تعديل المعامل على الخادم
                              </div>
                              <div className="text-slate-300 space-y-0.5">
                                <div>
                                  نسخة الخادم الأحدث:{' '}
                                  <span className="font-mono text-emerald-300 font-bold">
                                    {serverConflictDisplay}
                                  </span>
                                  {typeof entry.conflictServerRecord?.revision === 'number' && (
                                    <span className="text-slate-400 font-mono ms-1">
                                      (rev {entry.conflictServerRecord.revision})
                                    </span>
                                  )}
                                </div>
                                <div>
                                  مسودتك المحلية:{' '}
                                  <span className="font-mono text-amber-300 font-bold">
                                    {draftValue}
                                    {spec.inputSuffix ?? ''}
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                <button
                                  type="button"
                                  onClick={() => draftStore.resolveConflictAcceptServer(param.key)}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-[10px] font-semibold"
                                >
                                  اعتماد نسخة الخادم
                                </button>
                                <button
                                  type="button"
                                  onClick={() => draftStore.resolveConflictKeepDraft(param.key)}
                                  className="px-2 py-1 rounded bg-amber-900/70 hover:bg-amber-800/80 text-amber-100 border border-amber-700/70 text-[10px] font-semibold"
                                >
                                  الإبقاء على مسودتي فوق النسخة الأحدث
                                </button>
                              </div>
                            </div>
                          )}

                          {isDeletedOnServer && (
                            <div className="mt-2 p-2.5 rounded-lg border border-rose-700/70 bg-rose-950/60 text-[11px] font-normal space-y-1.5">
                              <div className="text-rose-200 font-semibold flex items-center gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                تم حذف هذا المعامل على الخادم
                              </div>
                              <div className="text-slate-300">
                                مسودتك المحلية ({draftValue}
                                {spec.inputSuffix ?? ''}) محفوظة مؤقتاً للمراجعة ولن تُعاد كتابتها تلقائياً.
                              </div>
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                <button
                                  type="button"
                                  onClick={() => draftStore.discardDeleted(param.key)}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] font-semibold"
                                >
                                  تجاهل المسودة وإزالتها
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewParamKey(param.key);
                                    setNewParamNameAr(param.nameAr);
                                    setNewParamDesc(param.descriptionAr || '');
                                    setNewParamVal(draftValue);
                                    setNewParamCustomIsPercent(entry.draftCustomType === 'pct');
                                    setNewParamRfMethodology(
                                      normalizeRfMethodology(entry.draftRfMethodology ?? param.rfMethodology)
                                    );
                                    setAddParamError(null);
                                    draftStore.discardDeleted(param.key);
                                    setIsAddParamModalOpen(true);
                                  }}
                                  className="px-2 py-1 rounded bg-emerald-900/70 hover:bg-emerald-800 text-emerald-100 border border-emerald-700/70 text-[10px] font-semibold"
                                >
                                  إعادة إنشاء صريح...
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-center align-top space-y-1">
                          <div>
                            <span
                              className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                isInvalidGlobalScope
                                  ? 'bg-red-950/70 text-red-300 border-red-800/60'
                                  : isEnabledInEngine
                                  ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                                  : 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                              }`}
                            >
                              {isInvalidGlobalScope
                                ? 'مرفوض (نطاق شركة)'
                                : isEnabledInEngine
                                ? 'مفعّل حسابياً'
                                : 'للتوثيق فقط'}
                            </span>
                          </div>
                          {isRowSaving && (
                            <div className="text-[10px] text-sky-300 font-medium">جارٍ الحفظ...</div>
                          )}
                          {isConflict && (
                            <div className="text-[10px] text-red-300 font-semibold">تعارض تزامن</div>
                          )}
                          {isDeletedOnServer && (
                            <div className="text-[10px] text-rose-300 font-semibold">محذوف بالخادم</div>
                          )}
                          {!isRowSaving && !isConflict && !isDeletedOnServer && isRowDirty && (
                            <div className="text-[10px] text-amber-300 font-medium">مسودة غير محفوظة</div>
                          )}
                        </td>
                        <td className="p-3 text-end align-top">
                          <div className="inline-flex items-center gap-1 justify-end">
                            <input
                              type="text"
                              inputMode={spec.inputMode}
                              aria-label={`قيمة ${param.key}`}
                              aria-invalid={Boolean(fieldError)}
                              value={draftValue}
                              disabled={isDeletedOnServer}
                              placeholder={spec.placeholderAr}
                              onChange={(e) => handleParamValueChange(param.key, e.target.value)}
                              className={`w-28 bg-slate-950 border rounded-md p-1.5 font-mono tabular-nums text-end font-bold focus:outline-none disabled:opacity-50 ${
                                fieldError || isConflict || isDeletedOnServer
                                  ? 'border-red-500 text-red-200 focus:border-red-400'
                                  : isRowDirty
                                  ? 'border-amber-500 text-amber-200 focus:border-amber-400'
                                  : 'border-slate-700 text-emerald-300 focus:border-emerald-500'
                              }`}
                            />
                            {spec.inputSuffix && (
                              <span className="text-slate-400 font-mono text-[11px] min-w-[1.25rem] text-start">
                                {spec.inputSuffix}
                              </span>
                            )}
                            {isRowDirty && !isConflict && !isDeletedOnServer && !isRowSaving && (
                              <button
                                type="button"
                                title="تراجع عن التعديل المحلي لهذا المعامل"
                                onClick={() => draftStore.discardSingle(param.key)}
                                className="p-1 rounded text-slate-400 hover:text-amber-300 hover:bg-slate-800"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          {fieldError && !isConflict && !isDeletedOnServer ? (
                            <div
                              role="alert"
                              className="text-[10px] text-red-300 mt-1 text-end max-w-[220px] ms-auto leading-snug"
                            >
                              {fieldError}
                            </div>
                          ) : (
                            spec.boundsSummaryAr && (
                              <div className="text-[10px] text-slate-500 mt-1 text-end">
                                {spec.boundsSummaryAr}
                              </div>
                            )
                          )}
                        </td>
                        <td className="p-3 text-[11px] text-slate-300 space-y-0.5 align-top">
                          <div className="text-slate-200 font-medium">{spec.displayUnitLabelAr}</div>
                          <div className="text-[10px] text-slate-400 leading-snug">
                            {spec.storageHintAr}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400">
                            {param.unit || spec.storageUnit}
                            {param.currency ? ` · ${param.currency}` : ''} · {param.asOfDate || 'بدون تاريخ'}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate max-w-[180px]" title={param.source || ''}>
                            {param.source || 'لوحة الإدارة'}
                          </div>
                        </td>
                        <td className="p-3 text-slate-400 leading-relaxed text-[11px] align-top">
                          {param.descriptionAr || spec.descriptionAr || '—'}
                        </td>
                        {onDeleteMacroParam && (
                          <td className="p-3 text-center align-top">
                            {entry.serverRecord ? (
                              <button
                                type="button"
                                disabled={draftState.isSaving}
                                onClick={() => setParamToDelete(entry.serverRecord)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-950/40 disabled:opacity-40 transition-colors"
                                title="حذف المعامل وإنشاء شاهد حذف"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-500">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. TAB 2: Official sectorPE Registry CRUD, Multiples & Diagnostics */}
      {activeAdminTab === 'sectors' && (
        <div className="space-y-5">
          {!sectorPeConfirmed && (
            <div
              role="alert"
              className="p-3.5 rounded-xl border border-amber-700/80 bg-amber-950/40 text-amber-200 text-xs flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">
                  حالة تحميل سجل القطاعات الرسمي (sectorPE): {sectorPeStatus}
                </div>
                <div className="text-[11px] mt-0.5">
                  {sectorPeError ||
                    'تعذر تأكيد قراءة مجموعة sectorPE من الخادم؛ لا يتم إنشاء قطاعات تلقائياً ولا يتم خفض حالة الشركات بصمت.'}
                </div>
              </div>
            </div>
          )}

          {/* 3A: sectorPE Authoritative Registry Management (CRUD) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>سجل القطاعات الرسمي ومضاعفات الربحية (sectorPE — المصدر الوحيد المعتمد)</span>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-950 text-emerald-300 font-mono tabular-nums">
                    {activeSectorDefs.length} نشط / {visibleSectorDefs.length} إجمالي
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  تُدار جميع القطاعات والمرادفات وتصنيف النشاط (مالي / غير مالي / غير معروف) ومضاعف P/E مباشرة عبر Cloud Functions في مجموعة sectorPE فقط.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={!onUpsertSector || sectorCrudBusy}
                  onClick={() => openCreateSectorForm()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white shadow-sm"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>إضافة قطاع جديد في sectorPE</span>
                </button>
              </div>
            </div>

            {sectorAssignNotice && (
              <div
                role="status"
                className={`p-3 rounded-xl border text-xs ${
                  sectorAssignNotice.ok
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
                    : 'bg-red-950/60 border-red-800 text-red-200'
                }`}
              >
                {sectorAssignNotice.text}
              </div>
            )}

            {/* Create / Edit Sector Form Panel */}
            {sectorFormMode !== 'closed' && (
              <form
                onSubmit={handleSaveSectorDefinition}
                className="bg-slate-950/85 border border-emerald-800/60 rounded-xl p-4 space-y-3 text-xs"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h4 className="font-bold text-emerald-300">
                    {sectorFormMode === 'create'
                      ? 'إضافة تعريف قطاع جديد في sectorPE'
                      : `تعديل قطاع: ${sectorForm.nameAr} (${sectorForm.sectorId})`}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setSectorFormMode('closed')}
                    className="text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">الاسم الرسمي بالعربية (nameAr)*</label>
                    <input
                      type="text"
                      required
                      value={sectorForm.nameAr}
                      onChange={(e) => {
                        const nextName = e.target.value;
                        setSectorForm((prev) => ({
                          ...prev,
                          nameAr: nextName,
                          sectorId:
                            sectorFormMode === 'create' && (!prev.sectorId || prev.sectorId === suggestSectorId(prev.nameAr))
                              ? suggestSectorId(nextName)
                              : prev.sectorId,
                        }));
                      }}
                      placeholder="مثال: بنوك وخدمات مالية"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">المعرّف الفريد (sectorId)*</label>
                    <input
                      type="text"
                      required
                      disabled={sectorFormMode === 'edit'}
                      value={sectorForm.sectorId}
                      onChange={(e) => setSectorForm((prev) => ({ ...prev, sectorId: e.target.value }))}
                      placeholder="banks_financial_services"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-slate-200 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">تصنيف النشاط (DCF Eligibility)*</label>
                    <select
                      value={sectorForm.classification}
                      onChange={(e) =>
                        setSectorForm((prev) => ({
                          ...prev,
                          classification: e.target.value as SectorClassification,
                        }))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100"
                    >
                      <option value="unknown">غير معروف (unknown — DCF مستبعد)</option>
                      <option value="non_financial">غير مالي (non_financial — مؤهل DCF)</option>
                      <option value="financial">مالي / بنوك (financial — DCF مستبعد)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">مضاعف الربحية P/E (اختياري / null)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max="500"
                      value={sectorForm.multipleStr}
                      onChange={(e) => setSectorForm((prev) => ({ ...prev, multipleStr: e.target.value }))}
                      placeholder="BLANK لترك المضاعف غير محدد (null)"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-emerald-300"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">مصدر مضاعف P/E (multipleSource)</label>
                    <input
                      type="text"
                      value={sectorForm.multipleSource}
                      onChange={(e) => setSectorForm((prev) => ({ ...prev, multipleSource: e.target.value }))}
                      placeholder="مثال: البورصة المصرية — متوسط القطاع"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">تاريخ سريان المضاعف (multipleAsOfDate)</label>
                    <input
                      type="date"
                      value={sectorForm.multipleAsOfDate}
                      onChange={(e) => setSectorForm((prev) => ({ ...prev, multipleAsOfDate: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">حالة القطاع</label>
                    <select
                      value={sectorForm.status}
                      onChange={(e) =>
                        setSectorForm((prev) => ({ ...prev, status: e.target.value as SectorStatus }))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                    >
                      <option value="active">نشط (active)</option>
                      <option value="disabled">معطّل (disabled)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">المرادفات / الأسماء البديلة (مفصولة بفاصلة)</label>
                    <input
                      type="text"
                      value={sectorForm.aliasesStr}
                      onChange={(e) => setSectorForm((prev) => ({ ...prev, aliasesStr: e.target.value }))}
                      placeholder="Banks, بنوك, مصارف"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="block text-slate-400 mb-1">ملاحظات إدارية (notes)</label>
                    <input
                      type="text"
                      value={sectorForm.notes}
                      onChange={(e) => setSectorForm((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder="ملاحظات اختيارية..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-slate-300 pt-4 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sectorForm.propagateToCompanies}
                      onChange={(e) =>
                        setSectorForm((prev) => ({ ...prev, propagateToCompanies: e.target.checked }))
                      }
                      className="rounded border-slate-700 bg-slate-900 text-emerald-500"
                    />
                    <span>تحديث الاسم والتصنيف في مستندات الشركات المرتبطة تلقائياً عند الحفظ</span>
                  </label>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setSectorFormMode('closed')}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={sectorCrudBusy || !onUpsertSector}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{sectorCrudBusy ? 'جارٍ الحفظ...' : 'حفظ تعريف القطاع في الخادم'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* Sector Cards Grid */}
            {visibleSectorDefs.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 border border-slate-800 rounded-xl bg-slate-950/50">
                لا توجد تعريفات قطاعات مسجلة في مجموعة <span className="font-mono text-slate-200">sectorPE</span> حتى الآن.
                استخدم زر "إضافة قطاع جديد في sectorPE" لإنشاء السجل المرجعي.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {visibleSectorDefs.map((def) => {
                  const isDisabled = def.status === 'disabled';
                  const linkedCount = getLinkedCompaniesForSector(def).length;
                  return (
                    <div
                      key={def.sectorId}
                      className={`p-3.5 rounded-xl border space-y-2 text-xs ${
                        isDisabled
                          ? 'bg-slate-950/40 border-amber-900/50 opacity-85'
                          : 'bg-slate-950/80 border-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-100 truncate" title={def.nameAr}>
                            {def.nameAr}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 truncate">
                            {def.sectorId}
                            {def.isLegacyFormat ? ' · legacy doc' : ''}
                            {` · ${linkedCount} شركة مرتبطة`}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border shrink-0 ${
                            isDisabled
                              ? 'bg-amber-950/70 text-amber-300 border-amber-800/60'
                              : 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60'
                          }`}
                        >
                          {isDisabled ? 'معطّل' : 'نشط'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px] bg-slate-900/70 px-2.5 py-1.5 rounded-lg border border-slate-800/70">
                        <span className="text-slate-400">
                          التصنيف:{' '}
                          <strong className="font-mono text-sky-300">{def.classification}</strong>
                        </span>
                        <span className="font-mono tabular-nums font-bold text-emerald-400">
                          {def.multiple !== null && def.multiple !== undefined
                            ? `${def.multiple}x`
                            : 'بدون مضاعف (null)'}
                        </span>
                      </div>

                      {def.aliases.length > 0 && (
                        <div className="text-[10px] text-slate-400 truncate" title={def.aliases.join('، ')}>
                          مرادفات: <span className="text-slate-300">{def.aliases.join('، ')}</span>
                        </div>
                      )}

                      {(def.multipleSource || def.multipleAsOfDate) && (
                        <div className="text-[10px] font-mono text-slate-400 truncate">
                          {def.multipleSource || '-'}
                          {def.multipleAsOfDate ? ` · ${def.multipleAsOfDate}` : ''}
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-slate-800/70">
                        {onUpsertSector && (
                          <button
                            type="button"
                            disabled={sectorCrudBusy}
                            onClick={() => openEditSectorForm(def)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold"
                          >
                            تعديل
                          </button>
                        )}
                        {onToggleSectorStatus && (
                          <button
                            type="button"
                            disabled={sectorCrudBusy}
                            onClick={() => {
                              if (isDisabled) {
                                void handleConfirmToggleSectorStatus(def, 'active');
                              } else {
                                setSectorDisableDialog({
                                  def,
                                  reassignToSectorId: '',
                                  errorText: null,
                                  pendingReport: null,
                                });
                              }
                            }}
                            className={`px-2 py-1 rounded text-[10px] font-semibold ${
                              isDisabled
                                ? 'bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/60'
                                : 'bg-amber-950/70 hover:bg-amber-900 text-amber-300 border border-amber-800/60'
                            }`}
                          >
                            {isDisabled ? 'تفعيل' : 'تعطيل'}
                          </button>
                        )}
                        {onDeleteSector && (
                          <button
                            type="button"
                            disabled={sectorCrudBusy}
                            onClick={() =>
                              setSectorDeleteDialog({
                                def,
                                reassignToSectorId: '',
                                errorText: null,
                                pendingReport: null,
                              })
                            }
                            className="px-2 py-1 rounded bg-red-950/60 hover:bg-red-900/70 text-red-300 border border-red-900/60 text-[10px] font-semibold"
                          >
                            حذف
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3B: Explicit Admin Stock Sector Override (Active-Only Sector Dropdown) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white">تعيين واعتماد قطاع الأسهم المشتقة (Admin Sector Override)</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                ربط كل سهم بقطاع نشط حصراً من سجل sectorPE وتصنيف النشاط المعتمد (غير مالي / مالي / غير معروف).
              </p>
            </div>

            {stocks.length === 0 ? (
              <div className="text-xs text-slate-400 py-4 text-center">
                لا توجد أسهم مشتقة من السجلات المالية حالياً.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto border border-slate-800 rounded-xl">
                <table className="w-full text-xs text-start">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 sticky top-0">
                    <tr>
                      <th className="p-2.5 text-start">الرمز والاسم</th>
                      <th className="p-2.5 text-start">القطاع الحالي والمصدر</th>
                      <th className="p-2.5 text-start">تعيين قطاع نشط (sectorPE)</th>
                      <th className="p-2.5 text-start">تصنيف النشاط (DCF)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {stocks.map((st) => {
                      const busy = assigningTicker === st.ticker;
                      const matchRes = matchSectorFromRegistry({
                        sectorId: st.sectorId,
                        rawSector: st.rawSector ?? st.sector,
                        sectorDefinitions: visibleSectorDefs,
                        includeDisabled: false,
                      });
                      const activeMatchedDef = matchRes.status === 'matched' ? matchRes.sector : null;
                      return (
                        <tr key={st.ticker} className="hover:bg-slate-800/30">
                          <td className="p-2.5">
                            <div className="font-mono font-bold text-emerald-400">{st.ticker}</div>
                            <div className="text-[11px] text-slate-300 truncate max-w-[180px]">{st.nameAr}</div>
                          </td>
                          <td className="p-2.5">
                            <div className="text-slate-200 font-medium">{st.sector || 'غير محدد'}</div>
                            <div className="text-[10px] font-mono text-slate-400">
                              {st.sectorSource ?? 'missing'}
                              {st.sectorDate ? ` · ${st.sectorDate}` : ''}
                            </div>
                          </td>
                          <td className="p-2.5">
                            <select
                              aria-label={`تعيين قطاع ${st.ticker}`}
                              disabled={!onPatchCompanyMetadata || busy || activeSectorDefs.length === 0}
                              value={activeMatchedDef?.sectorId ?? ''}
                              onChange={(e) => handleAssignStockSector(st, e.target.value)}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200 disabled:opacity-50"
                            >
                              <option value="">-- اختر قطاعاً نشطاً من sectorPE --</option>
                              {activeSectorDefs.map((def) => (
                                <option key={def.sectorId} value={def.sectorId}>
                                  {def.nameAr} ({def.classification === 'financial' ? 'مالي' : def.classification === 'non_financial' ? 'غير مالي' : 'غير معروف'})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2.5">
                            <select
                              aria-label={`تصنيف نشاط ${st.ticker}`}
                              title={
                                activeMatchedDef
                                  ? `التصنيف محكوم بتعريف القطاع "${activeMatchedDef.nameAr}" في sectorPE`
                                  : 'تصنيف نشاط يدوي للأسهم غير المرتبطة بقطاع في sectorPE'
                              }
                              disabled={!onPatchCompanyMetadata || busy || Boolean(activeMatchedDef)}
                              value={st.sectorClassification ?? 'unknown'}
                              onChange={(e) =>
                                handleAssignStockSector(
                                  st,
                                  activeMatchedDef?.sectorId ?? '',
                                  e.target.value as SectorClassification
                                )
                              }
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-200 disabled:opacity-50"
                            >
                              <option value="unknown">غير معروف</option>
                              <option value="non_financial">غير مالي (مؤهل DCF)</option>
                              <option value="financial">مالي / بنوك</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 3C: Security Identity, Ambiguous / Disabled / Unmapped Sectors & Conflict Diagnostics */}
          {universeDiagnostics && (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 text-xs">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
                <h4 className="font-bold text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>قطاعات غير مربوطة بالسجل ({universeDiagnostics.unmappedSectors.length})</span>
                </h4>
                {universeDiagnostics.unmappedSectors.length === 0 ? (
                  <p className="text-[11px] text-slate-400">جميع قطاعات الأسهم النشطة مربوطة بسجل sectorPE الرسمي.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto text-[11px]">
                    {universeDiagnostics.unmappedSectors.map((u, i) => (
                      <li key={`${u.ticker}-${i}`} className="bg-slate-950/70 px-2.5 py-1.5 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate">
                          <span className="font-mono font-bold text-emerald-400">{u.ticker}</span>{' '}
                          <span className="text-slate-300">{u.rawSector}</span>
                        </div>
                        {onUpsertSector && (
                          <button
                            type="button"
                            onClick={() => openCreateSectorForm(u.rawSector)}
                            className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/70 text-[10px] shrink-0"
                          >
                            + إضافة لـ sectorPE
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
                <h4 className="font-bold text-orange-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>تطابقات غامضة أو معطّلة ({universeDiagnostics.ambiguousSectors.length + universeDiagnostics.disabledSectors.length})</span>
                </h4>
                {universeDiagnostics.ambiguousSectors.length === 0 &&
                universeDiagnostics.disabledSectors.length === 0 ? (
                  <p className="text-[11px] text-slate-400">لا توجد قطاعات متنازعة أو معطّلة على الأسهم النشطة.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto text-[11px]">
                    {universeDiagnostics.ambiguousSectors.map((a, i) => (
                      <li key={`amb-${a.ticker}-${i}`} className="bg-orange-950/30 px-2.5 py-1.5 rounded-lg border border-orange-900/50 text-orange-200">
                        <span className="font-mono font-bold">{a.ticker}</span> ({a.rawSector}): {a.reasonAr}
                      </li>
                    ))}
                    {universeDiagnostics.disabledSectors.map((d, i) => (
                      <li key={`dis-${d.ticker}-${i}`} className="bg-amber-950/30 px-2.5 py-1.5 rounded-lg border border-amber-900/50 text-amber-200">
                        <span className="font-mono font-bold">{d.ticker}</span> ({d.rawSector}): {d.reasonAr}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
                <h4 className="font-bold text-red-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>تعارضات ISIN والبيانات الوصفية ({universeDiagnostics.metadataConflicts.length})</span>
                </h4>
                {universeDiagnostics.metadataConflicts.length === 0 ? (
                  <p className="text-[11px] text-slate-400">لا توجد تعارضات مسجلة في رموز ISIN أو البيانات الوصفية.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto text-[11px]">
                    {universeDiagnostics.metadataConflicts.map((c, i) => (
                      <li key={`${c.ticker}-${c.field}-${i}`} className="bg-red-950/30 px-2.5 py-1.5 rounded-lg border border-red-900/50 text-red-200">
                        <span className="font-mono font-bold">{c.ticker}</span> ({c.field}): {c.reasonAr}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2 lg:col-span-2 xl:col-span-3">
                <h4 className="font-bold text-sky-300 flex items-center gap-1.5">
                  <Building className="w-4 h-4 shrink-0" />
                  <span>أوراق مستبعدة (غير أسهم عادية: {universeDiagnostics.excludedNonEquity.length})</span>
                </h4>
                {universeDiagnostics.excludedNonEquity.length === 0 ? (
                  <p className="text-[11px] text-slate-400">لم تُرصد سندات أو صكوك أو حقوق اكتتاب ضمن السجلات المالية.</p>
                ) : (
                  <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto text-[11px]">
                    {universeDiagnostics.excludedNonEquity.map((ex, i) => (
                      <li key={`${ex.ticker}-${i}`} className="bg-slate-950/70 px-2.5 py-1.5 rounded-lg border border-slate-800 text-slate-300">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-sky-300">{ex.ticker}</span>
                          <span className="font-mono text-[10px] text-amber-300">{ex.instrumentType}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{ex.reasonAr}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. TAB 3: Users & Commercial Subscription Tiers */}
      {activeAdminTab === 'users' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>إدارة المستخدمين والأدوار والاشتراكات التجارية (RBAC & SaaS)</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                تحديد الصلاحيات: مدير (Admin) · مدخل بيانات (Data Entry) · سكرتارية (Assistant) · مشترك (Subscriber).
              </p>
            </div>

            <div className="text-xs bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 flex items-center gap-2">
              <span className="text-slate-400">المستخدم النشط حالياً:</span>
              <strong className="text-emerald-400 font-semibold">{currentUser.displayName}</strong>
              <span className="text-[10px] px-1.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                {currentUser.role}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-3 text-start">الاسم والبريد الإلكتروني</th>
                  <th className="p-3 text-center">الدور في النظام</th>
                  <th className="p-3 text-center">باقة الاشتراك</th>
                  <th className="p-3 text-center font-mono">تاريخ الصلاحية</th>
                  <th className="p-3 text-center font-mono">آخر دخول</th>
                  <th className="p-3 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3 text-start">
                      <div className="font-bold text-slate-200">{u.displayName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{u.email}</div>
                    </td>
                    <td className="p-3 text-center">
                      <select
                        value={u.role}
                        onChange={(e) => {
                          const updated = users.map((x) =>
                            x.id === u.id ? { ...x, role: e.target.value as UserRole } : x
                          );
                          onSaveUsers(updated);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded p-1 text-[11px] text-slate-200 font-semibold"
                      >
                        <option value="admin">مدير النظام (Admin)</option>
                        <option value="data_entry">مدخل بيانات (Data Entry)</option>
                        <option value="assistant">سكرتارية / مساند (Assistant)</option>
                        <option value="subscriber">مشترك تجاري (Subscriber)</option>
                      </select>
                    </td>
                    <td className="p-3 text-center">
                      <select
                        value={u.tier}
                        onChange={(e) => {
                          const updated = users.map((x) =>
                            x.id === u.id ? { ...x, tier: e.target.value as SubscriptionTier } : x
                          );
                          onSaveUsers(updated);
                        }}
                        className="bg-slate-950 border border-slate-700 rounded p-1 text-[11px] text-emerald-400 font-semibold"
                      >
                        <option value="free">مجاني (Free)</option>
                        <option value="bronze">برونزي (Bronze)</option>
                        <option value="silver">فضي (Silver)</option>
                        <option value="gold">ذهبي (Gold)</option>
                        <option value="institutional">مؤسسي (Institutional)</option>
                      </select>
                    </td>
                    <td className="p-3 text-center font-mono text-slate-400 text-[11px]">
                      {u.subscriptionExpiresAt || 'دائم / غير منتهٍ'}
                    </td>
                    <td className="p-3 text-center font-mono text-slate-400 text-[11px]">
                      {u.lastLoginAt?.split('T')[0] || '-'}
                    </td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => onSwitchUser(u)}
                          className={`px-2 py-1 text-[10px] rounded font-semibold transition-colors ${
                            currentUser.id === u.id
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {currentUser.id === u.id ? 'الحالي' : 'محاكاة الدخول'}
                        </button>
                        {u.id !== currentUser.id && (
                          <button
                            onClick={() => setUserToDelete(u)}
                            className="p-1 text-slate-400 hover:text-red-400 transition-colors"
                            title="حذف المستخدم"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4B. TAB 4: Governance, Maintenance & Dry-Run Legacy Migration Tool */}
      {activeAdminTab === 'governance' && (
        <div className="space-y-5">
          {/* Independent Local Dry-Run Legacy Migration Preview */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileSearch className="w-4 h-4 text-sky-400" />
                  <span>أداة معاينة ترحيل البيانات القديمة (Dry-Run Migration Preview)</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  تفحص محلياً دون أي تعديل على Firestore: القيم الافتراضية المضللة ("غير مصنف")، مطابقة القطاعات من التداول اليومي، مفاتيح sectorPEMap، والأدوات غير الأسهم، وسجلات الوحدات المليونية القديمة.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleRunDryRunMigration}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                >
                  <FileSearch className="w-3.5 h-3.5" />
                  <span>تشغيل المعاينة الجافة (Dry-Run)</span>
                </button>
                {dryRunReport && (
                  <>
                    <button
                      type="button"
                      onClick={handleCopyDryRunJson}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedDryRun ? 'تم النسخ' : 'نسخ التقرير JSON'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadDryRunJson}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>تنزيل التقرير</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {dryRunReport && (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 font-mono">
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="font-sans text-[10px] text-slate-400">نصوص قطاع مضللة</div>
                    <div className="text-lg font-bold text-amber-300 mt-0.5">
                      {dryRunReport.summaryCounts.companiesPlaceholderSector}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="font-sans text-[10px] text-slate-400">قابلة للإثراء من اليومي</div>
                    <div className="text-lg font-bold text-emerald-400 mt-0.5">
                      {dryRunReport.summaryCounts.companiesEnrichableFromDaily}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="font-sans text-[10px] text-slate-400">مستندات sectorPE غنية / قديمة</div>
                    <div className="text-lg font-bold text-sky-300 mt-0.5">
                      {dryRunReport.summaryCounts.sectorPeRichDocsCount} / {dryRunReport.summaryCounts.sectorPeLegacyFormatCount}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="font-sans text-[10px] text-slate-400">قطاعات غير معرفة / معطّلة / بلا P/E</div>
                    <div className="text-lg font-bold text-red-300 mt-0.5">
                      {dryRunReport.summaryCounts.sectorPeUnmappedKeys} · {dryRunReport.summaryCounts.sectorPeDisabledCount} · {dryRunReport.summaryCounts.sectorPeNullMultipleCount}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="font-sans text-[10px] text-slate-400">أدوات غير أسهم</div>
                    <div className="text-lg font-bold text-purple-300 mt-0.5">
                      {dryRunReport.summaryCounts.excludedNonEquityCount}
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="font-sans text-[10px] text-slate-400">سجلات *_millions قديمة</div>
                    <div className="text-lg font-bold text-slate-200 mt-0.5">
                      {dryRunReport.summaryCounts.legacyMillionUnitRecordsCount}
                    </div>
                  </div>
                </div>

                {dryRunReport.companyChanges.length > 0 && (
                  <div className="border border-slate-800 rounded-xl overflow-hidden">
                    <div className="bg-slate-950 px-3 py-2 text-[11px] font-bold text-slate-300 border-b border-slate-800">
                      التعديلات المقترحة على بيانات الشركات ({dryRunReport.companyChanges.length}) — معاينة فقط دون تنفيذ
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/70">
                      {dryRunReport.companyChanges.map((ch, idx) => (
                        <div key={`${ch.ticker}-${ch.action}-${idx}`} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950/40">
                          <div>
                            <span className="font-mono font-bold text-emerald-400">{ch.ticker}</span>{' '}
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-sky-300">
                              {ch.action}
                            </span>
                            <div className="text-[11px] text-slate-300 mt-0.5">{ch.reasonAr}</div>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 shrink-0">
                            {ch.currentSector ?? 'null'} ← {ch.proposedSector ?? 'null'} ({ch.proposedClassification})
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {dryRunReport.betaDefaultAudit && (
                  <div
                    role={dryRunReport.betaDefaultAudit.status === 'conflict_non_one' ? 'alert' : 'status'}
                    className={`p-3 rounded-xl border text-xs ${
                      dryRunReport.betaDefaultAudit.status === 'conflict_non_one'
                        ? 'bg-red-950/35 border-red-800/70 text-red-200'
                        : 'bg-slate-950/70 border-slate-800 text-slate-300'
                    }`}
                  >
                    <span className="font-bold">فحص معامل Beta_Default العام ({dryRunReport.betaDefaultAudit.status}): </span>
                    <span>{dryRunReport.betaDefaultAudit.reasonAr}</span>
                  </div>
                )}

                {dryRunReport.legacyParameterMigrations && dryRunReport.legacyParameterMigrations.length > 0 && (
                  <div className="border border-slate-800 rounded-xl overflow-hidden">
                    <div className="bg-slate-950 px-3 py-2 text-[11px] font-bold text-slate-300 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <span>معاينة ترحيل افتراضات وبيتا companies القديمة ({dryRunReport.legacyParameterMigrations.length})</span>
                      <span className="font-mono text-[10px] text-slate-400">
                        جاهز: {dryRunReport.summaryCounts.legacyParamsReadyToMigrate} · مطابق: {dryRunReport.summaryCounts.legacyParamsAlreadyMigrated} · تعارض: {dryRunReport.summaryCounts.legacyParamsConflicts}
                      </span>
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/70">
                      {dryRunReport.legacyParameterMigrations.map((item, idx) => (
                        <div key={`${item.ticker}-${item.legacyField}-${idx}`} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950/40">
                          <div>
                            <span className="font-mono font-bold text-emerald-400">{item.ticker}</span>{' '}
                            <span className="font-mono text-[11px] text-slate-200">
                              companies.{item.legacyField} ({item.legacyValue}) → {item.targetCollection}/{item.targetKey}
                            </span>
                            <div className="text-[11px] text-slate-400 mt-0.5">{item.reasonAr}</div>
                          </div>
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded shrink-0 ${
                              item.status === 'ready_to_migrate'
                                ? 'bg-sky-950 text-sky-300'
                                : item.status === 'already_migrated_equal'
                                ? 'bg-emerald-950 text-emerald-300'
                                : 'bg-red-950 text-red-300'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {dryRunReport.sectorPeChanges.length > 0 && (
                  <div className="border border-slate-800 rounded-xl overflow-hidden">
                    <div className="bg-slate-950 px-3 py-2 text-[11px] font-bold text-slate-300 border-b border-slate-800">
                      تقرير فحص مفاتيح قطاعية P/E ({dryRunReport.sectorPeChanges.length})
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-slate-800/70">
                      {dryRunReport.sectorPeChanges.map((sp, idx) => (
                        <div key={`${sp.currentKey}-${idx}`} className="px-3 py-2 flex items-center justify-between gap-2 bg-slate-950/40 text-[11px]">
                          <div>
                            <span className="font-semibold text-slate-200">{sp.currentKey}</span> ({sp.multiple}x) —{' '}
                            <span className="text-slate-400">{sp.reasonAr}</span>
                          </div>
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                              sp.status === 'already_canonical'
                                ? 'bg-emerald-950 text-emerald-300'
                                : sp.status === 'legacy_value_doc'
                                ? 'bg-sky-950 text-sky-300'
                                : sp.status === 'duplicate_alias_conflict' || sp.status === 'unmapped_key'
                                ? 'bg-red-950 text-red-300'
                                : 'bg-amber-950 text-amber-300'
                            }`}
                          >
                            {sp.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {dryRunReport.reportedEpsPeriodAudit && dryRunReport.reportedEpsPeriodAudit.length > 0 && (
                  <div className="border border-slate-800 rounded-xl overflow-hidden">
                    <div className="bg-slate-950 px-3 py-2 text-[11px] font-bold text-slate-300 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <span>مراجعة فترات ReportedEPS القديمة ({dryRunReport.reportedEpsPeriodAudit.length}) — معاينة فقط دون تعديل تلقائي</span>
                      <span className="font-mono text-[10px] text-slate-400">
                        مهيكل صحيح: {dryRunReport.summaryCounts.reportedEpsStructuredValidCount} · قابل للتحويل بلا لبس: {dryRunReport.summaryCounts.reportedEpsUnambiguousConvertibleCount} · يحتاج مراجعة: {dryRunReport.summaryCounts.reportedEpsNeedsReviewCount}
                      </span>
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/70">
                      {dryRunReport.reportedEpsPeriodAudit.map((item, idx) => (
                        <div key={`${item.ticker}-${item.year}-${item.quarter}-${idx}`} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950/40 text-[11px]">
                          <div>
                            <span className="font-mono font-bold text-emerald-400">{item.ticker}</span>{' '}
                            <span className="font-mono text-slate-200">{item.quarter} {item.year}</span>
                            {item.legacyReportedEpsPeriod ? (
                              <span className="text-slate-400"> · النص القديم: <span className="font-mono text-slate-200">{item.legacyReportedEpsPeriod}</span></span>
                            ) : null}
                            <div className="text-[11px] text-slate-400 mt-0.5">{item.reasonAr}</div>
                          </div>
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded shrink-0 ${
                              item.status === 'structured_valid'
                                ? 'bg-emerald-950 text-emerald-300'
                                : item.status === 'unambiguous_convertible'
                                ? 'bg-sky-950 text-sky-300'
                                : 'bg-amber-950 text-amber-300'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Wrench className="w-4 h-4 text-emerald-400" />
                <span>أدوات صيانة وحوكمة قاعدة البيانات السحابية (Admin Cloud Maintenance)</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                تشغيل عمليات الترحيل والتحقق وتنظيف شواهد الحذف مباشرة على خادم Firebase Functions دون كتابة عمياء من المتصفح.
              </p>
            </div>

            {maintenanceMessage && (
              <div
                role="status"
                className={`p-3 rounded-xl border text-xs ${
                  maintenanceMessage.ok
                    ? 'bg-emerald-950/70 border-emerald-800 text-emerald-200'
                    : 'bg-red-950/70 border-red-800 text-red-200'
                }`}
              >
                {maintenanceMessage.text}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {[
                {
                  op: 'migrate_legacy_beta' as AdminMaintenanceOperation,
                  title: 'ترحيل بيتا القديمة إلى beta_assumptions',
                  desc: 'ينسخ قيم بيتا المخزنة سابقاً في مستندات companies إلى مجموعة beta_assumptions المعتمدة دون استبدال السجلات الأحدث.',
                },
                {
                  op: 'migrate_legacy_company_overrides' as AdminMaintenanceOperation,
                  title: 'ترحيل افتراضات الشركات إلى company_assumptions',
                  desc: 'ينقل حقول التقييم المخزنة سابقاً داخل companies إلى المسار الهرمي company_assumptions/{ticker}/parameters/{key}.',
                },
                {
                  op: 'backfill_server_timestamps' as AdminMaintenanceOperation,
                  title: 'استكمال أختام التوقيت الخادمية (serverUpdatedAt)',
                  desc: 'يضيف serverUpdatedAt للوثائق القديمة غير المختومة لضمان عمل المزامنة التزايدية بدون سقوط.',
                },
                {
                  op: 'cleanup_expired_tombstones' as AdminMaintenanceOperation,
                  title: 'تنظيف شواهد الحذف المنتهية (tombstones)',
                  desc: 'يزيل شواهد الحذف التي تجاوزت مدة الاحتفاظ المعتمدة (30 يوماً).',
                },
              ].map((item) => {
                const busy = maintenanceRunning === item.op;
                return (
                  <div
                    key={item.op}
                    className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3"
                  >
                    <div>
                      <h4 className="font-bold text-slate-100">{item.title}</h4>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{item.desc}</p>
                    </div>
                    <button
                      type="button"
                      disabled={!onRunMaintenance || maintenanceRunning !== null}
                      onClick={() => triggerMaintenance(item.op, item.title)}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                      <span>{busy ? 'جارٍ التنفيذ على الخادم...' : 'تنفيذ الإجراء'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 5. Add Custom Parameter Modal */}
      {isAddParamModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">إضافة متغير مالي أو كلي جديد للنظام</h3>
              <button
                onClick={() => setIsAddParamModalOpen(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddNewParam} className="space-y-3 text-xs">
              {addParamError && (
                <div
                  role="alert"
                  className="p-2.5 rounded-lg border border-red-800/80 bg-red-950/50 text-red-200 text-[11px] leading-relaxed"
                >
                  {addParamError}
                </div>
              )}

              {missingDefinitions.length > 0 && (
                <div>
                  <label className="block text-slate-400 mb-1">اختيار متغير قياسي من التعريفات المعتمدة</label>
                  <select
                    value=""
                    onChange={(e) => {
                      const def = missingDefinitions.find((d) => d.key === e.target.value);
                      if (def) {
                        setNewParamKey(def.key);
                        setNewParamNameAr(def.nameAr);
                        setNewParamDesc(def.descriptionAr);
                        setNewParamCustomIsPercent(def.valueType === 'pct');
                        setAddParamError(null);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    <option value="">-- اختر لتعبئة التعريف تلقائياً --</option>
                    {missingDefinitions.map((def) => (
                      <option key={def.key} value={def.key}>
                        {def.key} — {def.nameAr}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1">رمز المتغير البرمجي (Key)*</label>
                <input
                  type="text"
                  placeholder="مثال: RIM_Retention أو Rf_Egypt_10Y"
                  value={newParamKey}
                  onChange={(e) => {
                    setNewParamKey(e.target.value);
                    setAddParamError(null);
                  }}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                />
                {newParamKey.trim() !== '' && !newParamSpec.allowedScopes.includes('global') && (
                  <p className="text-[11px] text-red-300 mt-1">
                    تنبيه: هذا المعامل مخصص لنطاق الشركة فقط (company_assumptions) ولا يُقبل في المتغيرات العامة.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-slate-400 mb-1">التسمية باللغة العربية*</label>
                <input
                  type="text"
                  placeholder="التسمية العربية للمتغير"
                  value={newParamNameAr}
                  onChange={(e) => {
                    setNewParamNameAr(e.target.value);
                    setAddParamError(null);
                  }}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>

              {newParamKey.trim() !== '' && !newParamSpec.isCataloged && (
                <div>
                  <label className="block text-slate-400 mb-1">نوع وحدة المتغير المخصص</label>
                  <select
                    value={newParamCustomIsPercent ? 'pct' : 'number'}
                    onChange={(e) => setNewParamCustomIsPercent(e.target.value === 'pct')}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                  >
                    <option value="number">معامل عددي عادي (يُحفظ كما يُدخل دون تحويل)</option>
                    <option value="pct">نسبة مئوية (%) — تُدخل بالمئة وتُحفظ ككسر عشري</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1">
                  القيمة المعتمدة — {newParamSpec.displayUnitLabelAr}*
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode={newParamSpec.inputMode}
                    placeholder={newParamSpec.placeholderAr}
                    value={newParamVal}
                    onChange={(e) => {
                      setNewParamVal(e.target.value);
                      setAddParamError(null);
                    }}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                  />
                  {newParamSpec.inputSuffix && (
                    <span className="px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 font-mono text-slate-300 shrink-0">
                      {newParamSpec.inputSuffix}
                    </span>
                  )}
                </div>
                <div className="mt-1 space-y-0.5 text-[10px] text-slate-400">
                  <div>{newParamSpec.storageHintAr}</div>
                  {newParamSpec.boundsSummaryAr && (
                    <div className="text-emerald-300/90">{newParamSpec.boundsSummaryAr}</div>
                  )}
                  {newParamSpec.modeNoteAr && (
                    <div className="text-amber-300">{newParamSpec.modeNoteAr}</div>
                  )}
                </div>
              </div>

              {RF_METHODOLOGY_KEYS.has(newParamKey.trim()) && (
                <div>
                  <label className="block text-slate-400 mb-1">تصنيف منهجية Rf (rfMethodology)</label>
                  <select
                    value={newParamRfMethodology}
                    onChange={(e) => setNewParamRfMethodology(e.target.value as CanonicalRfMethodology)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 font-mono text-slate-200"
                  >
                    <option value="unspecified">unspecified (غير مصنف)</option>
                    <option value="sovereign_yield">sovereign_yield (عائد سيادي خام)</option>
                    <option value="default_free">default_free (خالٍ من التعثر السيادي)</option>
                    <option value="synthetic">synthetic (عائد تركيبي)</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-slate-400 mb-1">شرح الدور المحاسبي في المعادلات</label>
                <textarea
                  rows={2}
                  placeholder="كيف يؤثر هذا المتغير في حسابات التقييم أو WACC..."
                  value={newParamDesc}
                  onChange={(e) => setNewParamDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isAddingParam}
                  onClick={() => {
                    setIsAddParamModalOpen(false);
                    setAddParamError(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-40"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isAddingParam || draftState.isSaving}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold"
                >
                  {isAddingParam ? 'جارٍ الإنشاء...' : 'حفظ المتغير'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unsaved Macro Drafts Tab-Switch Protection Modal */}
      {pendingAdminTab && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-amber-700/70 rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">توجد مسودات غير محفوظة للمعاملات العامة</h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  لديك {draftSummary.dirtyKeys.length} مسودة تعديل محلي لم تُحفظ بعد في Firestore. اختر الإجراء المطلوب قبل الانتقال من شاشة المتغيرات:
                </p>
              </div>
            </div>
            {draftSummary.hasBlockingIssues && (
              <div className="p-2.5 rounded-lg bg-red-950/50 border border-red-800/70 text-[11px] text-red-200">
                لا يمكن الحفظ التلقائي لوجود تعارض تزامن أو معامل محذوف على الخادم؛ اختر البقاء لمعالجته أو التخلي عن المسودات.
              </div>
            )}
            {pendingTabFeedback && (
              <div
                role="alert"
                className={`p-2.5 rounded-lg border text-[11px] ${
                  pendingTabFeedback.kind === 'error'
                    ? 'bg-red-950/50 border-red-800/70 text-red-200'
                    : 'bg-amber-950/50 border-amber-700/70 text-amber-200'
                }`}
              >
                {pendingTabFeedback.text}
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-800 text-xs">
              <button
                type="button"
                disabled={draftState.isSaving}
                onClick={() => {
                  setPendingTabFeedback(null);
                  setPendingAdminTab(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              >
                البقاء
              </button>
              <button
                type="button"
                disabled={draftState.isSaving}
                onClick={() => {
                  const target = pendingAdminTab;
                  handleDiscardAllDrafts();
                  setPendingTabFeedback(null);
                  setPendingAdminTab(null);
                  setActiveAdminTab(target);
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-900/70 hover:bg-rose-800 text-rose-100 border border-rose-700/70 font-semibold"
              >
                التخلي عن المسودات
              </button>
              <button
                type="button"
                disabled={draftState.isSaving || draftSummary.hasBlockingIssues}
                onClick={async () => {
                  const target = pendingAdminTab;
                  const startScope = draftStore.getState().userScopeKey;
                  setPendingTabFeedback(null);
                  const outcome = await handleSaveDirtyParams();
                  const latestState = draftStore.getState();
                  const latestSummary = getMacroParamDraftSummary(latestState);
                  if (
                    outcome.safeToLeave &&
                    latestState.userScopeKey === startScope &&
                    !latestSummary.hasUnsavedChanges &&
                    !latestSummary.hasBlockingIssues
                  ) {
                    setPendingAdminTab(null);
                    setActiveAdminTab(target);
                    return;
                  }
                  if (outcome.status === 'ignored_stale') {
                    if (latestState.userScopeKey !== startScope) {
                      setPendingAdminTab(null);
                    }
                    return;
                  }
                  if (outcome.errorAr) {
                    setPendingTabFeedback({ kind: 'error', text: outcome.errorAr });
                  } else if (outcome.status === 'saved_with_newer_draft') {
                    setPendingTabFeedback({
                      kind: 'info',
                      text:
                        outcome.noticeAr ||
                        'تم حفظ التعديل السابق، ولكن توجد تعديلات محلية أحدث غير محفوظة؛ لن يتم الانتقال قبل حفظها أو تجاهلها.',
                    });
                  }
                }}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold"
              >
                {draftState.isSaving ? 'جارٍ الحفظ...' : 'حفظ التعديلات والمتابعة'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Confirm Delete User Modal */}
      <ConfirmDeleteModal
        isOpen={!!userToDelete}
        title="تأكيد حذف حساب المستخدم"
        itemName={userToDelete ? `${userToDelete.displayName} (${userToDelete.email})` : ''}
        cascadeImpacts={[
          'إلغاء اشتراك المستخدم فوراً وإيقاف صلاحيات الوصول لقواعد البيانات السحابية.',
          'حذف سجلات الدخول وتفضيلات التداول المحفوظة للمستخدم.',
          'لا يمكن استرجاع هذا الحساب بعد الحذف.',
        ]}
        onConfirm={handleConfirmDeleteUser}
        onCancel={() => setUserToDelete(null)}
      />

      {/* 7. Confirm Delete Macro Parameter Modal */}
      <ConfirmDeleteModal
        isOpen={!!paramToDelete}
        title="تأكيد حذف المعامل الكلي"
        itemName={paramToDelete ? `${paramToDelete.key} (${paramToDelete.nameAr})` : ''}
        cascadeImpacts={[
          'حذف المعامل من مجموعة macro_params في Firestore وإنشاء شاهد حذف (tombstone).',
          'النماذج المعتمدة على هذا المعامل ستنتقل إلى حالة التعذر الصريح عند غياب بديل خاص بالشركة.',
        ]}
        onConfirm={handleConfirmDeleteParam}
        onCancel={() => setParamToDelete(null)}
      />

      {/* 8. Confirm Disable Sector Modal */}
      {sectorDisableDialog && (
        <SectorGovernanceActionModal
          mode="disable"
          sector={sectorDisableDialog.def}
          linkedCompanies={getLinkedCompaniesForSector(sectorDisableDialog.def)}
          activeReplacementSectors={activeSectorDefs.filter(
            (d) => d.sectorId !== sectorDisableDialog.def.sectorId
          )}
          reassignToSectorId={sectorDisableDialog.reassignToSectorId}
          onChangeReassignToSectorId={(nextId) =>
            setSectorDisableDialog((prev) =>
              prev ? { ...prev, reassignToSectorId: nextId, errorText: null } : prev
            )
          }
          busy={sectorCrudBusy}
          errorText={sectorDisableDialog.errorText}
          pendingReport={sectorDisableDialog.pendingReport}
          onConfirm={() =>
            handleConfirmToggleSectorStatus(
              sectorDisableDialog.def,
              'disabled',
              sectorDisableDialog.reassignToSectorId || undefined,
              sectorDisableDialog.pendingReport?.resumeAfterCompanyId ?? null,
              sectorDisableDialog.pendingReport?.mutationId ?? null
            )
          }
          onCancel={() => setSectorDisableDialog(null)}
        />
      )}

      {/* 9. Confirm Delete Sector Modal */}
      {sectorDeleteDialog && (
        <SectorGovernanceActionModal
          mode="delete"
          sector={sectorDeleteDialog.def}
          linkedCompanies={getLinkedCompaniesForSector(sectorDeleteDialog.def)}
          activeReplacementSectors={activeSectorDefs.filter(
            (d) => d.sectorId !== sectorDeleteDialog.def.sectorId
          )}
          reassignToSectorId={sectorDeleteDialog.reassignToSectorId}
          onChangeReassignToSectorId={(nextId) =>
            setSectorDeleteDialog((prev) =>
              prev ? { ...prev, reassignToSectorId: nextId, errorText: null } : prev
            )
          }
          busy={sectorCrudBusy}
          errorText={sectorDeleteDialog.errorText}
          pendingReport={sectorDeleteDialog.pendingReport}
          onConfirm={handleConfirmDeleteSector}
          onCancel={() => setSectorDeleteDialog(null)}
        />
      )}
    </div>
  );
};
